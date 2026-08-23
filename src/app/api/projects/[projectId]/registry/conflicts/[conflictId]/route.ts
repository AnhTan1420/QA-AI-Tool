import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createClient } from '@/services/supabase/server';
import { parseClassMethods, replaceMethodInClass } from '@/services/automation/page-object-merge';

const resolveConflictSchema = z.object({
  resolution: z.enum(['keep_existing', 'use_proposed', 'manual']),
  // Required only for 'manual' — full replacement text for the conflicting method
  // (e.g. `async fillEmail(value: string) { ... }`), reviewed/edited by a human.
  manual_method_code: z.string().min(1).optional(),
});

/**
 * Resolves ONE Page Object Registry conflict (Automation Agent Rebuild §4.1.3,
 * Principle P3: "AI đề xuất, hệ thống merge, con người duyệt xung đột"). This route
 * is deliberately the ONLY place in the whole Registry system where an EXISTING
 * method's body can change — never from a Generate/Heal call, never automatically.
 *
 * - 'keep_existing': no code change, just marks the conflict resolved (the AI's
 *   proposal is discarded — the existing method was correct/still preferred).
 * - 'use_proposed': extracts the specific method's text from the conflict's stored
 *   `proposed_code` snapshot (NOT the whole file — see replaceMethodInClass) and
 *   replaces just that method in the registry entry's current code.
 * - 'manual': same as 'use_proposed' but with reviewer-supplied `manual_method_code`
 *   instead of the AI's original proposal (e.g. the AI was half-right).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; conflictId: string }> },
) {
  try {
    const { projectId, conflictId } = await params;
    const rawBody = await req.json();
    const input = resolveConflictSchema.parse(rawBody);
    if (input.resolution === 'manual' && !input.manual_method_code) {
      return NextResponse.json(
        { success: false, error: 'Cần cung cấp manual_method_code khi chọn resolution "manual".' },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data: conflict, error: conflictError } = await supabase
      .from('automation_registry_conflicts')
      .select('id, project_id, page_object_id, method_name, proposed_code, status')
      .eq('id', conflictId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (conflictError || !conflict) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy conflict này.' }, { status: 404 });
    }
    if (conflict.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Conflict này đã được xử lý trước đó (${conflict.status}).` },
        { status: 409 },
      );
    }

    if (input.resolution !== 'keep_existing') {
      const { data: entry, error: entryError } = await supabase
        .from('automation_page_objects')
        .select('code, method_signatures, version')
        .eq('id', conflict.page_object_id)
        .single();
      if (entryError || !entry) {
        return NextResponse.json({ success: false, error: 'Không tìm thấy Page Object tương ứng trong Registry.' }, { status: 404 });
      }

      let replacementMethodText: string;
      if (input.resolution === 'use_proposed') {
        const proposedMethods = parseClassMethods(conflict.proposed_code);
        const proposedMethod = proposedMethods.find((m) => m.name === conflict.method_name);
        if (!proposedMethod) {
          return NextResponse.json(
            { success: false, error: `Không tìm thấy method "${conflict.method_name}" trong bản AI đề xuất đã lưu.` },
            { status: 422 },
          );
        }
        replacementMethodText = proposedMethod.fullText;
      } else {
        replacementMethodText = input.manual_method_code!;
      }

      // Guard against a silent no-op: replaceMethodInClass() returns the code
      // UNCHANGED (not an error) when it can't find conflict.method_name in the
      // registry entry's CURRENT code — e.g. the entry was edited/renamed by
      // something else between when this conflict was created and now. Without this
      // check the route would report success (200, status updated to resolved_*)
      // while the registry entry's code silently never actually changed — exactly
      // the kind of "looks resolved but wasn't" bug Principle P3 exists to prevent.
      if (!parseClassMethods(entry.code).some((m) => m.name === conflict.method_name)) {
        return NextResponse.json(
          {
            success: false,
            error: `Method "${conflict.method_name}" không còn tồn tại trong Page Object hiện tại - có thể đã bị thay đổi bởi một thao tác khác. Vui lòng tải lại trang Registry.`,
          },
          { status: 409 },
        );
      }

      const newCode = replaceMethodInClass(entry.code, conflict.method_name, replacementMethodText);
      const reparsedMethod = parseClassMethods(newCode).find((m) => m.name === conflict.method_name);
      const newMethodSignatures = (entry.method_signatures as { name: string; params: string; added_by_test_case_id: string | null; added_at: string }[]).map(
        (m) =>
          m.name === conflict.method_name
            ? { name: m.name, params: reparsedMethod?.paramsRaw ?? m.params, added_by_test_case_id: m.added_by_test_case_id, added_at: new Date().toISOString() }
            : m,
      );

      const { error: updateError } = await supabase
        .from('automation_page_objects')
        .update({
          code: newCode,
          method_signatures: newMethodSignatures,
          version: entry.version + 1,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conflict.page_object_id);
      if (updateError) {
        return NextResponse.json({ success: false, error: `Không cập nhật được Registry: ${updateError.message}` }, { status: 500 });
      }
    }

    const resolvedStatus =
      input.resolution === 'keep_existing' ? 'resolved_keep_existing' : input.resolution === 'use_proposed' ? 'resolved_use_proposed' : 'resolved_manual';
    const { data: updatedConflict, error: resolveError } = await supabase
      .from('automation_registry_conflicts')
      .update({ status: resolvedStatus, resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq('id', conflictId)
      .select('*')
      .single();
    if (resolveError) {
      return NextResponse.json({ success: false, error: resolveError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updatedConflict });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const errorMessage = 'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }
    const failureMessage = error instanceof Error ? error.message : 'Không thể xử lý conflict này';
    return NextResponse.json({ success: false, error: failureMessage }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { dedupePageObjectsByClassName } from '@/services/automation/page-object-merge';
import type { PageObject } from '@/models/validators/playwright';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: testCaseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  // Only return the single active script (no version history)
  // Two separate FKs to profiles now exist (generated_by, approved_by), so the
  // relationship must be disambiguated - PostgREST embed syntax accepts the FK
  // COLUMN name after `!`, which is more robust than guessing Postgres's
  // auto-generated constraint name.
  const { data, error } = await supabase
    .from('automation_scripts')
    .select(
      'id, version, code, page_objects, imports_used, selectors_used, warnings, created_at, status, approved_at, ' +
        'profiles!generated_by(full_name), ' +
        'approved_by_profile:profiles!approved_by(full_name)',
    )
    .eq('test_case_id', testCaseId)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .limit(1);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, data: data ?? [] });
}

/**
 * POST /api/test-cases/[id]/automation/scripts
 * Upsert: update existing script OR insert new one. No versioning.
 * Called from useAutomation.saveEditedScript() - the "Edit / Tweak" branch of
 * the Review Gate. Reviewing + fixing the code IS the review, so the saved
 * script is stamped 'approved' right away (no separate approve click needed
 * afterwards) - matches "Edit / Tweak" leading straight to "Status: APPROVED".
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: testCaseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { code, page_objects, imports_used, selectors_used, warnings, script_id } = body;

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing code' }, { status: 400 });
  }

  // Unlike /api/ai/playwright (generate) and /heal, this "Edit / Tweak → Save" path
  // never went through the Registry Merge Engine's dedup (computeRegistryMergePlan),
  // so a page_objects[] payload with a repeated class_name (e.g. two page objects the
  // user/AI-enhance left with the same class name) could be saved as-is. That's
  // exactly what produces `SyntaxError: Identifier 'X' has already been declared`
  // the next time this script runs (browser-runner.ts concatenates every page
  // object's class declaration into one shared scope). Apply the same
  // dedupe-by-class_name safety net here too, keeping the first occurrence.
  const dedupedPageObjects: PageObject[] = Array.isArray(page_objects)
    ? dedupePageObjectsByClassName(page_objects as PageObject[]).deduped
    : [];

  const now = new Date().toISOString();

  // If script_id provided, update existing; otherwise insert new
  if (script_id) {
    const { data: updated, error: updateError } = await supabase
      .from('automation_scripts')
      .update({
        code,
        page_objects: dedupedPageObjects,
        imports_used: imports_used ?? [],
        selectors_used: selectors_used ?? [],
        warnings: warnings ?? [],
        generated_by: user.id,
        status: 'approved',
        approved_by: user.id,
        approved_at: now,
      })
      .eq('id', script_id)
      .eq('test_case_id', testCaseId)
      .is('deleted_at', null)
      .select('id, version')
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ success: false, error: updateError?.message ?? 'Update failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: { id: updated.id, version: updated.version, status: 'approved', approved_at: now },
    });
  }

  // Insert new (first time — e.g. a save with no prior generated script). Compute
  // the next version from existing rows rather than hardcoding 1: hardcoding 1
  // made it possible to end up with several undeleted "version 1" rows for the
  // same test case (ties that made ORDER BY version DESC LIMIT 1 unpredictable),
  // and collided with any version the AI-generate route (app/api/ai/playwright)
  // had already inserted. Also excludes soft-deleted rows so a re-generate after
  // deleting doesn't fight the deleted row's version number.
  const { data: existing } = await supabase
    .from('automation_scripts')
    .select('version')
    .eq('test_case_id', testCaseId)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;

  const { data: saved, error: saveError } = await supabase
    .from('automation_scripts')
    .insert({
      test_case_id: testCaseId,
      version: nextVersion,
      code,
      page_objects: dedupedPageObjects,
      imports_used: imports_used ?? [],
      selectors_used: selectors_used ?? [],
      warnings: warnings ?? [],
      generated_by: user.id,
      status: 'approved',
      approved_by: user.id,
      approved_at: now,
    })
    .select('id, version')
    .single();

  if (saveError || !saved) {
    return NextResponse.json({ success: false, error: saveError?.message ?? 'Save failed' }, { status: 500 });
  }

  await supabase
    .from('test_cases')
    .update({ automation_status: 'generated' })
    .eq('id', testCaseId)
    .eq('automation_status', 'not_generated');

  return NextResponse.json({
    success: true,
    data: { id: saved.id, version: saved.version, status: 'approved', approved_at: now },
  });
}

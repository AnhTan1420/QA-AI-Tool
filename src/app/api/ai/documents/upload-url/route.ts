import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createClient } from '@/services/supabase/server';
import { DOCUMENT_SOURCE_UPLOADS_BUCKET } from '@/lib/constants/document-storage';

export const runtime = 'nodejs';

const uploadUrlRequestSchema = z.object({
  project_id: z.string().uuid(),
  file_name: z.string().min(1),
});

/**
 * AI Document Reader — buoc "xin URL upload truoc" cho file nguon .docx/.pdf/anh.
 *
 * Client goi route nay TRUOC, nhan ve 1 signed upload URL (path + token) roi tu
 * upload thang file len Supabase Storage bang supabase-js — KHONG di qua body
 * cua bat ky route Next.js nao ca. Sau khi upload xong, client moi goi
 * /api/ai/documents/parse voi `storage_path` thay vi nhet ca file (base64) vao
 * JSON body (xem hooks/test-case/use-generate-workspace.ts handleDocumentFile()).
 *
 * LY DO CAN ROUTE NAY (bug: upload file .docx bao loi "Request Entity Too
 * Large" / "FUNCTION_PAYLOAD_TOO_LARGE"): Vercel Serverless Function co gioi
 * han CUNG 4.5MB cho request body, khong the tang len bang config (next.config
 * hay vercel.json). Truoc day file .docx/.pdf duoc client base64-encode (phinh
 * to ~33%) roi nhet thang vao JSON body cua /api/ai/documents/parse — chi can
 * file van phong bai vai MB la da vuot gioi han, va vi loi 413 nay den tu
 * CHINH PLATFORM (truoc khi cham toi code cua route.ts) nen body tra ve khong
 * phai JSON, khien postJson() o client con nem them 1 loi parse JSON khong ro
 * rang de ("Unexpected token 'R', "Request En"... is not valid JSON").
 */
export async function POST(req: NextRequest) {
  try {
    const { project_id, file_name } = uploadUrlRequestSchema.parse(await req.json());
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data: member, error: memberError } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { success: false, error: 'Bạn không có quyền tải tài liệu lên cho project này.' },
        { status: 403 },
      );
    }

    // Giu lai duoi file goc de sau nay de doan dinh dang, nhung random hoa ten
    // (UUID) de tranh trung/ghi de va tranh loi voi ky tu la trong ten file goc.
    // Convention '<project_id>/<uuid>.<ext>' khop voi RLS policy
    // can_access_project_document_upload() trong schema.sql (tach project_id ra
    // tu split_part(name, '/', 1)).
    const rawExt = (file_name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ext = rawExt || 'bin';
    const path = `${project_id}/${randomUUID()}.${ext}`;

    const { data, error } = await supabase.storage.from(DOCUMENT_SOURCE_UPLOADS_BUCKET).createSignedUploadUrl(path);

    if (error || !data) {
      console.error('[ai/documents/upload-url] createSignedUploadUrl thất bại:', error);
      return NextResponse.json(
        { success: false, error: 'Không tạo được URL upload. Vui lòng thử lại.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: { path: data.path, token: data.token } });
  } catch (error: any) {
    console.error('❌ Lỗi API tạo upload URL cho document:', error);
    const message =
      error?.issues // loi tu Zod parse input
        ? 'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i: any) => i.message).join(', ')
        : error?.message || 'Có lỗi xảy ra khi tạo URL upload';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

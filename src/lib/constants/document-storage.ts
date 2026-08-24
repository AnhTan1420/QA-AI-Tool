/**
 * Ten bucket Supabase Storage dung TAM cho AI Document Reader — file nguon
 * (.docx/.pdf/anh) duoc upload TRUC TIEP tu browser vao day (bo qua route
 * /api/ai/documents/parse) de tranh gioi han CUNG 4.5MB request body cua Vercel
 * Serverless Function (loi "FUNCTION_PAYLOAD_TOO_LARGE" / "Request Entity Too
 * Large" khi base64-encode ca file .docx/.pdf roi nhet vao JSON body — base64
 * lam file phinh to ~33%, rat de vuot 4.5MB voi 1 file van phong vai MB rat
 * binh thuong).
 *
 * Object bi server XOA ngay sau khi doc xong (xem app/api/ai/documents/parse/
 * route.ts) — day chi la vung dem tam thoi, KHONG phai luu tru lau dai.
 *
 * Hang so nay dung chung o 3 noi de tranh sai lech ten bucket:
 *   1. schema.sql                              — tao bucket + RLS policy
 *   2. app/api/ai/documents/upload-url/route.ts — xin signed URL de upload
 *   3. app/api/ai/documents/parse/route.ts       — tai file ve tu storage_path
 */
export const DOCUMENT_SOURCE_UPLOADS_BUCKET = 'document-source-uploads';

/**
 * Gioi han kich thuoc file nguon cho AI Document Reader (docx/pdf/anh), tinh
 * bang byte. Ap dung o CA client (bao loi ngay truoc khi upload, khoi phai doi
 * mat mang roi moi biet — xem hooks/test-case/use-generate-workspace.ts
 * handleDocumentFile()) LAN server (storage.buckets.file_size_limit trong
 * schema.sql, phong khi client bi bypass).
 *
 * 25MB la du rong rai cho van ban FS/BRD/Word thong thuong; van ban trich xuat
 * duoc sau do con bi capText() gioi han o 24.000 ky tu truoc khi dua vao AI
 * (xem services/documents/text-extractors.ts) nen file qua lon cung khong giup
 * ich them — gioi han o day chu yeu de tranh nguoi dung cho upload mot file
 * rat lon ma cuoi cung khong dung duoc het.
 */
export const MAX_DOCUMENT_SOURCE_FILE_BYTES = 25 * 1024 * 1024;

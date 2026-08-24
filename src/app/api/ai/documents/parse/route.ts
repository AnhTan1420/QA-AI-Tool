import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { runAIAgent, runDocumentVisionAgent } from '@/services/ai/provider';
import { buildTextDocumentExtractionPrompt, buildVisualDocumentExtractionPrompt } from '@/services/ai/prompts/document-extraction-agent';
import { parseDocumentRequestSchema, documentExtractionResultSchema, type ParsedDocument } from '@/models/validators/document';
import { extractDocxText, extractPdfText, capText } from '@/services/documents/text-extractors';
import { fetchAndParseFigmaFile } from '@/services/documents/figma-client';
import { createClient } from '@/services/supabase/server';
import { DOCUMENT_SOURCE_UPLOADS_BUCKET } from '@/lib/constants/document-storage';

export const maxDuration = 120;
export const runtime = 'nodejs';

// Nguong so ky tu text-layer toi thieu de coi 1 file PDF la "van ban that su".
// Duoi nguong nay (bao gom ca chuoi rong khi pdf-parse khong doc duoc gi) - coi
// nhu PDF chi la anh/vector thuan tuy (vd export tu Figma) va rot xuong doc bang
// Vision thay vi bao loi "khong trich xuat duoc noi dung".
const MIN_PDF_TEXT_CHARS = 40;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Tai buffer nguon cho 1 file .docx/.pdf/anh, uu tien `storage_path` (file da
 * duoc client upload THANG len Supabase Storage qua /api/ai/documents/upload-url
 * — xem chu thich trong models/validators/document.ts) roi moi fallback ve
 * `data_base64` (nhet thang trong JSON body, chi con danh cho file rat nho /
 * tuong thich nguoc).
 *
 * Sau khi tai xong tu storage, XOA luon object do (best-effort, khong block
 * response) — bucket `document-source-uploads` chi la vung dem tam thoi, file
 * chi can dung DUY NHAT 1 LAN de extract text.
 */
async function loadSourceBuffer(
  supabase: SupabaseServerClient,
  dataBase64: string | undefined,
  storagePath: string | undefined,
  missingMessage: string,
): Promise<Buffer> {
  if (storagePath) {
    const { data, error } = await supabase.storage.from(DOCUMENT_SOURCE_UPLOADS_BUCKET).download(storagePath);
    if (error || !data) {
      console.error('[ai/documents/parse] Tải file từ storage thất bại:', error);
      throw new Error('Không tải được file đã upload (có thể đã hết hạn hoặc bạn không có quyền truy cập). Vui lòng thử tải lên lại.');
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    void supabase.storage
      .from(DOCUMENT_SOURCE_UPLOADS_BUCKET)
      .remove([storagePath])
      .catch((err) => console.warn('[ai/documents/parse] Dọn dẹp file tạm thất bại (bỏ qua):', err));
    return buffer;
  }
  if (dataBase64) return Buffer.from(dataBase64, 'base64');
  throw new Error(missingMessage);
}

/** Doc 1 anh/PDF-thuan-hinh qua Gemini Vision va tra ve ParsedDocument, hoac null
 * neu AI khong tra ve JSON dung schema (nguoi goi tu quyet dinh response loi). */
async function parseVisualDocument(fileName: string, mimeType: string, base64Data: string): Promise<ParsedDocument | null> {
  const prompt = buildVisualDocumentExtractionPrompt({ fileName });
  const aiRawResult = await runDocumentVisionAgent(prompt, [{ mimeType, base64Data }]);

  const parsed = documentExtractionResultSchema.safeParse(aiRawResult);
  if (!parsed.success) {
    console.error('[ai/documents/parse] Visual extraction schema fail:', parsed.error.flatten());
    return null;
  }

  return {
    id: randomUUID(),
    source_type: 'diagram_image',
    title: parsed.data.title,
    file_name: fileName,
    summary: parsed.data.summary,
    atoms: parsed.data.atoms,
  };
}

/**
 * AI Document Reader — atomize 1 nguon tai lieu (Figma / Markdown / logic
 * document / Functional Specification / ERD / diagram) thanh ParsedDocument
 * (danh sach DocumentAtom co atom_id on dinh). Ket qua nay duoc client giu
 * trong workspace va gui kem `document_context` khi goi /api/ai/generate, noi
 * Generation Agent bat buoc phai map 100% atom_id vao source_requirement_ids
 * cua test case (xem lib/ai/prompts/generation-agent.ts PHASE 0.5 va
 * lib/documents/coverage.ts).
 *
 * File .docx/.pdf/anh: client upload THANG len Supabase Storage truoc (xem
 * /api/ai/documents/upload-url) roi gui kem `storage_path` o day — tranh gioi
 * han cung 4.5MB request body cua Vercel Serverless Function (`data_base64`
 * trong JSON body van con duoc chap nhan cho file rat nho / tuong thich nguoc,
 * xem loadSourceBuffer() o tren).
 *
 * BAT BUOC: validate ca input tu client lan output tu AI bang Zod - khong tin
 * bat ky JSON nao chua qua validate (giong nguyen tac o /api/ai/generate).
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    const input = parseDocumentRequestSchema.parse(rawBody);
    const supabase = await createClient();

    // ── Nhanh 1: Figma (doc truc tiep qua REST API, atomize tat dinh - khong
    // qua AI nen khong the "doan sai", day la nguon chinh xac nhat) ──
    if (input.source_type === 'figma') {
      const token = input.figma_token?.trim() || process.env.FIGMA_ACCESS_TOKEN || '';
      const { title, atoms, screens, truncated } = await fetchAndParseFigmaFile(input.figma_url, token);

      const parsedDocument: ParsedDocument = {
        id: randomUUID(),
        source_type: 'figma',
        title,
        summary: `Figma design "${title}" — ${screens.length} màn hình: ${screens.slice(0, 8).join(', ')}${screens.length > 8 ? '…' : ''}. Đã trích xuất ${atoms.length} phần tử (text layer + component) trực tiếp từ thiết kế sống, nên mapping chính xác thay vì AI phải "đoán" qua ảnh.${truncated ? ' (File rất lớn, chỉ lấy phần đầu.)' : ''}`,
        atoms,
      };
      return NextResponse.json({ success: true, data: parsedDocument });
    }

    // ── Nhanh 2: anh diagram/ERD/UI mockup — doc qua Gemini Vision ──
    if (input.source_type === 'diagram_image') {
      const buffer = await loadSourceBuffer(supabase, input.data_base64, input.storage_path, 'Thiếu dữ liệu file ảnh.');
      const parsedDocument = await parseVisualDocument(input.file_name, input.mime_type, buffer.toString('base64'));
      if (!parsedDocument) {
        return NextResponse.json(
          { success: false, error: 'AI không phân tích được ảnh này. Vui lòng thử ảnh rõ nét hơn hoặc thử lại.' },
          { status: 502 },
        );
      }
      return NextResponse.json({ success: true, data: parsedDocument });
    }

    // ── Nhanh 3: tai lieu text (Markdown/FS/logic doc qua .txt/.md, hoac
    // .pdf/.docx can server tu extract text truoc) ──
    let rawText: string;
    if (input.file_format === 'pdf') {
      const buffer = await loadSourceBuffer(supabase, input.data_base64, input.storage_path, 'Thiếu dữ liệu file PDF.');
      // pdf-parse chi doc duoc text layer that su co trong file - mot PDF export
      // ra tu Figma (hoac bat ky cong cu design nao) thuong la vector/hinh anh
      // thuan tuy, KHONG co text layer, nen se tra ve chuoi rong hoac gan nhu
      // rong o day. Coi day la tin hieu de rot xuong nhanh Vision ben duoi thay
      // vi bao loi ngay - nguoi dung khong can phai biet truoc "PDF cua minh la
      // van ban hay la thiet ke" va chon dung o upload, MOT o duy nhat xu ly ca hai.
      try {
        rawText = await extractPdfText(buffer);
      } catch {
        rawText = '';
      }
      if (rawText.trim().length < MIN_PDF_TEXT_CHARS) {
        const parsedDocument = await parseVisualDocument(input.file_name, 'application/pdf', buffer.toString('base64'));
        if (!parsedDocument) {
          return NextResponse.json(
            { success: false, error: 'AI không phân tích được file PDF này (không trích xuất được văn bản, và AI Vision cũng không đọc được như ảnh thiết kế). Vui lòng thử lại.' },
            { status: 502 },
          );
        }
        return NextResponse.json({ success: true, data: parsedDocument });
      }
    } else if (input.file_format === 'docx') {
      const buffer = await loadSourceBuffer(supabase, input.data_base64, input.storage_path, 'Thiếu dữ liệu file DOCX.');
      rawText = await extractDocxText(buffer);
    } else {
      if (!input.content) throw new Error('Thiếu nội dung file.');
      rawText = input.content;
    }

    if (!rawText.trim()) {
      throw new Error('Không trích xuất được nội dung văn bản nào từ file này.');
    }

    const { text: boundedText, truncated } = capText(rawText);
    const prompt = buildTextDocumentExtractionPrompt({
      sourceLabel: input.file_name,
      rawText: boundedText,
      truncated,
    });

    const aiRawResult = await runAIAgent(prompt, 'document_extraction');
    const parsed = documentExtractionResultSchema.safeParse(aiRawResult);
    if (!parsed.success) {
      console.error('[ai/documents/parse] Text extraction schema fail:', parsed.error.flatten());
      return NextResponse.json(
        { success: false, error: 'AI không phân tích được tài liệu này. Vui lòng thử lại.' },
        { status: 502 },
      );
    }

    const parsedDocument: ParsedDocument = {
      id: randomUUID(),
      source_type: 'document',
      title: parsed.data.title,
      file_name: input.file_name,
      summary: parsed.data.summary + (truncated ? ' (Tài liệu dài, chỉ phần đầu được phân tích.)' : ''),
      atoms: parsed.data.atoms,
    };
    return NextResponse.json({ success: true, data: parsedDocument });
  } catch (error: any) {
    console.error('❌ Lỗi API Parse Document:', error);
    const message =
      error?.issues // loi tu Zod parse input
        ? 'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i: any) => i.message).join(', ')
        : error?.message || 'Có lỗi xảy ra khi phân tích tài liệu';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { runDocumentVisionAgent } from '@/services/ai/provider';
import { buildVisualDocumentExtractionPrompt } from '@/services/ai/prompts/document-extraction-agent';
import { parseDocumentRequestSchema, documentExtractionResultSchema, type ParsedDocument } from '@/models/validators/document';
import { extractDocxText, extractPdfText } from '@/services/documents/text-extractors';
import { readTextDocument } from '@/services/documents/reader';
import { fetchAndParseFigmaFile } from '@/services/documents/figma-client';

// Route nay chay Reader nhieu-luot (chunk + audit) cho tai lieu dai — co the
// can nhieu lan goi Gemini TUAN TU. maxDuration=120 (gia tri cu, phu hop khi
// Reader con cat cut o capText(24000) va chi goi Gemini 1 lan) da qua thap cho
// kien truc chunked hien tai va la NGUYEN NHAN TRUC TIEP gay ra loi
// "Vercel Runtime Timeout Error: Task timed out after 120 seconds" khi mot tai
// lieu can >= 2 chunk va mot trong so do gap model dang qua tai (503).
export const maxDuration = 300;
export const runtime = 'nodejs';

// Nguong so ky tu text-layer toi thieu de coi 1 file PDF la "van ban that su".
// Duoi nguong nay (bao gom ca chuoi rong khi pdf-parse khong doc duoc gi) - coi
// nhu PDF chi la anh/vector thuan tuy (vd export tu Figma) va rot xuong doc bang
// Vision thay vi bao loi "khong trich xuat duoc noi dung".
const MIN_PDF_TEXT_CHARS = 40;

/** Doc 1 anh/PDF-thuan-hinh qua Gemini Vision va tra ve ParsedDocument, hoac null
 * neu AI khong tra ve JSON dung schema (nguoi goi tu quyet dinh response loi). */
async function parseVisualDocument(
  fileName: string,
  mimeType: string,
  base64Data?: string,
): Promise<ParsedDocument | null> {
  if (!base64Data) throw new Error('Thiếu dữ liệu file.');
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
 * BAT BUOC: validate ca input tu client lan output tu AI bang Zod - khong tin
 * bat ky JSON nao chua qua validate (giong nguyen tac o /api/ai/generate).
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    const input = parseDocumentRequestSchema.parse(rawBody);

    // ── Nhanh 1: Figma (doc truc tiep qua REST API, atomize tat dinh - khong
    // qua AI nen khong the "doan sai", day la nguon chinh xac nhat) ──
    if (input.source_type === 'figma') {
      const token = input.figma_token?.trim() || process.env.FIGMA_ACCESS_TOKEN || '';
      const { title, atoms, screens, truncated, atoms_before_cap } = await fetchAndParseFigmaFile(input.figma_url, token);

      // Truoc day co truncated bi giau trong 1 cau trong summary, va viec cat
      // luon xay ra o MAN HINH CUOI CUNG cua file (xem figma-client.ts). Gio
      // provenance day du di kem qua reader_stats/reader_warnings — cung kenh
      // ma AI Document Reader (van ban) dung — va viec lay mau la RAI DEU tren
      // moi man hinh, khong con ai bi xoa so hoan toan.
      const parsedDocument: ParsedDocument = {
        id: randomUUID(),
        source_type: 'figma',
        title,
        summary: `Figma design "${title}" — ${screens.length} màn hình: ${screens.slice(0, 8).join(', ')}${screens.length > 8 ? '…' : ''}. Đã trích xuất ${atoms.length} phần tử (text layer + component) trực tiếp từ thiết kế sống, nên mapping chính xác thay vì AI phải "đoán" qua ảnh.`,
        atoms,
        ...(truncated
          ? {
              reader_stats: {
                source_chars: 0,
                chunks: 1,
                atoms_first_pass: atoms_before_cap,
                atoms_from_audit: 0,
                duplicates_removed: 0,
                failed_chunks: 0,
              },
              reader_warnings: [
                `File Figma có ${atoms_before_cap} phần tử, vượt giới hạn ${atoms.length} (cấu hình qua AI_FIGMA_MAX_ATOMS). Đã lấy mẫu RẢI ĐỀU trên tất cả ${screens.length} màn hình thay vì cắt ở cuối, nhưng một số chi tiết trong mỗi màn hình có thể không thành atom. Tăng AI_FIGMA_MAX_ATOMS hoặc tách file theo từng phần để phân tích đầy đủ.`,
              ],
            }
          : {}),
      };
      return NextResponse.json({ success: true, data: parsedDocument });
    }

    // ── Nhanh 2: anh diagram/ERD/UI mockup — doc qua Gemini Vision ──
    if (input.source_type === 'diagram_image') {
      const parsedDocument = await parseVisualDocument(input.file_name, input.mime_type, input.data_base64);
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
      if (!input.data_base64) throw new Error('Thiếu dữ liệu file PDF.');
      // pdf-parse chi doc duoc text layer that su co trong file - mot PDF export
      // ra tu Figma (hoac bat ky cong cu design nao) thuong la vector/hinh anh
      // thuan tuy, KHONG co text layer, nen se tra ve chuoi rong hoac gan nhu
      // rong o day. Coi day la tin hieu de rot xuong nhanh Vision ben duoi thay
      // vi bao loi ngay - nguoi dung khong can phai biet truoc "PDF cua minh la
      // van ban hay la thiet ke" va chon dung o upload, MOT o duy nhat xu ly ca hai.
      try {
        rawText = await extractPdfText(Buffer.from(input.data_base64, 'base64'));
      } catch {
        rawText = '';
      }
      if (rawText.trim().length < MIN_PDF_TEXT_CHARS) {
        const parsedDocument = await parseVisualDocument(input.file_name, 'application/pdf', input.data_base64);
        if (!parsedDocument) {
          return NextResponse.json(
            { success: false, error: 'AI không phân tích được file PDF này (không trích xuất được văn bản, và AI Vision cũng không đọc được như ảnh thiết kế). Vui lòng thử lại.' },
            { status: 502 },
          );
        }
        return NextResponse.json({ success: true, data: parsedDocument });
      }
    } else if (input.file_format === 'docx') {
      if (!input.data_base64) throw new Error('Thiếu dữ liệu file DOCX.');
      rawText = await extractDocxText(Buffer.from(input.data_base64, 'base64'));
    } else {
      if (!input.content) throw new Error('Thiếu nội dung file.');
      rawText = input.content;
    }

    if (!rawText.trim()) {
      throw new Error('Không trích xuất được nội dung văn bản nào từ file này.');
    }

    // Đọc TOÀN BỘ tài liệu theo nhiều đoạn (chunk) + một lượt audit độ đầy đủ.
    // Trước đây chỗ này gọi capText(rawText) và cắt thẳng ở ký tự thứ 24.000 —
    // mọi yêu cầu nằm sau đó không bao giờ trở thành atom, nên độ phủ "100%"
    // về sau chỉ là 100% của phần đầu tài liệu. Xem services/documents/reader.ts.
    const reader = await readTextDocument({ fileName: input.file_name, text: rawText });
    if (!reader) {
      return NextResponse.json(
        { success: false, error: 'AI không phân tích được tài liệu này. Vui lòng thử lại.' },
        { status: 502 },
      );
    }

    console.info(
      `[ai/documents/parse] "${input.file_name}": ${reader.stats.source_chars} ký tự → ${reader.stats.chunks} phần → ${reader.atoms.length} atom (pass 1: ${reader.stats.atoms_first_pass}, audit bổ sung: ${reader.stats.atoms_from_audit}, trùng lặp đã gộp: ${reader.stats.duplicates_removed}, phần lỗi: ${reader.stats.failed_chunks})`,
    );

    const parsedDocument: ParsedDocument = {
      id: randomUUID(),
      source_type: 'document',
      title: reader.title,
      file_name: input.file_name,
      summary: reader.summary,
      atoms: reader.atoms,
      // Provenance đi KÈM trong `data` (không phải trong một field `meta` anh em)
      // vì client bóc đúng `data` ra khỏi envelope — đặt ngoài là mất thẳng.
      reader_stats: reader.stats,
      reader_warnings: reader.warnings,
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

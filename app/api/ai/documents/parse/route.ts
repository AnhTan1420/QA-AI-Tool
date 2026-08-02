import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { runAIAgent, runDocumentVisionAgent } from '@/lib/ai/provider';
import { buildTextDocumentExtractionPrompt, buildVisualDocumentExtractionPrompt } from '@/lib/ai/prompts/document-extraction-agent';
import { parseDocumentRequestSchema, documentExtractionResultSchema, type ParsedDocument } from '@/lib/validators/document';
import { extractDocxText, extractPdfText, capText } from '@/lib/documents/text-extractors';
import { fetchAndParseFigmaFile } from '@/lib/documents/figma-client';

export const maxDuration = 120;
export const runtime = 'nodejs';

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
      const prompt = buildVisualDocumentExtractionPrompt({ fileName: input.file_name });
      const aiRawResult = await runDocumentVisionAgent(prompt, [
        { mimeType: input.mime_type, base64Data: input.data_base64 },
      ]);

      const parsed = documentExtractionResultSchema.safeParse(aiRawResult);
      if (!parsed.success) {
        console.error('[ai/documents/parse] Diagram extraction schema fail:', parsed.error.flatten());
        return NextResponse.json(
          { success: false, error: 'AI không phân tích được ảnh này. Vui lòng thử ảnh rõ nét hơn hoặc thử lại.' },
          { status: 502 },
        );
      }

      const parsedDocument: ParsedDocument = {
        id: randomUUID(),
        source_type: 'diagram_image',
        title: parsed.data.title,
        file_name: input.file_name,
        summary: parsed.data.summary,
        atoms: parsed.data.atoms,
      };
      return NextResponse.json({ success: true, data: parsedDocument });
    }

    // ── Nhanh 3: tai lieu text (Markdown/FS/logic doc qua .txt/.md, hoac
    // .pdf/.docx can server tu extract text truoc) ──
    let rawText: string;
    if (input.file_format === 'pdf') {
      if (!input.data_base64) throw new Error('Thiếu dữ liệu file PDF.');
      rawText = await extractPdfText(Buffer.from(input.data_base64, 'base64'));
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

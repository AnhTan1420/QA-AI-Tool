export type FakeFileType = 'txt' | 'csv' | 'json' | 'png' | 'pdf';

export function buildTextPayload(sizeBytes: number): string {
  const line = 'QAJD fake file - line for upload testing.\n';
  const repeats = Math.max(1, Math.ceil(sizeBytes / line.length));
  return line.repeat(repeats).slice(0, sizeBytes);
}

export function buildCsvPayload(sizeBytes: number): string {
  const header = 'id,name,email,created_at\n';
  const row = (i: number) => `${i},Tester ${i},tester${i}@example.com,2024-01-01T00:00:00Z\n`;
  let out = header;
  let i = 1;
  while (out.length < sizeBytes) {
    out += row(i);
    i += 1;
  }
  return out.slice(0, Math.max(sizeBytes, header.length));
}

export function buildJsonPayload(sizeBytes: number): string {
  const records: { id: number; name: string; email: string }[] = [];
  let i = 1;
  let approxLength = 2;
  while (approxLength < sizeBytes) {
    records.push({ id: i, name: `Tester ${i}`, email: `tester${i}@example.com` });
    approxLength += 60;
    i += 1;
  }
  return JSON.stringify(records, null, 2);
}

export function buildPdfBytes(sizeBytes: number): string {
  const header = '%PDF-1.4\n';
  const content = 'BT /F1 18 Tf 72 720 Td (QAJD Fake PDF File - generated for QA upload testing) Tj ET';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '';
  let offset = header.length;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(offset);
    body += obj;
    offset += obj.length;
  }

  const xrefStart = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  let pdf = header + body + xref + trailer;

  // Pad to reach the requested size using a trailing PDF comment line so the
  // structure above stays byte-accurate and the file still opens normally.
  if (pdf.length < sizeBytes) {
    const paddingLength = sizeBytes - pdf.length - 2;
    if (paddingLength > 0) {
      pdf += `\n%${'A'.repeat(paddingLength)}`;
    }
  }
  return pdf;
}

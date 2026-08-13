'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { downloadBlob, formatSize } from '@/lib/utils/file-download';
import { buildCsvPayload, buildJsonPayload, buildPdfBytes, buildTextPayload, type FakeFileType } from '@/lib/utils/fake-file-payloads';

export function FakeFileGeneratorTool() {
  const { t } = useLanguage();
  const [fileType, setFileType] = useState<FakeFileType>('txt');
  const [sizeKb, setSizeKb] = useState(10);
  const [fileName, setFileName] = useState('qajd-fake-file');
  const [lastGenerated, setLastGenerated] = useState<{ name: string; size: number } | null>(null);

  function handleGenerate() {
    const sizeBytes = Math.max(1, Math.round(sizeKb * 1024));
    let content: string | ArrayBuffer;
    let ext = fileType;
    let mimeType = 'text/plain';

    if (fileType === 'txt') {
      content = buildTextPayload(sizeBytes);
      mimeType = 'text/plain';
    } else if (fileType === 'csv') {
      content = buildCsvPayload(sizeBytes);
      mimeType = 'text/csv';
    } else if (fileType === 'json') {
      content = buildJsonPayload(sizeBytes);
      mimeType = 'application/json';
    } else if (fileType === 'pdf') {
      content = buildPdfBytes(sizeBytes);
      mimeType = 'application/pdf';
    } else {
      // png: draw noise onto a canvas sized to roughly match the requested byte size.
      const targetPixels = Math.max(2000, sizeBytes * 3);
      const side = Math.max(32, Math.round(Math.sqrt(targetPixels)));
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imageData = ctx.createImageData(side, side);
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = Math.floor(Math.random() * 256);
          imageData.data[i + 1] = Math.floor(Math.random() * 256);
          imageData.data[i + 2] = Math.floor(Math.random() * 256);
          imageData.data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
      }
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1] ?? '';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const finalName = `${fileName || 'qajd-fake-file'}.png`;
      downloadBlob(bytes, finalName, 'image/png');
      setLastGenerated({ name: finalName, size: bytes.byteLength });
      return;
    }

    const finalName = `${fileName || 'qajd-fake-file'}.${ext}`;
    downloadBlob(content, finalName, mimeType);
    setLastGenerated({ name: finalName, size: new Blob([content]).size });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">{t.tools.fakeFile.typeLabel}</span>
          <select value={fileType} onChange={(event) => setFileType(event.target.value as FakeFileType)} className="field-input">
            <option value="txt">TXT</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="png">PNG</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">{t.tools.fakeFile.sizeLabel}</span>
          <input type="number" min={1} value={sizeKb} onChange={(event) => setSizeKb(Number(event.target.value))} className="field-input" />
        </label>
        <label className="block">
          <span className="field-label">{t.tools.fakeFile.nameLabel}</span>
          <input value={fileName} onChange={(event) => setFileName(event.target.value)} className="field-input" placeholder="qajd-fake-file" />
        </label>
      </div>

      <button onClick={handleGenerate} className="btn-primary">
        {t.tools.fakeFile.generateButton}
      </button>

      {lastGenerated && (
        <div className="surface-card p-4 text-sm">
          {t.tools.fakeFile.generatedInfo(lastGenerated.name, formatSize(lastGenerated.size))}
        </div>
      )}

      <p className="text-caption">{t.tools.fakeFile.note}</p>
      <p className="text-caption">{t.tools.fakeFile.sizeHint}</p>
    </div>
  );
}

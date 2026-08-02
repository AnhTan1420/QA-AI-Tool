'use client';

import { SCROLLBAR } from './shared';
import type { GenerateWorkspaceState } from './use-generate-workspace';

const SOURCE_TYPE_LABEL: Record<string, string> = {
  document: 'Document (MD/FS/PDF/DOCX)',
  diagram_image: 'Diagram / ERD / Mockup',
  figma: 'Figma',
};

/**
 * Step 2 of the wizard: AI Document Reader — attach a Figma design, a Markdown/logic
 * document/Functional Specification (as .md/.txt/.pdf/.docx), or an ERD/diagram image.
 * Each source gets atomized into `atoms` (see lib/validators/document.ts); the Generation
 * Agent is then required to map every atom_id into a test case's source_requirement_ids
 * (PHASE 0.5 of lib/ai/prompts/generation-agent.ts), and ResultsPanel shows the resulting
 * document_coverage once a set has been generated.
 */
export function DocumentReaderPanel({ workspace }: { workspace: GenerateWorkspaceState }) {
  const { t } = workspace;
  const dr = t.generateWorkspace.documentReader;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-black text-white">2</span>
          {dr.label}
        </span>
        {workspace.documents.length > 0 && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">{dr.attachedCount(workspace.documents.length)}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">{dr.hint}</p>

      <label className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/30 p-5 text-center transition-all hover:border-blue-300 hover:bg-blue-50/30">
        <input
          type="file"
          accept=".md,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) workspace.handleDocumentFile(file);
            event.target.value = '';
          }}
        />
        <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-sm font-semibold text-slate-700">
          {workspace.isParsingDocument ? dr.parsing : dr.chooseFile}
        </span>
        <span className="text-xs text-slate-400">{dr.fileHint}</span>
      </label>

      <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50/30 p-3 sm:flex-row sm:items-center">
        <input
          value={workspace.figmaUrl}
          onChange={(event) => workspace.setFigmaUrl(event.target.value)}
          placeholder={dr.figmaUrlPlaceholder}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition-all focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
        <input
          value={workspace.figmaToken}
          onChange={(event) => workspace.setFigmaToken(event.target.value)}
          type="password"
          placeholder={dr.figmaTokenPlaceholder}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition-all focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
        <button
          type="button"
          disabled={workspace.isParsingDocument || !workspace.figmaUrl.trim()}
          onClick={workspace.handleFigmaImport}
          className="shrink-0 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {dr.figmaImportButton}
        </button>
      </div>

      {workspace.documentError && <p className="mt-2 text-xs font-semibold text-red-600">{workspace.documentError}</p>}

      {workspace.documents.length > 0 && (
        <ul className={`mt-3 max-h-48 space-y-1.5 overflow-y-auto pr-1 ${SCROLLBAR}`}>
          {workspace.documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-700">{doc.title}</p>
                <p className="text-[10px] text-slate-400">
                  {SOURCE_TYPE_LABEL[doc.source_type] ?? doc.source_type} · {dr.atomsSuffix(doc.atoms.length)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => workspace.removeDocument(doc.id)}
                className="shrink-0 font-bold text-red-500 transition-colors hover:text-red-600 hover:underline"
              >
                {t.generateWorkspace.removeFile}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

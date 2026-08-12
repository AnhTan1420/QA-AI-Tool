'use client';

import { useState } from 'react';
import { Upload, KeyRound, Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';
import { SCROLLBAR } from './shared';
import { StepNumber, FileDropzone, sourceTypeIcon } from './workspace-ui';
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
  const [showToken, setShowToken] = useState(false);

  return (
    <div className="border-t border-ink-100 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
          <StepNumber n={2} />
          {dr.label}
        </span>
        {workspace.documents.length > 0 && <span className="badge-brand">{dr.attachedCount(workspace.documents.length)}</span>}
      </div>
      <p className="mt-1.5 text-xs text-ink-400">{dr.hint}</p>

      <div className="mt-2">
        <FileDropzone
          accept=".md,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp"
          onFile={workspace.handleDocumentFile}
          icon={Upload}
          label={workspace.isParsingDocument ? dr.parsing : dr.chooseFile}
          hint={dr.fileHint}
        />
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius-control)] border border-ink-200 bg-ink-50/60 p-4">
        <input
          value={workspace.figmaUrl}
          onChange={(event) => workspace.setFigmaUrl(event.target.value)}
          placeholder={dr.figmaUrlPlaceholder}
          className="field-input !py-2 text-xs"
        />
        <div className="relative">
          <input
            value={workspace.figmaToken}
            onChange={(event) => workspace.setFigmaToken(event.target.value)}
            type={showToken ? 'text' : 'password'}
            placeholder={dr.figmaTokenPlaceholder}
            className="field-input !py-2 pr-9 text-xs"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="icon-btn absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
            aria-label={showToken ? 'Hide token' : 'Show token'}
          >
            {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <button
          type="button"
          disabled={workspace.isParsingDocument || !workspace.figmaUrl.trim()}
          onClick={workspace.handleFigmaImport}
          className="btn-primary btn-sm w-full !bg-ink-800 hover:!bg-ink-900 focus-visible:!ring-ink-400"
        >
          {workspace.isParsingDocument ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {dr.figmaImportButton}
        </button>

        <div className="flex items-center gap-2 py-0.5">
          <span className="h-px flex-1 bg-ink-200" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{dr.figmaFileDivider}</span>
          <span className="h-px flex-1 bg-ink-200" />
        </div>

        <FileDropzone
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onFile={workspace.handleFigmaFileImport}
          icon={Upload}
          label={workspace.isParsingDocument ? dr.parsing : dr.figmaFileUploadLabel}
          disabled={workspace.isParsingDocument}
          compact
        />
        <span className="text-[10px] text-ink-400">{dr.figmaFileHint}</span>
      </div>

      {workspace.documentError && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-danger-600">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {workspace.documentError}
        </p>
      )}

      {workspace.documents.length > 0 && (
        <ul className={`mt-3 max-h-48 space-y-1.5 overflow-y-auto pr-1 ${SCROLLBAR}`}>
          {workspace.documents.map((doc) => {
            const Icon = sourceTypeIcon(doc.source_type);
            return (
              <li key={doc.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-ink-200 bg-white px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-700">{doc.title}</p>
                    <p className="text-[10px] text-ink-400">
                      {SOURCE_TYPE_LABEL[doc.source_type] ?? doc.source_type} · {dr.atomsSuffix(doc.atoms.length)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => workspace.removeDocument(doc.id)}
                  className="shrink-0 font-semibold text-danger-600 transition-colors hover:text-red-700 hover:underline"
                >
                  {t.generateWorkspace.removeFile}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

import { Upload, AlertTriangle } from 'lucide-react';
import { SCROLLBAR } from './shared';
import { StepNumber, FileDropzone, sourceTypeIcon } from './workspace-ui';
import type { GenerateWorkspaceState } from '@/hooks/test-case/use-generate-workspace';

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
          disabled={workspace.isParsingDocument}
        />
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

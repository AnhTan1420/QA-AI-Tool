'use client';

import { useState } from 'react';
import { Upload, AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
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
  // Muc 11 cua audit: nguoi dung phai xem duoc TOAN BO atom inventory va
  // provenance cua buoc doc tai lieu (bao nhieu chunk, that bai bao nhieu,
  // audit bo sung duoc bao nhieu) thay vi chi mot con so "12 atoms".
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

      {workspace.isParsingDocument && workspace.documentProgress && (
        <p role="status" aria-live="polite" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-600">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {workspace.documentProgress}
        </p>
      )}

      {workspace.documentError && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-danger-600">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {workspace.documentError}
        </p>
      )}

      {workspace.documents.length > 0 && (
        <ul className={`mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1 ${SCROLLBAR}`}>
          {workspace.documents.map((doc) => {
            const Icon = sourceTypeIcon(doc.source_type);
            const isOpen = expandedId === doc.id;
            const hasWarnings = (doc.reader_warnings?.length ?? 0) > 0;
            return (
              <li key={doc.id} className="rounded-[var(--radius-control)] border border-ink-200 bg-white text-xs">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : doc.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink-700">{doc.title}</p>
                      <p className="text-[10px] text-ink-400">
                        {SOURCE_TYPE_LABEL[doc.source_type] ?? doc.source_type} · {dr.atomsSuffix(doc.atoms.length)}
                        {doc.reader_stats && doc.reader_stats.chunks > 1 && ` · ${dr.chunksSuffix(doc.reader_stats.chunks)}`}
                        {hasWarnings && <span className="ml-1 font-bold text-warning-600">⚠</span>}
                      </p>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => workspace.removeDocument(doc.id)}
                    className="shrink-0 font-semibold text-danger-600 transition-colors hover:text-red-700 hover:underline"
                  >
                    {t.generateWorkspace.removeFile}
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-ink-100 px-3 py-2">
                    {doc.reader_stats && (
                      <p className="text-[10px] text-ink-400">
                        {dr.readerStatsLine(
                          doc.reader_stats.chunks,
                          doc.reader_stats.atoms_first_pass,
                          doc.reader_stats.atoms_from_audit,
                          doc.reader_stats.duplicates_removed,
                        )}
                      </p>
                    )}
                    {doc.reader_warnings && doc.reader_warnings.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {doc.reader_warnings.map((w, i) => (
                          <li key={i} className="flex items-start gap-1 text-[10px] text-warning-600">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-[10px] font-semibold text-ink-500">{dr.atomInventoryTitle}</p>
                    <ul className={`mt-1 max-h-40 space-y-1 overflow-y-auto pr-1 ${SCROLLBAR}`}>
                      {doc.atoms.map((atom) => (
                        <li key={atom.atom_id} className="rounded bg-ink-50 px-2 py-1">
                          <p className="font-mono text-[10px] text-ink-500">
                            [{atom.atom_id}] <span className="text-ink-400">{atom.atom_type}</span>
                            {atom.screen_or_section && <span className="text-ink-400"> · {atom.screen_or_section}</span>}
                          </p>
                          <p className="text-[11px] font-semibold text-ink-700">{atom.label}</p>
                          <p className="text-[10px] text-ink-500">{atom.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

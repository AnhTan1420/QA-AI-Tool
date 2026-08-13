'use client';

import type { LucideIcon } from 'lucide-react';
import { FileText, Figma, Image as ImageIcon, X } from 'lucide-react';

/** Small circular numbered badge used for the 5 sections of the wizard. Kept
 * neutral (ink) instead of colored so the brand color stays reserved for
 * interactive/primary elements (buttons, focus states, selection) — the
 * numbers are structural, not actionable. */
export function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] font-bold text-white">
      {n}
    </span>
  );
}

/** One consistent dropzone recipe, reused for: old-case import, AI Document
 * Reader upload, Figma export upload, and the Review-panel .xlsx import —
 * previously each had its own near-identical (but subtly different) markup. */
export function FileDropzone({
  accept,
  onFile,
  icon: Icon,
  label,
  hint,
  disabled,
  compact = false,
}: {
  accept: string;
  onFile: (file: File) => void;
  icon: LucideIcon;
  label: string;
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] border-2 border-dashed border-ink-200 bg-ink-50/60 text-center transition-all duration-150 hover:border-brand-300 hover:bg-brand-50/50 ${
        compact ? 'p-3' : 'p-5'
      } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      <Icon className={compact ? 'h-4 w-4 text-ink-400' : 'h-5 w-5 text-ink-400'} strokeWidth={1.75} />
      <span className={`font-semibold text-ink-700 ${compact ? 'text-xs' : 'text-sm'}`}>{label}</span>
      {hint && <span className="text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

/** Attached-file / imported-file chip — filename (+ optional subtitle) with a
 * remove action. Reused for old-cases file, review-import file, and each AI
 * Document Reader source. */
export function AttachedFileChip({
  label,
  subtitle,
  onRemove,
  removeLabel,
}: {
  label: string;
  subtitle?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-ink-100 bg-ink-50 px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink-700">{label}</p>
        {subtitle && <p className="truncate text-[10px] text-ink-400">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex shrink-0 items-center gap-1 font-semibold text-danger-600 transition-colors hover:text-red-700 hover:underline"
      >
        <X className="h-3 w-3" />
        {removeLabel}
      </button>
    </div>
  );
}

const SOURCE_TYPE_ICON: Record<string, LucideIcon> = {
  document: FileText,
  diagram_image: ImageIcon,
  figma: Figma,
};

export function sourceTypeIcon(sourceType: string): LucideIcon {
  return SOURCE_TYPE_ICON[sourceType] ?? FileText;
}

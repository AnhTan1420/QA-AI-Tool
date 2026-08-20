'use client';

import { CheckCircle2, AlertTriangle, Download, Loader2, Save, Sparkles, FileSpreadsheet } from 'lucide-react';
import { TEST_CASE_CATEGORIES } from '@/models/test-case-taxonomy';
import { SCROLLBAR } from './shared';
import { StepNumber, FileDropzone, AttachedFileChip } from './workspace-ui';
import { DocumentReaderPanel } from './document-reader-panel';
import type { GenerateWorkspaceState } from '@/hooks/test-case/use-generate-workspace';

/** Danh sach preset cho dropdown "Ngon ngu" (ngon ngu OUTPUT cua test case sinh
 * ra - khac voi ngon ngu giao dien UI o LanguageToggle). Truoc day la 1 o input
 * text tu do go, doi thanh dropdown de tranh nguoi dung go sai/khong nhat quan
 * ten ngon ngu (VD "Viet", "vi", "Vietnamese" deu co the bi AI hieu khac nhau). */
const LANGUAGE_OPTIONS = ['Tiếng Việt', 'English', '日本語', '한국어', '中文', 'Français', 'Español', 'Deutsch'];

/** Left column: requirement input, old-cases import, language/detail, taxonomy, and actions. */
export function WizardPanel({ workspace }: { workspace: GenerateWorkspaceState }) {
  const { t } = workspace;

  return (
    <section className={`surface-card space-y-6 overflow-y-auto p-6 ${SCROLLBAR}`}>
      <div className="sticky -top-6 z-10 -mx-6 -mt-6 rounded-t-[var(--radius-card)] border-b border-ink-100 bg-white px-6 pb-6 pt-6">
        <p className="text-eyebrow">{t.generateWorkspace.wizardEyebrow}</p>
        <h1 className="text-h1 mt-2">{t.generateWorkspace.title}</h1>
        <p className="text-body mt-2">{t.generateWorkspace.subtitle}</p>
      </div>

      <label className="block">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
          <StepNumber n={1} />
          {t.generateWorkspace.requirementLabel}
        </span>
        <textarea
          value={workspace.description}
          onChange={(event) => workspace.setDescription(event.target.value)}
          placeholder={t.generateWorkspace.requirementPlaceholder}
          className={`field-input mt-2 min-h-64 resize-y leading-6 ${SCROLLBAR}`}
        />
        <p className={`mt-2 flex items-start gap-1.5 text-xs font-semibold ${workspace.hasEnoughInputToGenerate ? 'text-success-600' : 'text-warning-600'}`}>
          {workspace.hasEnoughInputToGenerate ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {workspace.hasEnoughInputToGenerate
              ? (workspace.hasRequirementInput ? t.generateWorkspace.inputStatus.requirementReady : t.generateWorkspace.inputStatus.documentReady)
              : t.generateWorkspace.inputStatus.needMore}
          </span>
        </p>
      </label>

      <DocumentReaderPanel workspace={workspace} />

      <div className="border-t border-ink-100 pt-6">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
            <StepNumber n={3} />
            {t.generateWorkspace.oldCasesLabel}
          </span>
          <button
            type="button"
            onClick={workspace.downloadOldCasesTemplate}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-700 hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            {t.generateWorkspace.downloadTemplate}
          </button>
        </div>
        <div className="mt-2">
          <FileDropzone
            accept=".xlsx,.xls"
            onFile={workspace.handleOldCasesFile}
            icon={FileSpreadsheet}
            label={workspace.isParsingOldCases ? t.generateWorkspace.chooseFileReading : t.generateWorkspace.chooseFile}
            hint={t.generateWorkspace.fileHint}
          />
        </div>
        {workspace.oldCasesFileName && !workspace.isParsingOldCases && (
          <AttachedFileChip
            label={`${workspace.oldCasesFileName} ${t.generateWorkspace.loadedSuffix(workspace.oldCases.length)}`}
            onRemove={workspace.clearOldCasesFile}
            removeLabel={t.generateWorkspace.removeFile}
          />
        )}
        {workspace.isEmbeddingOldCases && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-500">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            {t.generateWorkspace.embeddingOldCases}
          </p>
        )}
        {!workspace.isEmbeddingOldCases && workspace.embeddedOldCasesCount !== null && workspace.embeddedOldCasesCount > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-success-600">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {t.generateWorkspace.embeddedOldCasesSuffix(workspace.embeddedOldCasesCount)}
          </p>
        )}
        {workspace.oldCasesWarning && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning-600">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {workspace.oldCasesWarning}
          </p>
        )}
      </div>

      <div className="border-t border-ink-100 pt-6">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
          <StepNumber n={4} />
          {t.generateWorkspace.languageDetailHeading}
        </span>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ink-500">{t.generateWorkspace.languageLabel}</span>
            <select
              value={workspace.language}
              onChange={(event) => workspace.setLanguage(event.target.value)}
              className="field-input mt-1"
            >
              {/* Neu gia tri dang luu (VD tu du an cu, hoac tu ngon ngu UI mac dinh)
                  khong khop bat ky preset nao ben duoi, them no nhu 1 option rieng
                  de khong "mat" du lieu dang co cua workspace.language. */}
              {!LANGUAGE_OPTIONS.includes(workspace.language) && workspace.language && (
                <option value={workspace.language}>{workspace.language}</option>
              )}
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink-500">{t.generateWorkspace.detailLevelLabel}</span>
            <select
              value={workspace.detailLevel}
              onChange={(event) => workspace.setDetailLevel(event.target.value as typeof workspace.detailLevel)}
              className="field-input mt-1"
            >
              <option value="concise">{t.generateWorkspace.detailConcise}</option>
              <option value="standard">{t.generateWorkspace.detailStandard}</option>
              <option value="detailed">{t.generateWorkspace.detailDetailed}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="border-t border-ink-100 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
            <StepNumber n={5} />
            {t.generateWorkspace.taxonomyLabel}
            <span className="badge-brand">{workspace.selectedCategories.length}/{TEST_CASE_CATEGORIES.length}</span>
          </span>
          <div className="flex gap-3 text-xs font-semibold">
            <button type="button" onClick={() => workspace.setSelectedCategories(workspace.validCategoryValues)} className="text-brand-600 transition-colors hover:text-brand-700 hover:underline">
              {t.generateWorkspace.selectAll}
            </button>
            <button type="button" onClick={() => workspace.setSelectedCategories([])} className="text-ink-400 transition-colors hover:text-ink-600 hover:underline">
              {t.generateWorkspace.deselectAll}
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {TEST_CASE_CATEGORIES.map((category) => (
            <label
              key={category.value}
              className={`flex cursor-pointer gap-3 rounded-[var(--radius-control)] border p-3 text-sm transition-all duration-150 ${
                workspace.selectedCategories.includes(category.value)
                  ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400'
                  : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'
              }`}
            >
              <input
                type="checkbox"
                checked={workspace.selectedCategories.includes(category.value)}
                onChange={() => workspace.toggleCategory(category.value)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
              />
              <span>
                <span className="block font-semibold text-ink-800">{workspace.getCategoryLabel(category.value)}</span>
                <span className="text-xs text-ink-500">{workspace.getCategoryDescription(category.value)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {workspace.error && (
        <div className="alert-danger animate-[fadeIn_0.2s_ease]">
          {workspace.error}
          {workspace.errorDetails.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-normal text-red-600">
              {workspace.errorDetails.map((d, i) => <li key={i}><span className="font-mono">{d.path || '(root)'}</span>: {d.message}</li>)}
            </ul>
          )}
        </div>
      )}
      {workspace.successMessage && (
        <div className="flex items-center gap-2 rounded-2xl border border-success-600/20 bg-success-50 p-4 text-sm font-semibold text-success-600 animate-[fadeIn_0.2s_ease]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {workspace.successMessage}
        </div>
      )}
      {workspace.isDemoProject && (
        <div className="flex items-start gap-2 rounded-2xl border border-warning-600/20 bg-warning-50 p-4 text-sm font-semibold text-warning-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t.generateWorkspace.demoNotice}
        </div>
      )}

      {workspace.isRetrievingRagContext && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-500">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {t.generateWorkspace.retrievingRagContext}
        </p>
      )}
      {!workspace.isRetrievingRagContext && !!workspace.retrievedRagCount && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-success-600">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {t.generateWorkspace.retrievedRagContextSuffix(workspace.retrievedRagCount)}
        </p>
      )}

      <div className="flex flex-wrap gap-3 border-t border-ink-100 pt-6">
        <button
          disabled={!workspace.canGenerate}
          onClick={workspace.handleGenerateClick}
          className="btn-primary"
        >
          {workspace.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {workspace.isPending ? t.generateWorkspace.generating : t.generateWorkspace.generateButton}
        </button>
        <button
          disabled={workspace.isSaving || workspace.safeTestCasesCount === 0}
          onClick={workspace.saveToLibrary}
          className="btn border border-success-600/30 bg-success-50 text-success-600 hover:bg-emerald-100 focus-visible:ring-success-600/40"
        >
          {workspace.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {workspace.isSaving ? t.generateWorkspace.saving : t.generateWorkspace.saveButton}
        </button>
        <button
          disabled={workspace.safeTestCasesCount === 0}
          onClick={workspace.exportExcel}
          className="btn-secondary"
        >
          <Download className="h-4 w-4" />
          {t.generateWorkspace.exportButton}
        </button>
      </div>
    </section>
  );
}

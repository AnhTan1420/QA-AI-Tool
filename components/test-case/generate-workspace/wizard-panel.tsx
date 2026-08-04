'use client';

import { TEST_CASE_CATEGORIES } from '@/lib/test-case-taxonomy';
import { SCROLLBAR } from './shared';
import { DocumentReaderPanel } from './document-reader-panel';
import type { GenerateWorkspaceState } from './use-generate-workspace';

/** Danh sach preset cho dropdown "Ngon ngu" (ngon ngu OUTPUT cua test case sinh
 * ra - khac voi ngon ngu giao dien UI o LanguageToggle). Truoc day la 1 o input
 * text tu do go, doi thanh dropdown de tranh nguoi dung go sai/khong nhat quan
 * ten ngon ngu (VD "Viet", "vi", "Vietnamese" deu co the bi AI hieu khac nhau). */
const LANGUAGE_OPTIONS = ['Tiếng Việt', 'English', '日本語', '한국어', '中文', 'Français', 'Español', 'Deutsch'];

/** Left column: requirement input, old-cases import, language/detail, taxonomy, and actions. */
export function WizardPanel({ workspace }: { workspace: GenerateWorkspaceState }) {
  const { t } = workspace;

  return (
    <section className={`space-y-6 rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_2px_20px_-4px_rgba(15,23,42,0.06)] backdrop-blur-sm overflow-y-auto ${SCROLLBAR}`}>
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-blue-600">{t.generateWorkspace.wizardEyebrow}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{t.generateWorkspace.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{t.generateWorkspace.subtitle}</p>
      </div>

      <label className="block">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-[11px] font-black text-white shadow-sm shadow-blue-200">1</span>
          {t.generateWorkspace.requirementLabel}
        </span>
        <textarea
          value={workspace.description}
          onChange={(event) => workspace.setDescription(event.target.value)}
          placeholder={t.generateWorkspace.requirementPlaceholder}
          className={`mt-2 min-h-64 w-full rounded-2xl border border-slate-200 bg-slate-50/40 p-4 text-sm leading-6 text-slate-800 outline-none transition-all placeholder:text-slate-400/80 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100 ${SCROLLBAR}`}
        />
        <p className={`mt-1.5 text-xs font-semibold ${workspace.hasEnoughInputToGenerate ? 'text-emerald-600' : 'text-amber-600'}`}>
          {workspace.hasEnoughInputToGenerate
            ? (workspace.hasRequirementInput ? t.generateWorkspace.inputStatus.requirementReady : t.generateWorkspace.inputStatus.documentReady)
            : t.generateWorkspace.inputStatus.needMore}
        </p>
      </label>

      <DocumentReaderPanel workspace={workspace} />

      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-black text-white">3</span>
            {t.generateWorkspace.oldCasesLabel}
          </span>
          <button type="button" onClick={workspace.downloadOldCasesTemplate} className="text-xs font-bold text-blue-600 transition-colors hover:text-blue-700 hover:underline">
            {t.generateWorkspace.downloadTemplate}
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/30 p-5 text-center transition-all hover:border-blue-300 hover:bg-blue-50/30">
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) workspace.handleOldCasesFile(file);
              event.target.value = '';
            }}
          />
          <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3" />
          </svg>
          <span className="text-sm font-semibold text-slate-700">{workspace.isParsingOldCases ? t.generateWorkspace.chooseFileReading : t.generateWorkspace.chooseFile}</span>
          <span className="text-xs text-slate-400">{t.generateWorkspace.fileHint}</span>
        </label>
        {workspace.oldCasesFileName && !workspace.isParsingOldCases && (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <span className="font-semibold text-slate-700">{workspace.oldCasesFileName} {t.generateWorkspace.loadedSuffix(workspace.oldCases.length)}</span>
            <button type="button" onClick={workspace.clearOldCasesFile} className="font-bold text-red-500 transition-colors hover:text-red-600 hover:underline">{t.generateWorkspace.removeFile}</button>
          </div>
        )}
        {workspace.oldCasesWarning && <p className="mt-1 text-xs font-semibold text-amber-600">{workspace.oldCasesWarning}</p>}
      </div>

      <div>
        <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-black text-white">4</span>
          {t.generateWorkspace.languageDetailHeading}
        </span>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">{t.generateWorkspace.languageLabel}</span>
            <select
              value={workspace.language}
              onChange={(event) => workspace.setLanguage(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/40 px-4 py-3 text-sm outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
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
            <span className="text-xs font-semibold text-slate-500">{t.generateWorkspace.detailLevelLabel}</span>
            <select value={workspace.detailLevel} onChange={(event) => workspace.setDetailLevel(event.target.value as typeof workspace.detailLevel)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/40 px-4 py-3 text-sm outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100">
              <option value="concise">{t.generateWorkspace.detailConcise}</option>
              <option value="standard">{t.generateWorkspace.detailStandard}</option>
              <option value="detailed">{t.generateWorkspace.detailDetailed}</option>
            </select>
          </label>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-black text-white">5</span>
            {t.generateWorkspace.taxonomyLabel}
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">{workspace.selectedCategories.length}/{TEST_CASE_CATEGORIES.length}</span>
          </span>
          <div className="flex gap-3 text-xs font-bold">
            <button type="button" onClick={() => workspace.setSelectedCategories(workspace.validCategoryValues)} className="text-blue-600 transition-colors hover:text-blue-700 hover:underline">{t.generateWorkspace.selectAll}</button>
            <button type="button" onClick={() => workspace.setSelectedCategories([])} className="text-slate-400 transition-colors hover:text-slate-600 hover:underline">{t.generateWorkspace.deselectAll}</button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {TEST_CASE_CATEGORIES.map((category) => (
            <label
              key={category.value}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-3 text-sm transition-all duration-150 ${
                workspace.selectedCategories.includes(category.value)
                  ? 'border-blue-300 bg-blue-50/60 shadow-sm shadow-blue-100'
                  : 'border-slate-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-sm'
              }`}
            >
              <input type="checkbox" checked={workspace.selectedCategories.includes(category.value)} onChange={() => workspace.toggleCategory(category.value)} className="mt-0.5 accent-blue-600" />
              <span>
                <span className="block font-bold text-slate-800">{workspace.getCategoryLabel(category.value)}</span>
                <span className="text-xs text-slate-500">{workspace.getCategoryDescription(category.value)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {workspace.error && (
        <div className="animate-[fadeIn_0.2s_ease] rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {workspace.error}
          {workspace.errorDetails.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-normal text-red-600">
              {workspace.errorDetails.map((d, i) => <li key={i}><span className="font-mono">{d.path || '(root)'}</span>: {d.message}</li>)}
            </ul>
          )}
        </div>
      )}
      {workspace.successMessage && <div className="animate-[fadeIn_0.2s_ease] rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{workspace.successMessage}</div>}
      {workspace.isDemoProject && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">{t.generateWorkspace.demoNotice}</div>}

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          disabled={!workspace.canGenerate}
          onClick={workspace.handleGenerateClick}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-sm shadow-blue-200 transition-all hover:shadow-md hover:shadow-blue-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {workspace.isPending && (
            <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {workspace.isPending ? t.generateWorkspace.generating : t.generateWorkspace.generateButton}
        </button>
        <button
          disabled={workspace.isSaving || workspace.safeTestCasesCount === 0}
          onClick={workspace.saveToLibrary}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 transition-all hover:bg-emerald-100 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {workspace.isSaving && (
            <svg className="h-4 w-4 animate-spin text-emerald-700" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {workspace.isSaving ? t.generateWorkspace.saving : t.generateWorkspace.saveButton}
        </button>
        <button
          disabled={workspace.safeTestCasesCount === 0}
          onClick={workspace.exportExcel}
          className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition-all hover:border-emerald-200 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.generateWorkspace.exportButton}
        </button>
      </div>
    </section>
  );
}

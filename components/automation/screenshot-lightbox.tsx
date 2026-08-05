'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export function ScreenshotLightbox({
  runId,
  onClose,
  hasAnnotated,
}: {
  runId: string;
  onClose: () => void;
  hasAnnotated: boolean;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'original' | 'annotated'>('original');

  const src =
    mode === 'annotated' && hasAnnotated
      ? `/api/automation/runs/${runId}/screenshot?type=annotated`
      : `/api/automation/runs/${runId}/screenshot`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          {hasAnnotated && (
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setMode('original')}
                className={`px-2 py-1 rounded ${mode === 'original' ? 'bg-blue-100' : ''}`}
              >
                {t.automation.originalScreenshot}
              </button>
              <button
                type="button"
                onClick={() => setMode('annotated')}
                className={`px-2 py-1 rounded ${mode === 'annotated' ? 'bg-blue-100' : ''}`}
              >
                {t.automation.aiAnnotated}
              </button>
            </div>
          )}
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800">
            {t.common.close}
          </button>
        </div>
        <img src={src} alt="Screenshot" className="w-full rounded-lg" />
      </div>
    </div>
  );
}

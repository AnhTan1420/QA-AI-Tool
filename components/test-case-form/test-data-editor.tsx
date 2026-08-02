'use client';

export function TestDataEditor({
  testData,
  keyValue,
  valueValue,
  onKeyChange,
  onValueChange,
  onAdd,
  onRemove,
}: {
  testData: Record<string, string>;
  keyValue: string;
  valueValue: string;
  onKeyChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Dữ liệu test</label>
      <div className="flex gap-2 mb-2">
        <input
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="Key (VD: email)"
          value={keyValue}
          onChange={(e) => onKeyChange(e.target.value)}
        />
        <input
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="Value (VD: test@example.com)"
          value={valueValue}
          onChange={(e) => onValueChange(e.target.value)}
        />
        <button
          type="button"
          onClick={onAdd}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"
        >
          Thêm
        </button>
      </div>
      {Object.entries(testData).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(testData).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs">
              {k}: {v}
              <button type="button" onClick={() => onRemove(k)} className="text-blue-400 hover:text-blue-600">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

export function PreconditionsEditor({
  preconditions,
  onUpdate,
  onAdd,
  onRemove,
}: {
  preconditions: string[];
  onUpdate: (idx: number, value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Điều kiện tiên quyết</label>
      <div className="space-y-2">
        {preconditions.map((p, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={p}
              onChange={(e) => onUpdate(i, e.target.value)}
              placeholder={`Precondition ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="text-red-500 hover:text-red-700 text-sm px-2"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          + Thêm precondition
        </button>
      </div>
    </div>
  );
}

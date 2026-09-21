// ============================================================================
// File: src/services/ai/model-registry.ts
// Lop cau hinh DUY NHAT cho toan bo AI cua he thong. TAT CA AI = GEMINI.
// ----------------------------------------------------------------------------
// Truoc day `process.env.AI_MODEL_*` bi rai rac trong provider.ts, gemini.ts,
// vision.ts va cac route — moi noi co 1 quy tac fallback khac nhau. Gio moi
// quyet dinh "task nay chay model nao, fallback ra sao" deu o day.
//
// Quy tac giai model chain cho 1 task:
//     [ model rieng cua task ]  ->  AI_MODEL_PRIMARY
//                              ->  AI_MODEL_FALLBACK_1
//                              ->  AI_MODEL_FALLBACK_2
//                              ->  AI_MODEL_FALLBACK (bien cu, giu de tuong thich nguoc)
// Sau do: bo gia tri rong/whitespace, khu trung lap (giu thu tu xuat hien dau).
//
// LUU Y: moi ham o day doc process.env NGAY TAI THOI DIEM GOI (khong cache o
// module scope) de (a) test co the set env truoc tung case, (b) thay doi env
// tren Vercel co hieu luc ma khong phu thuoc thu tu import.
// ============================================================================

export type AITask =
  | 'generation'
  | 'coverage_repair'
  | 'review'
  | 'enhance'
  | 'classification'
  | 'document_extraction'
  | 'playwright_codegen'
  | 'playwright_heal';

/**
 * Pool Gemini Flash mac dinh khi KHONG cau hinh env nao. Day la lop CAU HINH,
 * khong phai business logic — khong co ham nghiep vu nao duoc phep nhac den 1
 * model id cu the; tat ca deu di qua `getModelChain()`. Moi gia tri o day deu
 * bi ghi de boi env tuong ung.
 */
export const DEFAULT_MODEL_POOL = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'] as const;

export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

/** Gia tri mac dinh cho cac tham so resilience (deu ghi de duoc qua env). */
export const RESILIENCE_DEFAULTS = {
  requestTimeoutMs: 120_000,
  maxRetriesPerModel: 2,
  backoffBaseMs: 1_000,
  backoffMaxMs: 8_000,
} as const;

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Bo gia tri rong + khu trung lap, giu nguyen thu tu uu tien. */
export function dedupeModels(models: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    if (typeof model !== 'string') continue;
    const trimmed = model.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** Pool Gemini dung chung cho moi task (primary + 2 fallback). */
export function getModelPool(): string[] {
  const configured = dedupeModels([
    readEnv('AI_MODEL_PRIMARY'),
    readEnv('AI_MODEL_FALLBACK_1'),
    readEnv('AI_MODEL_FALLBACK_2'),
    // Bien cu tu kien truc Copilot->Gemini->Groq. Giu lai o CUOI chuoi de cac
    // deployment dang chay khong mat fallback khi nang cap, nhung khong con la
    // nguon cau hinh chinh nua (README da chuyen sang AI_MODEL_FALLBACK_1/2).
    readEnv('AI_MODEL_FALLBACK'),
  ]);
  return configured.length > 0 ? configured : [...DEFAULT_MODEL_POOL];
}

function getTaskModel(task: AITask): string | undefined {
  switch (task) {
    case 'generation':
      return readEnv('AI_MODEL_GENERATION');
    case 'coverage_repair':
      // Repair pass la 1 lan generate thu nho -> mac dinh dung dung model generation.
      return readEnv('AI_MODEL_COVERAGE_REPAIR') ?? readEnv('AI_MODEL_GENERATION');
    case 'review':
      return readEnv('AI_MODEL_REVIEW');
    case 'enhance':
      // Enhance ban chat la 1 review + sua chua -> roi ve model review neu chua cau hinh rieng.
      return readEnv('AI_MODEL_ENHANCE') ?? readEnv('AI_MODEL_REVIEW');
    case 'classification':
      return readEnv('AI_MODEL_CLASSIFICATION');
    case 'document_extraction':
      return readEnv('AI_MODEL_DOCUMENT_EXTRACTION');
    case 'playwright_codegen':
      return readEnv('AI_MODEL_PLAYWRIGHT_CODEGEN');
    case 'playwright_heal':
      // Heal van la codegen -> thua ke model codegen neu khong cau hinh rieng.
      return readEnv('AI_MODEL_PLAYWRIGHT_HEAL') ?? readEnv('AI_MODEL_PLAYWRIGHT_CODEGEN');
    default:
      return undefined;
  }
}

/**
 * Chuoi model Gemini day du cho 1 task: model rieng cua task truoc, roi den pool
 * chung. Luon tra ve it nhat 1 model (DEFAULT_MODEL_POOL), nen KHONG bao gio
 * nem loi "thieu bien moi truong model" nhu kien truc cu.
 */
export function getModelChain(task: AITask): string[] {
  return dedupeModels([getTaskModel(task), ...getModelPool()]);
}

export function getEmbeddingModel(): string {
  return readEnv('AI_MODEL_EMBEDDING') ?? DEFAULT_EMBEDDING_MODEL;
}

/** Doc API key. Nem loi ro rang (khong lo gia tri) neu thieu. */
export function getGeminiApiKey(): string {
  const key = readEnv('GOOGLE_GEMINI_API_KEY');
  if (!key) {
    throw new Error(
      'Thiếu GOOGLE_GEMINI_API_KEY trong biến môi trường server. Đây là provider AI duy nhất của hệ thống.',
    );
  }
  return key;
}

export type ResilienceConfig = {
  requestTimeoutMs: number;
  maxRetriesPerModel: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
};

export function getResilienceConfig(): ResilienceConfig {
  const backoffBaseMs = readIntEnv('GEMINI_BACKOFF_BASE_MS', RESILIENCE_DEFAULTS.backoffBaseMs, 0, 60_000);
  const backoffMaxMs = readIntEnv('GEMINI_BACKOFF_MAX_MS', RESILIENCE_DEFAULTS.backoffMaxMs, 0, 120_000);
  return {
    requestTimeoutMs: readIntEnv('GEMINI_REQUEST_TIMEOUT_MS', RESILIENCE_DEFAULTS.requestTimeoutMs, 1_000, 600_000),
    maxRetriesPerModel: readIntEnv('GEMINI_MAX_RETRIES_PER_MODEL', RESILIENCE_DEFAULTS.maxRetriesPerModel, 0, 10),
    backoffBaseMs,
    // Bao ve khoi cau hinh nguoc (max < base) — neu khong, backoff se bi kep ve 0.
    backoffMaxMs: Math.max(backoffBaseMs, backoffMaxMs),
  };
}

/** So vong repair coverage toi da truoc khi tra ve trang thai "chua du 100%". */
export function getMaxCoverageRepairRounds(): number {
  return readIntEnv('AI_MAX_COVERAGE_REPAIR_ROUNDS', 4, 0, 10);
}

/** So atom toi da gui trong 1 lan goi repair (batch theo tai lieu/section). */
export function getCoverageRepairBatchSize(): number {
  return readIntEnv('AI_COVERAGE_REPAIR_BATCH_SIZE', 35, 5, 200);
}

export type ModelRegistrySnapshot = {
  pool: string[];
  embedding_model: string;
  has_api_key: boolean;
  resilience: ResilienceConfig;
  chains: Record<AITask, string[]>;
};

/**
 * Anh chup cau hinh dung cho health-check/log khoi dong. KHONG chua API key —
 * chi bao co/khong (`has_api_key`), de an toan khi in ra log.
 */
export function describeModelRegistry(): ModelRegistrySnapshot {
  const tasks: AITask[] = [
    'generation',
    'coverage_repair',
    'review',
    'enhance',
    'classification',
    'document_extraction',
    'playwright_codegen',
    'playwright_heal',
  ];
  return {
    pool: getModelPool(),
    embedding_model: getEmbeddingModel(),
    has_api_key: Boolean(readEnv('GOOGLE_GEMINI_API_KEY')),
    resilience: getResilienceConfig(),
    chains: Object.fromEntries(tasks.map((task) => [task, getModelChain(task)])) as Record<AITask, string[]>,
  };
}

/**
 * Validate cau hinh o 1 cho duy nhat. Tra ve danh sach van de thay vi nem loi,
 * de caller tu quyet dinh (health endpoint chi canh bao, runtime call thi chan).
 */
export function validateModelConfiguration(): string[] {
  const problems: string[] = [];
  if (!readEnv('GOOGLE_GEMINI_API_KEY')) {
    problems.push('GOOGLE_GEMINI_API_KEY chưa được cấu hình.');
  }
  if (getModelPool().length === 0) {
    problems.push('Không có model Gemini nào khả dụng (AI_MODEL_PRIMARY / AI_MODEL_FALLBACK_1 / AI_MODEL_FALLBACK_2).');
  }
  const legacyProviderVars = ['GROQ_API_KEY', 'GROQ_MODEL_PRIMARY', 'GROQ_MODEL_FALLBACK', 'GITHUB_COPILOT_TOKEN', 'GITHUB_COPILOT_BASE_URL', 'AI_MODEL_COPILOT', 'AI_MODEL_COPILOT_FALLBACK', 'AI_MODEL_COPILOT_EMBEDDING'];
  const leftovers = legacyProviderVars.filter((name) => readEnv(name));
  if (leftovers.length > 0) {
    problems.push(
      `Các biến môi trường của provider cũ vẫn còn và bị BỎ QUA hoàn toàn (hệ thống chỉ dùng Gemini): ${leftovers.join(', ')}.`,
    );
  }
  return problems;
}

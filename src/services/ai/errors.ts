// ============================================================================
// File: src/services/ai/errors.ts
// Phan loai loi Gemini + loi provider co kiem soat (controlled error).
// ----------------------------------------------------------------------------
// Toan bo chien luoc retry/fallback cua gemini.ts dua tren `classifyGeminiError`.
// Nguyen tac:
//   • transient        -> retry CUNG model (backoff + jitter), roi moi sang model sau
//   • schema_incompatible -> retry CUNG model nhung BO responseSchema (Mode B)
//   • bad_response     -> AI tra JSON hong/rong/khong qua Zod -> retry (co the lan sau tot hon)
//   • model_unavailable-> model nay khong dung duoc (404/400 ve model id) -> sang model ke tiep
//   • auth             -> KHONG retry, KHONG sang model khac (cung 1 API key se cung fail)
//   • fatal            -> loi lap trinh/cau hinh, dung han
// ============================================================================

export type GeminiErrorKind =
  | 'transient'
  | 'schema_incompatible'
  | 'bad_response'
  | 'model_unavailable'
  | 'auth'
  | 'fatal';

/** HTTP status duoc coi la loi tam thoi (co the tu khoi phuc bang retry). */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/** Ma loi tang transport (undici/Node) duoc coi la tam thoi. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ABORT_ERR',
  'ABORTERROR',
]);

const TRANSIENT_KEYWORDS = [
  'overloaded',
  'service unavailable',
  'unavailable',
  'rate limit',
  'too many requests',
  'quota',
  'exhausted',
  'deadline exceeded',
  'timeout',
  'timed out',
  'socket hang up',
  'fetch failed',
  'network',
  'connection reset',
  'connection closed',
  'temporarily',
  'try again later',
  'abort',
  'internal error',
  'backend error',
];

/**
 * Tu khoa cho biet 400 khong phai do request sai ve mat nghiep vu, ma do
 * model/phien ban API KHONG TUONG THICH voi responseSchema ta gui len
 * (vd model cu khong ho tro `propertyOrdering`, hoac schema qua sau).
 * Truong hop nay PHAI thu lai cung model o Mode B (bo schema) truoc khi bo cuoc.
 */
const SCHEMA_KEYWORDS = [
  'responseschema',
  'response_schema',
  'response schema',
  'responsejsonschema',
  'propertyordering',
  'property_ordering',
  'response_mime_type',
  'responsemimetype',
  'json schema',
  'schema',
  'unknown name',
  'invalid json payload',
  'unsupported field',
  'not supported for this model',
  'is not supported',
  'only supported for',
];

const MODEL_UNAVAILABLE_KEYWORDS = [
  'was not found',
  'not found for api version',
  'is not found',
  'unsupported model',
  'model not supported',
  'does not exist',
  'unknown model',
  'is not available',
  'has been deprecated',
  'no longer available',
];

const AUTH_KEYWORDS = [
  'api key not valid',
  'api_key_invalid',
  'invalid api key',
  'permission denied',
  'permission_denied',
  'unauthenticated',
  'unauthorized',
  'caller does not have permission',
  'billing account',
  'access denied',
  'forbidden',
];

/** Gom moi noi ma SDK/undici co the giau HTTP status vao 1 cho. */
export function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;

  const direct = [err.status, err.statusCode, err.code];
  for (const value of direct) {
    if (typeof value === 'number' && value >= 100 && value <= 599) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }

  // @google/genai boc loi goc trong `error` / `response`.
  const nested = (err.error ?? err.response ?? err.cause) as Record<string, unknown> | undefined;
  if (nested && typeof nested === 'object') {
    const nestedStatus = nested.status ?? nested.statusCode ?? nested.code;
    if (typeof nestedStatus === 'number' && nestedStatus >= 100 && nestedStatus <= 599) return nestedStatus;
    if (typeof nestedStatus === 'string' && /^\d{3}$/.test(nestedStatus)) return Number(nestedStatus);
  }

  // Cuoi cung: SDK hay nem Error voi message dang "[503 Service Unavailable] ...",
  // "got status: 429 Too Many Requests" hoac '{"error":{"code":503,...}}'.
  const message = typeof err.message === 'string' ? err.message : '';
  const bracket = message.match(/\[(\d{3})\s/);
  if (bracket) return Number(bracket[1]);
  const statusPhrase = message.match(/status[:\s]+(\d{3})\b/i);
  if (statusPhrase) return Number(statusPhrase[1]);
  const jsonCode = message.match(/"code"\s*:\s*(\d{3})\b/);
  if (jsonCode) return Number(jsonCode[1]);

  return undefined;
}

function errorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();
  const err = error as Record<string, unknown>;
  const parts = [
    typeof err.message === 'string' ? err.message : '',
    typeof err.name === 'string' ? err.name : '',
    typeof err.code === 'string' ? err.code : '',
    typeof (err.cause as Record<string, unknown>)?.code === 'string'
      ? String((err.cause as Record<string, unknown>).code)
      : '',
    typeof (err.cause as Record<string, unknown>)?.message === 'string'
      ? String((err.cause as Record<string, unknown>).message)
      : '',
  ];
  return parts.join(' ').toLowerCase();
}

function transportCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;
  const candidates = [err.code, (err.cause as Record<string, unknown> | undefined)?.code, err.name];
  for (const value of candidates) {
    if (typeof value === 'string' && TRANSIENT_CODES.has(value.toUpperCase())) return value.toUpperCase();
  }
  return undefined;
}

/** Loi do CHINH ta nem ra khi AI tra ve du lieu khong dung (JSON hong / Zod fail). */
export class GeminiBadResponseError extends Error {
  readonly kind = 'bad_response' as const;
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = 'GeminiBadResponseError';
  }
}

/**
 * Phan hoi bi CAT CUT giua chung (thuong do cham tran maxOutputTokens).
 *
 * Truoc day parse.ts am tham va lai phan JSON hop le roi tra ve nhu mot ket qua
 * binh thuong — nghia la he thong CHAP NHAN mot bo test case thieu mot nua ma
 * khong ai biet. Gio no la mot loi co kieu: engine se retry (lan sample sau co
 * the ngan hon va tron ven), va chi dung lai phan da va duoc khi khong con lua
 * chon nao — kem theo co bao "truncated" di len tan API.
 */
export class GeminiTruncatedResponseError extends Error {
  readonly name = 'GeminiTruncatedResponseError';
  constructor(message: string, readonly salvaged: unknown) {
    super(message);
  }
}

/** Loi do ta chu dong nem khi request vuot qua timeout cau hinh. */
export class GeminiTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  constructor(readonly timeoutMs: number, readonly model: string) {
    super(`Gemini request timed out after ${timeoutMs}ms (model: ${model})`);
    this.name = 'GeminiTimeoutError';
  }
}

/**
 * Loi CUOI CUNG tra ra khi da di het model pool. Chua du thong tin de log/audit
 * nhung message hien cho nguoi dung thi trung tinh (xem `userMessage`) — khong
 * lo stack trace SDK, khong lo API key, khong lo ten model noi bo.
 */
export class GeminiProviderError extends Error {
  readonly name = 'GeminiProviderError';
  constructor(
    message: string,
    readonly meta: {
      task: string;
      attemptedModels: string[];
      lastKind: GeminiErrorKind;
      lastStatus?: number;
      cause?: unknown;
    },
  ) {
    super(message);
  }

  /** Thong bao an toan de hien thi truc tiep cho nguoi dung. */
  get userMessage(): string {
    if (this.meta.lastKind === 'auth') {
      return 'Cấu hình Gemini API key không hợp lệ hoặc không có quyền truy cập. Vui lòng liên hệ quản trị viên.';
    }
    if (this.meta.attemptedModels.length > 1) {
      return 'Gemini đang tạm thời không khả dụng trên tất cả model đã cấu hình. Vui lòng thử lại thao tác này.';
    }
    return 'Gemini đang tạm thời không khả dụng. Hệ thống đã tự động thử các model Gemini dự phòng được cấu hình.';
  }
}

export function classifyGeminiError(error: unknown): GeminiErrorKind {
  if (error instanceof GeminiTruncatedResponseError) return 'bad_response';
  if (error instanceof GeminiBadResponseError) return 'bad_response';
  if (error instanceof GeminiTimeoutError) return 'transient';

  const status = extractStatus(error);
  const text = errorText(error);
  const code = transportCode(error);

  // 1) Auth/permission truoc tien: KHONG bao gio retry, va doi model cung vo ich.
  if (status === 401 || status === 403) return 'auth';
  if (!status && AUTH_KEYWORDS.some((k) => text.includes(k)) && !TRANSIENT_KEYWORDS.some((k) => text.includes(k))) {
    return 'auth';
  }

  // 2) Loi transport/timeout.
  if (code) return 'transient';
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return 'transient';

  // 3) Model khong ton tai/khong dung duoc -> nhay sang model ke tiep.
  if (status === 404) return 'model_unavailable';
  if (MODEL_UNAVAILABLE_KEYWORDS.some((k) => text.includes(k))) return 'model_unavailable';

  // 4) 400 do schema/cau hinh structured-output -> thu lai KHONG kem schema.
  if (status === 400 && SCHEMA_KEYWORDS.some((k) => text.includes(k))) return 'schema_incompatible';
  if (status === undefined && SCHEMA_KEYWORDS.some((k) => text.includes(k))) return 'schema_incompatible';

  // 5) 400 con lai = request that su sai -> khong retry mu quang.
  if (status === 400) return 'fatal';

  // 6) Khong xac dinh duoc status: dua vao tu khoa.
  if (TRANSIENT_KEYWORDS.some((k) => text.includes(k))) return 'transient';

  return 'fatal';
}

/** Chuoi mo ta ngan gon, AN TOAN de dua vao log (khong chua key/header/payload). */
export function describeErrorForLog(error: unknown): string {
  const status = extractStatus(error);
  const kind = classifyGeminiError(error);
  const name = error instanceof Error ? error.name : 'Error';
  return status ? `${kind}/${status} (${name})` : `${kind} (${name})`;
}

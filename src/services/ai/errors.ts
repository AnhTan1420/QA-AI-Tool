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

export function errorText(error: unknown): string {
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
 * Failure taxonomy used by the retry policy, telemetry and user messages.
 * Finer than GeminiErrorKind on purpose: 429 / 5xx / timeout were all
 * "transient" and invalid-JSON / validation / truncation were all
 * "bad_response", so they all got the same handling — which is exactly how a
 * deterministic failure (an oversized request, a truncated output) got replayed
 * against every model. Each code has ONE handling rule (see retry-policy.ts).
 */
export type FailureCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'MODEL_UNAVAILABLE'
  | 'TIMEOUT'
  | 'SCHEMA_ERROR'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'OUTPUT_TRUNCATED'
  | 'REQUEST_TOO_LARGE'
  | 'SERVER_BUDGET_EXHAUSTED'
  | 'NO_PROGRESS'
  | 'UNKNOWN';

/** Thrown by the engine itself when the remaining execution budget cannot fund another attempt. */
export class GeminiBudgetExhaustedError extends Error {
  readonly name = 'GeminiBudgetExhaustedError';
  constructor(readonly remainingMs: number, readonly neededMs: number) {
    super(`Insufficient execution budget: ${Math.max(0, Math.round(remainingMs))}ms left, ${Math.round(neededMs)}ms needed.`);
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
      /** Fine-grained reason (see FailureCode) — what callers should branch on. */
      failure?: FailureCode;
      /** Wall time the whole call consumed, for diagnostics. */
      elapsedMs?: number;
    },
  ) {
    super(message);
  }

  /** Thong bao an toan de hien thi truc tiep cho nguoi dung. */
  get userMessage(): string {
    switch (this.meta.failure) {
      case 'SERVER_BUDGET_EXHAUSTED':
        return 'Không còn đủ thời gian xử lý trong một lượt. Phần đã hoàn thành được giữ lại — hãy tiếp tục để xử lý phần còn lại.';
      case 'REQUEST_TOO_LARGE':
        return 'Yêu cầu quá lớn so với giới hạn của AI. Hãy giảm số category/tài liệu hoặc chia nhỏ đầu vào.';
      case 'OUTPUT_TRUNCATED':
        return 'Phản hồi của AI vượt giới hạn độ dài và bị cắt cụt. Hãy giảm số lượng yêu cầu trong một lượt.';
      case 'RATE_LIMIT':
        return 'Gemini đang giới hạn tốc độ hoặc API key đã hết hạn mức (quota). Vui lòng đợi rồi thử lại; nếu lỗi lặp lại, quản trị viên cần kiểm tra gói/billing của API key.';
      case 'TIMEOUT':
        return 'Gemini phản hồi quá chậm cho yêu cầu này. Hãy thử lại hoặc giảm khối lượng công việc.';
      default:
        break;
    }
    if (this.meta.lastKind === 'auth') {
      return 'Cấu hình Gemini API key không hợp lệ hoặc không có quyền truy cập. Vui lòng liên hệ quản trị viên.';
    }
    // The LAST failure was the API refusing the request itself (HTTP 400), not an outage: telling the
    // user "temporarily unavailable, try again" would send them into a retry loop that cannot succeed.
    if (this.meta.lastStatus === 400) {
      return 'Gemini từ chối yêu cầu này (HTTP 400) trên model dự phòng cuối cùng. Thử lại sau ít phút; nếu lỗi lặp lại, quản trị viên cần kiểm tra cấu hình model (AI_MODEL_*) và log máy chủ.';
    }
    if (this.meta.attemptedModels.length > 1) {
      return 'Gemini đang tạm thời không khả dụng trên tất cả model đã cấu hình. Vui lòng thử lại thao tác này.';
    }
    return 'Gemini đang tạm thời không khả dụng. Hệ thống đã tự động thử các model Gemini dự phòng được cấu hình.';
  }
}

/** Failures a user retrying the same action can plausibly get past (vs. a request that will be refused again). */
const RETRYABLE_FAILURES: ReadonlySet<FailureCode> = new Set<FailureCode>([
  'RATE_LIMIT',
  'TRANSIENT_PROVIDER_ERROR',
  'TIMEOUT',
  'SERVER_BUDGET_EXHAUSTED',
]);

/**
 * JSON body the AI routes return for a GeminiProviderError. The HTTP status stays 503 (clients and
 * tests depend on it), but a bare 503 hid WHY: quota (429), overload (5xx), timeout and a refused
 * request (400) all looked identical. `failure` / `upstream_status` name the real cause without
 * exposing model ids, SDK stack traces or keys.
 */
export function providerErrorBody(error: GeminiProviderError) {
  const failure = error.meta.failure ?? null;
  return {
    success: false as const,
    error: error.userMessage,
    failure,
    upstream_status: error.meta.lastStatus ?? null,
    retryable: failure !== null && RETRYABLE_FAILURES.has(failure),
  };
}

/**
 * true khi loi la do QUA THOI GIAN CHO (timeout cua chinh ta, hoac AbortError do
 * abortSignal cua SDK). Tach rieng khoi 'transient' chung chung vi 1 request bi
 * timeout o T giay ma thu lai voi CUNG timeout T gan nhu chac chan timeout lai —
 * khac han 503/429, la loi tuc thoi that su va thu lai thuong qua duoc.
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof GeminiTimeoutError) return true;
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
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

/**
 * The provider's own explanation of a failure, made SAFE for logs: whitespace collapsed, anything
 * that looks like a credential removed, length capped. Without it a "fatal/400" is undiagnosable:
 * the status alone cannot say WHICH part of the request the API refused (thinking level, schema
 * shape, model-specific limit...), which is exactly what is needed to pick the right fix.
 * Only the provider's RESPONSE text is used - never the request (prompt, headers, payload).
 */
export function safeErrorDetail(error: unknown, maxChars = 300): string {
  if (!error) return '';
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown }).message === 'string'
          ? String((error as { message: string }).message)
          : '';
  const cleaned = raw
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-key]')
    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : cleaned;
}

/** Chuoi mo ta ngan gon, AN TOAN de dua vao log (khong chua key/header/payload). */
export function describeErrorForLog(error: unknown): string {
  const status = extractStatus(error);
  const kind = classifyGeminiError(error);
  const name = error instanceof Error ? error.name : 'Error';
  const head = status ? `${kind}/${status} (${name})` : `${kind} (${name})`;
  const detail = safeErrorDetail(error);
  return detail ? `${head}: ${detail}` : head;
}

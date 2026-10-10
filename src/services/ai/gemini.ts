// ============================================================================
// File: src/services/ai/gemini.ts
// LOP THUC THI GEMINI DUY NHAT CUA HE THONG.
// ----------------------------------------------------------------------------
// Moi request AI (generate / coverage repair / review / enhance / document
// extraction / vision / playwright codegen+heal / classification / embedding)
// deu di qua day. KHONG duoc phep goi `ai.models.generateContent` o bat ky
// file nao khac — neu khong, logic retry/backoff/timeout/schema-degradation se
// bi nhan ban va lech nhau (day chinh la bug cu: gemini.ts va vision.ts co 2
// bo quy tac fallback khac nhau).
//
// Chien luoc cho MOI request (chi tiet quy tac: retry-policy.ts — noi DUY NHAT
// quyet dinh retry/fallback; khong tang nao khac duoc tu y retry cung 1 request):
//
//   for model of [task model, AI_MODEL_PRIMARY, FALLBACK_1, FALLBACK_2]:
//       repeat:
//           moi lan thu: timeout = min(timeoutMs, ngan sach con lai)
//           goi Gemini (Mode A: co responseSchema)
//           ├─ OK              -> parse JSON -> validate (Zod) -> TRA VE
//           └─ loi -> classifyFailure() -> decideNext():
//                retry_same | next_model | degrade_schema | degrade_thinking |
//                return_salvaged | stop
//   het model / het ngan sach -> nem GeminiProviderError (kem `failure` + userMessage an toan)
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import { extractJson } from './parse';
import {
  classifyGeminiError,
  describeErrorForLog,
  extractStatus,
  GeminiBadResponseError,
  GeminiBudgetExhaustedError,
  GeminiProviderError,
  GeminiTimeoutError,
  GeminiTruncatedResponseError,
  type FailureCode,
} from './errors';
import { classifyFailure, decideNext, extractRetryAfterMs, type PolicyState } from './retry-policy';
import { emitAiEvent, estimateTokens } from './ai-telemetry';
import type { ExecutionBudget } from './execution-budget';
import {
  dedupeModels,
  getEmbeddingModel,
  getGeminiApiKey,
  getModelChain,
  getResilienceConfig,
  type AITask,
} from './model-registry';

export type VisionImageInput = { mimeType: string; base64Data: string };

/**
 * Muc suy nghi (thinking) cua ho Gemini 3.x. CHI co 'low' | 'medium' | 'high':
 * KHONG bao gio dung 'minimal' o day — theo tai lieu Gemini API, 'minimal' tra
 * LOI o Gemini 3.7/3.8 Flash va 3.1 Pro, nen mot chain co model do se hong
 * ngay attempt dau tien. 'low' duoc moi model text Gemini 3.x ho tro.
 */
export type GeminiThinkingLevel = 'low' | 'medium' | 'high';

/** Ho Gemini 2.5 dung thinkingBudget (khong co thinkingLevel) nen chi ap dung cho 3.x. */
function supportsThinkingLevel(model: string): boolean {
  return /^gemini-3/i.test(model);
}

// ── Client adapter ─────────────────────────────────────────────────────────
// Interface toi thieu de (a) khong phu thuoc chi tiet kieu cua SDK trong logic
// retry, (b) test co the inject 1 client gia lap ma khong can mock module SDK.

export type GeminiGenerateArgs = {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
};

export interface GeminiLikeClient {
  models: {
    generateContent(args: GeminiGenerateArgs): Promise<{
      text?: string | undefined;
      /** Real SDK responses carry the stop reason here; MAX_TOKENS = output hit maxOutputTokens. */
      candidates?: { finishReason?: string | undefined }[] | undefined;
    }>;
    embedContent(args: { model: string; contents: string }): Promise<{
      embeddings?: { values?: number[] }[] | undefined;
    }>;
  };
}

function createDefaultClient(apiKey: string): GeminiLikeClient {
  const ai = new GoogleGenAI({ apiKey });
  // Cast qua `unknown`: KHONG phai de "tat type-check" ma vi kieu tham so cua
  // SDK (GenerateContentParameters) chat hon interface cau truc o tren (config
  // la Record<string, unknown> de con truyen duoc abortSignal/responseSchema
  // dong). Moi gia tri truyen vao deu do chinh file nay dung nen, khong den tu
  // input nguoi dung.
  return {
    models: {
      generateContent: (args: GeminiGenerateArgs) =>
        ai.models.generateContent(args as unknown as Parameters<typeof ai.models.generateContent>[0]),
      embedContent: (args: { model: string; contents: string }) =>
        ai.models.embedContent(args as unknown as Parameters<typeof ai.models.embedContent>[0]),
    },
  } as unknown as GeminiLikeClient;
}

let clientFactoryOverride: ((apiKey: string) => GeminiLikeClient) | null = null;

/**
 * CHI DUNG TRONG TEST. Thay the factory tao Gemini client de test duoc chuoi
 * retry/fallback ma khong goi mang that. Truyen `null` de khoi phuc.
 */
export function __setGeminiClientFactoryForTests(
  factory: ((apiKey: string) => GeminiLikeClient) | null,
): void {
  clientFactoryOverride = factory;
}

function resolveClient(): GeminiLikeClient {
  const apiKey = getGeminiApiKey();
  return (clientFactoryOverride ?? createDefaultClient)(apiKey);
}

// ── Backoff ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff + "equal jitter": nua co dinh, nua ngau nhien. Jitter la
 * BAT BUOC — neu nhieu request dong thoi cung dinh 503 va cung retry sau dung
 * 1000ms thi ta chi doi don tat ca chung vao cung 1 thoi diem lan nua.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  if (baseMs <= 0) return 0;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  const half = exponential / 2;
  return Math.round(half + random() * half);
}

// ── Mot lan goi Gemini (co timeout cung) ───────────────────────────────────

function buildContents(userPrompt: string, images?: VisionImageInput[]): unknown {
  if (!images || images.length === 0) return userPrompt;
  return [
    {
      role: 'user' as const,
      parts: [
        { text: userPrompt },
        ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64Data } })),
      ],
    },
  ];
}

async function callGeminiOnce(
  client: GeminiLikeClient,
  model: string,
  opts: {
    systemPrompt: string;
    userPrompt: string;
    images?: VisionImageInput[];
    responseSchema?: Record<string, unknown>;
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
    thinkingLevel?: GeminiThinkingLevel;
    /** Telemetry hook: size (chars) of the raw model output, before parsing. */
    onOutput?: (chars: number) => void;
  },
): Promise<unknown> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let raceTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const request = client.models.generateContent({
      model,
      contents: buildContents(opts.userPrompt, opts.images),
      config: {
        systemInstruction: opts.systemPrompt,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
        responseMimeType: 'application/json',
        abortSignal: controller.signal,
        ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
        // SDK dung enum chuoi IN HOA (ThinkingLevel.LOW = "LOW").
        ...(opts.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: opts.thinkingLevel.toUpperCase() } }
          : {}),
      },
    });

    // Belt-and-braces: khong phai phien ban SDK nao cung ton trong abortSignal.
    // Race voi 1 timer rieng de request KHONG BAO GIO treo vo han — day la yeu
    // cau cung (moi external call phai co timeout co gioi han).
    const response = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        raceTimer = setTimeout(
          () => reject(new GeminiTimeoutError(opts.timeoutMs, model)),
          opts.timeoutMs + 250,
        );
      }),
    ]);

    const text = response?.text;
    if (typeof text === 'string') opts.onOutput?.(text.length);
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new GeminiBadResponseError(`Gemini trả về phản hồi rỗng (model: ${model}).`);
    }

    // extractJson = Mode C: bo ```json fence, cat dung doan JSON, va va lai JSON
    // bi cat cut do cham tran maxOutputTokens truoc khi bo cuoc.
    try {
      return extractJson(text);
    } catch (error) {
      // The API itself says the output hit maxOutputTokens, and the text is not repairable:
      // that is DETERMINISTIC truncation, not a random bad sample. Classify it as such, or the
      // retry policy would burn a resample replaying the identical request.
      const finishReason = response?.candidates?.[0]?.finishReason;
      if (error instanceof GeminiBadResponseError && finishReason === 'MAX_TOKENS') {
        throw new GeminiTruncatedResponseError('Phản hồi AI bị cắt cụt (finishReason=MAX_TOKENS).', undefined);
      }
      throw error;
    }
  } finally {
    clearTimeout(abortTimer);
    if (raceTimer) clearTimeout(raceTimer);
  }
}

// ── API chinh ──────────────────────────────────────────────────────────────

export type GeminiCallOptions<T> = {
  /** Ten task — quyet dinh model chain va xuat hien trong log. */
  task: AITask;
  systemPrompt: string;
  userPrompt: string;
  /** Ghi de model chain (vd repair pass dung lai dung model da thanh cong). */
  models?: string[];
  /** Structured output (Mode A). Bo qua -> chi dung responseMimeType JSON. */
  responseSchema?: Record<string, unknown>;
  images?: VisionImageInput[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Timeout toi da cho MOI lan thu (se bi cat xuong con ngan sach con lai). */
  timeoutMs?: number;
  maxRetriesPerModel?: number;
  /** Cho phep thu lai KHONG kem schema khi model tu choi schema. Mac dinh: true. */
  allowSchemaDegradation?: boolean;
  /**
   * Gioi han thinking cho model Gemini 3.x. Model khong ho tro (vd 2.5) tu dong
   * duoc bo qua; neu API van tu choi thi engine thu lai CUNG model khong kem
   * thinkingConfig.
   */
  thinkingLevel?: GeminiThinkingLevel;
  /**
   * Co thu lai tren CUNG model sau khi bi TIMEOUT hay khong. MAC DINH: false.
   * Timeout o T giay thu lai voi cung T gan nhu chac chan timeout lai — tuc la
   * dot them T giay de nhan cung ket qua. Mac dinh la sang ngay model ke tiep
   * (neu con ngan sach). Chi bat khi caller co ly do cu the.
   */
  retryOnTimeout?: boolean;
  /**
   * Ngan sach thoi gian CHUNG cua request (route). Moi lan thu bi cat timeout
   * theo ngan sach con lai; het ngan sach thi DUNG NGAY thay vi bi nen tang
   * (Vercel) giet giua chung va mat het ket qua.
   */
  budget?: ExecutionBudget;
  /**
   * Lan thu re nhat con co ich (ms). Duoi nguong nay engine khong bat dau them
   * mot lan thu nao nua vi chac chan khong kip hoan thanh. Mac dinh min(10s, timeout).
   */
  minAttemptMs?: number;
  /** Ngu canh khoi luong cho telemetry (batch_size, repair_round...). Chi so/chuoi ngan. */
  telemetry?: Record<string, number | string>;
  /**
   * Validate o MUC UNG DUNG. BAT BUOC o moi call path nghiep vu: HTTP 200
   * KHONG co nghia la du lieu dung. Nem loi (bat ky loai nao) neu khong hop le
   * — engine se coi do la VALIDATION_ERROR/INVALID_JSON.
   */
  validate?: (raw: unknown) => T;
  /** Nhan phu cho log, vd "repair round 2/4". */
  label?: string;
};

export type GeminiCallResult<T> = {
  data: T;
  /** true khi ket qua nay duoc va lai tu mot phan hoi bi cat cut — nghia la
   * NOI DUNG CHUA DAY DU. Caller PHAI bao len tren, khong duoc coi nhu binh thuong. */
  truncated: boolean;
  /** Model thuc su tra ve ket qua. */
  model: string;
  /** Tong so lan goi API (ke ca lan hong). */
  attempts: number;
  /** true neu phai bo responseSchema moi chay duoc (Mode B). */
  schema_degraded: boolean;
  models_attempted: string[];
  elapsed_ms: number;
  input_tokens_est: number;
  output_tokens_est: number;
};

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
const DEFAULT_MIN_ATTEMPT_MS = 10_000;

/** Loi tu `validate` luon duoc quy ve phan hoi hong co kieu, de chinh sach retry xu ly dung. */
function asBadResponse(error: unknown): Error {
  if (error instanceof GeminiBadResponseError || error instanceof GeminiTruncatedResponseError) return error;
  const issues = (error as { issues?: unknown } | null)?.issues;
  const message = error instanceof Error ? error.message : 'Dữ liệu AI không hợp lệ.';
  return new GeminiBadResponseError(message, Array.isArray(issues) ? issues : [message]);
}

/**
 * Thuc thi 1 request Gemini co kha nang tu phuc hoi. Xem so do dau file.
 *
 * KHONG bao gio "ha cap" prompt khi doi model: model B nhan CHINH XAC prompt ma
 * model A nhan. Fallback = CUNG YEU CAU NGHIEP VU, KHAC MODEL GEMINI.
 */
export async function generateWithGeminiResilient<T = unknown>(
  options: GeminiCallOptions<T>,
): Promise<GeminiCallResult<T>> {
  const config = getResilienceConfig();
  const chain = options.models?.length ? dedupeModels(options.models) : getModelChain(options.task);

  if (chain.length === 0) {
    throw new GeminiProviderError('Không có model Gemini nào được cấu hình.', {
      task: options.task,
      attemptedModels: [],
      lastKind: 'fatal',
    });
  }

  const client = resolveClient();
  const startedAt = Date.now();
  const maxRetries = options.maxRetriesPerModel ?? config.maxRetriesPerModel;
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const minAttemptMs = Math.min(options.minAttemptMs ?? DEFAULT_MIN_ATTEMPT_MS, timeoutMs);
  const allowDegradation = options.allowSchemaDegradation !== false;
  const retryOnTimeout = options.retryOnTimeout === true;
  const budget = options.budget;
  const scope = options.label ? `${options.task} (${options.label})` : options.task;
  const inputTokensEst = estimateTokens(options.systemPrompt.length + options.userPrompt.length);

  const modelsAttempted: string[] = [];
  let totalAttempts = 0;
  let lastError: unknown;
  let lastFailure: FailureCode = 'UNKNOWN';
  let stopReason: FailureCode | undefined;
  let unknownHops = 0;
  let outputTokensEst = 0;
  // Phan hoi bi cat cut nhung VAN va lai duoc + qua validate. Luon tra ve kem
  // `truncated: true` de khong ai nham la ket qua day du.
  let salvaged: { data: T; model: string; schemaDegraded: boolean } | null = null;

  const summarize = (status: 'ok' | 'failed' | 'truncated', model?: string) =>
    emitAiEvent({
      event: 'ai_task',
      task: options.task,
      label: options.label,
      status,
      failure: status === 'ok' ? undefined : stopReason ?? lastFailure,
      model,
      attempts: totalAttempts,
      models_attempted: modelsAttempted.length,
      elapsed_ms: Date.now() - startedAt,
      input_tokens_est: inputTokensEst,
      output_tokens_est: outputTokensEst,
      remaining_budget_ms: budget ? Math.round(budget.usableMs()) : null,
      ctx: options.telemetry,
    });

  const fail = (failure: FailureCode, message: string, cause?: unknown): never => {
    stopReason = failure;
    summarize('failed');
    throw new GeminiProviderError(message, {
      task: options.task,
      attemptedModels: modelsAttempted,
      lastKind: failure === 'AUTH_ERROR' ? 'auth' : lastError ? classifyGeminiError(lastError) : 'fatal',
      lastStatus: extractStatus(lastError),
      cause: cause ?? lastError,
      failure,
      elapsedMs: Date.now() - startedAt,
    });
  };

  // Khong du ngan sach cho BAT KY lan thu huu ich nao -> dung ngay, khong goi mang.
  if (budget && !budget.canAfford(minAttemptMs)) {
    const err = new GeminiBudgetExhaustedError(budget.usableMs(), minAttemptMs);
    lastError = err;
    return fail('SERVER_BUDGET_EXHAUSTED', err.message, err);
  }

  for (let modelIndex = 0; modelIndex < chain.length && !stopReason; modelIndex++) {
    const model = chain[modelIndex];
    modelsAttempted.push(model);
    const hasNextModel = modelIndex < chain.length - 1;

    let useSchema = Boolean(options.responseSchema);
    let useThinking = Boolean(options.thinkingLevel) && supportsThinkingLevel(model);
    let degradedForThisModel = false;
    const used = { transient: 0, badResponse: 0, rateLimit: 0 };
    let moveToNextModel = false;

    while (!moveToNextModel && !stopReason) {
      totalAttempts++;
      const remainingBefore = budget ? budget.usableMs() : null;
      const attemptTimeoutMs = remainingBefore === null ? timeoutMs : Math.max(1, Math.min(timeoutMs, remainingBefore));
      const attemptStartedAt = Date.now();
      let outChars = 0;

      try {
        const raw = await callGeminiOnce(client, model, {
          systemPrompt: options.systemPrompt,
          userPrompt: options.userPrompt,
          images: options.images,
          responseSchema: useSchema ? options.responseSchema : undefined,
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          maxOutputTokens,
          timeoutMs: attemptTimeoutMs,
          thinkingLevel: useThinking ? options.thinkingLevel : undefined,
          onOutput: (chars) => {
            outChars = chars;
          },
        });

        // NEVER TRUST AI OUTPUT: HTTP 200 chi moi la dieu kien can.
        let data: T;
        try {
          data = options.validate ? options.validate(raw) : (raw as T);
        } catch (validationError) {
          throw asBadResponse(validationError);
        }

        outputTokensEst = estimateTokens(outChars);
        emitAiEvent({
          event: 'ai_attempt',
          task: options.task,
          label: options.label,
          model,
          attempt: totalAttempts,
          outcome: 'ok',
          latency_ms: Date.now() - attemptStartedAt,
          timeout_ms: attemptTimeoutMs,
          input_tokens_est: inputTokensEst,
          output_tokens_est: outputTokensEst,
          max_output_tokens: maxOutputTokens,
          schema_degraded: degradedForThisModel,
          thinking: useThinking ? options.thinkingLevel : undefined,
          truncated: false,
          remaining_budget_ms: remainingBefore === null ? null : Math.round(remainingBefore),
          ctx: options.telemetry,
        });
        summarize('ok', model);
        return {
          data,
          truncated: false,
          model,
          attempts: totalAttempts,
          schema_degraded: degradedForThisModel,
          models_attempted: [...modelsAttempted],
          elapsed_ms: Date.now() - startedAt,
          input_tokens_est: inputTokensEst,
          output_tokens_est: outputTokensEst,
        };
      } catch (rawError) {
        const error = rawError;
        lastError = error;
        let failure = classifyFailure(error);
        lastFailure = failure;
        const status = extractStatus(error);
        if (outChars > 0) outputTokensEst = estimateTokens(outChars);

        // Phan hoi cat cut: thu cuu phan da va duoc (neu qua duoc validate).
        if (error instanceof GeminiTruncatedResponseError && !salvaged && error.salvaged !== undefined) {
          try {
            const partial = options.validate ? options.validate(error.salvaged) : (error.salvaged as T);
            salvaged = { data: partial, model, schemaDegraded: degradedForThisModel };
          } catch {
            // Phan va duoc cung khong hop le -> khong co gi de cuu.
          }
        }

        const thinkingRejected =
          useThinking && status === 400 && /thinking/i.test(error instanceof Error ? error.message : '');

        const state: PolicyState = {
          failure,
          used,
          maxRetries,
          maxBadResponseRetries: 1,
          useSchema,
          allowSchemaDegradation: allowDegradation,
          thinkingRejected,
          useThinking,
          status,
          retryOnTimeout,
          hasSalvage: salvaged !== null,
          hasNextModel,
          unknownHops,
          remainingMs: budget ? budget.usableMs() : null,
          minAttemptMs,
          backoffMs: computeBackoffMs(used.transient + used.badResponse + used.rateLimit, config.backoffBaseMs, config.backoffMaxMs),
          retryAfterMs: failure === 'RATE_LIMIT' ? extractRetryAfterMs(error) : undefined,
        };
        // Model tu choi thinkingConfig: thu lai CUNG model khong kem no (khong tinh quota).
        const action = thinkingRejected ? ({ type: 'degrade_thinking' } as const) : decideNext(state);
        if (thinkingRejected) failure = 'SCHEMA_ERROR';

        emitAiEvent({
          event: 'ai_attempt',
          task: options.task,
          label: options.label,
          model,
          attempt: totalAttempts,
          outcome: 'failed',
          failure,
          action: action.type === 'stop' ? `stop:${action.reason}` : action.type,
          latency_ms: Date.now() - attemptStartedAt,
          timeout_ms: attemptTimeoutMs,
          input_tokens_est: inputTokensEst,
          output_tokens_est: outputTokensEst,
          max_output_tokens: maxOutputTokens,
          schema_degraded: degradedForThisModel,
          thinking: useThinking ? options.thinkingLevel : undefined,
          truncated: error instanceof GeminiTruncatedResponseError,
          remaining_budget_ms: remainingBefore === null ? null : Math.round(remainingBefore),
          ctx: options.telemetry,
        });
        console.warn(`[Gemini] ${scope} ${model}: ${describeErrorForLog(error)} -> ${action.type}`);

        switch (action.type) {
          case 'degrade_schema':
            useSchema = false;
            degradedForThisModel = true;
            break;
          case 'degrade_thinking':
            useThinking = false;
            break;
          case 'retry_same':
            if (failure === 'RATE_LIMIT') used.rateLimit++;
            else if (failure === 'INVALID_JSON' || failure === 'VALIDATION_ERROR') used.badResponse++;
            else used.transient++;
            await sleep(action.waitMs);
            break;
          case 'next_model':
            if (failure === 'UNKNOWN') unknownHops++;
            moveToNextModel = true;
            break;
          case 'return_salvaged':
            summarize('truncated', salvaged!.model);
            return {
              data: salvaged!.data,
              truncated: true,
              model: salvaged!.model,
              attempts: totalAttempts,
              schema_degraded: salvaged!.schemaDegraded,
              models_attempted: [...modelsAttempted],
              elapsed_ms: Date.now() - startedAt,
              input_tokens_est: inputTokensEst,
              output_tokens_est: outputTokensEst,
            };
          case 'stop':
            stopReason = action.reason;
            break;
        }
      }
    }
  }

  if (salvaged) {
    summarize('truncated', salvaged.model);
    return {
      data: salvaged.data,
      truncated: true,
      model: salvaged.model,
      attempts: totalAttempts,
      schema_degraded: salvaged.schemaDegraded,
      models_attempted: [...modelsAttempted],
      elapsed_ms: Date.now() - startedAt,
      input_tokens_est: inputTokensEst,
      output_tokens_est: outputTokensEst,
    };
  }

  const finalFailure = stopReason ?? lastFailure;
  if (finalFailure === 'AUTH_ERROR') return fail(finalFailure, 'Gemini authentication/permission error.');
  return fail(
    finalFailure,
    `Gemini thất bại trên toàn bộ ${chain.length} model đã cấu hình cho tác vụ "${options.task}" (${finalFailure}).`,
  );
}

/**
 * Embedding (RAG) — di qua CUNG chinh sach retry (decideNext) va telemetry nhu
 * generation; model chain CHI gom AI_MODEL_EMBEDDING vi so chieu vector khac
 * nhau se lam hong index da luu trong Supabase.
 */
export async function createGeminiEmbedding(
  content: string,
  options: { budget?: ExecutionBudget } = {},
): Promise<number[]> {
  const trimmed = content?.trim();
  if (!trimmed) throw new Error('Nội dung cần embedding không được rỗng.');

  const config = getResilienceConfig();
  const client = resolveClient();
  const model = getEmbeddingModel();
  const startedAt = Date.now();
  const minAttemptMs = Math.min(3_000, config.requestTimeoutMs);
  const inputTokensEst = estimateTokens(trimmed.length);

  let lastError: unknown;
  let failure: FailureCode = 'UNKNOWN';
  let retries = 0;

  for (;;) {
    const remaining = options.budget ? options.budget.usableMs() : null;
    if (remaining !== null && remaining < minAttemptMs) {
      failure = 'SERVER_BUDGET_EXHAUSTED';
      break;
    }
    const timeoutMs = remaining === null ? config.requestTimeoutMs : Math.max(1, Math.min(config.requestTimeoutMs, remaining));
    const attemptStartedAt = Date.now();
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        client.models.embedContent({ model, contents: trimmed }),
        new Promise<never>((_, reject) => {
          raceTimer = setTimeout(() => reject(new GeminiTimeoutError(timeoutMs, model)), timeoutMs);
        }),
      ]);

      const values = response?.embeddings?.[0]?.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw new GeminiBadResponseError('Gemini không trả về dữ liệu embedding.');
      }
      emitAiEvent({
        event: 'ai_attempt', task: 'embedding', model, attempt: retries + 1, outcome: 'ok',
        latency_ms: Date.now() - attemptStartedAt, timeout_ms: timeoutMs, input_tokens_est: inputTokensEst,
        output_tokens_est: 0, max_output_tokens: 0, schema_degraded: false, truncated: false,
        remaining_budget_ms: remaining === null ? null : Math.round(remaining),
      });
      return values;
    } catch (error) {
      lastError = error;
      failure = classifyFailure(error);
      const action = decideNext({
        failure,
        used: { transient: retries, badResponse: retries, rateLimit: retries },
        maxRetries: config.maxRetriesPerModel,
        maxBadResponseRetries: 1,
        useSchema: false,
        allowSchemaDegradation: false,
        thinkingRejected: false,
        retryOnTimeout: true,
        hasSalvage: false,
        hasNextModel: false,
        unknownHops: 0,
        remainingMs: options.budget ? options.budget.usableMs() : null,
        minAttemptMs,
        backoffMs: computeBackoffMs(retries, config.backoffBaseMs, config.backoffMaxMs),
        retryAfterMs: failure === 'RATE_LIMIT' ? extractRetryAfterMs(error) : undefined,
      });
      emitAiEvent({
        event: 'ai_attempt', task: 'embedding', model, attempt: retries + 1, outcome: 'failed', failure,
        action: action.type === 'stop' ? `stop:${action.reason}` : action.type,
        latency_ms: Date.now() - attemptStartedAt, timeout_ms: timeoutMs, input_tokens_est: inputTokensEst,
        output_tokens_est: 0, max_output_tokens: 0, schema_degraded: false, truncated: false,
        remaining_budget_ms: remaining === null ? null : Math.round(remaining),
      });
      if (action.type !== 'retry_same') {
        if (action.type === 'stop') failure = action.reason;
        break;
      }
      retries++;
      await sleep(action.waitMs);
    } finally {
      if (raceTimer) clearTimeout(raceTimer);
    }
  }

  throw new GeminiProviderError('Không tạo được embedding từ Gemini.', {
    task: 'classification',
    attemptedModels: [model],
    lastKind: classifyGeminiError(lastError),
    lastStatus: extractStatus(lastError),
    cause: lastError,
    failure,
    elapsedMs: Date.now() - startedAt,
  });
}

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
// Chien luoc cho MOI request:
//
//   for model of [task model, AI_MODEL_PRIMARY, FALLBACK_1, FALLBACK_2]:
//       attempt = 0
//       repeat:
//           goi Gemini (Mode A: co responseSchema)
//           ├─ OK            -> parse JSON -> validate (Zod) -> TRA VE
//           ├─ transient     -> sleep(exponential backoff + jitter), attempt++
//           ├─ schema loi    -> Mode B: goi lai CUNG model, BO responseSchema
//           ├─ JSON/Zod hong -> retry cung model (lan sample sau co the dung)
//           ├─ model unavail -> sang model ke tiep
//           └─ auth          -> DUNG HAN (doi model cung vo ich, cung 1 API key)
//   het model -> nem GeminiProviderError (co userMessage an toan)
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import { extractJson } from './parse';
import {
  classifyGeminiError,
  describeErrorForLog,
  extractStatus,
  GeminiBadResponseError,
  GeminiProviderError,
  GeminiTimeoutError,
  GeminiTruncatedResponseError,
  isTimeoutError,
  type GeminiErrorKind,
} from './errors';
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
    generateContent(args: GeminiGenerateArgs): Promise<{ text?: string | undefined }>;
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
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new GeminiBadResponseError(`Gemini trả về phản hồi rỗng (model: ${model}).`);
    }

    // extractJson = Mode C: bo ```json fence, cat dung doan JSON, va va lai JSON
    // bi cat cut do cham tran maxOutputTokens truoc khi bo cuoc.
    return extractJson(text);
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
  timeoutMs?: number;
  maxRetriesPerModel?: number;
  /** Cho phep thu lai KHONG kem schema khi model tu choi schema. Mac dinh: true. */
  allowSchemaDegradation?: boolean;
  /**
   * Gioi han thinking cho model Gemini 3.x. Bo qua -> dung mac dinh cua model
   * (gemini-3.5-flash mac dinh 'medium', kha cham voi tac vu trich xuat co cau
   * truc). Model khong ho tro (vd 2.5) tu dong duoc bo qua; neu API van tu choi
   * thi engine thu lai CUNG model khong kem thinkingConfig.
   */
  thinkingLevel?: GeminiThinkingLevel;
  /**
   * Co thu lai tren CUNG model sau khi bi TIMEOUT hay khong. Mac dinh: true.
   * Dat false khi caller dang chay duoi ngan sach thoi gian chat: timeout o T
   * giay thu lai voi cung T gan nhu chac chan timeout lai, tuc la dot them T
   * giay de nhan cung ket qua thay vi sang ngay model ke tiep.
   */
  retryOnTimeout?: boolean;
  /**
   * Validate o MUC UNG DUNG. BAT BUOC o moi call path nghiep vu: HTTP 200
   * KHONG co nghia la du lieu dung. Nem loi (bat ky loai nao) neu khong hop le
   * — engine se coi do la `bad_response` va retry.
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
};

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

/**
 * Thuc thi 1 request Gemini co kha nang tu phuc hoi. Xem so do dau file.
 *
 * KHONG bao gio "ha cap" prompt khi doi model: model B nhan CHINH XAC prompt ma
 * model A nhan (cung requirement, cung tai lieu, cung categories, cung rang buoc
 * traceability). Fallback = CUNG YEU CAU NGHIEP VU, KHAC MODEL GEMINI.
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
  const maxRetries = options.maxRetriesPerModel ?? config.maxRetriesPerModel;
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
  const allowDegradation = options.allowSchemaDegradation !== false;
  const scope = options.label ? `${options.task} (${options.label})` : options.task;

  const modelsAttempted: string[] = [];
  let totalAttempts = 0;
  let lastError: unknown;
  let lastKind: GeminiErrorKind = 'fatal';
  // Phan hoi bi cat cut nhung VAN va lai duoc + qua validate. Giu lai lam phao
  // cuu sinh: neu moi luot deu that bai, tra ve no con hon tra ve rong — nhung
  // luon kem co `truncated: true` de khong ai nham la ket qua day du.
  let salvaged: { data: T; model: string; schemaDegraded: boolean } | null = null;

  for (let modelIndex = 0; modelIndex < chain.length; modelIndex++) {
    const model = chain[modelIndex];
    modelsAttempted.push(model);
    console.info(`[Gemini] ${scope} using ${model}`);

    let useSchema = Boolean(options.responseSchema);
    let useThinking = Boolean(options.thinkingLevel) && supportsThinkingLevel(model);
    let degradedForThisModel = false;
    let attempt = 0;
    let moveToNextModel = false;

    while (!moveToNextModel) {
      totalAttempts++;
      try {
        const raw = await callGeminiOnce(client, model, {
          systemPrompt: options.systemPrompt,
          userPrompt: options.userPrompt,
          images: options.images,
          responseSchema: useSchema ? options.responseSchema : undefined,
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          timeoutMs,
          thinkingLevel: useThinking ? options.thinkingLevel : undefined,
        });

        // NEVER TRUST AI OUTPUT: HTTP 200 chi moi la dieu kien can.
        const data = options.validate ? options.validate(raw) : (raw as T);

        if (attempt > 0) console.info(`[Gemini] ${scope} retry succeeded on ${model}`);
        return {
          data,
          truncated: false,
          model,
          attempts: totalAttempts,
          schema_degraded: degradedForThisModel,
          models_attempted: [...modelsAttempted],
        };
      } catch (error) {
        lastError = error;
        lastKind = classifyGeminiError(error);
        const status = extractStatus(error);

        // Phan hoi cat cut: thu cuu phan da va duoc (neu no qua duoc validate)
        // truoc khi retry. Retry van chay binh thuong — ban cat cut chi la phao.
        if (error instanceof GeminiTruncatedResponseError && !salvaged) {
          try {
            const partial = options.validate
              ? options.validate(error.salvaged)
              : (error.salvaged as T);
            salvaged = { data: partial, model, schemaDegraded: degradedForThisModel };
            console.warn(`[Gemini] ${scope} response truncated on ${model} — salvaged partial result as fallback`);
          } catch {
            // Phan va duoc cung khong hop le -> khong co gi de cuu.
          }
        }

        // (1) Auth/permission: doi model khong cuu duoc gi (cung 1 API key).
        if (lastKind === 'auth') {
          console.error(`[Gemini] ${scope} authentication/permission error — dừng toàn bộ model chain`);
          throw new GeminiProviderError('Gemini authentication/permission error.', {
            task: options.task,
            attemptedModels: modelsAttempted,
            lastKind,
            lastStatus: status,
            cause: error,
          });
        }

        // (2) Model tu choi responseSchema -> thu lai CUNG model o Mode B.
        //     KHONG tinh vao quota retry: day la doi CHE DO, khong phai retry loi.
        if (lastKind === 'schema_incompatible' && useSchema && allowDegradation) {
          console.warn(
            `[Gemini] ${scope} model ${model} rejected responseSchema (${describeErrorForLog(error)}) — retrying without schema`,
          );
          useSchema = false;
          degradedForThisModel = true;
          continue;
        }

        // (2b) Model tu choi thinkingConfig (400 nhac toi "thinking") -> thu lai
        //      CUNG model, bo thinkingConfig. Khong tinh vao quota retry. Day la
        //      lop bao ve de mot model moi/la khong lam hong ca chain chi vi ta
        //      gui mot tham so toi uu toc do.
        if (useThinking && status === 400 && /thinking/i.test(error instanceof Error ? error.message : '')) {
          console.warn(
            `[Gemini] ${scope} model ${model} rejected thinkingConfig (${describeErrorForLog(error)}) — retrying without it`,
          );
          useThinking = false;
          continue;
        }

        // (3) Model khong ton tai / khong kha dung -> sang model ke tiep ngay.
        if (lastKind === 'model_unavailable') {
          console.warn(`[Gemini] ${scope} model ${model} unavailable (${describeErrorForLog(error)})`);
          moveToNextModel = true;
          break;
        }

        // (4) Loi tam thoi HOAC phan hoi hong -> retry cung model neu con quota.
        const retryable = lastKind === 'transient' || lastKind === 'bad_response';
        const skipRetryForTimeout = options.retryOnTimeout === false && isTimeoutError(error);
        if (retryable && !skipRetryForTimeout && attempt < maxRetries) {
          attempt++;
          const waitMs = computeBackoffMs(attempt - 1, config.backoffBaseMs, config.backoffMaxMs);
          console.warn(
            `[Gemini] ${scope} ${lastKind} failure ${status ?? ''}`.trimEnd() +
              `, retry ${attempt}/${maxRetries} on ${model} in ${waitMs}ms`,
          );
          await sleep(waitMs);
          continue;
        }

        // (5) Het quota retry hoac loi khong retry duoc -> model ke tiep.
        console.warn(
          `[Gemini] ${scope} ${model} failed with ${describeErrorForLog(error)}${retryable && attempt > 0 ? ' after retries' : ''}`,
        );
        moveToNextModel = true;
      }
    }

    if (modelIndex < chain.length - 1) {
      console.warn(`[Gemini] ${scope} switching to ${chain[modelIndex + 1]}`);
    }
  }

  if (salvaged) {
    console.error(
      `[Gemini] ${scope} exhausted all models; returning TRUNCATED partial result from ${salvaged.model} — caller must surface this as incomplete`,
    );
    return {
      data: salvaged.data,
      truncated: true,
      model: salvaged.model,
      attempts: totalAttempts,
      schema_degraded: salvaged.schemaDegraded,
      models_attempted: [...modelsAttempted],
    };
  }

  console.error(`[Gemini] ${scope} exhausted all ${chain.length} configured model(s)`);
  throw new GeminiProviderError(
    `Gemini thất bại trên toàn bộ ${chain.length} model đã cấu hình cho tác vụ "${options.task}".`,
    {
      task: options.task,
      attemptedModels: modelsAttempted,
      lastKind,
      lastStatus: extractStatus(lastError),
      cause: lastError,
    },
  );
}

/**
 * Embedding (RAG) — cung di qua co che retry/timeout, nhung model chain CHI gom
 * AI_MODEL_EMBEDDING: khong the fallback sang model Flash vi so chieu vector
 * khac nhau se lam hong index vector da luu trong Supabase.
 */
export async function createGeminiEmbedding(content: string): Promise<number[]> {
  const trimmed = content?.trim();
  if (!trimmed) throw new Error('Nội dung cần embedding không được rỗng.');

  const config = getResilienceConfig();
  const client = resolveClient();
  const model = getEmbeddingModel();

  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetriesPerModel; attempt++) {
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        client.models.embedContent({ model, contents: trimmed }),
        new Promise<never>((_, reject) => {
          raceTimer = setTimeout(
            () => reject(new GeminiTimeoutError(config.requestTimeoutMs, model)),
            config.requestTimeoutMs,
          );
        }),
      ]);

      const values = response?.embeddings?.[0]?.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw new GeminiBadResponseError('Gemini không trả về dữ liệu embedding.');
      }
      return values;
    } catch (error) {
      lastError = error;
      const kind = classifyGeminiError(error);
      if (kind === 'auth' || attempt >= config.maxRetriesPerModel) break;
      if (kind !== 'transient' && kind !== 'bad_response') break;
      const waitMs = computeBackoffMs(attempt, config.backoffBaseMs, config.backoffMaxMs);
      console.warn(
        `[Gemini] embedding ${kind} failure, retry ${attempt + 1}/${config.maxRetriesPerModel} in ${waitMs}ms`,
      );
      await sleep(waitMs);
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
  });
}

# Fix: `413 FUNCTION_PAYLOAD_TOO_LARGE` on AI Document Reader (.docx upload)

## The bug

Uploading `R3C.docx` (25.6 MB) to the AI Document Reader failed with:

```
POST /api/ai/documents/parse → 413 Content Too Large
FUNCTION_PAYLOAD_TOO_LARGE
```

...followed by a second, more confusing error in the UI:

```
Unexpected token 'R', "Request En"... is not valid JSON
```

## Root cause

`handleDocumentFile` (`src/hooks/test-case/use-generate-workspace.ts`) read the
entire `.docx` file, base64-encoded it, and inlined it as `data_base64` in a
single JSON `POST` body sent straight to `/api/ai/documents/parse`.

- 25.6 MB raw → **~34 MB** once base64-encoded.
- Vercel's Node.js Serverless Functions enforce a **hard ~4.5 MB limit on the
  total request body**. This is a platform-level constraint applied at the
  edge *before* the request ever reaches our route handler — no
  `next.config.ts` setting, no in-app body-parser config, and no server-side
  code change can raise it.
- So the request was rejected outright with `FUNCTION_PAYLOAD_TOO_LARGE`,
  returning a **plaintext** body ("Request Entity Too Large").

That plaintext body is what caused the *second* bug: `postJson()`
(`src/lib/api/client.ts`) unconditionally called `response.json()` on every
response. Parsing a plaintext body as JSON throws a raw `SyntaxError`, which
is the `Unexpected token 'R', "Request En"...` the user saw — a confusing
symptom of the real (413) problem, not a separate one.

## The fix

### 1. Real fix — extract `.docx` text in the browser (`docx-client-extract.ts`, new)

The server only ever needed the **plain text** inside the `.docx` (it's fed to
an AI prompt, capped at 24,000 chars) — never the raw binary, and never the
embedded images that make Word files this large in the first place.

`mammoth` (already a dependency, used server-side in
`services/documents/text-extractors.ts`) ships a **browser build** that reads
from an `ArrayBuffer` instead of a Node `Buffer`/`fs` path. Next.js's bundler
picks this up automatically via mammoth's `package.json` `"browser"` field.

`handleDocumentFile` now extracts the `.docx` text fully client-side and sends
it through the existing `file_format: 'text'` / `content` path (the same one
already used for `.md`/`.txt`) — the raw file bytes never leave the browser,
so file size is no longer relevant to this 413 at all.

### 2. Defense-in-depth — size guard for PDF/image uploads (`upload-limits.ts`, new)

PDFs and diagram images still have to be sent as `data_base64` (they need
server-side text extraction / Vision respectively), so they're still subject
to the same platform limit. Added:

- **Client-side** pre-flight check (`assertInlineUploadSize`, in
  `use-generate-workspace.ts`) — rejects with a clear, translated error
  *before* wasting time reading/encoding an oversized file.
- **Server-side** Zod `max()` on `data_base64` (`models/validators/document.ts`)
  as a backstop for any caller that bypasses the UI.
- Both share one constant, `MAX_INLINE_BASE64_UPLOAD_BYTES` (3 MiB raw), so
  the two limits can't drift apart.

### 3. Defense-in-depth — `postJson` no longer crashes on non-JSON responses (`client.ts`)

`postJson()` now falls back to the caller's generic error message when
`response.json()` throws, instead of letting the raw `SyntaxError` surface.
This fixes the *reported* garbled error and also protects against any other
platform-level failure (502/504 gateway errors, etc.) that returns a
non-JSON body.

### 4. Type shim update (`vendor-shims.d.ts`)

The project's hand-rolled ambient types for `mammoth` (`declare module
'mammoth'`) only declared the `{ buffer }` / `{ path }` (Node.js) input
shapes. Added the `{ arrayBuffer }` (browser) shape mammoth's own types
already support, so the new client-side call type-checks.

## Files changed

- **New** `src/lib/utils/docx-client-extract.ts` — browser-side `.docx` text extraction.
- **New** `src/lib/utils/upload-limits.ts` — shared size-limit constant + formatter, used client- and server-side.
- `src/hooks/test-case/use-generate-workspace.ts` — `.docx` now extracted client-side; PDF/image uploads pre-checked for size.
- `src/lib/api/client.ts` — `postJson` tolerates non-JSON error responses.
- `src/models/validators/document.ts` — `data_base64` now bounded by the shared limit (Zod).
- `src/services/documents/vendor-shims.d.ts` — added the browser `{ arrayBuffer }` input shape to the `mammoth` shim.
- `src/lib/i18n/dictionaries/vi.ts` / `en.ts` — new `fileTooLarge` / `docxExtractFailed` error strings (kept in sync, both dictionaries satisfy the shared `Dictionary` type).

## What did NOT change

- `app/api/ai/documents/parse/route.ts` — untouched. It still accepts
  `file_format: 'docx'` + `data_base64` for backward compatibility (e.g. any
  other caller hitting the API directly with a small `.docx`); it's just no
  longer the path the UI uses for `.docx`.
- `services/documents/text-extractors.ts` (`extractDocxText`, server-side,
  Node/Buffer) — untouched; still used for that legacy `docx` branch and by
  nothing else in this fix.

## Verification performed

- `npm install --ignore-scripts` + `npx tsc --noEmit` → **0 errors** (full
  project, not a subset).
- `npx vitest run` → **42/42 existing tests pass**, nothing regressed.
- Manually confirmed `R3C.docx` (25.6 MB) is far above the previous
  ~3.3 MB effective ceiling (4.5 MB ÷ 1.33 base64 overhead), i.e. it would
  have failed under the old code regardless of any other tweak — this
  wasn't a marginal/off-by-one limit, the file was ~7–10x over.
- `eslint` could not be run — the checked-out `eslint-config-next` install in
  this zip errors on its own (`ERR_PACKAGE_PATH_NOT_EXPORTED` on
  `eslint-config-next/core-web-vitals.js`) independent of any change here;
  pre-existing environment issue, not introduced by this fix.

## To verify on your end

1. `npm install && npm run typecheck` (per usual).
2. Upload `R3C.docx` again via AI Document Reader — it should now succeed
   without going near the server's size limit at all.
3. Try a PDF/image well over ~3 MB — you should get a clear inline error
   *before* the request is even sent, instead of a 413 mid-flight.

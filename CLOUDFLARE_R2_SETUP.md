# Cloudflare R2 Setup Guide

This guide walks you through connecting QA-AI-Tool to **Cloudflare R2** for storing automation screenshots and Playwright scripts.

R2 is S3-compatible, offers a generous free tier (10 GB/month), and has zero egress fees — ideal for storing test screenshots.

---

## 1. Prerequisites

- A Cloudflare account (free tier works)
- Node.js ≥ 18 (already required by this project)

---

## 2. Create an R2 Bucket

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. In the left sidebar → **R2 Object Storage** → **Overview**
3. Click **Create bucket**
4. Name it e.g. `qa-automation-assets`  
5. Choose your preferred region (or leave it as automatic)
6. Click **Create bucket**

### Optional: Enable Public Access

If you want screenshots accessible via a public URL (no signed-URL expiry issues):

1. Open your bucket → **Settings** tab → **Public access**
2. Enable **Allow Access** and note the `r2.dev` domain shown (e.g. `pub-abc123.r2.dev`)
3. Or, connect a custom domain via **Custom domain** → **Connect domain**

Set this domain as `R2_PUBLIC_URL` in your env vars (see below).

---

## 3. Create API Credentials

1. In the Cloudflare Dashboard → **R2 Object Storage** → **Overview**
2. Click **Manage R2 API tokens** (top-right)
3. Click **Create API token**
4. Give it a name, e.g. `qa-tool-automation`
5. Set **Permissions** → **Object Read & Write**
6. Set **Specify bucket(s)** → select your bucket
7. Click **Create API token**
8. **Copy the values shown:**
   - **Access Key ID** → save this
   - **Secret Access Key** → save this (**shown once only!**)

Also copy your **Account ID** from the right sidebar of the Cloudflare Dashboard main page.

---

## 4. Configure Environment Variables

Add the following to your `.env.local` file (never commit this file):

```env
# ── Cloudflare R2 ────────────────────────────────────────────────────────────
# Your Cloudflare account ID (found on the dashboard right sidebar)
R2_ACCOUNT_ID=your_account_id_here

# API credentials from step 3
R2_ACCESS_KEY_ID=your_r2_access_key_id_here
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key_here

# Bucket name (must match what you created in step 2)
R2_BUCKET_NAME=qa-automation-assets

# Optional: Public domain for the bucket (if you enabled public access in step 2)
# Without this, signed URLs with 7-day expiry are used instead
# R2_PUBLIC_URL=https://pub-abc123.r2.dev
```

For **Vercel deployment**, add these in:
**Vercel Dashboard** → your project → **Settings** → **Environment Variables**

---

## 5. Install the AWS SDK

R2 uses the S3-compatible API. Install the required packages:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

These are already listed in `package.json` if you pulled the latest version of this repo.

---

## 6. How It Works in Code

The storage logic is in `lib/automation/r2-storage.ts` and `lib/automation/screenshot-storage.ts`.

### Upload a screenshot to R2

```typescript
import { uploadScreenshotToR2 } from '@/lib/automation/r2-storage';

const result = await uploadScreenshotToR2(testCaseId, runId, screenshotBuffer);
if (result) {
  console.log('Uploaded to:', result.url); // signed URL or public URL
  console.log('Key:', result.key);          // screenshots/<testCaseId>/<runId>.png
}
```

### Upload a script file to R2

```typescript
import { uploadScriptToR2 } from '@/lib/automation/r2-storage';

const result = await uploadScriptToR2(testCaseId, scriptId, playwrightCode);
if (result) {
  console.log('Script URL:', result.url);
}
```

### Generate a fresh signed URL (if original expired)

```typescript
import { getR2SignedUrl } from '@/lib/automation/r2-storage';

const freshUrl = await getR2SignedUrl('screenshots/tc-abc/run-123.png');
// Returns null if R2 is not configured
```

### Storage Strategy (automatic fallback)

`lib/automation/screenshot-storage.ts` uses this priority:

```
R2 configured?  ─── Yes ──► Upload to R2 → return R2 URL
                         (if R2 upload fails, fall through)
                └── No  ──► Upload to Supabase Storage → return signed URL
```

So R2 is **opt-in**: if you don't set the env vars, the existing Supabase Storage path continues to work unchanged.

---

## 7. Storage Key Conventions

| Content | R2 Key |
|---------|--------|
| Screenshots | `screenshots/<test_case_id>/<run_id>.png` |
| Playwright scripts | `scripts/<test_case_id>/<script_id>.ts` |

---

## 8. Verify It's Working

After setting up env vars and deploying:

1. Open a test case → **Automation** tab
2. Configure environment → Click **Inspect**
3. Click **Generate & Run**
4. After the run completes, the screenshot URL should point to your R2 bucket:
   - With `R2_PUBLIC_URL`: `https://pub-abc123.r2.dev/screenshots/...`
   - Without: a signed URL containing `r2.cloudflarestorage.com`

Check your R2 bucket in the Cloudflare Dashboard to confirm the files appear.

---

## 9. CORS (if fetching screenshots from a browser)

If you access screenshots directly from the browser (not via a proxy), configure CORS on your bucket:

1. Cloudflare Dashboard → R2 → your bucket → **Settings** → **CORS policy**
2. Add:

```json
[
  {
    "AllowedOrigins": ["https://your-vercel-app.vercel.app"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## 10. Cost Estimate

R2 free tier includes:
- **10 GB** storage/month  
- **1 million** Class A operations (PUT, POST) / month
- **10 million** Class B operations (GET) / month
- **Zero egress fees** (compared to S3 which charges per-GB)

For a small/medium QA team with ~1000 runs/month averaging 200KB screenshots each: **~200MB/month** — well within the free tier.

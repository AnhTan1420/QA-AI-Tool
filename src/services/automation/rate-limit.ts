/**
 * Minimal in-memory rate limiter for the automation run endpoint (AUDIT_REPORT.md
 * item H). Each browser run launches a real headless Chromium instance and holds
 * it for up to 45s - without any throttling, a single user could fire many
 * concurrent requests and exhaust server resources / hit hosting concurrency caps.
 *
 * DELIBERATE SCOPE: in-memory only, per-serverless-instance. On Vercel this means
 * the limit is "per warm function instance", not a hard global guarantee across
 * every concurrent invocation - a determined user could still get some degree of
 * parallelism across cold starts. This is an intentional, low-cost first line of
 * defense (matches the project's existing "no server-side worker" constraint
 * documented in schema.sql's Batch Automation section) rather than a claim of
 * perfect enforcement; a durable global limiter would need Redis/Upstash, which
 * is out of scope for this pass. Documented here so a future contributor
 * upgrading this doesn't assume it's already bulletproof.
 */

const COOLDOWN_MS = 15_000; // 15s between runs per user
const lastRunAt = new Map<string, number>();

// Bound the map size so long-running instances don't leak memory indefinitely.
const MAX_TRACKED_USERS = 500;

export function checkRunRateLimit(userId: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const last = lastRunAt.get(userId);

  if (last !== undefined) {
    const elapsed = now - last;
    if (elapsed < COOLDOWN_MS) {
      return { allowed: false, retryAfterMs: COOLDOWN_MS - elapsed };
    }
  }

  if (lastRunAt.size >= MAX_TRACKED_USERS && !lastRunAt.has(userId)) {
    // Evict the oldest entry to bound memory - crude but sufficient for a
    // best-effort in-memory limiter.
    const oldestKey = lastRunAt.keys().next().value;
    if (oldestKey) lastRunAt.delete(oldestKey);
  }

  lastRunAt.set(userId, now);
  return { allowed: true, retryAfterMs: 0 };
}

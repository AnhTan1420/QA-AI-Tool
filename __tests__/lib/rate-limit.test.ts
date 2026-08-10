/**
 * Unit tests for lib/automation/rate-limit.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRunRateLimit } from '@/lib/automation/rate-limit';

describe('checkRunRateLimit', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('allows the first run for a new user', () => {
    const userId = `user-${Math.random()}`;
    const result = checkRunRateLimit(userId);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('blocks a second immediate run from the same user', () => {
    const userId = `user-${Math.random()}`;
    checkRunRateLimit(userId); // first run - consumes the slot
    const second = checkRunRateLimit(userId);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(second.retryAfterMs).toBeLessThanOrEqual(15_000);
  });

  it('allows a different user to run independently of another user being rate-limited', () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;
    checkRunRateLimit(userA);
    const resultB = checkRunRateLimit(userB);
    expect(resultB.allowed).toBe(true);
  });

  it('allows a run again after the cooldown window has passed', () => {
    vi.useFakeTimers();
    const userId = `user-${Math.random()}`;
    checkRunRateLimit(userId);
    vi.advanceTimersByTime(15_001);
    const afterCooldown = checkRunRateLimit(userId);
    expect(afterCooldown.allowed).toBe(true);
    vi.useRealTimers();
  });
});

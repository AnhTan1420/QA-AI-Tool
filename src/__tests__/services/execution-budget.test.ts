import { describe, it, expect, afterEach } from 'vitest';
import { ExecutionBudget, createRouteBudget, getBudgetReserveMs } from '@/services/ai/execution-budget';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('ExecutionBudget', () => {
  it('tracks elapsed/remaining and subtracts the reserve from usable time', () => {
    const c = clock();
    const b = new ExecutionBudget(100_000, { now: c.now, reserveMs: 15_000 });
    expect(b.remainingMs()).toBe(100_000);
    expect(b.usableMs()).toBe(85_000);
    c.advance(60_000);
    expect(b.remainingMs()).toBe(40_000);
    expect(b.usableMs()).toBe(25_000);
    expect(b.canAfford(25_000)).toBe(true);
    expect(b.canAfford(25_001)).toBe(false);
  });

  it('never goes negative and reports exhaustion once only the reserve is left', () => {
    const c = clock();
    const b = new ExecutionBudget(10_000, { now: c.now, reserveMs: 4_000 });
    c.advance(6_000);
    expect(b.isExhausted()).toBe(true);
    c.advance(60_000);
    expect(b.remainingMs()).toBe(0);
    expect(b.usableMs()).toBe(0);
  });

  it('a child budget can never outlive its parent', () => {
    const c = clock();
    const parent = new ExecutionBudget(50_000, { now: c.now, reserveMs: 5_000 });
    const child = parent.child(200_000, 'stage');
    expect(child.remainingMs()).toBe(50_000);
    expect(child.usableMs()).toBe(45_000);
    c.advance(48_000);
    expect(child.remainingMs()).toBe(2_000);
    expect(child.isExhausted()).toBe(true);
  });

  it('a short child limits itself even when the parent has plenty left', () => {
    const c = clock();
    const parent = new ExecutionBudget(300_000, { now: c.now });
    const child = parent.child(20_000);
    c.advance(21_000);
    expect(child.remainingMs()).toBe(0);
    expect(parent.remainingMs()).toBe(279_000);
  });
});

describe('createRouteBudget', () => {
  afterEach(() => {
    delete process.env.AI_BUDGET_RESERVE_MS;
  });

  it('derives the budget from maxDuration and holds back a reserve for persistence/response', () => {
    const c = clock();
    const b = createRouteBudget(300, 'generate', c.now);
    expect(b.totalMs).toBe(300_000);
    expect(b.usableMs()).toBe(300_000 - getBudgetReserveMs());
  });

  it('scales the reserve down for short routes so they are not left with no working time', () => {
    const c = clock();
    const b = createRouteBudget(20, 'short', c.now); // 15s default reserve would leave 5s
    expect(b.usableMs()).toBeGreaterThanOrEqual(17_000);
  });

  it('AI_BUDGET_RESERVE_MS is clamped to a sane range', () => {
    process.env.AI_BUDGET_RESERVE_MS = '1';
    expect(getBudgetReserveMs()).toBe(1_000);
    process.env.AI_BUDGET_RESERVE_MS = '9999999';
    expect(getBudgetReserveMs()).toBe(60_000);
    process.env.AI_BUDGET_RESERVE_MS = 'abc';
    expect(getBudgetReserveMs()).toBe(15_000);
  });
});

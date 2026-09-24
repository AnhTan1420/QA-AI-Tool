/**
 * Unit tests cho services/ai/resumable-job.ts — loi dieu phoi Agent Fallback &
 * Job Resumption. Khong co Gemini o day: agent la chuoi ten, `execute` la ham
 * gia lap, nen moi kich ban (primary sap, force-stop, resume...) tat dinh.
 */
import { describe, it, expect } from 'vitest';
import {
  runResumableJob,
  StepInterruptedError,
  type JobCheckpoint,
  type JobEvent,
  type JobStep,
  type StepContext,
} from '@/services/ai/resumable-job';
import { GeminiProviderError } from '@/services/ai/errors';

const PRIMARY = 'gemini-3.5-flash';
const SECONDARY = 'gemini-3.5-flash-lite';

type S = { value: string; phase?: number };

const steps = (n: number): JobStep[] => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, hash: `h${i + 1}`.padEnd(16, '0') }));

function providerError(lastKind: 'transient' | 'auth' | 'model_unavailable' = 'transient', lastStatus = 503) {
  return new GeminiProviderError('boom', { task: 'document_extraction', attemptedModels: ['x'], lastKind, lastStatus });
}

/** Ghi lai (step, agent) cua moi lan execute + cho phep kich ban theo (step, agent). */
function harness(script: (ctx: StepContext<S>) => Promise<{ state: S; complete: boolean }> | { state: S; complete: boolean }) {
  const calls: { step: string; agent: string; previous?: S }[] = [];
  const execute = async (ctx: StepContext<S>) => {
    calls.push({ step: ctx.stepId, agent: ctx.agent, previous: ctx.previous });
    return script(ctx);
  };
  return { calls, execute };
}

const ok = (agent: string, stepId: string) => ({ state: { value: `${stepId}@${agent}` }, complete: true });

describe('runResumableJob — đường thành công', () => {
  it('chạy mọi bước bằng agent chính, không có handoff', async () => {
    const { calls, execute } = harness((ctx) => ok(ctx.agent, ctx.stepId));
    const result = await runResumableJob<S>({ steps: steps(3), agents: [PRIMARY, SECONDARY], execute });

    expect(result.status).toBe('completed');
    expect(result.stopReason).toBe('complete');
    expect(calls.map((c) => c.agent)).toEqual([PRIMARY, PRIMARY, PRIMARY]);
    expect(result.handoffs).toEqual([]);
    expect(Object.values(result.stepStatus)).toEqual(['done', 'done', 'done']);
  });

  it('chạy song song tối đa `concurrency` bước', async () => {
    let inFlight = 0;
    let max = 0;
    const { execute } = harness(async (ctx) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return ok(ctx.agent, ctx.stepId);
    });
    await runResumableJob<S>({ steps: steps(6), agents: [PRIMARY], execute, concurrency: 3 });
    expect(max).toBe(3);
  });
});

describe('runResumableJob — failover sang agent phụ', () => {
  it('agent chính lỗi -> agent phụ hoàn thành CHÍNH bước đó; ghi lại handoff kèm lý do', async () => {
    const { calls, execute } = harness((ctx) => {
      if (ctx.agent === PRIMARY) throw providerError('transient', 503);
      return ok(ctx.agent, ctx.stepId);
    });
    const result = await runResumableJob<S>({ steps: steps(1), agents: [PRIMARY, SECONDARY], execute });

    expect(result.status).toBe('completed');
    expect(calls.map((c) => c.agent)).toEqual([PRIMARY, SECONDARY]);
    expect(result.records.c1.agent).toBe(SECONDARY);
    expect(result.handoffs).toEqual([
      { step_id: 'c1', from: PRIMARY, to: SECONDARY, reason: 'transient/503', carried_state: false },
    ]);
  });

  it('lỗi timeout được ghi nhận là "timeout" trong handoff', async () => {
    const { execute } = harness((ctx) => {
      if (ctx.agent === PRIMARY) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return ok(ctx.agent, ctx.stepId);
    });
    const result = await runResumableJob<S>({ steps: steps(1), agents: [PRIMARY, SECONDARY], execute });
    expect(result.handoffs[0].reason).toBe('timeout');
  });

  it('lỗi bất ngờ (crash, không phải lỗi Gemini) cũng kích hoạt failover thay vì làm hỏng job', async () => {
    const { execute } = harness((ctx) => {
      if (ctx.agent === PRIMARY) throw new TypeError('Cannot read properties of undefined');
      return ok(ctx.agent, ctx.stepId);
    });
    const result = await runResumableJob<S>({ steps: steps(1), agents: [PRIMARY, SECONDARY], execute });
    expect(result.status).toBe('completed');
    expect(result.handoffs[0].reason).toBe('crash');
  });

  it('đủ 3 agent: đi lần lượt primary -> secondary -> tertiary', async () => {
    const { calls, execute } = harness((ctx) => {
      if (ctx.agent !== 'tertiary') throw providerError();
      return ok(ctx.agent, ctx.stepId);
    });
    const result = await runResumableJob<S>({ steps: steps(1), agents: [PRIMARY, SECONDARY, 'tertiary'], execute });
    expect(calls.map((c) => c.agent)).toEqual([PRIMARY, SECONDARY, 'tertiary']);
    expect(result.handoffs.map((h) => `${h.from}>${h.to}`)).toEqual([`${PRIMARY}>${SECONDARY}`, `${SECONDARY}>tertiary`]);
  });
});

describe('runResumableJob — theo dõi sức khỏe agent (không trả lại chi phí thất bại cho mọi bước)', () => {
  it('agent chính lỗi 2 bước liên tiếp bị hạ cấp: các bước SAU đi thẳng agent phụ', async () => {
    const { calls, execute } = harness((ctx) => {
      if (ctx.agent === PRIMARY) throw providerError();
      return ok(ctx.agent, ctx.stepId);
    });
    const result = await runResumableJob<S>({ steps: steps(5), agents: [PRIMARY, SECONDARY], execute });

    expect(result.status).toBe('completed');
    // c1, c2: primary thử rồi hỏng (2 lần); từ c3 primary bị bỏ qua.
    expect(calls.filter((c) => c.agent === PRIMARY).map((c) => c.step)).toEqual(['c1', 'c2']);
    expect(calls.filter((c) => c.agent === SECONDARY).map((c) => c.step)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('failback: hết cooldown thì agent chính được thử lại, và phục hồi nếu đã khỏe', async () => {
    let clock = 0;
    let primaryHealthy = false;
    const { calls, execute } = harness((ctx) => {
      if (ctx.agent === PRIMARY && !primaryHealthy) throw providerError();
      // Mỗi bước "tốn" 40s thời gian ảo.
      clock += 40_000;
      if (ctx.stepId === 'c3') primaryHealthy = true;
      return ok(ctx.agent, ctx.stepId);
    });
    const events: JobEvent<S>['type'][] = [];
    await runResumableJob<S>({
      steps: steps(6),
      agents: [PRIMARY, SECONDARY],
      execute,
      now: () => clock,
      cooldownMs: 60_000,
      onEvent: (e) => events.push(e.type),
    });

    expect(events).toContain('agent_demoted');
    expect(events).toContain('agent_restored');
    // Cuối job primary đã được thử lại và hoàn thành được ít nhất 1 bước.
    const lastPrimaryOk = calls.filter((c) => c.agent === PRIMARY).at(-1)!;
    expect(lastPrimaryOk.step).not.toBe('c1');
  });

  it('mọi agent đều bị hạ cấp -> dừng bắt đầu bước mới, giữ các bước còn lại ở trạng thái pending', async () => {
    const { calls, execute } = harness(() => {
      throw providerError();
    });
    const result = await runResumableJob<S>({ steps: steps(6), agents: [PRIMARY, SECONDARY], execute });

    expect(result.status).toBe('partial');
    expect(result.stopReason).toBe('agents_unavailable');
    // 2 bước x 2 agent = 4 lần gọi; KHÔNG phải 6 bước x 2 agent.
    expect(calls).toHaveLength(4);
    expect(result.stepStatus).toMatchObject({ c1: 'failed', c2: 'failed', c3: 'pending', c6: 'pending' });
  });
});

describe('runResumableJob — bàn giao TRẠNG THÁI dở dang cho agent kế tiếp', () => {
  it('agent chính xong pha 1 rồi lỗi ở pha 2 -> agent phụ nhận previous và chỉ làm pha 2', async () => {
    const { calls, execute } = harness((ctx) => {
      if (ctx.agent === PRIMARY) throw new StepInterruptedError<S>({ value: 'phase1-by-primary', phase: 1 }, providerError());
      // Agent phụ: có previous -> chỉ hoàn thiện, không làm lại pha 1.
      expect(ctx.previous).toEqual({ value: 'phase1-by-primary', phase: 1 });
      return { state: { value: 'phase1-by-primary+phase2-by-secondary', phase: 2 }, complete: true };
    });
    const result = await runResumableJob<S>({ steps: steps(1), agents: [PRIMARY, SECONDARY], execute });

    expect(result.status).toBe('completed');
    expect(calls[1].previous).toEqual({ value: 'phase1-by-primary', phase: 1 });
    expect(result.handoffs[0]).toMatchObject({ from: PRIMARY, to: SECONDARY, carried_state: true, reason: 'transient/503' });
    expect(result.records.c1.state?.phase).toBe(2);
  });

  it('save() ghi checkpoint dở dang NGAY, trước khi bước xong (để không mất nếu bị giết giữa chừng)', async () => {
    const seen: string[] = [];
    const { execute } = harness((ctx) => {
      ctx.save({ value: 'half', phase: 1 });
      return { state: { value: 'full', phase: 2 }, complete: true };
    });
    await runResumableJob<S>({
      steps: steps(1),
      agents: [PRIMARY],
      execute,
      onEvent: (e) => {
        if (e.type === 'checkpoint') seen.push(`${e.record.state?.value}:${e.record.complete}`);
      },
    });
    expect(seen).toEqual(['half:false', 'full:true']);
  });

  it('complete:false (dừng có chủ đích, vd hết ngân sách) giữ state và KHÔNG failover', async () => {
    const { calls, execute } = harness(() => ({ state: { value: 'phase1', phase: 1 }, complete: false }));
    const result = await runResumableJob<S>({ steps: steps(1), agents: [PRIMARY, SECONDARY], execute });

    expect(calls).toHaveLength(1);
    expect(result.status).toBe('partial');
    expect(result.stepStatus.c1).toBe('partial');
    expect(result.records.c1).toMatchObject({ complete: false, state: { phase: 1 } });
    expect(result.handoffs).toEqual([]);
  });
});

describe('runResumableJob — RESUME từ checkpoint (kể cả sau khi tiến trình bị giết)', () => {
  const completeRecord = (id: string, hash: string): JobCheckpoint<S>[string] => ({ hash, complete: true, agent: PRIMARY, state: { value: `old-${id}` } });

  it('bước đã hoàn thành trong checkpoint KHÔNG bị chạy lại', async () => {
    const all = steps(4);
    const resume: JobCheckpoint<S> = { c1: completeRecord('c1', all[0].hash), c2: completeRecord('c2', all[1].hash) };
    const { calls, execute } = harness((ctx) => ok(ctx.agent, ctx.stepId));
    const result = await runResumableJob<S>({ steps: all, agents: [PRIMARY], execute, resume });

    expect(calls.map((c) => c.step)).toEqual(['c3', 'c4']);
    expect(result.resumedSteps).toEqual(['c1', 'c2']);
    expect(result.status).toBe('completed');
    expect(result.records.c1.state?.value).toBe('old-c1');
  });

  it('hash lệch (đầu vào đã đổi) -> checkpoint bị BỎ và bước chạy lại, không dùng nhầm kết quả cũ', async () => {
    const all = steps(2);
    const resume: JobCheckpoint<S> = { c1: completeRecord('c1', 'ffffffffffffffff') };
    const { calls, execute } = harness((ctx) => ok(ctx.agent, ctx.stepId));
    const result = await runResumableJob<S>({ steps: all, agents: [PRIMARY], execute, resume });

    expect(calls.map((c) => c.step)).toEqual(['c1', 'c2']);
    expect(result.resumedSteps).toEqual([]);
    expect(result.records.c1.state?.value).toBe(`c1@${PRIMARY}`);
  });

  it('bước dở dang trong checkpoint được trao cho agent làm tiếp (previous), không làm lại từ đầu', async () => {
    const all = steps(1);
    const resume: JobCheckpoint<S> = { c1: { hash: all[0].hash, complete: false, agent: PRIMARY, state: { value: 'phase1', phase: 1 } } };
    const { calls, execute } = harness((ctx) => ({ state: { value: `${ctx.previous?.value}+phase2`, phase: 2 }, complete: true }));
    const result = await runResumableJob<S>({ steps: all, agents: [SECONDARY], execute, resume });

    expect(calls[0].previous).toEqual({ value: 'phase1', phase: 1 });
    expect(result.records.c1.state?.value).toBe('phase1+phase2');
    expect(result.resumedSteps).toEqual([]); // chưa "xong" nên không tính là khôi phục nguyên vẹn
  });

  it('kịch bản force-stop: tiến trình bị giết giữa chừng, resume chỉ chạy các bước còn thiếu', async () => {
    const all = steps(5);
    const saved: JobCheckpoint<S> = {};
    // Lần 1: bước c3 "treo mãi" (mô phỏng function bị nền tảng giết) — ta bỏ rơi nó.
    const first = harness((ctx) => {
      if (ctx.stepId === 'c3') return new Promise<never>(() => {});
      return ok(ctx.agent, ctx.stepId);
    });
    void runResumableJob<S>({
      steps: all,
      agents: [PRIMARY],
      execute: first.execute,
      onEvent: (e) => {
        if (e.type === 'checkpoint') saved[e.stepId] = e.record;
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(Object.keys(saved)).toEqual(['c1', 'c2']); // chỉ những gì đã xong còn sống sót

    // Lần 2: tiến trình mới chỉ nhận checkpoint.
    const second = harness((ctx) => ok(ctx.agent, ctx.stepId));
    const result = await runResumableJob<S>({ steps: all, agents: [PRIMARY], execute: second.execute, resume: saved });

    expect(second.calls.map((c) => c.step)).toEqual(['c3', 'c4', 'c5']);
    expect(result.status).toBe('completed');
  });
});

describe('runResumableJob — ngân sách & lỗi không cứu được', () => {
  it('hết ngân sách giữa chừng -> dừng có kiểm soát, stopReason=budget, giữ kết quả đã có', async () => {
    // Đồng hồ ảo: mỗi bước tốn 40s, ngân sách 100s -> đủ cho 3 bước rồi phải dừng.
    let clock = 0;
    const { calls, execute } = harness((ctx) => {
      clock += 40_000;
      return ok(ctx.agent, ctx.stepId);
    });
    const result = await runResumableJob<S>({ steps: steps(5), agents: [PRIMARY], execute, hasTime: () => clock < 100_000 });

    expect(result.status).toBe('partial');
    expect(result.stopReason).toBe('budget');
    expect(calls).toHaveLength(3);
    expect(result.stepStatus.c3).toBe('done');
    expect(result.stepStatus.c4).toBe('pending');
    expect(result.stepStatus.c5).toBe('pending');
  });

  it('lỗi xác thực (API key) dừng cả job ngay, không thử hết chuỗi agent', async () => {
    const { calls, execute } = harness(() => {
      throw providerError('auth', 403);
    });
    const result = await runResumableJob<S>({ steps: steps(4), agents: [PRIMARY, SECONDARY], execute });

    expect(calls).toHaveLength(1);
    expect(result.fatalError).toBeInstanceOf(GeminiProviderError);
    expect(result.status).toBe('partial');
  });

  it('lỗi từ onEvent (vd stream đã đóng) không làm hỏng job', async () => {
    const { execute } = harness((ctx) => ok(ctx.agent, ctx.stepId));
    const result = await runResumableJob<S>({
      steps: steps(2),
      agents: [PRIMARY],
      execute,
      onEvent: () => {
        throw new Error('stream closed');
      },
    });
    expect(result.status).toBe('completed');
  });
});

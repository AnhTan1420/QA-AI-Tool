// ============================================================================
// File: src/lib/ai/generation-resume.ts
// Client-side CONTINUATION of a partial generation. Pure (no React, no fetch) so
// the one piece of logic that could loop unboundedly is unit-tested.
// ----------------------------------------------------------------------------
// Each HTTP request has a fixed server time budget. When a pass returns
// `progress.partial`, we send back what we have (existing cases + completed
// categories) and the next pass CONTINUES — it does not repeat the request, it
// sends new, smaller work. This is NOT a retry layer (see retry-policy.ts).
//
// Always terminates: at most `maxContinues` extra passes, AND it stops the
// moment a pass adds neither a category nor a case.
// ============================================================================

export type ResumeProgress<C extends string> = {
  partial: boolean;
  completed_categories: C[];
  remaining_categories: C[];
  needs_repair: boolean;
};

export type PassResult<T, C extends string> = {
  test_cases: T[];
  progress?: ResumeProgress<C>;
};

export type ResumeOutcome = 'complete' | 'no_progress' | 'max_passes';

export async function runGenerationPasses<T, C extends string, R extends PassResult<T, C>>(params: {
  maxContinues: number;
  runPass: (carry: { existing_test_cases: T[]; completed_categories: C[] }) => Promise<R>;
  /** Called after EVERY pass — so partial work is already surfaced if a later pass throws. */
  onPass: (result: R, pass: number) => void;
}): Promise<{ passes: number; last: R; outcome: ResumeOutcome }> {
  let existing: T[] = [];
  let completed: C[] = [];

  for (let pass = 1; ; pass++) {
    const result = await params.runPass({ existing_test_cases: existing, completed_categories: completed });
    params.onPass(result, pass);

    const progress = result.progress;
    if (!progress?.partial) return { passes: pass, last: result, outcome: 'complete' };

    const madeProgress =
      progress.completed_categories.length > completed.length || result.test_cases.length > existing.length;
    existing = result.test_cases;
    completed = progress.completed_categories;

    if (!madeProgress) return { passes: pass, last: result, outcome: 'no_progress' };
    if (pass > params.maxContinues) return { passes: pass, last: result, outcome: 'max_passes' };
  }
}

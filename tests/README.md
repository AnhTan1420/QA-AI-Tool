# tests/

Playwright `.spec.ts` files produced by the `qa-generator` agent
(`.claude/agents/qa-generator.md`) from a plan in `specs/`, run via the root
`playwright.config.ts`:

```
tests/<test-suite-kebab-case>/<number>-<kebab-case-test-name>.spec.ts
```

Optional shared setup: `tests/seed.spec.ts` (only used if it already exists —
see the generator's `<seed-file>` rules; it is never auto-created).

Run the suite:

```bash
npx playwright install   # first time only
npx playwright test
```

When tests fail, use the `qa-healer` agent (`.claude/agents/qa-healer.md`) to
diagnose and fix them rather than editing by hand. See `docs/e2e-agents.md`.

This folder is unrelated to `src/services/automation/` — see that note in
`docs/e2e-agents.md` if you're unsure which "Playwright" a file belongs to.

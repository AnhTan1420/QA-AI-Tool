# Agent-Driven E2E Testing

Three Claude Code subagents in `.claude/agents/` give this repo its own committed,
CI-able Playwright regression suite — separate from, and complementary to, the
in-app "Playwright Automation Agent" feature the product sells to its own users.

| Agent | File | Does | Reads | Writes |
|---|---|---|---|---|
| `qa-planner` | `.claude/agents/qa-planner.md` | Explores a running app with `playwright-cli` and writes a structured Markdown test plan | live app | `specs/<name>.md` |
| `qa-generator` | `.claude/agents/qa-generator.md` | Converts a plan's scenarios into self-contained `.spec.ts` files | `specs/*.md` | `tests/**/*.spec.ts` |
| `qa-healer` | `.claude/agents/qa-healer.md` | Runs the suite, diagnoses failures, fixes test code, iterates until green | `tests/**/*.spec.ts` | `tests/**/*.spec.ts` |

They're meant to be run in that order — **Plan → Generate → Heal** — though each can
also be invoked standalone (e.g. re-run `qa-healer` after an unrelated app change
breaks a selector).

## Quick start

```bash
npm run dev                 # app running at http://localhost:3000 (default baseURL)
npx playwright install      # once, downloads browser binaries

# In Claude Code:
# "Use qa-planner to explore the login flow at http://localhost:3000 and write a plan"
# "Use qa-generator to generate tests for specs/authentication-test-plan.md"
npx playwright test         # or: "Use qa-healer to fix any failing tests"
```

`playwright.config.ts` (repo root) drives all three: `testDir: 'tests'`,
`baseURL` from `PLAYWRIGHT_BASE_URL` (defaults to `http://localhost:3000`).

## Why two Playwright systems in one repo?

| | This E2E suite (`tests/`, `.claude/agents/`) | In-app Automation Agent (`src/services/automation/`, `playwright-agent.ts`) |
|---|---|---|
| **Tests** | This app's own UI/flows | Whatever a QAJD *end user* is testing — any target app |
| **Author** | A Claude Code subagent, run by a developer in this repo | An LLM prompt (`generation-agent.ts` → `playwright-agent.ts`), called at request/run time from the product's UI |
| **Output** | Real committed `.spec.ts` files under `tests/` | Code stored in the `automation_scripts` table, executed on demand; not committed to this repo |
| **Style** | Self-contained tests, no Page Object Model (see `qa-generator`'s Abstraction Policy) | Strict Page Object Model per page, enforced by the prompt's grounding rules |
| **Grounding** | Live DOM via `playwright-cli` snapshots during planning | A server-side `extractElementMap()` (`browser-runner.ts`) inspecting the *target* app at run time |
| **Run how** | `npx playwright test` (CI, local) | In-app "Run" button / batch queue (`batch-runner.ts`) |
| **Healing** | `qa-healer` subagent edits `.spec.ts` files directly, any number of iterations | "Heal & Retry" button → `/api/ai/playwright/heal`, one AI-patched version per click, still gated by script review |

Both independently already agree on locator priority — semantic role/label first, then
`data-testid`/`id`, then stable CSS, never `nth-child` or generated classes — so tests
written by either system look similar at the locator level even though one uses POM
and the other deliberately doesn't. If you're a subagent working in this repo: **don't
cross the streams** — `qa-generator`/`qa-healer` only ever touch `tests/`, never
`src/services/automation/` or `src/services/ai/prompts/playwright-agent.ts`.

## Conventions enforced

- **Tool policy**: each subagent's `tools:` frontmatter is restricted to
  `Bash, Read, Write, Edit, Glob, Grep` (no MCP browser tool) — the "don't use MCP
  browser tools, prefer Playwright CLI" instruction in each agent body is backed by an
  actual tool restriction, not just prose.
- **Scope**: `qa-planner` never runs tests; `qa-generator` never runs or debugs tests;
  `qa-healer` never explores new features or writes new scenarios. Each stays in its
  lane so a single invocation can't silently do another agent's job.
- **`playwright.config.ts` is protected**: none of the three subagents will edit it
  without asking first (relevant if a plan needs a new `testIdAttribute` or base URL).

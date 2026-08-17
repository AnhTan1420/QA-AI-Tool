# specs/

Markdown test plans produced by the `qa-planner` agent (`.claude/agents/qa-planner.md`)
live here, one file per explored feature/app area:

```
specs/<kebab-case-name>.md
```

These are inputs to the `qa-generator` agent, which turns a plan's scenarios into
Playwright spec files under `tests/`. See `docs/e2e-agents.md` for the full workflow.

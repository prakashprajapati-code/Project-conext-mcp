# ShopDot AI Agent

An MCP (Model Context Protocol) server plus a plan → context → execute → test
orchestrator for the **ShopDot backend** (Express + Sequelize + PostgreSQL).

It gives AI coding agents an accurate, queryable map of a large backend
(726 runtime files, 156 Sequelize models, 2,277 dependency edges) and a
reviewable workflow for turning a task into a plan, a set of edits, and a test
result.

## Architecture

```
config/project.json ──▶ DependencyTracer ──▶ tasks/shopdot-dependency-graph.json
                              │
                              ├─ static relative imports
                              ├─ dynamic dir loaders (models/index.js)
                              └─ app/ sweep + test index

graph ──▶ context-builder (rank) ──▶ planner ──▶ executor (worktree) ──▶ test runner
```

## MCP tools (read-only)

| Tool | Purpose |
|---|---|
| `get_project_architecture` | Stack + graph stats (`byType`, model coverage, generatedAt) |
| `get_task_context` | Ranked files + 1-hop dependencies for a task |
| `get_file` | Read one backend file (path-contained) |
| `search_files` | Content search (optional regex / `pathPrefix`) |
| `get_tests_for` | Related test files for a task |

## Commands

```bash
npm run mcp             # start the MCP server over stdio
npm run graph           # rebuild the dependency graph
npm run graph:check     # fail if the graph is stale (CI gate)
npm run graph:validate  # data-quality report (coverage / dangling / escaping)
npm test                # 28 unit tests
npm start               # quick project analysis (file scanner)
```

## Orchestrator

```bash
node src/orchestrator.js "Add pagination to brand products API"
```

Plan-only by default. To execute against an isolated worktree:

```bash
node src/orchestrator.js "Add pagination to brand products API" \
  --worktree /path/to/backend-worktree \
  --patch patch.json \
  --run-tests \
  --test-command "npm test -- --runInBand" \
  --max-retries 3
```

`patch.json`:

```json
{ "edits": [ { "path": "app/...", "content": "..." } ] }
```

Flow: **plan → approval → edits → approval → tests → retry (≤3) → pass/escalate**.
Artifacts are written to `tasks/plan.json` and `tasks/test-result.json`.

`--auto-approve` (`-y`) skips the human gates (use only in CI/dev).

## Data quality

`npm run graph:validate` enforces:

- runtime coverage ≥ 95% (currently 100%)
- model coverage ≥ 99% (currently 156/156)
- test index coverage ≥ 95% (currently 109/109)
- zero dangling edges
- zero edges escaping the project root

## Safety

- The backend is `readOnly: true`; the MCP tools never write to it.
- The executor only writes inside an explicit worktree and rejects path
  traversal.
- The orchestrator requires human approval before applying edits and before
  testing unless `--auto-approve` is set.

## Notes

- `search_files` exists because some task words (e.g. `pagination`) do not
  appear in file paths; use it to locate the implementation.
- Regenerate the graph after pulling backend changes, or let `graph:check`
  fail in CI.

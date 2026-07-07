# ADR 011: Future MCP Tool Contract

## Status

Accepted after MCP-lite. Update: a real MCP stdio transport has since shipped
as a thin proxy over the local bridge (`scripts/dioramai-mcp.ts` and the
`dioramai mcp` CLI subcommand). The shipped P0 surface is narrower than the
tool list sketched below — it deliberately excludes generic `apply_command` /
`apply_command_batch`; `packages/mcp/src/index.ts` and `docs/mcp-tools.md` are
canonical. The `@dioramai/agent-interface` runtime referenced below has been
removed (see `docs/ARCHITECTURE.md`).

## Context

MCP-lite proves the future agent workflow without implementing a local MCP
server. The future target architecture is:

```text
Cursor/Claude/Codex
  -> local Dioramai MCP server
  -> Dioramai agent runtime
  -> validated commands
  -> structured scene
  -> R3F export
```

The existing `@dioramai/agent-interface` runtime already supports validated scene
reads, command dry-run, command apply, scene load, action logging, and export.
MCP-lite adds a library facade with helpers named like future MCP tools. Real
MCP should become a thin transport over that runtime, not a second scene system.

## Decision

Future MCP will expose narrow, typed tools for common scene structuring,
semantics, behaviors, arrangement, loading, and export, plus generic
`apply_command` and `apply_command_batch` escape hatches for advanced command
payloads.

Every tool maps to `DioramaiSceneRuntime`, the MCP-lite facade, `CommandSchema`,
or an explicit command constructor. MCP tools must not connect directly to
Zustand, R3F objects, files, shells, or arbitrary JavaScript execution.

`docs/mcp-tools.md` is the canonical detailed tool contract. This ADR records
the architecture decision and gate for real transport work.

## Runtime Mapping

| Tool | Kind | Runtime or command mapping | Mutation |
| --- | --- | --- | --- |
| `get_scene` | read | `getScene()` | none |
| `get_semantic_groups` | read | MCP-lite facade over `getScene()` | none |
| `get_behaviors` | read | MCP-lite facade over `getScene()` | none |
| `get_selected_nodes` | read | `getSelection()` plus scene lookup when needed | none |
| `structure_scene` | command | `STRUCTURE_SCENE` | scene semantics |
| `set_node_semantics` | command | `SET_NODE_SEMANTICS` | node semantics |
| `create_semantic_group` | command | `CREATE_SEMANTIC_GROUP` | semantic groups |
| `assign_to_semantic_group` | command | `ASSIGN_TO_SEMANTIC_GROUP` | semantic groups and node semantics |
| `add_behavior` | command | `ADD_BEHAVIOR` | behaviors and refs |
| `remove_behavior` | command | `REMOVE_BEHAVIOR` | behaviors and refs |
| `make_interactive` | command | `MAKE_INTERACTIVE` | behaviors and refs |
| `arrange_nodes` | command | `ARRANGE_NODES` | local transforms |
| `apply_command` | command | generic `CommandSchema` -> `dryRunCommand()` / `applyCommand()` | command-defined |
| `apply_command_batch` | command | `CommandSchema.array()` -> `dryRunCommandBatch()` / `applyCommandBatch()` | command-defined |
| `load_scene` | session boundary | `LoadSceneInputSchema` -> `loadScene()` | replaces scene |
| `export_json` | read/export | `exportScene({ format: "json" })` | none |
| `export_r3f` | read/export | `exportScene({ format: "r3f" })` | none |

## Tool Contracts

### `get_scene`

- Read-only.
- Returns the validated canonical scene.
- Does not mutate scene, selection, action log, UI state, or viewport state.

### `get_semantic_groups`

- Read-only.
- Returns cloned `scene.semanticGroups ?? {}`.
- Does not mutate scene, selection, action log, UI state, or viewport state.

### `get_behaviors`

- Read-only.
- Returns cloned `scene.behaviors ?? {}`.
- Does not execute behavior metadata.
- Does not mutate scene, selection, action log, UI state, or viewport state.

### `get_selected_nodes`

- Read-only.
- Returns the current selection id and, when requested, selected node summaries.
- Does not mutate scene, selection, action log, UI state, or viewport state.

### Semantic And Behavior Mutation Tools

- `structure_scene` maps to `STRUCTURE_SCENE`.
- `set_node_semantics` maps to `SET_NODE_SEMANTICS`.
- `create_semantic_group` maps to `CREATE_SEMANTIC_GROUP`.
- `assign_to_semantic_group` maps to `ASSIGN_TO_SEMANTIC_GROUP`.
- `add_behavior` maps to `ADD_BEHAVIOR`.
- `remove_behavior` maps to `REMOVE_BEHAVIOR`.
- `make_interactive` maps to `MAKE_INTERACTIVE`.
- All support dry-run.
- All validate payloads before reducer execution.
- Behavior and semantic metadata are JSON data only and must not be executed.

### `arrange_nodes`

- Validates node ids, layout, and layout options.
- Maps to `ARRANGE_NODES`.
- Supports dry-run.
- Mutates scene transforms for the provided node set.

### `apply_command`

- Validates a generic command with `CommandSchema`.
- Maps to `applyCommand()` / `dryRunCommand()`.
- Supports dry-run.
- Mutates scene or selection according to the command.
- Intended for advanced or newly added commands that do not yet have a narrow
  tool.

### `apply_command_batch`

- Validates generic command arrays with `CommandSchema.array()`.
- Maps to `applyCommandBatch()` / `dryRunCommandBatch()`.
- Supports dry-run.
- Commits atomically only when all commands pass.
- Replay-safe duplicate commands must provide deterministic `idMap`.

### `export_r3f`

- Validates export options.
- Maps to `exportScene({ format: "r3f" })`.
- Does not mutate scene, selection, action log, UI state, or viewport state.

### `export_json`

- Validates export options.
- Maps to `exportScene({ format: "json" })`.
- Does not mutate scene, selection, action log, UI state, or viewport state.

### `load_scene`

- Validates full scene input or JSON text.
- Maps to `loadScene()`.
- Mutates scene as a session boundary.
- Must reset any runtime state that is scoped to the prior scene.
- Future MCP must provide dry-run validation before committing a load.

## Safety Requirements

- No filesystem browsing.
- No shell execution.
- No arbitrary JavaScript execution.
- No direct Zustand access.
- No direct R3F or Three object access.
- No direct scene patching outside commands or validated scene load.
- Every mutating tool records source, payload, dry-run status, result, errors,
  and warnings in the runtime action log or an explicitly scoped successor.
- Mutating tools must support dry-run before apply.
- Narrow schemas should be used for common tools; generic `apply_command` remains
  available for advanced cases.
- MCP tools wrap `@dioramai/agent-interface` only.

## Go/No-Go For Real MCP

Real MCP implementation can begin only when:

- schema is complete;
- R3F bridge is complete;
- command validation is complete;
- dry-run behavior is complete for every mutating tool;
- batch API is complete;
- action logging is complete or explicitly deferred with a replacement scope;
- replay tests pass;
- export snapshots pass;
- the runtime adapter decision is complete;
- security review is complete.

Current recommendation: do not begin real MCP transport yet. Milestone 7 proves
the contract shape and MCP-lite proves the runtime facade, but the runtime
adapter decision and security review still need explicit decisions before
transport work starts.

## Consequences

- MCP transport stays thin and delegates to `DioramaiSceneRuntime`.
- Future MCP tools must not bypass commands.
- Tests can validate tool contracts without stdio, HTTP, JSON-RPC, auth, or a
  long-running local server.
- New commands require updates to command schemas, narrow MCP tools if needed,
  eval fixtures, and this ADR.

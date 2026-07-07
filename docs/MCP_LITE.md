# MCP-Lite

> **Historical document.** MCP-lite and the `@dioramai/agent-interface`
> package it described have been removed. The live agent surface is the MCP
> tool contract in [`docs/mcp-tools.md`](mcp-tools.md), implemented by
> `@dioramai/mcp` (a typed HTTP client for the local bridge) plus the stdio
> proxy in `scripts/dioramai-mcp.ts` and the `dioramai mcp` CLI command.
> Command validation now lives in `packages/core/src/commandSchema.ts`.
> The notes below are retained for design history.

MCP-lite was a library-level proof of the future MCP surface. It proved the
agent workflow without a server transport:

Agent intent -> MCP-lite facade -> validated Dioramai commands -> dry-run ->
apply -> inspect result -> JSON/R3F export.

## Scope

MCP-lite wraps `createAgentSession()` with helper names that match future MCP
tools. It does not implement a real MCP server, tool descriptors,
authentication, persistence, or remote sessions.

All write helpers compile to canonical commands and then delegate to the
validated agent runtime. They do not mutate scenes directly.

Implemented helpers:

- `createMcpLiteRuntime(initialScene?)`
- `getScene()`
- `getSemanticGroups()`
- `getBehaviors()`
- `dryRunCommand(command)`
- `applyCommand(command)`
- `dryRunCommandBatch(commands)`
- `applyCommandBatch(commands)`
- `structureScene({ preset, dryRun? })`
- `makeInteractive({ targetRole, dryRun? })`
- `arrangeNodes({ nodeIds, layout, options, dryRun? })`
- `exportR3F(options?)`
- `exportJSON()`

All helpers return `AgentResult<T>`: either `{ ok: true, data }` or
`{ ok: false, error }`.

## Safety Rules

MCP-lite explicitly forbids:

- Filesystem browsing.
- Shell execution.
- Arbitrary JavaScript execution.
- Zustand access.
- React Three Fiber object access.
- Editing exported code or scene files as a substitute for commands.
- Direct hidden mutation of scene state.

Expected validation and command failures return structured `AgentErr` values
instead of throwing.

## Future Tool Mapping

The full future MCP tool contract now lives in `docs/mcp-tools.md`. MCP-lite
keeps the same boundary: helpers compile to commands or delegate to the
agent-interface runtime, and real transport remains deferred.

## Go Criteria For Real MCP

Move to a real MCP transport when all are true:

- MCP-lite facade tests pass for dry-run, apply, inspect, and export loops.
- Every write path goes through `CommandSchema` or existing validated load
  schemas.
- Convenience helpers compile to command payloads rather than changing scene
  directly.
- `getSemanticGroups()` and `getBehaviors()` are clone-safe read helpers.
- Agent eval proves: structure scene -> make interactive -> arrange -> export
  R3F module.
- R3F module export is deterministic and safe against command log, path, and
  raw URL leakage.
- Docs list forbidden capabilities and future tool mapping.
- No dependency on `apps/web`, Zustand, DOM objects, R3F runtime objects,
  filesystem browsing, shell, or arbitrary JS execution.

## No-Go Criteria

Do not implement real MCP if any are true:

- A helper mutates scene outside `applyCommandWithResult`.
- Convenience helpers duplicate reducer behavior instead of compiling commands.
- Dry-run and apply produce inconsistent results for the same valid payload.
- Any export leaks action logs, command logs, local filesystem paths, or
  arbitrary metadata as executable JavaScript.
- MCP design requires access to Zustand, React components, Three objects, shell,
  filesystem browsing, or raw source-code mutation.
- Tool results are unstructured strings instead of `AgentResult`-style objects.

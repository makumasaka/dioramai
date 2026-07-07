# ADR 008: MCP integration deferred until the agent API surface is stable

## Status

Superseded. The deferral has ended: `@dioramai/agent-interface` was removed
(see `docs/ARCHITECTURE.md`), and a real MCP stdio surface now ships as thin
proxies over the local bridge (`scripts/dioramai-mcp.ts` and the `dioramai mcp`
CLI subcommand) with the tool contract defined in `@dioramai/mcp` and
documented in `docs/mcp-tools.md`. Kept for historical context.

## Context

MCP hosts need stable tool names and payloads. Shipping MCP too early risks locking the wrong contracts.

## Decision

- **`@dioramai/agent-interface`** is the supported typed entry for validate → `applyCommand` → export flows.
- **`@dioramai/mcp`** may re-export agent-interface during MVP ramp; a real MCP server (stdio/HTTP) lands after session/command batch semantics are frozen and covered by tests.

## Rationale

Avoid two divergent “agent APIs”; let MCP be a thin transport over the same session type.

## Tradeoffs

- Early adopters use the library directly instead of MCP until Milestone 7-style work completes.

## Consequences

- MCP PRs must not redefine `Scene` or commands; they call existing modules only.

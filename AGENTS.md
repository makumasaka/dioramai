# Dioramai Agent Instructions

## Product intent

Dioramai is a local-first runtime orchestration layer for React Three Fiber
applications. It sits inside developer workflows.

Prioritize live code <-> runtime synchronization, deterministic commands,
stable node identity, runtime inspection, and repo-native R3F code emission.

The repo is the source of truth. The browser shell exists to inspect,
manipulate, and synchronize runtime state back into code. The local bridge
connects the repo, runtime, browser shell, and coding agents.

## Architectural priorities

1. Runtime sync first
2. Command system second
3. R3F bridge third
4. Export / code sync fourth
5. Agent / MCP control plane fifth
6. UI polish last

## Core rules

- Never mutate scene state directly from UI or runtime code.
- All meaningful edits must flow through commands.
- Preserve deterministic behavior and stable node IDs.
- Keep operational scene state separate from render state, R3F refs, and
  Zustand app state.
- R3F refs are runtime projections only; they are never source of truth.
- Prefer small, typed, composable modules.
- Avoid broad abstractions before the command and code-sync model is stable.

## Code quality

- TypeScript only for new code.
- Zod schemas are the source of truth for data shapes.
- Use pure reducers for scene state.
- Use Zustand only for web app/view state.
- Add tests with each architecture-affecting change.

## MVP scope

- Local project/repo sync only.
- Local GLB/GLTF registration only.
- Deterministic generated R3F module output.
- Code -> runtime sync through the generated `dioramaiScene` block.
- Deployment happens through the developer repo and Vercel, not Dioramai cloud.

## Non-goals for MVP

- No full DCC feature creep
- No realtime collaboration
- No shader graph or material graph
- No animation authoring, rigging, skinning, physics, or ECS
- No text-to-3D/image-to-3D asset generation orchestration
- No cloud publishing
- No hidden mutations
- No universal scene schema or cross-engine abstractions
- No engine-agnostic middleware

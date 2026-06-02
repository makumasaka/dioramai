# V1 Vertical Slice Architectural Changelog

> Archived historical note. This generator-first vertical slice is not part of
> the P0 local runtime-sync architecture. Do not use these generation paths for
> the public MVP bridge, hosted shell, or MCP tool surface.

This document records the architecture-level changes implemented for the first
end-to-end V1 slice:

`generateAsset -> ingestAsset -> structureScene -> makeInteractive -> arrangeNodes -> exportR3F`

It focuses on mutation boundaries, runtime contracts, and extension points.

## Scope

- Added a complete mock-first vertical path from generated GLB reference to
  exported R3F module output.
- Preserved deterministic command semantics as the only scene mutation path.
- Kept `@dioramai/mcp` as a future adapter layer while extending the current
  Agent Runtime (`@dioramai/agent-interface`).

## Architectural Delta Summary

## 1) Core Command Model

### Added command

- `REGISTER_ASSET` was added to the core command union and reducer path in
  [`packages/core/src/commands.ts`](../packages/core/src/commands.ts).
- Summary/logging support was added in
  [`packages/core/src/commandLog.ts`](../packages/core/src/commandLog.ts).
- Agent-facing command schema parity was added in
  [`packages/agent-interface/src/commandSchema.ts`](../packages/agent-interface/src/commandSchema.ts).

### Why this matters

- Asset registration is now a first-class, replayable scene/document mutation.
- Ingestion does not mutate scene state directly; it emits commands including
  `REGISTER_ASSET`.
- Determinism and no-op behavior are preserved by reducer checks and tests.

## 2) Ingestion Layer (formerly section 3)

### New package

- Added `@dioramai/ingestion`:
  - [`packages/ingestion/src/types.ts`](../packages/ingestion/src/types.ts)
  - [`packages/ingestion/src/ingest.ts`](../packages/ingestion/src/ingest.ts)
  - [`packages/ingestion/src/index.ts`](../packages/ingestion/src/index.ts)

### Core contract

- Primary contract is command-first:
  - `IngestionResult = { commands: Command[]; warnings: string[] }`
- Optional `assets` is convenience output only.

### Classification policy

- Metadata and semantics are primary:
  - `semantics.role = 'product'`
  - `metadata.source = 'generator'`
  - `metadata.prompt = <prompt when available>`
- Node name is display text, not the primary classifier.

### Mutation boundary

- Ingestion returns command plans only.
- Scene changes occur only when command batches are applied via Agent Runtime.

## 4) Agent Runtime Surface

### Terminology

- `@dioramai/agent-interface` is the Agent Runtime.
- `@dioramai/mcp` remains a future adapter surface.

### Added Agent Runtime tools

- Extended runtime in
  [`packages/agent-interface/src/mcpLite.ts`](../packages/agent-interface/src/mcpLite.ts):
  - `generateAsset(input)`
  - `ingestAsset(input)`
- Exported new schemas/types in
  [`packages/agent-interface/src/index.ts`](../packages/agent-interface/src/index.ts).

### Safety and boundaries

- Inputs are validated with Zod before command execution.
- No shell execution, filesystem browsing API, arbitrary JS execution, direct
  Zustand mutation, or direct R3F object mutation was added.
- Agent Runtime remains the single gateway for automated Core edits.

## 5) R3F Exporter Delta

### Asset-aware scaffolding

- Export model now resolves asset-backed mesh nodes:
  - [`packages/export-r3f/src/sceneToR3fModel.ts`](../packages/export-r3f/src/sceneToR3fModel.ts)
- Module export emits `useGLTF`-based scaffold when safe GLB/GLTF URIs are
  available:
  - [`packages/export-r3f/src/moduleExporter.ts`](../packages/export-r3f/src/moduleExporter.ts)
- Fragment export emits clear GLTF scaffold comments and placeholder fallback:
  - [`packages/export-r3f/src/fragmentExporter.ts`](../packages/export-r3f/src/fragmentExporter.ts)

### Privacy/safety guard

- Export sanitizes local/private asset paths (`file:///`, `/Users/...`,
  absolute Windows user paths, and generic external URLs) and does not inline
  them into generated code.

## 6) End-to-End Demo and Validation

### Demo entry point

- Root script:
  - [`package.json`](../package.json) -> `demo:v1`
- Vertical slice test:
  - [`packages/agent-interface/src/v1VerticalSlice.test.ts`](../packages/agent-interface/src/v1VerticalSlice.test.ts)

### Workflow covered

- Mock generation
- Local asset reference write
- Ingestion command plan
- Command batch apply
- `structureScene`
- `makeInteractive`
- `arrangeNodes`
- `exportR3F` (module)
- `exportJSON`

## Extension Points After V1

## Additional providers (Tripo/Luma)

- 3D model generation is handled by external MCP servers (e.g. Meshy MCP).
  Once a GLB is available locally it enters the normal ingestion path.

## Ingestion enrichment

- Add deeper GLB introspection in `@dioramai/ingestion` only as command planning
  logic (for example richer node trees and semantic hints).
- Preserve command-only mutation semantics.

## Future MCP adapter

- Keep `@dioramai/mcp` as adapter-only transport and tool-hosting layer.
- Route all mutations through `@dioramai/agent-interface` instead of creating a
  second mutation path.

## Known V1 Limits (Intentional)

- No full glTF pipeline, material fidelity system, animation, or physics.
- No deployment/publishing features in Dioramai.
- No file browsing tool surface for agents.
- No arbitrary code execution surface for agents.

## Acceptance Status

- Workspace typecheck: PASS
- Workspace tests: PASS
- Workspace lint: PASS
- `demo:v1`: PASS

This slice is now a deterministic, test-backed baseline for provider expansion
and future transport adapters.

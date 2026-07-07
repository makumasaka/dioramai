# Monorepo migration

## What moved

| Former location | New location |
|-----------------|--------------|
| `apps/web/src/core/types.ts` | `packages/schema/src/types.ts` |
| `apps/web/src/core/sceneValidation.ts` | `packages/schema/src/sceneValidation.ts` |
| `apps/web/src/core/sceneJson.ts` | `packages/schema/src/sceneJson.ts` |
| `apps/web/src/core/{scene,transform,layout,duplicate,commands,commandLog}.ts` | `packages/core/src/` (same filenames) |
| `apps/web/src/core/fixtures/**` | `packages/core/src/fixtures/**` |
| `apps/web/src/export/r3f.ts` | `packages/export-r3f/src/r3f.ts` |

## Why

- **Schema** (`@dioramai/schema`): canonical scene types, structural validation, and JSON parse/serialize live in a UI-free package.
- **Core** (`@dioramai/core`): pure command reducer, graph helpers, fixtures, and command summaries; depends only on schema.
- **Export** (`@dioramai/export-r3f`): R3F JSX string emitter stays separate so the editor does not own export-only code paths.
- **Examples / MCP**: placeholder packages and `docs/adr`, `docs/evals` reserve folders for the roadmap without pulling scope into the web app.

## Imports

Application code should use workspace packages:

- `@dioramai/schema` - when you need types or validation at the edge without pulling commands.
- `@dioramai/core` - commands, fixtures, `applyCommand`, re-exports of common schema helpers used by the app today.
- `@dioramai/export-r3f` - `exportSceneToR3fJsx`.

`apps/web/vite.config.ts` aliases those packages to `packages/*/src` so Vite resolves TypeScript sources without a pre-build step.

## Scripts

- `npm run typecheck` - `tsc --noEmit` in each workspace package (in dependency order via separate `-w` calls).
- `npm run build` - typecheck, then `apps/web` production build.

## Scene document version

The canonical scene document format is now version 2:

- `format`: `dioramai-scene`

Wrapped v2 documents that still use the pre-rebrand `format` value `diorama-scene`
are accepted on parse; `serializeScene` always emits `dioramai-scene`.

- `version`: `2`
- `data`: canonical `Scene`

Version 2 formalizes the current `SceneNode` shape:

- `id`
- `name`
- `type`
- `children`
- `transform`
- `visible`
- optional `assetRef`
- optional `materialRef`
- optional `light`
- `metadata`

The schema parser still accepts wrapped version 1 documents and legacy bare scene
graphs. Those imports are migrated/defaulted to the version 2 shape before being
returned to callers. New exports should always use the wrapped version 2 format.

Migration/defaulting behavior:

- `selection` defaults to `null` when omitted.
- `visible` defaults to `true`.
- `metadata` defaults to `{}`.
- missing node `type` is inferred during migration: the `rootId` node becomes
  `root`, nodes with `light` become `light`, branch nodes become `group`, and
  remaining leaf nodes become `mesh`.
- current v2 documents must have `rootId` pointing to a `type: "root"` node,
  and non-root nodes must not use `type: "root"`.

Transform policy:

- stored transforms are local only.
- rotation values are Euler radians in XYZ order.
- world transforms are computed from hierarchy by core utilities when needed.

## Root package name

The root `package.json` `name` field is now `dioramai` (was `scenegraph-ai`) to match the product; the Vite app workspace package remains `web`.

## TODOs left in tree

- `packages/mcp` - now owns the typed tool contract (`DIORAMAI_MCP_TOOL_NAMES` / `DIORAMAI_MCP_TOOL_DEFINITIONS`) consumed by the stdio proxies (`scripts/dioramai-mcp.ts` and `dioramai mcp`); see `docs/mcp-tools.md`.
- `packages/examples` - checked-in scene examples exist, but broader scripted eval harnesses are still future work.

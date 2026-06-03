# Dioramai

Dioramai is a visual runtime orchestration layer for AI-native React Three Fiber applications.

It is runtime-first and code-first. Dioramai runs inside or
alongside an existing developer project, keeps a validated canonical scene graph as source of truth, projects that scene into an R3F viewport, and synchronizes
deterministic visual edits back into generated R3F code.

The closest product analogy is Paper.design for interactive 3D web apps: a live
visual layer that helps developers and AI coding agents keep runtime spatial
composition, semantic scene identity, and app-ready R3F modules aligned.

## MVP Focus

The MVP is live code <-> runtime synchronization.

1. Open an R3F project with Dioramai running beside it.
2. Register GLB assets that already live in the project.
3. Select and transform scene nodes in the Dioramai viewport.
4. Dioramai applies commands to the canonical scene.
5. Dioramai regenerates a deterministic R3F scene module in the project.
6. The app hot reloads from that module.
7. Editing the embedded `dioramaiScene` block in the generated module reloads the
   canonical scene and updates the runtime again.

Dioramai does not host or publish projects. Deployment stays in the developer
repo through Cursor, Codex, Claude, Vercel, or the project's normal deploy
workflow.

## Canonical Model

The Dioramai scene schema is the source of truth.

Not canonical:

- Three.js objects
- React Three Fiber refs
- viewport state
- editor state
- runtime object transforms

All meaningful edits flow through:

```text
runtime interaction
  -> command
  -> canonical scene
  -> export/code sync
  -> runtime refresh
```

## Product Boundaries

Dioramai is not:

- a general-purpose 3D editor
- a browser game engine
- Unity or Blender in the browser
- a model generation platform
- a DCC for mesh authoring, animation, rigging, UVs, or shader graphs
- a cloud publishing system

Generated assets can be created elsewhere, committed into the developer repo as
GLB/GLTF files, and then registered with Dioramai.

## Repository Layout

| Path | Role |
|------|------|
| `packages/schema` | Zod scene schemas, validation, JSON serialization |
| `packages/core` | Pure command reducer, scene helpers, deterministic transforms |
| `packages/r3f-bridge` | R3F runtime projection, selection, registry, transform command translation |
| `packages/export-r3f` | Deterministic R3F module export and generated scene metadata parsing |
| `packages/agent-interface` | Narrow command/session surface for tools |
| `packages/local-bridge` | Local filesystem-aware bridge for safe repo sync |
| `packages/cli` | `npx dioramai` init/doctor/dev/export/validate commands |
| `packages/mcp` | Narrow MCP-facing package that proxies to the local bridge |
| `packages/ingestion` | Local GLB/GLTF registration helpers |
| `apps/web` | Vite runtime debug shell for viewport, hierarchy, inspector, code sync status |
| `apps/demo-export` | Sample generated R3F app used for local preview |

Generation packages are retained only as deferred historical experiments and are
not part of the runtime-sync MVP path.

## Run Locally

```bash
npm install
npm run dev
```

Useful scripts:

| Command | Purpose |
|---------|---------|
| `npm run test` | Run MVP package and app tests |
| `npm run typecheck` | Typecheck MVP packages |
| `npm run build` | Build the Dioramai web shell |
| `npm run bridge:dev` | Start the local Dioramai project bridge |
| `npm run mcp:stdio` | Start the narrow local MCP adapter |

For project sync, start the bridge with a project root:

```bash
npx dioramai init --template vite-r3f
npx dioramai doctor
npx dioramai dev --open
```

Default generated output:

- `src/generated/DioramaiScene.generated.tsx`
- `src/generated/dioramai.scene.json`
- `public/assets/models/*`

## More Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Runtime Sync MVP](docs/MVP_RUNTIME_SYNC.md)
- [R3F Export](docs/EXPORT.md)
- [MCP Tool Contract](docs/mcp-tools.md)

## License

MIT - see [LICENSE](LICENSE).

# Dioramai Web Shell

The hosted studio UI (deployed at [dioramai.design](https://dioramai.design)):
a Vite + React + React Three Fiber app with the viewport, outline tree,
inspector, command history, and code pane.

## Run

From the monorepo root:

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
```

To pair with a local project, start a bridge in that project
(`npx dioramai dev --open`) or open the shell with `?bridgeUrl=...&bridgeToken=...`
query parameters printed by the CLI.

## Structure

| Path | Role |
|------|------|
| `src/viewport/` | R3F `<Canvas>`, environment, grid, `RuntimeScene` mount |
| `src/ui/` | Inspector (with Advanced tab: performance settings + command history), toolbar, tree view, code pane |
| `src/store/sceneStore.ts` | Zustand store: canonical scene, undo/redo, command log, bridge routing |
| `src/bridge/` | HTTP + SSE client for the local bridge |

All scene mutations must flow through commands dispatched to the store — never
mutate scene objects or Three.js state directly (see `.cursor/rules/20-ui-architecture.mdc`).

## Test / Lint

```bash
npm run test -w web
npm run lint -w web
```

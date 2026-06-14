# MVP Local Repo Workflow

Dioramai's MVP workflow is local-repo first. The Vercel app is a static shell;
the local bridge is the only process that can touch a project folder.

## 1. Create Or Prepare An R3F Project

For the fastest MVP path, open an empty folder and run:

```bash
npx dioramai init --template vite-r3f
npx dioramai doctor
npx dioramai dev --open
```

`init` creates a minimal Vite + React + R3F app, `dioramai.config.json`,
`src/DioramaiApp.tsx`, the generated scene module, the scene JSON file, the
Cursor rule, and `public/assets/models`.

For an existing app, add a minimal `dioramai.config.json` at the project root:

```json
{
  "projectRoot": ".",
  "assetDir": "public/assets/models",
  "generatedSceneFile": "src/generated/DioramaiScene.generated.tsx",
  "publicAssetBase": "/assets/models",
  "sceneJsonFile": "src/generated/dioramai.scene.json"
}
```

Put GLB or GLTF files under the configured asset directory, for example:

```text
public/assets/models/chair.glb
```

## 2. Start The Local Bridge

From the target project:

```bash
npx dioramai doctor
npx dioramai dev --open
```

From the Dioramai monorepo against another project:

```bash
npm run bridge:dev -- --projectRoot /absolute/path/to/r3f-project
```

On Windows PowerShell:

```powershell
npx dioramai dev --projectRoot D:\Web\my-r3f-project
```

The bridge listens on `http://127.0.0.1:7777` by default.
It also prints a pairing token for browser-origin requests:

```text
Pairing token: <token>
Web shell URL: http://localhost:5173/?bridgeToken=<token>&bridgeUrl=http%3A%2F%2F127.0.0.1%3A7777
```

Useful checks:

```bash
curl http://127.0.0.1:7777/project-status
curl http://127.0.0.1:7777/scene
```

## 3. Open Dioramai

Use either local web dev or the deployed static shell.

Local shell:

```bash
npm run dev -w web
```

Open the shell with the printed bridge URL. If you started the bridge with
`--open`, Dioramai opens it for you. A local shell URL looks like:

```text
http://localhost:5173/?bridgeToken=<token>&bridgeUrl=http%3A%2F%2F127.0.0.1%3A7777
```

The shell connects to `http://127.0.0.1:7777` unless
`VITE_DIORAMAI_BRIDGE_ENABLED=false` is set. For a custom bridge URL, build or run
with:

```bash
VITE_DIORAMAI_BRIDGE_URL=http://127.0.0.1:7777
```

## 4. Register A GLB Asset

Through MCP/Cursor or bridge HTTP, register a project-relative asset:

```json
{
  "path": "public/assets/models/chair.glb",
  "name": "Chair",
  "semanticRole": "product",
  "importMode": "hierarchy"
}
```

HTTP example:

```bash
curl -X POST http://127.0.0.1:7777/tools/import_glb_asset \
  -H "content-type: application/json" \
  -d "{\"path\":\"public/assets/models/chair.glb\",\"name\":\"Chair\",\"semanticRole\":\"product\",\"importMode\":\"hierarchy\"}"
```

Dioramai will:

- validate the path stays inside the explicit project root
- register an asset with `REGISTER_ASSET`
- create an asset-backed scene node with `ADD_NODE`
- inspect the GLB and add stable child nodes for its internal glTF hierarchy
- reference the asset by `/assets/models/chair.glb`
- write the generated R3F module and scene JSON

## 5. Edit Runtime And Code

Runtime to code:

1. Select the object in the Dioramai viewport.
2. Move, rotate, or scale it.
3. Dioramai emits `UPDATE_TRANSFORM`.
4. The bridge writes `src/generated/DioramaiScene.generated.tsx`.

Code to runtime:

1. Edit the embedded `dioramaiScene` block in
   `src/generated/DioramaiScene.generated.tsx`, or edit
   `src/generated/dioramai.scene.json`.
2. In the Dioramai code pane, press Reload, or call:

```bash
curl -X POST http://127.0.0.1:7777/tools/reload_scene_from_file \
  -H "content-type: application/json" \
  -d "{}"
```

The bridge validates the scene before replacing canonical state.

## 6. Use The Generated Module

In the target app:

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { DioramaiScene } from './generated/DioramaiScene.generated';

export function App() {
  return (
    <Canvas>
      <OrbitControls />
      <DioramaiScene />
    </Canvas>
  );
}
```

Then run the target app normally:

```bash
npm run dev
npm run build
```

For the included sample app:

```bash
npx dioramai dev --projectRoot apps/demo-export
npm run dev -w demo-export
npm run build -w demo-export
```

## MCP Tools

The MVP MCP surface is intentionally narrow:

- `get_project_status`
- `get_scene`
- `load_scene`
- `register_asset`
- `import_glb_asset`
- `update_transform`
- `write_scene_to_file`
- `reload_scene_from_file`
- `export_r3f`
- `sync_code`

Before starting MCP, start the same local bridge for the target project:

```bash
npx dioramai dev --projectRoot /absolute/path/to/r3f-project
npm run mcp:stdio
```

On Windows PowerShell:

```powershell
npx dioramai dev --projectRoot D:\Web\my-r3f-project
npm run mcp:stdio
```

MCP is a proxy to the already-running local bridge. It does not start an
embedded bridge and it does not touch the filesystem directly.

No shell tools, arbitrary file browsing, code execution, or cloud publishing are
part of the MVP bridge.

## Current Limits

- The generated file is Dioramai-owned. Put app customization in wrapper files.
- Code-to-runtime sync parses the embedded scene block or scene JSON, not
  arbitrary JSX.
- GLB hierarchy import is the default. `single` remains available for
  intentionally opaque one-node GLBs.
- The deployed shell can connect to a local bridge, but the bridge must be
  running on the user's machine.

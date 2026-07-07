# Dioramai MVP MCP Tool Contract

Dioramai's MVP MCP surface is a narrow developer control plane for repo-first
runtime synchronization. It is not a generator middleware layer and it must not
expose shell, arbitrary file browsing, JavaScript evaluation, Zustand access, or
R3F/Three object references.

```text
Cursor / Claude / Codex
  -> local Dioramai MCP stdio proxy
  -> local Dioramai bridge
  -> canonical Dioramai scene
  -> deterministic R3F sync module
```

## Tools

### `get_project_status`

Returns bridge/project status for the explicit project root: config presence,
safe paths, asset dir status, generated file status, scene JSON status, current
scene loaded flag, node count, asset count, and last sync result.

Input:

```json
{}
```

### `get_scene`

Returns the current cloned canonical scene.

Input:

```json
{}
```

### `load_scene`

Loads a validated scene document or JSON scene text. This is the only
non-command mutation boundary and must validate through the Dioramai schema.

Input:

```json
{ "json": "{...}", "dryRun": false }
```

or `{ "scene": { "...": "..." }, "dryRun": false }`.

### `register_asset`

Registers a GLB/GLTF asset that already exists inside the allowed project root
and creates a scene node that references it by project-safe public URI.

Input:

```json
{
  "path": "public/assets/models/chair.glb",
  "name": "Chair",
  "importMode": "hierarchy",
  "semanticRole": "product",
  "dryRun": false
}
```

`hierarchy` is the default. It creates the renderable asset node plus stable
inspectable child nodes for glTF internals such as meshes, skins, joints, and
bones. `shallow` is accepted as a backward-compatible alias. Use `single` only
when an intentionally opaque one-node GLB is desired.

### `import_glb_asset`

Alias for `register_asset`. Accepts either `path` or `workspaceRelativePath`.

### `update_transform`

Applies an `UPDATE_TRANSFORM` command for a stable node id. Runtime gizmos use
this tool shape internally; runtime object refs are never canonical state.

Input:

```json
{
  "nodeId": "chair_01",
  "patch": {
    "position": [1, 0, 0],
    "rotation": [0, 0.5, 0],
    "scale": [1, 1, 1]
  },
  "dryRun": false
}
```

`transform` is accepted as a backward-compatible alias for `patch`.

### `set_node_semantics`

Applies a `SET_NODE_SEMANTICS` command tagging one or more nodes with a
semantic role, label, description, and tags.

Input:

```json
{
  "nodeIds": ["chair_01"],
  "semantics": {
    "role": "product",
    "label": "Oak Chair",
    "tags": ["featured"]
  },
  "dryRun": false
}
```

### `add_behavior`

Applies an `ADD_BEHAVIOR` command attaching a declarative interaction behavior
(`hover_highlight`, `click_select`, `focus_camera`, `anchor_point`,
`show_info`, `open_url`, `rotate_idle`, `scroll_reveal`) to nodes. Behavior
metadata is JSON data only and is never executed.

Input:

```json
{
  "behavior": {
    "id": "chair-info",
    "type": "show_info",
    "nodeIds": ["chair_01"],
    "params": { "title": "Chair", "description": "Handcrafted oak seat." }
  },
  "dryRun": false
}
```

### `remove_behavior`

Applies a `REMOVE_BEHAVIOR` command removing a behavior by id.

Input:

```json
{ "behaviorId": "chair-info", "dryRun": false }
```

### `export_r3f`

Writes or previews the generated R3F sync module for the current scene. The
default file is `src/generated/DioramaiScene.generated.tsx` inside the
configured project root.

Input:

```json
{ "write": true }
```

Pass `"write": false` to preview the generated module content without writing
it to disk.

### `write_scene_to_file`

Writes the current canonical scene to the configured generated R3F module and
scene JSON file.

Input:

```json
{}
```

### `reload_scene_from_file`

Reloads the canonical scene from the generated R3F module scene block. If the
generated module is missing, the bridge falls back to the configured scene JSON
file.

Input:

```json
{}
```

### `sync_code`

Synchronizes the canonical scene and generated file.

Input:

```json
{ "direction": "toCode" }
```

or:

```json
{ "direction": "fromCode" }
```

`toCode` regenerates the Dioramai-owned module from canonical scene state.
`fromCode` parses the embedded `dioramaiScene` block from the generated module,
validates it, and replaces canonical scene state.

## Forbidden MVP Tools

The MVP MCP server must not expose:

- `generate_asset`
- `generate_and_ingest_asset`
- arbitrary `apply_command`
- arbitrary `apply_command_batch`
- shell execution
- file read/write tools
- raw R3F or Three object access
- Zustand state access
- arbitrary JSX/JavaScript interpretation

Generation integrations may remain in the repository as deferred experiments,
but they are not part of the runtime sync MVP contract.

## Project Boundary

The bridge is started with `DIORAMAI_PROJECT_ROOT` or `--projectRoot`. All asset
paths, session paths, and generated module paths must resolve inside that root.
The MCP server must not browse outside the project root and must not provide a
general-purpose filesystem API.

## Generated File Contract

The generated file starts with `// @dioramai-generated`, includes an embedded
JSON-compatible `dioramaiScene` object, and renders R3F from that scene. MVP
code-to-runtime sync reads only this scene block. Custom app code should import
and wrap `DioramaiScene` instead of editing generated JSX.

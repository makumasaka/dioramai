# Example scenes

This document describes how scenes are represented in the repo, which **starter kits** ship with Dioramai, and how to move JSON in and out of the app.

## Document format

Exported files use a small wrapper so tooling can detect version and format:

- **`format`**: `dioramai-scene` (see `SCENE_DOCUMENT_FORMAT` in `@dioramai/schema`).
- **`version`**: Integer data version (`SCENE_DATA_VERSION`). Canonical exports currently use version 2.
- **`data`**: The `Scene` object: `rootId`, `selection`, and `nodes` (id -> node record).

Each canonical version 2 **node** includes:

- `id`
- `name`
- `type` (`root`, `group`, `mesh`, `light`, or `empty`)
- `children` (ordered list of child ids)
- `transform`: local `position`, `rotation`, `scale` as 3-tuples of finite numbers
- `visible`
- optional `assetRef`
- optional `materialRef`
- optional `light`
- `metadata`

The `rootId` node must have `type: "root"`, and non-root nodes must not use the
`root` type. Scene transforms are local only; world transforms are computed from
hierarchy when needed. Rotations are Euler radians using XYZ order.

Serialization uses **stable key ordering** at every object depth so diffs stay readable; array order (for example `children`) is preserved.

## Legacy import policy

`parseSceneJson` still accepts wrapped version 1 documents and legacy bare scene
graphs while that compatibility path is retained. Those inputs are migrated to
the canonical version 2 scene shape before callers receive them.

Migration/defaulting behavior:

- `selection` defaults to `null` when omitted.
- `visible` defaults to `true`.
- `metadata` defaults to `{}`.
- missing node `type` is inferred during migration: the `rootId` node becomes
  `root`, nodes with `light` become `light`, branch nodes become `group`, and
  remaining leaf nodes become `mesh`.
- unsupported document versions are rejected.

## Starter kits (built-in)

These are TypeScript fixtures in `@dioramai/core` (`packages/core/src/fixtures/`). In the web app, use the **Kit** dropdown and **Load kit** in the scene loader panel.

| Kit ID | Description | Demonstrates |
|--------|-------------|--------------|
| `default` | Minimal graph: root plus one cube. | Smoke tests, empty-slate edits, JSON/R3F baseline. |
| `showroom` | Root -> wide floor slab with pedestal children and a rotated/scaled accent cube. | Nested hierarchy, child order, transform export, reparent flows. |
| `gallery` | Root -> hall with a 3 by 3 grid of thin frame boxes. | Repeated deterministic nodes, layout-like spacing, snapshot stability. |
| `living` | Root -> room -> furniture group with sofa, coffee table, floor, and lamp proxies. | Multi-level grouping, `materialRef` tokens, realistic fixture shape without real asset loading. |

Fixture IDs are prefixed per kit (`default-*`, `showroom-*`, `gallery-*`, `living-*`) so graphs do not collide when switching kits in one session.

## Checked-in JSON examples

Canonical JSON examples live in `packages/examples/scenes/`:

- `default.json`
- `showroom.json`
- `gallery.json`
- `living.json`

These examples are intended for docs, regression fixtures, export snapshots, and
future eval harnesses. They should remain byte-for-byte aligned with
`serializeScene(getStarterScene(id))`.

Examples are not hand-authored alternates to the fixtures. They are canonical
JSON fixture exports used to verify reloadability, stable ordering, required v2
fields, and code -> canvas -> code loops.

## Import and export in the UI

1. **Export JSON** - Writes a `dioramai-scene` document (wrapper + sorted keys) suitable for Git or CI fixtures.
2. **Import JSON** - Parses the wrapper or, when applicable, a **legacy** graph shape the schema layer still accepts. Successful imports dispatch `REPLACE_SCENE` and become a new session boundary.
3. **Copy R3F JSX** - Uses `@dioramai/export-r3f` to place the current scene into a clipboard-friendly JSX snippet. The web UI passes `includeStudioLights: true` for a previewable studio fill (see [EXPORT.md](EXPORT.md) for the full limitations list).

The code -> canvas -> code loop is:

1. Load a kit or import JSON.
2. Edit through commands in the canvas.
3. Export JSON and R3F.
4. Re-import the exported JSON.
5. Verify the re-imported scene and regenerated outputs are deterministic.

## Authoring JSON by hand

- Ensure `rootId` exists in `nodes` and matches the root node's `id`.
- Ensure the `rootId` node has `type: "root"`.
- Do not use `type: "root"` on non-root nodes.
- Every non-root node must appear exactly once in some parent's `children` array.
- Do not attach the root as a child of any node.
- Avoid duplicate ids and cycles.

When in doubt, export a kit from the app and edit from that template.

## `packages/examples`

The `@dioramai/examples` package is reserved for checked-in JSON scenes, small
scripts that load scenes through `@dioramai/core`, and regression assets shared by
docs and tests.

## Related reading

- [ARCHITECTURE.md](ARCHITECTURE.md) - how commands update `Scene`.
- [EXPORT.md](EXPORT.md) - JSON and R3F export contracts and limitations.
- [COMMANDS.md](COMMANDS.md) - the validated command reference for mapping natural language to scene mutations.

# MVP Runtime Sync

The runtime-sync MVP proves one loop:

```text
runtime edit -> command -> canonical scene -> generated R3F module -> hot reload
code edit -> parse embedded scene document -> canonical scene -> runtime refresh
```

## Generated File Convention

Default generated file:

```text
src/generated/DioramaiScene.generated.tsx
```

Default asset location:

```text
public/assets/models
```

The generated module contains a canonical scene document and an R3F renderer:

```tsx
// @dioramai-generated
export const dioramaiScene = {
  "format": "dioramai-scene",
  "version": 2,
  "data": {}
} as const;

export function DioramaiScene() {
  return <DioramaiSceneRenderer scene={dioramaiScene.data} />;
}
```

MVP code -> runtime sync parses only the `dioramaiScene` object. Arbitrary JSX
roundtripping is deferred. Developers should customize wrapper files that import
`DioramaiScene`, not the generated renderer body.

GLBs that should appear in Dioramai must be registered in the canonical scene
document with `import_glb_asset` or equivalent scene JSON edits. App-specific
components may own playback and interaction behavior, but they should bind that
behavior to canonical node IDs instead of loading the same model with sibling
`useGLTF`/`GLTFLoader` code. The local bridge warns when app source files appear
to load GLB/GLTF assets outside the generated scene.

## Runtime -> Code

1. User selects a node in the R3F viewport.
2. TransformControls mutates only the local draft Object3D during dragging.
3. On commit, `@dioramai/r3f-bridge` reads the draft local transform and emits
   `UPDATE_TRANSFORM`.
4. `@dioramai/core` updates the canonical scene.
5. The local bridge regenerates the deterministic R3F module if bytes changed.
6. The developer app hot reloads from the generated module.

## Code -> Runtime

1. The local bridge watches the generated module inside the configured project
   root.
2. File changes are debounced.
3. `@dioramai/export-r3f` extracts the embedded `dioramaiScene` object.
4. Zod validates the scene document.
5. The bridge applies `REPLACE_SCENE`.
6. Web clients receive an SSE scene event and reproject the runtime.

## Project Safety

The bridge accepts a project root through `DIORAMAI_PROJECT_ROOT` or an explicit
startup option. All generated files and registered assets must resolve inside
that project root. The bridge must reject absolute, parent-directory, `file://`,
remote, or otherwise unsafe asset/code paths.

Browser-origin requests must pair with the local bridge token printed by
`dioramai dev`. The bridge binds to `127.0.0.1`, reflects CORS only for the
request origin, and exposes only the P0 safe routes/tools.

## MVP Limits

- No AST patching.
- No eval or arbitrary code interpretation.
- No file watching outside the configured project root.
- No cloud publishing.
- No Meshy/Tripo/World Labs or text-to-3D tools.
- No hidden mutation path from runtime refs to canonical scene.

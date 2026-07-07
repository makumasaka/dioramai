---
name: add-scene-command
description: Add or change a Dioramai scene command or scene schema field end-to-end. Use when adding a new Command type, extending the Scene schema (new scene-level or node-level field), or changing command payloads, reducers, CommandSchema validation, or the generated R3F module output.
---

# Adding a Scene Command or Schema Field

Commands are the only mutation path for persistent scene state. Any change to
the `Command` union or `Scene` schema must touch every layer below in the same
PR, or parity tests and roundtrips will break.

## Checklist

```
- [ ] 1. Schema: packages/schema/src/schemas.ts (+ types.ts, index.ts exports)
- [ ] 2. Clone helpers: sceneJson.ts cloneSceneFromJson + sceneValidation.ts cloneSceneImmutable
- [ ] 3. Core: packages/core/src/commands.ts (union, apply*, validation switch)
- [ ] 4. Core: commandLog.ts summarizeCommand case
- [ ] 5. Core: commandSchema.ts (COMMAND_TYPES, COMMAND_SCHEMA_PARITY, CommandSchema union)
- [ ] 6. Core exports: packages/core/src/index.ts
- [ ] 7. Export: packages/export-r3f/src/syncModule.ts if the generated module must reflect it
- [ ] 8. Web: apps/web store/UI dispatch path
- [ ] 9. Docs: docs/COMMANDS.md section
- [ ] 10. Tests: core commands.test.ts, schema sceneJson.test.ts, export syncModule.test.ts
```

## Key details per step

1. **Schema**: New scene fields must be optional (`.optional()`) so existing
   scene JSON keeps parsing. Use `.strict()` objects. Export the Zod schema and
   inferred type from `schemas.ts`, `types.ts`, and `index.ts`.

2. **Clone helpers**: `cloneSceneFromJson` (sceneJson.ts) and
   `cloneSceneImmutable` (sceneValidation.ts) enumerate scene fields explicitly.
   A new top-level scene field silently disappears on parse/clone if you skip
   this step.

3. **Reducer**: Follow the `UPDATE_ENVIRONMENT` pattern: merge patch, compare
   with `JSON.stringify` for no-op reference equality, run `validateScene`
   before returning the new scene. There are two switches in `commands.ts`:
   the reducer switch and the validation-error-string switch — update both
   (they are exhaustive via `never` checks, so tsc will point at them).

4. **Command routing in the web store**: `apps/web/src/store/sceneStore.ts`
   special-cases a few commands with dedicated bridge endpoints; everything
   else goes through local apply + full-scene `load_scene` upload. New
   commands need no bridge changes unless they require a dedicated endpoint.

5. **Generated module**: `renderSyncModule` in `syncModule.ts` emits the whole
   file as a template string. The scene JSON block roundtrips automatically
   once the schema accepts the field; only emit extra code (types, constants
   like `dioramaiCanvasProps`) when runtime behavior of the generated site
   must change. The scaffolded `DioramaiApp.tsx` template lives in
   `packages/local-bridge/src/runtime.ts` (`dioramaiAppTsx()`), with an
   assertion in `runtime.test.ts`.

6. **Verify**: `npm run typecheck && npm test` from the repo root must pass.

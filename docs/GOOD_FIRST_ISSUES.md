# Good first issues

These are **suggested** starting points for contributors. They are not all filed as GitHub issues yet; feel free to open an issue to claim a task or propose a variant.

## Documentation and examples

1. **More example scenes** — `packages/examples/scenes/` already contains a few `*.json` scenes matching the `dioramai-scene` wrapper. Add new ones (different lighting setups, GLB-based layouts) plus a short note in that package's README on how to load them.

2. **Link graph** — Cross-link `docs/EXAMPLE_SCENES.md` from other docs (e.g. `docs/COMMANDS.md`, `packages/examples`) where it reduces duplication.

## Tests

3. **Reducer edge cases** — Extend `packages/core` tests for commands that should no-op (duplicate id on `ADD_NODE`, invalid `SET_PARENT` targets, empty `ARRANGE_NODES` selection). Prefer table-driven tests next to existing flow tests.

4. **Export roundtrip** — Add a test in `packages/export-r3f` that exports a fixture scene and asserts stable substrings or structure (without over-constraining formatting).

## Web UX (small scope)

5. **Scene loader a11y** — Improve labels, focus management, or live region text for import/export status in `SceneLoader.tsx` without changing scene semantics.

6. **Keyboard affordances** — If there is an established pattern in the app, add one missing shortcut documented in the UI (scope tightly; avoid a full shortcut system in one PR).

## Schema and validation

7. **Clearer parse errors** — When `parseSceneJson` fails, optional logging or dev-only hints (without leaking large user files) could help integrators; keep production behavior safe.

## Agent / MCP surface

8. **MCP smoke test** — If `packages/mcp` exposes tools, add a minimal scripted test or documented manual checklist in a single markdown file under `docs/` (only if the package is executable in CI without secrets).

---

When opening a PR, reference this file or a GitHub issue number, keep the change set focused, and run `npm run test` and `npm run typecheck`.

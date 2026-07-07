# Dioramai Commands

Commands are the only mutation path for persistent scene state. UI actions,
agent sessions, evals, and future MCP tools must produce commands and pass them
through the core reducer instead of editing scene objects directly.

Untrusted payloads are validated by `CommandSchema` in
`packages/core/src/commandSchema.ts` before they reach core reducers.

## Scene Contract

Commands operate on canonical version 2 `Scene` state from `@dioramai/schema`.
Import code may accept wrapped v1 documents or legacy bare scenes, but those
inputs are normalized before reducers receive them.

Canonical `Scene` state includes `rootId`, `nodes`, `selection`, optional
`semanticGroups`, optional `behaviors`, optional asset/material registries, and
JSON-safe `metadata`. Canonical `SceneNode` fields are `id`, `name`, `type`,
`children`, `transform`, `visible`, optional `assetRef`, optional `materialRef`,
optional `light`, `metadata`, optional `semantics`, optional `behaviorRefs`,
and compatibility fields for the current viewport preview.

`rootId` must point to a node whose `type` is `root`. Persistent transforms are
local only; world transforms are computed from scene hierarchy. Rotations are
Euler radians in XYZ order.

## Reducer API

`applyCommand(scene, command): Scene` is the stable reducer entry point.

- It returns the next `Scene`.
- Expected invalid commands do not throw.
- No-op or rejected commands return the original scene reference where practical.
- Changing commands preserve scene invariants.
- It does not return diagnostics; callers compare references when they need to
  know whether state changed.

`applyCommandWithResult(scene, command): CommandResult` wraps the same scene
behavior with deterministic metadata for UI, agent, and future MCP surfaces.

`CommandResult` fields:

- `scene`: the scene returned by `applyCommand`.
- `changed`: `true` when `scene !== inputScene`.
- `summary`: deterministic ASCII command summary from `summarizeCommand`.
- `error?`: expected rejection reason when a command is invalid and unchanged.
- `warnings?`: non-fatal warnings, currently used for non-replay-safe duplicate
  commands without `idMap`.
- `command`: the original command object.

Expected invalid user or agent commands follow a no-throw policy. Use
`CommandResult.error` or bridge `VALIDATION_ERROR` results for expected
rejections. Reserve thrown exceptions for programmer errors outside the command
contract.

## Replay And Validation Policy

- Reducers are pure, deterministic functions.
- Reducers do not access DOM, storage, network, clocks, random values, or render
  state.
- Command replay must use the same initial scene and the same command sequence.
- Replay-safe `DUPLICATE_NODE` commands must include a complete deterministic
  `idMap`.
- Command batches should dry-run before apply in agent and future MCP flows.
- Every changing command must preserve graph invariants.
- `CommandSchema` must mirror the core `Command` union. Any command union change
  must update `CommandSchema`, `COMMAND_TYPES`, `COMMAND_SCHEMA_PARITY`,
  `docs/COMMANDS.md`, core command tests, and affected UI/export tests together.
- `packages/core/src/commands.test.ts` locks the command type set,
  valid/invalid payload coverage, and `COMMAND_SCHEMA_PARITY`.

## Product Log And History Policy

- Visible product log entries use `summarizeCommand` titles and details.
- `SET_SELECTION` updates canonical `scene.selection` but is omitted from the
  visible product command log by default.
- `REPLACE_SCENE` is a session boundary for the web product: the incoming scene
  is validated and cloned, then undo, redo, and visible command log state are
  cleared by the store layer.
- Undo/redo is store-owned snapshot history. Reducers do not own stacks.
- Changing commands produce undo snapshots. No-op and rejected commands do not.
- Consecutive `UPDATE_TRANSFORM` commands for the same node may be coalesced by
  the web store into one undo entry. Core reducers still apply each command
  independently.

## Canvas Loop Policy

- The web canvas is a visual adapter over canonical scene state, not a source of
  truth.
- Inspector edits, outliner actions, toolbar actions, viewport selection, and
  viewport gizmo commits must route through store dispatch and core commands.
- Viewport object transforms are transient until committed through
  `UPDATE_TRANSFORM`.
- The viewport renders the scene recursively from `scene.rootId`; the root is
  rendered as a transformed group, not assumed to be identity.
- Viewport traversal must preserve scene hierarchy semantics and match R3F export
  traversal for visible nodes.

## MCP Exposure

Every command below is exposed to agents through the same validated command
surface. The live MCP tool contract is documented in
[mcp-tools.md](mcp-tools.md); tools proxy through the local bridge, validate
payloads with `CommandSchema`, and must not introduce command-specific
mutation paths.

Undo/redo remain store-owned in the web product; they are not part of the
bridge or MCP surface.

## ADD_NODE

Purpose: create a new scene node under an existing parent.

Payload shape:

```ts
{ type: 'ADD_NODE'; parentId: string; node: SceneNode }
```

Preconditions:

- `parentId` exists in `scene.nodes`.
- `node.id` is fresh.
- `node` is a valid canonical v2 `SceneNode`.
- The resulting scene passes graph validation.

Behavior:

- Adds `node` to `scene.nodes`.
- Appends `node.id` to the parent `children` array.
- Leaves selection unchanged.

No-op cases:

- Parent does not exist.
- Node ID already exists.
- Node would break graph invariants.

Validation errors:

- `ADD_NODE parentId does not exist`
- `ADD_NODE node id already exists`
- `ADD_NODE would violate scene invariants`
- Agent payload validation also rejects malformed `parentId` or `node`.

Undo/redo behavior:

- Changing add commands create an undo snapshot.
- Undo restores the prior scene without the added node.
- Redo reapplies the same command from the redo snapshot.
- Rejected add commands do not affect history.

Visible product log behavior:

- Logged as `Add node`.
- Detail includes node name, parent id, and node id with long ids shortened.

Future MCP exposure:

- Expose as a validated command. Agents must provide the full canonical node.

Test coverage notes:

- `packages/core/src/commands.test.ts` covers missing parent and duplicate id
  no-ops.
- `packages/core/src/commandContract.test.ts` covers successful root/nested add,
  invariant rejection, duplicate ids, and missing parents.
- `packages/core/src/editingReducer.flows.test.ts` covers reducer flow usage.
- `packages/core/src/sceneGraph.property.test.ts` covers invariant preservation
  across random command streams.
- `packages/core/src/commands.test.ts` covers `CommandSchema` validation of
  untrusted payloads before reducer execution.

## DELETE_NODE

Purpose: remove a non-root node and its descendants.

Payload shape:

```ts
{ type: 'DELETE_NODE'; nodeId: string }
```

Preconditions:

- `nodeId` exists.
- `nodeId` is not `scene.rootId`.

Behavior:

- Deletes the node and all descendants.
- Removes the node ID from its parent.
- Clears selection when the selected node is inside the deleted subtree.

No-op cases:

- Node is the root.
- Node does not exist.

Validation errors:

- `DELETE_NODE cannot delete root`
- `DELETE_NODE nodeId does not exist`
- Agent payload validation also rejects malformed `nodeId`.

Undo/redo behavior:

- Changing delete commands create an undo snapshot with the removed subtree.
- Undo restores the prior scene, including selection.
- Redo removes the same subtree again.
- Rejected delete commands do not affect history.

Visible product log behavior:

- Logged as `Delete node`.
- Detail includes the target node id with long ids shortened.

Future MCP exposure:

- Expose as a validated command. MCP must not provide direct subtree deletion
  helpers that bypass this command.

Test coverage notes:

- `packages/core/src/commands.test.ts` covers root deletion, subtree deletion
  integrity, and selection clearing.
- `packages/core/src/commandContract.test.ts` covers leaf/subtree deletion,
  selection clearing for selected descendants, root rejection, and missing-node
  rejection.
- `packages/core/src/editingReducer.flows.test.ts` covers snapshot-style undo
  behavior around reducer changes.

## UPDATE_TRANSFORM

Purpose: update a node's local transform.

Payload shape:

```ts
{
  type: 'UPDATE_TRANSFORM';
  nodeId: string;
  patch: {
    position?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
  };
}
```

Preconditions:

- `nodeId` exists.
- `patch` includes at least one transform field when coming through
  `CommandSchema`.
- Patched transform remains schema-valid.

Behavior:

- Merges the patch into the node local transform.
- Preserves unchanged transform fields.
- Validates the resulting scene before accepting the change.

No-op cases:

- Node does not exist.
- Core receives an empty patch.
- Patch equals the current transform.
- Patch would break scene invariants.

Validation errors:

- `UPDATE_TRANSFORM nodeId does not exist`
- `UPDATE_TRANSFORM would violate scene invariants`
- Agent payload validation rejects empty patches, malformed Vec3 tuples, and
  non-finite values before core execution.

Undo/redo behavior:

- Changing transform commands create an undo snapshot.
- Undo restores the previous local transform.
- Redo reapplies the local transform patch from the command/history path.
- Rejected or unchanged transform commands do not affect history.

Visible product log behavior:

- Logged as `Update transform`.
- Detail includes the node id with long ids shortened.

Future MCP exposure:

- Expose as a validated command for agent-authored transform edits. MCP must use
  local transforms; world transforms are computed by core utilities when needed.

Test coverage notes:

- `packages/core/src/commands.test.ts` covers empty patch, same-reference
  no-op, and invalid invariant rejection.
- `packages/core/src/commandContract.test.ts` covers position, rotation, scale,
  full patches, missing nodes, empty patches, and equal-value no-ops.
- `packages/core/src/editingReducer.flows.test.ts` covers transform edit flow.
- `packages/core/src/commands.test.ts` covers malformed patch validation
  before reducer execution.

## STRUCTURE_SCENE

Purpose: deterministically structure a raw scene using a local preset.

Payload shape:

```ts
{ type: 'STRUCTURE_SCENE'; preset: 'showroom' }
```

For the showroom preset, Dioramai creates scene-level semantic groups
`display_area`, `seating_area`, `lighting_zone`, and `environment`, then assigns
node semantics from deterministic name/type cues. It does not call AI or mutate
the hierarchy.

## MAKE_INTERACTIVE

Purpose: add simple behavior definitions for nodes with a target semantic role.

Payload shape:

```ts
{ type: 'MAKE_INTERACTIVE'; targetRole?: SemanticRole }
```

For the MVP, the default role is `product`. The command adds `hover_highlight`,
`click_select`, and `show_info` behavior definitions and references them from
target nodes.

## CREATE_SEMANTIC_GROUP

Purpose: create an explicit semantic group node and assign existing nodes to it.

Payload shape:

```ts
{
  type: 'CREATE_SEMANTIC_GROUP';
  group: SemanticGroup;
}
```

Behavior:

- Adds or updates a scene-level semantic group.
- Keeps scene graph hierarchy unchanged.
- Returns the original scene for duplicate group ids or no valid targets.

## ASSIGN_TO_SEMANTIC_GROUP

Purpose: assign existing nodes to a semantic group without reparenting.

Payload shape:

```ts
{
  type: 'ASSIGN_TO_SEMANTIC_GROUP';
  groupId: string;
  nodeIds: string[];
}
```

Behavior:

- Updates `semanticGroups[groupId].nodeIds`.
- Sets each valid node's `semantics.groupId`.
- Preserves child order and graph hierarchy.

## SET_NODE_SEMANTICS

Purpose: assign semantic meaning to existing nodes.

Payload shape:

```ts
{
  type: 'SET_NODE_SEMANTICS';
  nodeIds: string[];
  semantics: Partial<NodeSemantics>;
}
```

Behavior:

- Filters invalid ids and root.
- Merges `semantics` onto each valid node.
- Preserves transforms, refs, visibility, metadata, and behaviors.

## ADD_BEHAVIOR

Purpose: attach inspectable interaction metadata to nodes.

Payload shape:

```ts
{
  type: 'ADD_BEHAVIOR';
  behavior: BehaviorDefinition;
}
```

Behavior:

- Adds or updates a scene-level behavior definition.
- Appends the behavior id to target nodes' `behaviorRefs`.
- Does not execute runtime code or store transient hover state.

## REMOVE_BEHAVIOR

Purpose: remove a behavior definition and node references to it.

Payload shape:

```ts
{ type: 'REMOVE_BEHAVIOR'; behaviorId: string }
```

Behavior:

- Deletes `scene.behaviors[behaviorId]`.
- Removes that id from all node `behaviorRefs`.

## DUPLICATE_NODE

Purpose: duplicate a node or subtree.

Payload shape:

```ts
{
  type: 'DUPLICATE_NODE';
  nodeId: string;
  includeSubtree: boolean;
  newParentId?: string;
  idMap?: Record<string, string>;
}
```

Preconditions:

- `nodeId` exists and is not root.
- Target parent exists. If `newParentId` is omitted, the duplicate attaches to
  the current parent or root.
- Target parent is not inside the duplicated subtree.
- When provided, `idMap` maps every duplicated source id to a fresh unique target
  id and contains no extra source ids.

Behavior:

- Duplicates one node or a full subtree.
- Preserves local transforms, refs, node fields, light payloads, and metadata.
- Appends ` (copy)` to duplicated node names.
- Uses `idMap` when supplied.
- Without `idMap`, generated ids are allowed for UI-style duplication but are
  not replay-safe.

No-op cases:

- Source node does not exist.
- Source node is root.
- Target parent does not exist.
- Target parent is inside the duplicated subtree.
- `idMap` is incomplete, has unknown source ids, empty target ids, existing
  target ids, duplicate target ids, or extra source ids.

Validation errors:

- `DUPLICATE_NODE cannot duplicate root`
- `DUPLICATE_NODE nodeId does not exist`
- `DUPLICATE_NODE newParentId does not exist`
- `DUPLICATE_NODE cannot parent duplicate under its own subtree`
- `DUPLICATE_NODE idMap must map each duplicated node`
- `DUPLICATE_NODE idMap contains unknown source id`
- `DUPLICATE_NODE idMap contains empty target id`
- `DUPLICATE_NODE idMap target id already exists`
- `DUPLICATE_NODE idMap target ids must be unique`
- Agent payload validation rejects malformed `idMap` shape before core
  execution.

Undo/redo behavior:

- Changing duplicate commands create an undo snapshot.
- Undo removes the duplicated nodes by restoring the prior scene.
- Redo is replay-safe only when command ids are deterministic.
- Commands without `idMap` can be used by UI, but should not be used in replay,
  agent, eval, or MCP fixtures.

Visible product log behavior:

- Logged as `Duplicate node`.
- Detail includes source id, subtree flag, and optional target parent id.
- `applyCommandWithResult` emits warning
  `DUPLICATE_NODE without idMap uses generated ids` when `idMap` is omitted.

Future MCP exposure:

- Expose as a validated command. MCP and agent workflows must provide `idMap`
  for deterministic replay.

Test coverage notes:

- `packages/core/src/commands.test.ts` covers invalid id maps, deterministic id
  maps, generated-id warnings, light copying, and replay-safe idMap errors.
- `packages/core/src/commandContract.test.ts` covers leaf/subtree duplication,
  deterministic id maps, copied node fields, invalid id maps, root source, and
  missing source.
- `packages/core/src/editingReducer.flows.test.ts` covers deterministic duplicate
  flow.
- `packages/core/src/sceneGraph.property.test.ts` generates deterministic
  duplicate id maps in random command streams.

## SET_PARENT

Purpose: reparent a node while preserving local transform by default or world
transform when requested.

Payload shape:

```ts
{
  type: 'SET_PARENT';
  nodeId: string;
  parentId: string;
  preserveWorldTransform?: boolean;
}
```

Preconditions:

- `nodeId` exists and is not root.
- `parentId` exists.
- `nodeId` is not equal to `parentId`.
- `parentId` is not a descendant of `nodeId`.

Behavior:

- Moves `nodeId` under `parentId`.
- Default behavior preserves local transform.
- With `preserveWorldTransform`, computes a new local transform so the node keeps
  its previous world matrix when possible.

No-op cases:

- Node is root.
- Node does not exist.
- Parent does not exist.
- Node equals parent.
- Parent is a descendant of node.
- Node is already under the parent.
- Preserve-world computation cannot find the node world matrix.

Validation errors:

- `SET_PARENT cannot reparent root`
- `SET_PARENT nodeId cannot equal parentId`
- `SET_PARENT nodeId does not exist`
- `SET_PARENT parentId does not exist`
- `SET_PARENT cannot create a cycle`
- Agent payload validation also rejects malformed ids.

Undo/redo behavior:

- Changing reparent commands create an undo snapshot.
- Undo restores the previous parent and local transform.
- Redo reapplies the reparent semantics.
- Rejected reparent commands do not affect history.

Visible product log behavior:

- Logged as `Set parent`.
- Detail includes node id, parent id, and `preserve world` when requested.

Future MCP exposure:

- Expose as a validated command. MCP should prefer explicit
  `preserveWorldTransform` values for clarity.

Test coverage notes:

- `packages/core/src/commands.test.ts` covers cycle blocking, same-parent no-op,
  local-transform default, and preserve-world behavior.
- `packages/core/src/commandContract.test.ts` covers leaf/subtree reparenting,
  append child order, self-parent, descendant-parent, root no-op, local
  preservation, and world preservation.
- `packages/core/src/sceneGraph.property.test.ts` covers invariant preservation
  across random reparent streams.

## ARRANGE_NODES

Purpose: apply deterministic layout positions to a set of nodes.

Payload shape:

```ts
{
  type: 'ARRANGE_NODES';
  nodeIds: string[];
  layout: 'line' | 'grid' | 'circle';
  options?: {
    spacing?: number;
    cols?: number;
    radius?: number;
    axis?: 'x' | 'y' | 'z';
  };
}
```

Preconditions:

- At least one supplied id resolves to a non-root node.
- `layout` is one of `line`, `grid`, or `circle`.
- `options`, when present, pass `CommandSchema` validation.

Behavior:

- Filters invalid IDs, duplicate IDs, and root.
- Computes deterministic positions from input order.
- Updates local positions only.
- Preserves rotation and scale.

No-op cases:

- Empty input.
- No valid non-root targets.
- Computed positions match current positions.

Validation errors:

- `ARRANGE_NODES has no valid non-root targets`
- Agent payload validation rejects unknown layouts or malformed options.

Undo/redo behavior:

- Changing arrange commands create an undo snapshot.
- Undo restores previous local positions.
- Redo reapplies the same deterministic layout.
- Rejected or unchanged arrange commands do not affect history.

Visible product log behavior:

- Logged as `Arrange (<layout>)`.
- Detail includes target count and up to four shortened node ids.

Future MCP exposure:

- Expose as a validated command for agent-authored spatial organization. MCP
  must pass explicit node id sets and deterministic options.

Test coverage notes:

- `packages/core/src/commands.test.ts` covers invalid/root-only target no-op.
- `packages/core/src/commandContract.test.ts` covers line, grid, circle,
  one-node input, empty lists, duplicate ids, invalid ids, root exclusion, and
  unchanged positions.
- `packages/core/src/editingReducer.flows.test.ts` covers reducer flow replay.

## SET_SELECTION

Purpose: update canonical scene selection.

Payload shape:

```ts
{ type: 'SET_SELECTION'; nodeId: string | null }
```

Preconditions:

- `nodeId` is `null` or references an existing node.

Behavior:

- Sets canonical `scene.selection` to a valid node id or `null`.
- Does not mutate node data.

No-op cases:

- Node ID does not exist.
- Selection is already equal to the payload.

Validation errors:

- `SET_SELECTION nodeId does not exist`
- Agent payload validation rejects malformed nullable ids.

Undo/redo behavior:

- `SET_SELECTION` participates in canonical scene snapshots.
- Undo/redo may restore selection when the store records selection snapshots.
- Missing or unchanged selection commands do not affect history.

Visible product log behavior:

- Omitted from the visible product command log by default.
- `summarizeCommand` still returns `Selection` for diagnostic, replay, and future
  tool surfaces.

Future MCP exposure:

- Expose as a validated command or dedicated selection tool that still writes
  through this command semantics.

Test coverage notes:

- `packages/core/src/commands.test.ts` covers valid selection, missing node
  no-op, unchanged no-op, and selection clearing on delete.
- `packages/core/src/commandContract.test.ts` covers select, clear, missing id,
  and unchanged selection behavior.
- `packages/core/src/editingReducer.flows.test.ts` covers selection flow and JSON
  roundtrip.
- `apps/web/src/store/sceneStore.test.ts` covers visible product log omission.

## REPLACE_SCENE

Purpose: replace the current scene with a validated scene, usually for import or
starter kit loading.

Payload shape:

```ts
{ type: 'REPLACE_SCENE'; scene: Scene }
```

Preconditions:

- Incoming `scene` passes `validateScene`.

Behavior:

- Validates the incoming scene.
- Clones the incoming scene instead of aliasing it.
- Replaces the current scene.
- Acts as a session boundary in the web product.

No-op cases:

- Incoming scene fails validation.

Validation errors:

- `REPLACE_SCENE scene failed validation`
- Agent payload validation rejects malformed scene graphs before core execution.

Undo/redo behavior:

- The web store treats this as a session boundary and clears undo and redo state.
- Rejected replacements do not affect history.

Visible product log behavior:

- Session boundary: web product clears visible command log state.
- `summarizeCommand` still returns `Replace scene` for diagnostics and tool
  surfaces.

Future MCP exposure:

- Expose through validated scene load or replace behavior. MCP must parse/migrate
  imported JSON to canonical v2 before replacement.

Test coverage notes:

- `packages/core/src/editingReducer.flows.test.ts` covers starter kit replacement.
- `packages/core/src/commandContract.test.ts` covers valid replacement, invalid
  scene rejection, and clone-not-alias behavior.
- `apps/web/src/store/sceneStore.test.ts` covers session-boundary history/log
  clearing.
- `packages/local-bridge/src/runtime.test.ts` covers canonical JSON load,
  embedded scene load, and parse errors through the bridge.

## UPDATE_LIGHT

Purpose: set or replace a node's authored light payload and promote the node to
a `light` node.

Payload shape:

```ts
{ type: 'UPDATE_LIGHT'; nodeId: string; light: SceneLight }
```

`SceneLight` is a discriminated union over `kind`:

- `ambient`: `intensity?`, `color?`
- `directional`: `intensity?`, `color?`, `castShadow?`
- `point`: `intensity?`, `color?`, `distance?`, `decay?`, `castShadow?`
- `spot`: `intensity?`, `color?`, `distance?`, `decay?`, `angle?` (radians),
  `penumbra?`, `castShadow?`

Color is a `#rrggbb`/`#rgb` hex string. Light direction for directional/spot
lights derives from the node transform, not the payload.

Preconditions:

- `nodeId` exists and is not `scene.rootId`.
- `light` is a valid `SceneLight`.

Behavior:

- Replaces `node.light` with the payload.
- Sets `node.type` to `light` (unless the node is the root, which is rejected).
- Validates the resulting scene before accepting the change.

No-op cases:

- Node does not exist or is the root.
- The node is already a `light` with an identical payload.

Validation errors:

- `UPDATE_LIGHT nodeId does not exist`
- `UPDATE_LIGHT cannot target root`
- `UPDATE_LIGHT would violate scene invariants`

## UPDATE_ENVIRONMENT

Purpose: merge a patch into the scene-level `environment` (image-based lighting).

Payload shape:

```ts
{
  type: 'UPDATE_ENVIRONMENT';
  patch: Partial<{
    hdriUri: string;
    enabled: boolean;
    showBackground: boolean;
    intensity: number;
    rotationY: number;
    backgroundColor: string;
  }>;
}
```

Behavior:

- Merges `patch` into `scene.environment`, creating it (with
  `enabled: true, showBackground: false`) when absent.
- Validates the resulting scene before accepting the change.

No-op cases:

- The merged environment equals the current environment.

Validation errors:

- `UPDATE_ENVIRONMENT would violate scene invariants`

## UPDATE_RENDER_SETTINGS

Purpose: merge a patch into the scene-level `renderSettings` (performance
tuning applied by the studio viewport and the generated R3F module's
`dioramaiCanvasProps` export).

Payload shape:

```ts
{
  type: 'UPDATE_RENDER_SETTINGS';
  patch: Partial<{
    maxPixelRatio: number; // 0.25 - 4
    shadows: boolean;
    shadowMapSize: 256 | 512 | 1024 | 2048 | 4096;
    renderOnDemand: boolean;
    antialias: boolean;
    powerPreference: 'default' | 'high-performance' | 'low-power';
  }>;
}
```

Behavior:

- Merges defined `patch` fields into `scene.renderSettings`, creating it when
  absent. Undefined fields are left untouched.
- Validates the resulting scene before accepting the change.

No-op cases:

- The merged render settings equal the current render settings.

Validation errors:

- `UPDATE_RENDER_SETTINGS would violate scene invariants`

## SET_NODE_VISIBLE

Purpose: toggle a node's `visible` flag (the outliner eye toggle).

Payload shape:

```ts
{ type: 'SET_NODE_VISIBLE'; nodeId: string; visible: boolean }
```

Behavior:

- Sets `node.visible` to the requested value.
- Validates the resulting scene before accepting the change.

No-op cases:

- Node does not exist.
- Visibility already equals the requested value.

Validation errors:

- `SET_NODE_VISIBLE nodeId does not exist`

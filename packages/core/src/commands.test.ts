import { describe, expect, it } from 'vitest';
import { validateScene } from '@dioramai/schema';
import { applyCommand, applyCommandWithResult, applyReparent, type Command } from './commands';
import { CommandSchema } from './commandSchema';
import { showroomScene } from './fixtures';
import { createEmptyScene, createNode } from './scene';
import { getWorldMatrix } from './worldTransform';

const assertValid = (scene: ReturnType<typeof createEmptyScene>) => {
  expect(validateScene(scene)).toBe(true);
};

describe('applyCommand', () => {
  it('ADD_NODE is a no-op when parent is missing', () => {
    const scene = createEmptyScene();
    const node = createNode({ id: 'n1', name: 'A' });
    const next = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: 'missing',
      node,
    });
    expect(next).toBe(scene);
  });

  it('ADD_NODE is a no-op when node id already exists', () => {
    const scene = createEmptyScene();
    const rootId = scene.rootId;
    const dup = createNode({ id: rootId, name: 'Dup' });
    const next = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: rootId,
      node: dup,
    });
    expect(next).toBe(scene);
  });

  it('DELETE_NODE does not remove root', () => {
    const scene = createEmptyScene();
    const next = applyCommand(scene, { type: 'DELETE_NODE', nodeId: scene.rootId });
    expect(next).toBe(scene);
  });

  it('UPDATE_TRANSFORM no-op for empty patch', () => {
    const scene = createEmptyScene();
    const next = applyCommand(scene, {
      type: 'UPDATE_TRANSFORM',
      nodeId: scene.rootId,
      patch: {},
    });
    expect(next).toBe(scene);
  });

  it('SET_PARENT blocks cycles (moving under own descendant)', () => {
    const scene = createEmptyScene();
    const root = scene.rootId;
    const a = createNode({ id: 'a', name: 'A' });
    const b = createNode({ id: 'b', name: 'B' });
    let s = applyCommand(scene, { type: 'ADD_NODE', parentId: root, node: a });
    s = applyCommand(s, { type: 'ADD_NODE', parentId: 'a', node: b });
    const blocked = applyCommand(s, { type: 'SET_PARENT', nodeId: 'a', parentId: 'b' });
    expect(blocked).toBe(s);
    assertValid(blocked);
  });

  it('SET_PARENT no-op when already under target parent', () => {
    const scene = createEmptyScene();
    const root = scene.rootId;
    const a = createNode({ id: 'a', name: 'A' });
    let s = applyCommand(scene, { type: 'ADD_NODE', parentId: root, node: a });
    const again = applyCommand(s, { type: 'SET_PARENT', nodeId: 'a', parentId: root });
    expect(again).toBe(s);
  });

  it('SET_PARENT preserveWorldTransform keeps world matrix (explicit flag)', () => {
    const scene = createEmptyScene();
    const root = scene.rootId;
    const parent = createNode({
      id: 'p',
      name: 'P',
      transform: { position: [3, 0, 0] },
    });
    const child = createNode({
      id: 'c',
      name: 'C',
      transform: { position: [1, 0, 0] },
    });
    let s = applyCommand(scene, { type: 'ADD_NODE', parentId: root, node: parent });
    s = applyCommand(s, { type: 'ADD_NODE', parentId: 'p', node: child });
    const worldBefore = getWorldMatrix(s, 'c');
    expect(worldBefore).not.toBeNull();
    const rep = applyCommand(s, {
      type: 'SET_PARENT',
      nodeId: 'c',
      parentId: root,
      preserveWorldTransform: true,
    });
    assertValid(rep);
    const worldAfter = getWorldMatrix(rep, 'c');
    expect(worldAfter!.elements).toEqual(worldBefore!.elements);
  });

  it('SET_PARENT without preserve changes local transform only (world may change)', () => {
    const scene = createEmptyScene();
    const root = scene.rootId;
    const parent = createNode({
      id: 'p',
      name: 'P',
      transform: { position: [3, 0, 0] },
    });
    const child = createNode({
      id: 'c',
      name: 'C',
      transform: { position: [1, 0, 0] },
    });
    let s = applyCommand(scene, { type: 'ADD_NODE', parentId: root, node: parent });
    s = applyCommand(s, { type: 'ADD_NODE', parentId: 'p', node: child });
    const worldBefore = getWorldMatrix(s, 'c');
    const rep = applyCommand(s, {
      type: 'SET_PARENT',
      nodeId: 'c',
      parentId: root,
      preserveWorldTransform: false,
    });
    const worldAfter = getWorldMatrix(rep, 'c');
    expect(worldAfter!.equals(worldBefore!)).toBe(false);
  });

  it('DUPLICATE_NODE is a no-op when idMap is invalid', () => {
    const scene = createEmptyScene();
    const root = scene.rootId;
    const a = createNode({ id: 'a', name: 'A' });
    let s = applyCommand(scene, { type: 'ADD_NODE', parentId: root, node: a });
    const bad = applyCommand(s, {
      type: 'DUPLICATE_NODE',
      nodeId: 'a',
      includeSubtree: false,
      idMap: { a: 'a' },
    });
    expect(bad).toBe(s);
  });

  it('DUPLICATE_NODE uses idMap for deterministic ids', () => {
    const scene = createEmptyScene();
    const root = scene.rootId;
    const a = createNode({ id: 'a', name: 'A' });
    let s = applyCommand(scene, { type: 'ADD_NODE', parentId: root, node: a });
    s = applyCommand(s, {
      type: 'DUPLICATE_NODE',
      nodeId: 'a',
      includeSubtree: false,
      idMap: { a: 'a-copy' },
    });
    expect(s.nodes['a-copy']).toBeDefined();
    expect(s.nodes['a-copy']?.name).toBe('A (copy)');
    assertValid(s);
  });

  it('DUPLICATE_NODE copies optional light', () => {
    let s = createEmptyScene();
    const root = s.rootId;
    const sun = createNode({
      id: 'sun',
      name: 'Sun',
      children: [],
      light: { kind: 'directional', intensity: 1.2 },
    });
    s = applyCommand(s, { type: 'ADD_NODE', parentId: root, node: sun });
    s = applyCommand(s, { type: 'DUPLICATE_NODE', nodeId: 'sun', includeSubtree: false });
    const dupId = s.nodes[root]?.children.find((c) => c !== 'sun');
    expect(dupId).toBeDefined();
    expect(s.nodes[dupId!]?.light).toEqual({ kind: 'directional', intensity: 1.2 });
    assertValid(s);
  });

  it('ARRANGE_NODES ignores unknown ids and root', () => {
    const scene = createEmptyScene();
    const next = applyCommand(scene, {
      type: 'ARRANGE_NODES',
      nodeIds: [scene.rootId, 'missing', scene.rootId],
      layout: 'line',
    });
    expect(next).toBe(scene);
  });

  it('REGISTER_ASSET adds and updates scene assets deterministically', () => {
    const scene = createEmptyScene();
    const added = applyCommand(scene, {
      type: 'REGISTER_ASSET',
      asset: {
        id: 'asset-chair-glb',
        name: 'Chair',
        kind: 'glb',
        uri: '/assets/generated/chair.glb',
        source: 'generator',
      },
    });
    const updated = applyCommand(added, {
      type: 'REGISTER_ASSET',
      asset: {
        id: 'asset-chair-glb',
        name: 'Chair Model',
        kind: 'glb',
        uri: '/assets/generated/chair-v2.glb',
        source: 'generator',
        metadata: { prompt: 'Modern chair product display' },
      },
    });

    expect(added.assets?.['asset-chair-glb']).toMatchObject({
      id: 'asset-chair-glb',
      uri: '/assets/generated/chair.glb',
    });
    expect(updated.assets?.['asset-chair-glb']).toMatchObject({
      name: 'Chair Model',
      uri: '/assets/generated/chair-v2.glb',
    });
    assertValid(updated);
  });

  it('CREATE_SEMANTIC_GROUP records a scene-level semantic group', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({ id: 'product-a', name: 'Product A' }),
    });
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({ id: 'product-b', name: 'Product B' }),
    });

    const next = applyCommand(scene, {
      type: 'CREATE_SEMANTIC_GROUP',
      group: {
        id: 'display_area',
        name: 'Display Area',
        role: 'display',
        nodeIds: ['product-a', 'product-b'],
      },
    });

    expect(next.semanticGroups?.display_area).toEqual({
      id: 'display_area',
      name: 'Display Area',
      role: 'display',
      nodeIds: ['product-a', 'product-b'],
    });
    expect(next.nodes[next.rootId]?.children).toEqual(scene.nodes[scene.rootId]?.children);
    assertValid(next);
  });

  it('SET_NODE_SEMANTICS assigns roles without changing behavior or transforms', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({
        id: 'product-a',
        name: 'Product A',
        behaviors: { hoverHighlight: true },
        transform: { position: [1, 2, 3] },
      }),
    });

    const next = applyCommand(scene, {
      type: 'SET_NODE_SEMANTICS',
      nodeIds: ['product-a', 'missing'],
      semantics: { role: 'product', label: 'Hero product', source: 'manual' },
    });

    expect(next.nodes['product-a']?.semantics).toEqual({
      role: 'product',
      label: 'Hero product',
      source: 'manual',
    });
    expect(next.nodes['product-a']?.semanticRole).toBe('product');
    expect(next.nodes['product-a']?.behaviors).toEqual({ hoverHighlight: true });
    expect(next.nodes['product-a']?.transform.position).toEqual([1, 2, 3]);
    assertValid(next);
  });

  it('ADD_BEHAVIOR merges behavior metadata deterministically', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({
        id: 'product-a',
        name: 'Product A',
        semantics: { role: 'product' },
        behaviors: { hoverHighlight: true, info: { title: 'Old' } },
      }),
    });

    const next = applyCommand(scene, {
      type: 'ADD_BEHAVIOR',
      behavior: {
        id: 'product-info',
        type: 'show_info',
        nodeIds: ['product-a'],
        params: { title: 'Product A', description: 'Details' },
      },
    });

    expect(next.behaviors?.['product-info']?.type).toBe('show_info');
    expect(next.nodes['product-a']?.behaviorRefs).toEqual(['product-info']);
    expect(next.nodes['product-a']?.behaviors).toEqual({
      hoverHighlight: true,
      info: { title: 'Product A', description: 'Details' },
    });
    assertValid(next);
  });

  it('STRUCTURE_SCENE creates semantic showroom groups and roles', () => {
    const next = applyCommand(showroomScene, { type: 'STRUCTURE_SCENE', preset: 'showroom' });

    expect(next.semanticGroups?.display_area?.nodeIds).toContain('product_01');
    expect(next.semanticGroups?.seating_area?.nodeIds).toContain('bench');
    expect(next.semanticGroups?.lighting_zone?.nodeIds).toContain('light_key');
    expect(next.semanticGroups?.environment?.nodeIds).toContain('floor');
    expect(next.nodes.product_01?.semantics?.role).toBe('product');
    expect(next.nodes.product_01?.semantics?.traits).toEqual([
      'clickable',
      'hoverable',
      'displayable',
      'focusable',
    ]);
    expect(next.nodes.display_table?.semantics?.role).toBe('display');
    expect(next.nodes.bench?.semantics?.role).toBe('seating');
    expect(next.nodes.light_key?.semantics?.role).toBe('lighting');
    expect(next.nodes.floor?.semantics?.role).toBe('environment');
    assertValid(next);
  });

  it('MAKE_INTERACTIVE adds product behavior definitions and refs', () => {
    const structured = applyCommand(showroomScene, { type: 'STRUCTURE_SCENE', preset: 'showroom' });
    const next = applyCommand(structured, { type: 'MAKE_INTERACTIVE' });

    expect(next.behaviors?.product_click_select?.type).toBe('click_select');
    expect(next.behaviors?.product_hover_highlight?.type).toBe('hover_highlight');
    expect(next.behaviors?.product_show_info?.type).toBe('show_info');
    expect(next.behaviors?.product_focus_camera?.type).toBe('focus_camera');
    expect(next.nodes.product_01?.behaviorRefs).toEqual([
      'product_click_select',
      'product_hover_highlight',
      'product_show_info',
      'product_focus_camera',
    ]);
    expect(next.nodes.product_01?.behaviors?.hoverHighlight).toBe(true);
    expect(next.nodes.product_01?.behaviors?.clickSelect).toBe(true);
    assertValid(next);
  });

  it('MAKE_INTERACTIVE maps seatable traits to focus and anchor behaviors', () => {
    const structured = applyCommand(showroomScene, { type: 'STRUCTURE_SCENE', preset: 'showroom' });
    const next = applyCommand(structured, {
      type: 'MAKE_INTERACTIVE',
      targetRole: 'seating',
    });

    expect(next.nodes.bench?.semantics?.traits).toEqual(['seatable', 'focusable']);
    expect(next.behaviors?.seating_focus_camera?.type).toBe('focus_camera');
    expect(next.behaviors?.seating_anchor_point?.type).toBe('anchor_point');
    expect(next.nodes.bench?.behaviorRefs).toEqual([
      'seating_focus_camera',
      'seating_anchor_point',
    ]);
    assertValid(next);
  });

  it('maintains hierarchy integrity and reachability after edits', () => {
    let s = createEmptyScene();
    const root = s.rootId;
    const a = createNode({ id: 'a', name: 'A' });
    const b = createNode({ id: 'b', name: 'B' });
    s = applyCommand(s, { type: 'ADD_NODE', parentId: root, node: a });
    s = applyCommand(s, { type: 'ADD_NODE', parentId: 'a', node: b });
    assertValid(s);
    s = applyCommand(s, { type: 'DELETE_NODE', nodeId: 'a' });
    assertValid(s);
    expect(s.nodes['b']).toBeUndefined();
  });

  it('clears selection when selected node is deleted', () => {
    let s = createEmptyScene();
    const root = s.rootId;
    const a = createNode({ id: 'a', name: 'A' });
    s = applyCommand(s, { type: 'ADD_NODE', parentId: root, node: a });
    s = applyCommand(s, { type: 'SET_SELECTION', nodeId: 'a' });
    expect(s.selection).toBe('a');
    s = applyCommand(s, { type: 'DELETE_NODE', nodeId: 'a' });
    expect(s.selection).toBe(null);
    assertValid(s);
  });

  it('SET_SELECTION no-op for missing node id', () => {
    const scene = createEmptyScene();
    const next = applyCommand(scene, { type: 'SET_SELECTION', nodeId: 'ghost' });
    expect(next).toBe(scene);
  });

  it('SET_SELECTION is a no-op when unchanged', () => {
    const scene = createEmptyScene();
    const withSel = applyCommand(scene, {
      type: 'SET_SELECTION',
      nodeId: scene.rootId,
    });
    const again = applyCommand(withSel, {
      type: 'SET_SELECTION',
      nodeId: scene.rootId,
    });
    expect(again).toBe(withSel);
  });
});

describe('applyReparent', () => {
  it('returns same reference when moving root', () => {
    const scene = createEmptyScene();
    expect(applyReparent(scene, scene.rootId, scene.rootId)).toBe(scene);
  });
});

describe('applyCommandWithResult', () => {
  it('keeps applyCommand scene behavior while adding deterministic result metadata', () => {
    const root = createNode({
      id: 'result-root-abcdef',
      name: 'Root',
      type: 'root',
      children: [],
    });
    const scene = {
      rootId: root.id,
      selection: null,
      nodes: { [root.id]: root },
    };
    const node = createNode({ id: 'result-node', name: 'Result node' });
    const command: Command = {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node,
    };

    const result = applyCommandWithResult(scene, command);

    expect(result.scene).toEqual(applyCommand(scene, command));
    expect(result.scene).not.toBe(scene);
    expect(result.changed).toBe(true);
    expect(result.command).toBe(command);
    expect(result.summary).toEqual({
      title: 'Add node',
      detail: 'Result node -> parent result-r... - id result-n...',
    });
    expect(result.error).toBeUndefined();
    expect(validateScene(result.scene)).toBe(true);
  });

  it('returns expected errors for invalid commands without throwing or changing references', () => {
    const scene = createEmptyScene();
    const invalidCommands: Array<[Command, string]> = [
      [
        { type: 'ADD_NODE', parentId: 'missing', node: createNode({ id: 'a' }) },
        'ADD_NODE parentId does not exist',
      ],
      [
        { type: 'DELETE_NODE', nodeId: scene.rootId },
        'DELETE_NODE cannot delete root',
      ],
      [
        { type: 'UPDATE_TRANSFORM', nodeId: 'missing', patch: { position: [1, 2, 3] } },
        'UPDATE_TRANSFORM nodeId does not exist',
      ],
      [
        { type: 'DUPLICATE_NODE', nodeId: scene.rootId, includeSubtree: false },
        'DUPLICATE_NODE cannot duplicate root',
      ],
      [
        { type: 'SET_PARENT', nodeId: scene.rootId, parentId: scene.rootId },
        'SET_PARENT cannot reparent root',
      ],
      [
        { type: 'ARRANGE_NODES', nodeIds: [scene.rootId, 'missing'], layout: 'line' },
        'ARRANGE_NODES has no valid non-root targets',
      ],
      [
        {
          type: 'SET_NODE_SEMANTICS',
          nodeIds: ['missing'],
          semantics: { role: 'product' },
        },
        'SET_NODE_SEMANTICS has no valid non-root targets',
      ],
      [
        {
          type: 'ADD_BEHAVIOR',
          behavior: { id: 'missing-hover', type: 'hover_highlight', nodeIds: ['missing'] },
        },
        'ADD_BEHAVIOR has no valid non-root targets',
      ],
      [
        { type: 'SET_SELECTION', nodeId: 'missing' },
        'SET_SELECTION nodeId does not exist',
      ],
      [
        {
          type: 'REGISTER_ASSET',
          asset: { id: 'bad-asset', name: 'Bad', kind: 'nope' },
        } as unknown as Command,
        'REGISTER_ASSET would violate scene invariants',
      ],
    ];

    for (const [command, error] of invalidCommands) {
      expect(() => applyCommandWithResult(scene, command)).not.toThrow();
      const result = applyCommandWithResult(scene, command);
      expect(result.scene).toBe(scene);
      expect(result.changed).toBe(false);
      expect(result.error).toBe(error);
      expect(result.summary.title.length).toBeGreaterThan(0);
    }
  });

  it('treats unchanged valid operations as no-ops without errors', () => {
    const scene = createEmptyScene();
    const noOps: Command[] = [
      { type: 'UPDATE_TRANSFORM', nodeId: scene.rootId, patch: {} },
      { type: 'SET_SELECTION', nodeId: null },
    ];

    const [emptyTransform, clearSelection] = noOps.map((command) =>
      applyCommandWithResult(scene, command),
    );

    expect(emptyTransform.scene).toBe(scene);
    expect(emptyTransform.changed).toBe(false);
    expect(emptyTransform.error).toBeUndefined();

    expect(clearSelection.scene).toBe(scene);
    expect(clearSelection.changed).toBe(false);
    expect(clearSelection.error).toBeUndefined();
  });

  it('warns when DUPLICATE_NODE uses generated ids but allows UI-style duplication', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({ id: 'source', name: 'Source' }),
    });

    const result = applyCommandWithResult(scene, {
      type: 'DUPLICATE_NODE',
      nodeId: 'source',
      includeSubtree: false,
    });

    expect(result.changed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warnings).toEqual(['DUPLICATE_NODE without idMap uses generated ids']);
    expect(validateScene(result.scene)).toBe(true);
  });

  it('requires deterministic idMap entries for replay-safe duplication', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({ id: 'source', name: 'Source' }),
    });

    const invalid = applyCommandWithResult(scene, {
      type: 'DUPLICATE_NODE',
      nodeId: 'source',
      includeSubtree: false,
      idMap: { source: scene.rootId },
    });
    const valid = applyCommandWithResult(scene, {
      type: 'DUPLICATE_NODE',
      nodeId: 'source',
      includeSubtree: false,
      idMap: { source: 'source-copy' },
    });

    expect(invalid.scene).toBe(scene);
    expect(invalid.changed).toBe(false);
    expect(invalid.error).toBe('DUPLICATE_NODE idMap target id already exists');
    expect(valid.changed).toBe(true);
    expect(valid.scene.nodes['source-copy']?.name).toBe('Source (copy)');
    expect(validateScene(valid.scene)).toBe(true);
  });

  it('rejects transform patches that would break scene invariants', () => {
    const scene = createEmptyScene();
    const command = {
      type: 'UPDATE_TRANSFORM',
      nodeId: scene.rootId,
      patch: { position: [Number.NaN, 0, 0] },
    } as unknown as Command;
    const result = applyCommandWithResult(scene, command);

    expect(result.scene).toBe(scene);
    expect(result.changed).toBe(false);
    expect(result.error).toBe('UPDATE_TRANSFORM would violate scene invariants');
    expect(validateScene(result.scene)).toBe(true);
  });

  it('UPDATE_LIGHT sets light payload and promotes node type to light', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({ id: 'lamp', name: 'Lamp' }),
    });

    const next = applyCommand(scene, {
      type: 'UPDATE_LIGHT',
      nodeId: 'lamp',
      light: { kind: 'spot', intensity: 2, color: '#ff0000', angle: 0.5 },
    });

    expect(next).not.toBe(scene);
    expect(next.nodes.lamp?.type).toBe('light');
    expect(next.nodes.lamp?.light).toEqual({
      kind: 'spot',
      intensity: 2,
      color: '#ff0000',
      angle: 0.5,
    });
    assertValid(next);
  });

  it('UPDATE_LIGHT is a no-op when light is unchanged', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({ id: 'lamp', name: 'Lamp', type: 'light', light: { kind: 'point' } }),
    });
    const next = applyCommand(scene, {
      type: 'UPDATE_LIGHT',
      nodeId: 'lamp',
      light: { kind: 'point' },
    });
    expect(next).toBe(scene);
  });

  it('UPDATE_LIGHT is a no-op for the root and missing nodes', () => {
    const scene = createEmptyScene();
    expect(
      applyCommand(scene, {
        type: 'UPDATE_LIGHT',
        nodeId: scene.rootId,
        light: { kind: 'ambient' },
      }),
    ).toBe(scene);
    expect(
      applyCommand(scene, {
        type: 'UPDATE_LIGHT',
        nodeId: 'missing',
        light: { kind: 'ambient' },
      }),
    ).toBe(scene);
  });

  it('UPDATE_ENVIRONMENT merges patches into scene environment', () => {
    const scene = createEmptyScene();
    const enabled = applyCommand(scene, {
      type: 'UPDATE_ENVIRONMENT',
      patch: { hdriUri: '/assets/hdri/studio.hdr', enabled: true },
    });
    expect(enabled.environment).toEqual({
      enabled: true,
      showBackground: false,
      hdriUri: '/assets/hdri/studio.hdr',
    });

    const withBackground = applyCommand(enabled, {
      type: 'UPDATE_ENVIRONMENT',
      patch: { showBackground: true },
    });
    expect(withBackground.environment?.showBackground).toBe(true);
    expect(withBackground.environment?.hdriUri).toBe('/assets/hdri/studio.hdr');

    const cleared = applyCommand(withBackground, {
      type: 'UPDATE_ENVIRONMENT',
      patch: { hdriUri: null, enabled: false, showBackground: false },
    });
    expect(cleared.environment?.hdriUri).toBeUndefined();
    expect(cleared.environment?.enabled).toBe(false);
    expect(cleared.environment?.showBackground).toBe(false);
    assertValid(withBackground);
    assertValid(cleared);
  });

  it('UPDATE_ENVIRONMENT schema accepts null as clear-hdri command state only', () => {
    expect(
      CommandSchema.safeParse({
        type: 'UPDATE_ENVIRONMENT',
        patch: { hdriUri: null, enabled: false },
      }).success,
    ).toBe(true);
    expect(
      CommandSchema.safeParse({
        type: 'UPDATE_ENVIRONMENT',
        patch: { hdriUri: '' },
      }).success,
    ).toBe(false);
  });

  it('UPDATE_ENVIRONMENT is a no-op when nothing changes', () => {
    const scene = applyCommand(createEmptyScene(), {
      type: 'UPDATE_ENVIRONMENT',
      patch: { enabled: true, showBackground: false },
    });
    const next = applyCommand(scene, {
      type: 'UPDATE_ENVIRONMENT',
      patch: { enabled: true },
    });
    expect(next).toBe(scene);
  });

  it('SET_NODE_VISIBLE toggles visibility and is a no-op when unchanged', () => {
    let scene = createEmptyScene();
    scene = applyCommand(scene, {
      type: 'ADD_NODE',
      parentId: scene.rootId,
      node: createNode({ id: 'box', name: 'Box' }),
    });
    const hidden = applyCommand(scene, {
      type: 'SET_NODE_VISIBLE',
      nodeId: 'box',
      visible: false,
    });
    expect(hidden.nodes.box?.visible).toBe(false);
    assertValid(hidden);
    expect(
      applyCommand(hidden, { type: 'SET_NODE_VISIBLE', nodeId: 'box', visible: false }),
    ).toBe(hidden);
    expect(
      applyCommand(scene, { type: 'SET_NODE_VISIBLE', nodeId: 'missing', visible: false }),
    ).toBe(scene);
  });
});

import { describe, expect, it } from 'vitest';
import { applyCommand, createNode, defaultFixtureScene, livingSpaceScene, showroomScene } from '@dioramai/core';
import type { Scene } from '@dioramai/schema';
import { exportSceneToR3fModule } from './r3f';

const moduleCode = (scene: Scene, options = {}) => exportSceneToR3fModule(scene, options).code;

describe('exportSceneToR3fModule', () => {
  it('emits a readable module for a basic scene', () => {
    const out = moduleCode(defaultFixtureScene);
    expect(out).toContain('export function DioramaiScene()');
    expect(out).toContain('function SceneMesh');
    expect(out).toContain('sourceId="default-cube-1"');
    expect(out).toMatchSnapshot();
  });

  it('emits material token comments for living space without material runtime', () => {
    const out = moduleCode(livingSpaceScene, { behaviorScaffold: 'comments' });
    expect(out).toContain('material=mat.fabric');
    expect(out).toContain('material=mat.floor');
    expect(out).not.toContain('const materials');
    expect(out).toMatchSnapshot();
  });

  it('emits semantic components and handler scaffolds for an interactive showroom', () => {
    let scene = applyCommand(showroomScene, { type: 'STRUCTURE_SCENE', preset: 'showroom' });
    scene = applyCommand(scene, { type: 'MAKE_INTERACTIVE', targetRole: 'product' });
    const result = exportSceneToR3fModule(scene, { includeStudioLights: true });
    const out = result.code;

    expect(out).toContain('function Product');
    expect(out).toContain('function DisplaySurface');
    expect(out).toContain('handleSelect');
    expect(out).toContain('handleHoverStart');
    expect(out).toContain('handleFocusCamera');
    expect(out).toContain('TODO: render info panel');
    expect(out).toContain('Semantic group: display_area');
    expect(result.diagnostics.some((d) => d.code === 'semantic_group_not_contiguous')).toBe(true);
    expect(out).toMatchSnapshot();
  });

  it('wraps contiguous semantic group members without reordering children', () => {
    const root = createNode({
      id: 'root',
      name: 'Root',
      type: 'root',
      children: ['display-a', 'display-b', 'product-c'],
    });
    const displayA = createNode({
      id: 'display-a',
      name: 'Display A',
      semantics: { role: 'display', groupId: 'display_area' },
    });
    const displayB = createNode({
      id: 'display-b',
      name: 'Display B',
      semantics: { role: 'display', groupId: 'display_area' },
    });
    const productC = createNode({
      id: 'product-c',
      name: 'Product C',
      semantics: { role: 'product' },
    });
    const scene: Scene = {
      rootId: root.id,
      selection: null,
      nodes: {
        [root.id]: root,
        [displayA.id]: displayA,
        [displayB.id]: displayB,
        [productC.id]: productC,
      },
      semanticGroups: {
        display_area: {
          id: 'display_area',
          name: 'Display Area',
          role: 'display',
          nodeIds: ['display-a', 'display-b'],
        },
      },
    };
    const out = moduleCode(scene);
    expect(out).toContain('function DisplayArea');
    expect(out.indexOf('<DisplayArea>')).toBeLessThan(out.indexOf('display-a - Display A'));
    expect(out.indexOf('display-a - Display A')).toBeLessThan(out.indexOf('display-b - Display B'));
    expect(out.indexOf('display-b - Display B')).toBeLessThan(out.indexOf('product-c - Product C'));
    expect(out).toMatchSnapshot();
  });

  it('is deterministic for identical scene and options', () => {
    let scene = applyCommand(showroomScene, { type: 'STRUCTURE_SCENE', preset: 'showroom' });
    scene = applyCommand(scene, { type: 'MAKE_INTERACTIVE', targetRole: 'product' });
    const a = moduleCode(scene, { componentName: 'ShowroomScene' });
    const b = moduleCode(scene, { componentName: 'ShowroomScene' });
    expect(a).toBe(b);
  });

  it('does not inline arbitrary URLs or editor state into behavior scaffolds', () => {
    const product = createNode({
      id: 'product',
      name: 'Product',
      semantics: { role: 'product' },
      behaviorRefs: ['open_url'],
    });
    const root = createNode({
      id: 'root',
      name: 'Root',
      type: 'root',
      children: [product.id],
    });
    const scene = {
      rootId: root.id,
      selection: product.id,
      commandLog: [{ type: 'SET_SELECTION', nodeId: product.id }],
      nodes: {
        [root.id]: root,
        [product.id]: {
          ...product,
          metadata: { sourcePath: '/Users/example/private.glb' },
          assetRef: { kind: 'uri', uri: 'file:///Users/example/private.glb' },
        },
      },
      behaviors: {
        open_url: {
          id: 'open_url',
          type: 'open_url',
          nodeIds: [product.id],
          params: { url: 'https://example.com/private' },
        },
      },
    } as Scene & { commandLog: unknown[] };
    const result = exportSceneToR3fModule(scene);
    const out = result.code;
    expect(out).toContain('TODO: open_url is scaffolded');
    expect(out).not.toContain('https://example.com/private');
    expect(out).not.toContain('/Users/');
    expect(out).not.toContain('file:///');
    expect(out).not.toContain('SET_SELECTION');
    expect(result.diagnostics.some((d) => d.code === 'unsafe_asset_uri')).toBe(true);
  });

  it('emits useGLTF scaffold for safe generated asset refs', () => {
    const product = createNode({
      id: 'product',
      name: 'Product',
      semantics: { role: 'product' },
      assetRef: { kind: 'uri', uri: '/assets/generated/chair.glb' },
    });
    const root = createNode({
      id: 'root',
      name: 'Root',
      type: 'root',
      children: [product.id],
    });
    const scene: Scene = {
      rootId: root.id,
      selection: null,
      nodes: {
        [root.id]: root,
        [product.id]: product,
      },
      assets: {
        asset_chair: {
          id: 'asset_chair',
          name: 'Chair',
          kind: 'glb',
          uri: '/assets/generated/chair.glb',
          source: 'generator',
        },
      },
    };
    const result = exportSceneToR3fModule(scene);
    expect(result.code).toContain("import { useGLTF } from '@react-three/drei';");
    expect(result.code).toContain("import { SkeletonUtils } from 'three-stdlib';");
    expect(result.code).toContain('function AssetModel');
    expect(result.code).toContain('SkeletonUtils.clone(gltf.scene)');
    expect(result.code).toContain('assetUri="/assets/generated/chair.glb"');
    expect(result.diagnostics.some((d) => d.code === 'unsafe_asset_uri')).toBe(false);
  });

  it('emits inspect-only glTF hierarchy nodes without duplicate placeholder meshes', () => {
    const gltfChild = createNode({
      id: 'gltf-child',
      name: 'Ring',
      type: 'mesh',
      metadata: {
        source: 'gltf',
        renderMode: 'gltf-inspect-only',
        gltfNodeIndex: 1,
      },
    });
    const product = createNode({
      id: 'product',
      name: 'Product',
      semantics: { role: 'product' },
      assetRef: { kind: 'uri', uri: '/assets/imports/planets.glb' },
      children: [gltfChild.id],
    });
    const root = createNode({
      id: 'root',
      name: 'Root',
      type: 'root',
      children: [product.id],
    });
    const scene: Scene = {
      rootId: root.id,
      selection: null,
      nodes: {
        [root.id]: root,
        [product.id]: product,
        [gltfChild.id]: gltfChild,
      },
      assets: {
        planets: {
          id: 'planets',
          name: 'Planets',
          kind: 'glb',
          uri: '/assets/imports/planets.glb',
          source: 'generator',
        },
      },
    };

    const out = moduleCode(scene);
    const childStart = out.indexOf('sourceId="gltf-child"');
    const childEnd = out.indexOf('/>', childStart);
    expect(childStart).toBeGreaterThan(-1);
    expect(out.slice(childStart, childEnd)).not.toContain('renderMesh');
  });
});

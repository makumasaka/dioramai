import { describe, expect, it } from 'vitest';
import { Group, Object3D } from 'three';
import { createNode, type Scene } from '@dioramai/core';
import {
  applyGltfNodeProjections,
  collectGltfNodeProjections,
  dioramaiIdForObject,
  gltfScenePathSlots,
  objectAtGltfScenePath,
  resolveProjectionObject,
  type GltfNodeProjection,
} from './gltfProjection';

const sceneWithGltfHierarchy = (): Scene => {
  const gltfChild = createNode({
    id: 'asset-android-node-gltf-1-char1',
    name: 'char1',
    type: 'mesh',
    transform: {
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [2, 2, 2],
    },
    metadata: {
      source: 'gltf',
      renderMode: 'gltf-inspect-only',
      gltfNodeIndex: 1,
      gltfPath: 'scene:0/0/0',
    },
  });
  const gltfLeaf = createNode({
    id: 'asset-android-node-gltf-2-head',
    name: 'Head',
    type: 'empty',
    transform: {
      position: [0, 4, 0],
      rotation: [0, 0.5, 0],
      scale: [1, 1, 1],
    },
    metadata: {
      source: 'gltf',
      renderMode: 'gltf-inspect-only',
      gltfNodeIndex: 2,
      gltfPath: 'scene:0/0/0/0',
    },
  });
  const asset = createNode({
    id: 'asset-android-node',
    name: 'Orange Armor Android',
    type: 'mesh',
    assetRef: { kind: 'uri', uri: '/assets/models/android.glb' },
    children: [gltfChild.id],
  });
  const root = createNode({
    id: 'root',
    name: 'Root',
    type: 'root',
    children: [asset.id],
  });
  return {
    rootId: root.id,
    selection: null,
    nodes: {
      [root.id]: root,
      [asset.id]: asset,
      [gltfChild.id]: {
        ...gltfChild,
        children: [gltfLeaf.id],
      },
      [gltfLeaf.id]: gltfLeaf,
    },
  };
};

describe('glTF hierarchy projection', () => {
  it('parses scene paths into child slots', () => {
    expect(gltfScenePathSlots('scene:0/1/2/3')).toEqual([1, 2, 3]);
    expect(gltfScenePathSlots('skin:0/1')).toBeNull();
    expect(gltfScenePathSlots('scene:0/a')).toBeNull();
  });

  it('collects inspect-only glTF nodes below an asset node', () => {
    const scene = sceneWithGltfHierarchy();

    expect(collectGltfNodeProjections(scene, 'asset-android-node')).toEqual([
      {
        nodeId: 'asset-android-node-gltf-1-char1',
        name: 'char1',
        gltfPath: 'scene:0/0/0',
        gltfNodeIndex: 1,
        visible: true,
        transform: scene.nodes['asset-android-node-gltf-1-char1']?.transform,
      },
      {
        nodeId: 'asset-android-node-gltf-2-head',
        name: 'Head',
        gltfPath: 'scene:0/0/0/0',
        gltfNodeIndex: 2,
        visible: true,
        transform: scene.nodes['asset-android-node-gltf-2-head']?.transform,
      },
    ]);
  });

  it('applies canonical node transforms to matching GLB clone objects', () => {
    const scene = sceneWithGltfHierarchy();
    const cloneRoot = new Group();
    const armature = new Object3D();
    const char1 = new Object3D();
    const head = new Object3D();
    const headMesh = new Object3D();
    cloneRoot.add(armature);
    armature.add(char1);
    char1.add(head);
    head.add(headMesh);

    applyGltfNodeProjections(
      cloneRoot,
      collectGltfNodeProjections(scene, 'asset-android-node'),
    );

    expect(objectAtGltfScenePath(cloneRoot, 'scene:0/0/0')).toBe(char1);
    expect(char1.position.toArray()).toEqual([1, 2, 3]);
    expect(char1.rotation.toArray().slice(0, 3)).toEqual([0.1, 0.2, 0.3]);
    expect(char1.scale.toArray()).toEqual([2, 2, 2]);
    expect(head.position.toArray()).toEqual([0, 4, 0]);
    expect(dioramaiIdForObject(headMesh)).toBe('asset-android-node-gltf-2-head');
  });

  it('resolves projections by node-index map even when child ordering differs', () => {
    // A loader-shaped tree where the recorded gltfPath slot resolves to a
    // DIFFERENT object than the canonical node-index association (e.g. the
    // loader injected a wrapper at children[0] and the real mesh is elsewhere).
    const cloneRoot = new Group();
    const wrapper = new Object3D();
    const realChar1 = new Object3D();
    cloneRoot.add(wrapper); // children[0] — what 'scene:0/0' walks to
    cloneRoot.add(realChar1); // children[1] — the real target by node index

    const nodeIndexMap = new Map<number, Object3D>([[1, realChar1]]);
    const projection: GltfNodeProjection = {
      nodeId: 'asset-android-node-gltf-1-char1',
      name: 'char1',
      gltfPath: 'scene:0/0',
      gltfNodeIndex: 1,
      visible: true,
      transform: { position: [5, 6, 7], rotation: [0, 0, 0], scale: [1, 1, 1] },
    };

    // Path walking resolves to the wrong object (the injected wrapper)…
    expect(objectAtGltfScenePath(cloneRoot, 'scene:0/0')).toBe(wrapper);
    expect(objectAtGltfScenePath(cloneRoot, 'scene:0/0')).not.toBe(realChar1);
    // …but index-based resolution finds the correct object.
    expect(resolveProjectionObject(cloneRoot, projection, nodeIndexMap)).toBe(realChar1);

    applyGltfNodeProjections(cloneRoot, [projection], nodeIndexMap);
    expect(realChar1.position.toArray()).toEqual([5, 6, 7]);
    expect(wrapper.position.toArray()).toEqual([0, 0, 0]);
    expect(dioramaiIdForObject(realChar1)).toBe('asset-android-node-gltf-1-char1');
  });

  it('falls back to path resolution when no index map is supplied', () => {
    const cloneRoot = new Group();
    const child = new Object3D();
    cloneRoot.add(child);
    const projection: GltfNodeProjection = {
      nodeId: 'asset-x-gltf-0-mesh',
      name: 'mesh',
      gltfPath: 'scene:0/0',
      gltfNodeIndex: 0,
      visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    };
    expect(resolveProjectionObject(cloneRoot, projection)).toBe(child);
  });
});

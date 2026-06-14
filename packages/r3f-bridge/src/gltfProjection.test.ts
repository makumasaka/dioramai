import { describe, expect, it } from 'vitest';
import { Group, Object3D } from 'three';
import { createNode, type Scene } from '@dioramai/core';
import {
  applyGltfNodeProjections,
  collectGltfNodeProjections,
  dioramaiIdForObject,
  gltfScenePathSlots,
  objectAtGltfScenePath,
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
        visible: true,
        transform: scene.nodes['asset-android-node-gltf-1-char1']?.transform,
      },
      {
        nodeId: 'asset-android-node-gltf-2-head',
        name: 'Head',
        gltfPath: 'scene:0/0/0/0',
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
});

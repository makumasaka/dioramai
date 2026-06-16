import { describe, expect, it } from 'vitest';
import { Group, Object3D } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { buildGltfNodeIndexMap, type GltfLike } from './gltfObjectBinding';

const namedObject = (name: string): Object3D => {
  const object = new Object3D();
  object.name = name;
  return object;
};

describe('buildGltfNodeIndexMap', () => {
  it('maps glTF node indices onto cloned objects via parallel traversal', () => {
    const scene = new Group();
    const root = namedObject('RootNode');
    const box = namedObject('Box');
    const lid = namedObject('Lid');
    scene.add(root);
    root.add(box);
    root.add(lid);

    // Loader associations key the ORIGINAL objects to their glTF node index.
    const associations = new Map<object, { nodes?: number }>([
      [root, { nodes: 0 }],
      [box, { nodes: 1 }],
      [lid, { nodes: 2 }],
    ]);
    const gltf = { scene, parser: { associations } } as unknown as GltfLike;

    const clone = SkeletonUtils.clone(scene);
    const map = buildGltfNodeIndexMap(gltf, clone);

    // Indices resolve to CLONED objects (not the originals), preserving names.
    expect(map.get(0)?.name).toBe('RootNode');
    expect(map.get(1)?.name).toBe('Box');
    expect(map.get(2)?.name).toBe('Lid');
    expect(map.get(1)).not.toBe(box);
    // The clone's Box should be a descendant of the clone, not the original tree.
    expect(clone.getObjectByName('Box')).toBe(map.get(1));
  });

  it('returns an empty map when the loader exposes no associations', () => {
    const scene = new Group();
    scene.add(namedObject('A'));
    const gltf = { scene, parser: {} } as unknown as GltfLike;
    expect(buildGltfNodeIndexMap(gltf, SkeletonUtils.clone(scene)).size).toBe(0);
  });
});

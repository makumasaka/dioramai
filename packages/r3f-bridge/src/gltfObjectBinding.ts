import type { Object3D } from 'three';

/**
 * Minimal shape of the glTF result we rely on for stable node binding.
 * `parser.associations` is the canonical map the loader maintains from each
 * loaded `Object3D` back to its source glTF node index.
 */
export type GltfAssociation = { nodes?: number };

export type GltfLike = {
  scene: Object3D;
  parser?: {
    associations?: Map<object, GltfAssociation | undefined>;
  };
};

const nodeIndexFromAssociation = (
  association: GltfAssociation | undefined,
): number | undefined =>
  typeof association?.nodes === 'number' ? association.nodes : undefined;

const flattenPreorder = (root: Object3D): Object3D[] => {
  const out: Object3D[] = [];
  root.traverse((object) => out.push(object));
  return out;
};

/**
 * Build a robust `glTF node index -> cloned Object3D` map.
 *
 * The loader's `associations` map keys the ORIGINAL objects in `gltf.scene`.
 * Because we render a `SkeletonUtils.clone(gltf.scene)` (so multiple instances
 * and gizmo edits never mutate the cached loader scene), we re-map those
 * associations onto the clone via a structurally parallel pre-order traversal.
 * `SkeletonUtils.clone` preserves child order and count, so traversal index N
 * in the original corresponds to traversal index N in the clone.
 *
 * This replaces fragile `children[slot]` index-path walking, which drifts
 * whenever the loader inserts wrapper groups or splits multi-primitive meshes.
 */
export const buildGltfNodeIndexMap = (
  gltf: GltfLike,
  clonedScene: Object3D,
): Map<number, Object3D> => {
  const map = new Map<number, Object3D>();
  const associations = gltf.parser?.associations;
  if (!associations || associations.size === 0) return map;

  const originals = flattenPreorder(gltf.scene);
  const clones = flattenPreorder(clonedScene);
  const count = Math.min(originals.length, clones.length);

  for (let i = 0; i < count; i += 1) {
    const original = originals[i];
    const clone = clones[i];
    if (original === undefined || clone === undefined) continue;
    const nodeIndex = nodeIndexFromAssociation(associations.get(original));
    if (nodeIndex === undefined || map.has(nodeIndex)) continue;
    map.set(nodeIndex, clone);
  }

  return map;
};

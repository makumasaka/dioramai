import type { Object3D } from 'three';
import type { Scene, SceneNode, Transform } from '@dioramai/core';

export type GltfNodeProjection = {
  nodeId: string;
  name: string;
  gltfPath: string;
  visible: boolean;
  transform: Transform;
};

const isObject3DLike = (value: unknown): value is Object3D =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { children?: unknown }).children) &&
  typeof (value as { traverse?: unknown }).traverse === 'function';

const isGltfInspectNode = (node: SceneNode): boolean =>
  node.metadata.renderMode === 'gltf-inspect-only' &&
  node.metadata.source === 'gltf' &&
  typeof node.metadata.gltfPath === 'string' &&
  typeof node.metadata.gltfNodeIndex === 'number';

export const collectGltfNodeProjections = (
  scene: Scene,
  assetNodeId: string,
): GltfNodeProjection[] => {
  const out: GltfNodeProjection[] = [];

  const visit = (nodeId: string): void => {
    const node = scene.nodes[nodeId];
    if (!node) return;
    if (isGltfInspectNode(node)) {
      out.push({
        nodeId: node.id,
        name: node.name,
        gltfPath: node.metadata.gltfPath as string,
        visible: node.visible !== false,
        transform: node.transform,
      });
    }
    node.children.forEach(visit);
  };

  scene.nodes[assetNodeId]?.children.forEach(visit);
  return out;
};

export const gltfScenePathSlots = (gltfPath: string): number[] | null => {
  const match = /^scene:\d+\/(.+)$/.exec(gltfPath);
  if (!match) return null;
  const slots = match[1]
    .split('/')
    .map((part) => Number(part));
  if (!slots.every((slot) => Number.isInteger(slot) && slot >= 0)) return null;
  return slots;
};

export const objectAtGltfScenePath = (
  root: Object3D,
  gltfPath: string,
): Object3D | null => {
  if (!isObject3DLike(root)) return null;
  const slots = gltfScenePathSlots(gltfPath);
  if (slots === null) return null;
  let current: Object3D = root;
  for (const slot of slots) {
    const next = current.children[slot];
    if (!isObject3DLike(next)) return null;
    current = next;
  }
  return current;
};

const applyTransform = (object: Object3D, transform: Transform): void => {
  object.position.set(
    transform.position[0],
    transform.position[1],
    transform.position[2],
  );
  object.rotation.set(
    transform.rotation[0],
    transform.rotation[1],
    transform.rotation[2],
  );
  object.scale.set(
    transform.scale[0],
    transform.scale[1],
    transform.scale[2],
  );
};

const depthOfPath = (projection: GltfNodeProjection): number =>
  gltfScenePathSlots(projection.gltfPath)?.length ?? 0;

export const applyGltfNodeProjections = (
  root: Object3D,
  projections: readonly GltfNodeProjection[],
): void => {
  if (!isObject3DLike(root)) return;

  const ordered = [...projections].sort((a, b) => depthOfPath(a) - depthOfPath(b));
  for (const projection of ordered) {
    const target = objectAtGltfScenePath(root, projection.gltfPath);
    if (!target) continue;
    applyTransform(target, projection.transform);
    target.visible = projection.visible;
    target.name = target.name || projection.name;
    target.traverse((object) => {
      object.userData = {
        ...object.userData,
        dioramaiId: projection.nodeId,
        sourceId: projection.nodeId,
      };
    });
  }
};

export const dioramaiIdForObject = (object: Object3D | null | undefined): string | undefined => {
  let current: Object3D | null | undefined = object;
  while (current) {
    const id = current.userData?.dioramaiId;
    if (typeof id === 'string' && id.length > 0) return id;
    current = current.parent;
  }
  return undefined;
};

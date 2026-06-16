import type { Scene, SceneLight, SceneNode, Transform } from '@dioramai/schema';

export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

/** Generates a new unique node id (used by createNode and duplicate). */
export const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `n_${Math.random().toString(36).slice(2, 10)}`;
};

export interface CreateNodeInput {
  id?: string;
  name?: string;
  type?: SceneNode['type'];
  transform?: Partial<Transform>;
  children?: string[];
  visible?: boolean;
  assetRef?: SceneNode['assetRef'];
  materialRef?: SceneNode['materialRef'];
  light?: SceneNode['light'];
  metadata?: SceneNode['metadata'];
  semantics?: SceneNode['semantics'];
  behaviorRefs?: SceneNode['behaviorRefs'];
  locked?: SceneNode['locked'];
  semanticRole?: SceneNode['semanticRole'];
  semanticGroupId?: SceneNode['semanticGroupId'];
  behaviors?: SceneNode['behaviors'];
}

export const createNode = (input: CreateNodeInput = {}): SceneNode => {
  const base = identityTransform();
  const children = input.children ?? [];
  const node: SceneNode = {
    id: input.id ?? createId(),
    name: input.name ?? 'Node',
    type: input.type ?? 'mesh',
    children,
    transform: {
      position: input.transform?.position ?? base.position,
      rotation: input.transform?.rotation ?? base.rotation,
      scale: input.transform?.scale ?? base.scale,
    },
    visible: input.visible ?? true,
    metadata: input.metadata ?? {},
  };
  if (input.assetRef !== undefined) node.assetRef = input.assetRef;
  if (input.materialRef !== undefined) node.materialRef = input.materialRef;
  if (input.light !== undefined) node.light = input.light;
  if (input.semantics !== undefined) node.semantics = input.semantics;
  if (input.behaviorRefs !== undefined) node.behaviorRefs = input.behaviorRefs;
  if (input.locked !== undefined) node.locked = input.locked;
  if (input.semanticRole !== undefined) node.semanticRole = input.semanticRole;
  if (input.semanticGroupId !== undefined) node.semanticGroupId = input.semanticGroupId;
  if (input.behaviors !== undefined) node.behaviors = input.behaviors;
  return node;
};

type LightKind = SceneLight['kind'];

const DEFAULT_LIGHT_NAME: Record<LightKind, string> = {
  ambient: 'Ambient Light',
  directional: 'Directional Light',
  point: 'Point Light',
  spot: 'Spot Light',
};

/** Sensible per-kind defaults, modeled on three.js light defaults. */
const defaultLightForKind = (kind: LightKind): SceneLight => {
  switch (kind) {
    case 'ambient':
      return { kind: 'ambient', intensity: 0.4, color: '#ffffff' };
    case 'directional':
      return { kind: 'directional', intensity: 1, color: '#ffffff' };
    case 'point':
      return { kind: 'point', intensity: 1, color: '#ffffff', distance: 0, decay: 2 };
    case 'spot':
      return {
        kind: 'spot',
        intensity: 1,
        color: '#ffffff',
        distance: 0,
        decay: 2,
        angle: Math.PI / 6,
        penumbra: 0,
      };
  }
};

/**
 * Builds a `type:'light'` scene node with sensible defaults for the given kind.
 * Directional/spot lights default to a downward-ish position so direction is
 * visually meaningful in the editor.
 */
export const createLightNode = (
  kind: LightKind,
  input: Omit<CreateNodeInput, 'type' | 'light'> & { light?: Partial<SceneLight> } = {},
): SceneNode => {
  const baseLight = defaultLightForKind(kind);
  const light = (input.light ? { ...baseLight, ...input.light, kind } : baseLight) as SceneLight;
  const positionedDefault: Partial<Transform> =
    kind === 'directional' || kind === 'spot'
      ? { position: [2, 4, 2] }
      : kind === 'point'
        ? { position: [0, 3, 0] }
        : {};
  const { light: _ignored, ...rest } = input;
  return createNode({
    name: DEFAULT_LIGHT_NAME[kind],
    ...rest,
    type: 'light',
    transform: { ...positionedDefault, ...input.transform },
    light,
  });
};

export const createEmptyScene = (rootName = 'Root'): Scene => {
  const root = createNode({ name: rootName, type: 'root' });
  return {
    rootId: root.id,
    selection: null,
    nodes: { [root.id]: root },
  };
};

/** Path from root to `nodeId` (inclusive). Empty if `nodeId` is missing. */
export const getAncestorPath = (scene: Scene, nodeId: string): string[] => {
  if (!scene.nodes[nodeId]) return [];
  const up: string[] = [];
  let cur: string | null = nodeId;
  while (cur) {
    up.push(cur);
    if (cur === scene.rootId) break;
    const p = getParent(scene, cur);
    cur = p?.id ?? null;
  }
  return up.reverse();
};

export const getNode = (scene: Scene, id: string): SceneNode | undefined =>
  scene.nodes[id];

export const getChildren = (scene: Scene, id: string): SceneNode[] => {
  const node = scene.nodes[id];
  if (!node) return [];
  return node.children
    .map((childId) => scene.nodes[childId])
    .filter((n): n is SceneNode => Boolean(n));
};

export const getParent = (scene: Scene, id: string): SceneNode | undefined => {
  if (id === scene.rootId) return undefined;
  for (const candidate of Object.values(scene.nodes)) {
    if (candidate.children.includes(id)) return candidate;
  }
  return undefined;
};

export const isDescendant = (
  scene: Scene,
  ancestorId: string,
  candidateId: string,
): boolean => {
  if (ancestorId === candidateId) return true;
  const ancestor = scene.nodes[ancestorId];
  if (!ancestor) return false;
  const stack = [...ancestor.children];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === candidateId) return true;
    const n = scene.nodes[id];
    if (n) stack.push(...n.children);
  }
  return false;
};

export const collectSubtreeIds = (scene: Scene, rootId: string): string[] => {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const node = scene.nodes[id];
    if (!node) continue;
    out.push(id);
    stack.push(...node.children);
  }
  return out;
};

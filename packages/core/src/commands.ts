import {
  cloneSceneFromJson,
  validateScene,
  type BehaviorDefinition,
  type DioramaiAsset,
  type InteractionBehavior,
  type NodeSemantics,
  type Scene,
  type SceneEnvironment,
  type SceneLight,
  type SceneNode,
  type SemanticGroup,
  type SemanticRole,
  type Trait,
} from '@dioramai/schema';
import { summarizeCommand, type CommandSummary } from './commandLog';
import { duplicateNodeInScene } from './duplicate';
import { computeArrangement, type ArrangeLayout, type ArrangeOptions } from './layout';
import { collectSubtreeIds, getParent, isDescendant } from './scene';
import {
  isEmptyPatch,
  mergeTransform,
  transformEqual,
  vec3Equal,
  type TransformPatch,
} from './transform';
import { getWorldMatrix, matrixToTransform } from './worldTransform';

export type Command =
  | { type: 'ADD_NODE'; parentId: string; node: SceneNode }
  | { type: 'DELETE_NODE'; nodeId: string }
  | { type: 'UPDATE_TRANSFORM'; nodeId: string; patch: TransformPatch }
  | { type: 'STRUCTURE_SCENE'; preset: 'showroom' }
  | { type: 'MAKE_INTERACTIVE'; targetRole?: SemanticRole }
  | {
      type: 'CREATE_SEMANTIC_GROUP';
      group: SemanticGroup;
    }
  | {
      type: 'ASSIGN_TO_SEMANTIC_GROUP';
      groupId: string;
      nodeIds: string[];
    }
  | {
      type: 'SET_NODE_SEMANTICS';
      nodeIds: string[];
      semantics: Partial<NodeSemantics>;
    }
  | {
      type: 'ADD_BEHAVIOR';
      behavior: BehaviorDefinition;
    }
  | { type: 'REMOVE_BEHAVIOR'; behaviorId: string }
  | {
      type: 'DUPLICATE_NODE';
      nodeId: string;
      includeSubtree: boolean;
      newParentId?: string;
      /** Deterministic ids for duplicated subtrees; must map every duplicated node to a fresh id. */
      idMap?: Record<string, string>;
    }
  | {
      type: 'SET_PARENT';
      nodeId: string;
      parentId: string;
      /** When true, adjusts local TRS so the world matrix matches the state before reparenting. */
      preserveWorldTransform?: boolean;
    }
  | {
      type: 'ARRANGE_NODES';
      nodeIds: string[];
      layout: ArrangeLayout;
      options?: ArrangeOptions;
    }
  | {
      type: 'REGISTER_ASSET';
      asset: DioramaiAsset;
    }
  | { type: 'REPLACE_SCENE'; scene: Scene }
  | { type: 'SET_SELECTION'; nodeId: string | null }
  | { type: 'UPDATE_LIGHT'; nodeId: string; light: SceneLight }
  | { type: 'UPDATE_ENVIRONMENT'; patch: Partial<SceneEnvironment> }
  | { type: 'SET_NODE_VISIBLE'; nodeId: string; visible: boolean };

const addChild = (node: SceneNode, childId: string): SceneNode => ({
  ...node,
  children: [...node.children, childId],
});

const removeChild = (node: SceneNode, childId: string): SceneNode => ({
  ...node,
  children: node.children.filter((id) => id !== childId),
});

const validNonRootIds = (scene: Scene, nodeIds: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of nodeIds) {
    if (!id || id === scene.rootId || !scene.nodes[id] || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const applyAddNode = (
  scene: Scene,
  parentId: string,
  node: SceneNode,
): Scene => {
  const parent = scene.nodes[parentId];
  if (!parent) return scene;
  if (scene.nodes[node.id]) return scene;

  const nextScene: Scene = {
    ...scene,
    nodes: {
      ...scene.nodes,
      [parentId]: addChild(parent, node.id),
      [node.id]: node,
    },
  };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

const applyDeleteNode = (scene: Scene, nodeId: string): Scene => {
  if (nodeId === scene.rootId) return scene;
  const node = scene.nodes[nodeId];
  if (!node) return scene;

  const parent = getParent(scene, nodeId);
  const idsToRemove = new Set(collectSubtreeIds(scene, nodeId));

  const nextNodes: Record<string, SceneNode> = {};
  for (const [id, n] of Object.entries(scene.nodes)) {
    if (idsToRemove.has(id)) continue;
    nextNodes[id] = n;
  }

  if (parent && nextNodes[parent.id]) {
    nextNodes[parent.id] = removeChild(nextNodes[parent.id], nodeId);
  }

  let nextSelection = scene.selection;
  if (nextSelection !== null && idsToRemove.has(nextSelection)) {
    nextSelection = null;
  }

  const semanticGroups =
    scene.semanticGroups === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(scene.semanticGroups).map(([id, group]) => [
            id,
            {
              ...group,
              nodeIds: group.nodeIds.filter((targetId) => !idsToRemove.has(targetId)),
            },
          ]),
        );
  const behaviors =
    scene.behaviors === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(scene.behaviors).map(([id, behavior]) => [
            id,
            {
              ...behavior,
              nodeIds: behavior.nodeIds.filter((targetId) => !idsToRemove.has(targetId)),
            },
          ]),
        );

  const nextScene = {
    ...scene,
    nodes: nextNodes,
    selection: nextSelection,
    ...(semanticGroups !== undefined ? { semanticGroups } : {}),
    ...(behaviors !== undefined ? { behaviors } : {}),
  };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

/** Reparents `nodeId` under `newParentId` without changing local transform. */
export const applyReparent = (
  scene: Scene,
  nodeId: string,
  newParentId: string,
): Scene => {
  if (nodeId === scene.rootId) return scene;
  if (nodeId === newParentId) return scene;

  const node = scene.nodes[nodeId];
  const newParent = scene.nodes[newParentId];
  if (!node || !newParent) return scene;

  if (isDescendant(scene, nodeId, newParentId)) return scene;

  const currentParent = getParent(scene, nodeId);
  if (currentParent && currentParent.id === newParentId) return scene;

  const nextNodes: Record<string, SceneNode> = { ...scene.nodes };
  if (currentParent) {
    nextNodes[currentParent.id] = removeChild(
      nextNodes[currentParent.id],
      nodeId,
    );
  }
  nextNodes[newParentId] = addChild(nextNodes[newParentId], nodeId);

  return { ...scene, nodes: nextNodes };
};

const applySetParent = (scene: Scene, command: Extract<Command, { type: 'SET_PARENT' }>): Scene => {
  const { nodeId, parentId, preserveWorldTransform } = command;
  if (!preserveWorldTransform) {
    return applyReparent(scene, nodeId, parentId);
  }

  const worldBefore = getWorldMatrix(scene, nodeId);
  if (!worldBefore) return scene;

  const reparented = applyReparent(scene, nodeId, parentId);
  if (reparented === scene) return scene;

  const parentWorld = getWorldMatrix(reparented, parentId);
  if (!parentWorld) return reparented;

  const inv = parentWorld.clone().invert();
  const localMat = inv.multiply(worldBefore);
  const nextTransform = matrixToTransform(localMat);
  const n = reparented.nodes[nodeId];
  if (!n) return reparented;
  if (transformEqual(n.transform, nextTransform)) return reparented;

  return {
    ...reparented,
    nodes: {
      ...reparented.nodes,
      [nodeId]: { ...n, transform: nextTransform },
    },
  };
};

const applyUpdateTransform = (
  scene: Scene,
  nodeId: string,
  patch: TransformPatch,
): Scene => {
  const node = scene.nodes[nodeId];
  if (!node) return scene;
  if (isEmptyPatch(patch)) return scene;

  const nextTransform = mergeTransform(node.transform, patch);
  if (transformEqual(node.transform, nextTransform)) return scene;

  const nextNode: SceneNode = { ...node, transform: nextTransform };
  const nextScene: Scene = {
    ...scene,
    nodes: { ...scene.nodes, [nodeId]: nextNode },
  };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

const applyCreateSemanticGroup = (
  scene: Scene,
  group: SemanticGroup,
): Scene => {
  const validNodeIds = validNonRootIds(scene, group.nodeIds);
  const nextGroup: SemanticGroup = {
    ...group,
    nodeIds: validNodeIds,
    ...(group.tags !== undefined ? { tags: [...group.tags] } : {}),
    ...(group.metadata !== undefined ? { metadata: { ...group.metadata } } : {}),
  };
  const nextScene: Scene = {
    ...scene,
    semanticGroups: {
      ...(scene.semanticGroups ?? {}),
      [group.id]: nextGroup,
    },
  };
  if (!validateScene(nextScene)) return scene;
  if (JSON.stringify(scene.semanticGroups?.[group.id]) === JSON.stringify(nextGroup)) {
    return scene;
  }
  return nextScene;
};

const mergeNodeSemantics = (
  current: NodeSemantics | undefined,
  incoming: Partial<NodeSemantics>,
): NodeSemantics => ({
  ...(current ?? {}),
  ...incoming,
  ...(incoming.traits !== undefined ? { traits: [...incoming.traits] } : {}),
  ...(incoming.tags !== undefined ? { tags: [...incoming.tags] } : {}),
});

const applySetNodeSemantics = (
  scene: Scene,
  nodeIds: string[],
  semantics: Partial<NodeSemantics>,
): Scene => {
  const targets = validNonRootIds(scene, nodeIds);
  if (targets.length === 0) return scene;

  let nextNodes: Record<string, SceneNode> | null = null;
  for (const id of targets) {
    const node = (nextNodes ?? scene.nodes)[id];
    if (!node) continue;
    const nextSemantics = mergeNodeSemantics(node.semantics, semantics);
    if (JSON.stringify(node.semantics ?? {}) === JSON.stringify(nextSemantics)) continue;
    if (!nextNodes) nextNodes = { ...scene.nodes };
    nextNodes[id] = {
      ...node,
      semantics: nextSemantics,
      ...(nextSemantics.role !== undefined ? { semanticRole: nextSemantics.role } : {}),
      ...(nextSemantics.groupId !== undefined ? { semanticGroupId: nextSemantics.groupId } : {}),
    };
  }

  if (!nextNodes) return scene;
  const nextScene = { ...scene, nodes: nextNodes };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

const applyAssignToSemanticGroup = (
  scene: Scene,
  groupId: string,
  nodeIds: string[],
): Scene => {
  const group = scene.semanticGroups?.[groupId];
  if (!group) return scene;
  const targets = validNonRootIds(scene, nodeIds);
  if (targets.length === 0) return scene;
  const mergedNodeIds = Array.from(new Set([...group.nodeIds, ...targets]));
  let next = applyCreateSemanticGroup(scene, { ...group, nodeIds: mergedNodeIds });
  next = applySetNodeSemantics(next, targets, {
    groupId,
    role: group.role,
    source: 'rule',
  });
  return next;
};

const mergeBehavior = (
  current: InteractionBehavior | undefined,
  incoming: InteractionBehavior,
): InteractionBehavior => {
  const merged: InteractionBehavior = {
    ...(current ?? {}),
    ...incoming,
  };
  if (current?.info !== undefined && incoming.info !== undefined) {
    merged.info = { ...current.info, ...incoming.info };
  } else if (incoming.info !== undefined) {
    merged.info = incoming.info;
  } else if (current?.info !== undefined) {
    merged.info = current.info;
  }
  return merged;
};

const behaviorEqual = (
  a: InteractionBehavior | undefined,
  b: InteractionBehavior | undefined,
): boolean => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

const behaviorToLegacy = (behavior: BehaviorDefinition): InteractionBehavior => {
  const params = behavior.params ?? {};
  switch (behavior.type) {
    case 'hover_highlight':
      return { hoverHighlight: true };
    case 'click_select':
      return { clickSelect: true };
    case 'focus_camera':
      return { focusOnClick: true };
    case 'anchor_point':
      return {};
    case 'show_info':
      return {
        info: {
          title: typeof params.title === 'string' ? params.title : behavior.label ?? behavior.id,
          ...(typeof params.description === 'string'
            ? { description: params.description }
            : behavior.description
              ? { description: behavior.description }
              : {}),
        },
      };
    default:
      return {};
  }
};

const applyAddBehaviorDefinition = (
  scene: Scene,
  behavior: BehaviorDefinition,
): Scene => {
  const targets = validNonRootIds(scene, behavior.nodeIds);
  if (targets.length === 0) return scene;

  let nextNodes: Record<string, SceneNode> | null = null;
  const legacy = behaviorToLegacy(behavior);
  for (const id of targets) {
    const node = (nextNodes ?? scene.nodes)[id];
    if (!node) continue;
    const behaviorRefs = node.behaviorRefs?.includes(behavior.id)
      ? node.behaviorRefs
      : [...(node.behaviorRefs ?? []), behavior.id];
    const behaviors = mergeBehavior(node.behaviors, legacy);
    if (node.behaviorRefs === behaviorRefs && behaviorEqual(node.behaviors, behaviors)) continue;
    if (!nextNodes) nextNodes = { ...scene.nodes };
    nextNodes[id] = { ...node, behaviorRefs, behaviors };
  }

  const nextBehavior: BehaviorDefinition = { ...behavior, nodeIds: targets };
  const nextScene: Scene = {
    ...scene,
    nodes: nextNodes ?? scene.nodes,
    behaviors: {
      ...(scene.behaviors ?? {}),
      [behavior.id]: nextBehavior,
    },
  };
  if (!validateScene(nextScene)) return scene;
  if (!nextNodes && JSON.stringify(scene.behaviors?.[behavior.id]) === JSON.stringify(nextBehavior)) {
    return scene;
  }
  return nextScene;
};

const applyRemoveBehavior = (scene: Scene, behaviorId: string): Scene => {
  if (!scene.behaviors?.[behaviorId]) return scene;
  const nextBehaviors = { ...scene.behaviors };
  delete nextBehaviors[behaviorId];
  const nextNodes = Object.fromEntries(
    Object.entries(scene.nodes).map(([id, node]) => [
      id,
      node.behaviorRefs?.includes(behaviorId)
        ? {
            ...node,
            behaviorRefs: node.behaviorRefs.filter((ref) => ref !== behaviorId),
          }
        : node,
    ]),
  );
  const nextScene: Scene = {
    ...scene,
    nodes: nextNodes,
    behaviors: Object.keys(nextBehaviors).length > 0 ? nextBehaviors : undefined,
  };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

const showroomGroupSpecs = [
  {
    groupId: 'display_area',
    name: 'Display Area',
    role: 'display' as SemanticRole,
    match: (node: SceneNode) => {
      const s = `${node.id} ${node.name}`.toLowerCase();
      return s.includes('product') || s.includes('display') || s.includes('plinth') || s.includes('table');
    },
  },
  {
    groupId: 'seating_area',
    name: 'Seating Area',
    role: 'seating' as SemanticRole,
    match: (node: SceneNode) => {
      const s = `${node.id} ${node.name}`.toLowerCase();
      return s.includes('bench') || s.includes('chair') || s.includes('seat');
    },
  },
  {
    groupId: 'lighting_zone',
    name: 'Lighting Zone',
    role: 'lighting' as SemanticRole,
    match: (node: SceneNode) => {
      const s = `${node.id} ${node.name}`.toLowerCase();
      return node.type === 'light' || node.light !== undefined || s.includes('light');
    },
  },
  {
    groupId: 'environment',
    name: 'Environment',
    role: 'environment' as SemanticRole,
    match: (node: SceneNode) => {
      const s = `${node.id} ${node.name}`.toLowerCase();
      return s.includes('wall') || s.includes('floor') || s.includes('backdrop') || s.includes('environment');
    },
  },
] as const;

const traitsForRole = (role: SemanticRole): Trait[] => {
  switch (role) {
    case 'product':
      return ['clickable', 'hoverable', 'displayable', 'focusable'];
    case 'display':
      return ['displayable'];
    case 'seating':
      return ['seatable', 'focusable'];
    case 'navigation':
      return ['navigable', 'clickable'];
    default:
      return [];
  }
};

const semanticRoleForNode = (node: SceneNode, groupRole: SemanticRole): SemanticRole => {
  const s = `${node.id} ${node.name}`.toLowerCase();
  if (s.includes('product')) return 'product';
  if (s.includes('display') || s.includes('plinth') || s.includes('table')) return 'display';
  if (s.includes('bench') || s.includes('chair') || s.includes('seat')) return 'seating';
  if (node.type === 'light' || node.light !== undefined || s.includes('light') || s.includes('lamp')) return 'lighting';
  if (s.includes('wall') || s.includes('floor') || s.includes('backdrop')) return 'environment';
  return groupRole === 'container' ? 'unknown' : groupRole;
};

const applyStructureShowroomScene = (scene: Scene): Scene => {
  let next = scene;
  for (const spec of showroomGroupSpecs) {
    const nodeIds = Object.values(next.nodes)
      .filter((node) => node.id !== next.rootId && spec.match(node))
      .map((node) => node.id);
    if (nodeIds.length === 0) continue;

    next = applyCreateSemanticGroup(next, {
      id: spec.groupId,
      name: spec.name,
      role: spec.role,
      nodeIds,
    });

    const groupedIds = nodeIds.filter((id) => next.nodes[id]);
    const nodesByRole = groupedIds.reduce<Record<SemanticRole, string[]>>(
      (acc, id) => {
        const node = next.nodes[id];
        if (!node) return acc;
        const role = semanticRoleForNode(node, spec.role);
        acc[role].push(id);
        return acc;
      },
      {
        product: [],
        display: [],
        seating: [],
        lighting: [],
        light: [],
        environment: [],
        navigation: [],
        decor: [],
        container: [],
        unknown: [],
      },
    );

    for (const [role, ids] of Object.entries(nodesByRole) as Array<[SemanticRole, string[]]>) {
      if (ids.length > 0) {
        next = applySetNodeSemantics(next, ids, {
          role,
          groupId: spec.groupId,
          traits: traitsForRole(role),
          source: 'rule',
        });
      }
    }
  }
  return next;
};

const roleOf = (node: SceneNode): SemanticRole | undefined =>
  node.semantics?.role ?? node.semanticRole;

const behaviorTypesForTraits = (traits: Trait[]): BehaviorDefinition['type'][] => {
  const out: BehaviorDefinition['type'][] = [];
  const add = (type: BehaviorDefinition['type']) => {
    if (!out.includes(type)) out.push(type);
  };
  for (const trait of traits) {
    switch (trait) {
      case 'seatable':
        add('focus_camera');
        add('anchor_point');
        break;
      case 'clickable':
        add('click_select');
        break;
      case 'focusable':
        add('focus_camera');
        break;
      case 'hoverable':
        add('hover_highlight');
        break;
      case 'displayable':
        add('show_info');
        break;
      case 'navigable':
        add('focus_camera');
        break;
      default: {
        const _exhaustive: never = trait;
        return _exhaustive;
      }
    }
  }
  return out;
};

const behaviorLabel = (type: BehaviorDefinition['type']): string =>
  type
    .split('_')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');

const applyMakeInteractive = (
  scene: Scene,
  targetRole: SemanticRole = 'product',
): Scene => {
  const targets = Object.values(scene.nodes)
    .filter((node) => node.id !== scene.rootId && roleOf(node) === targetRole)
    .map((node) => node.id);
  if (targets.length === 0) return scene;

  let next = scene;
  const traits = Array.from(
    new Set(
      targets.flatMap((id) => scene.nodes[id]?.semantics?.traits ?? traitsForRole(targetRole)),
    ),
  );
  const behaviorTypes = behaviorTypesForTraits(traits);

  for (const type of behaviorTypes) {
    next = applyAddBehaviorDefinition(next, {
      id: `${targetRole}_${type}`,
      type,
      nodeIds: targets,
      label: behaviorLabel(type),
      description: `${behaviorLabel(type)} behavior inferred from ${targetRole} traits.`,
      params:
        type === 'show_info'
          ? {
              title: 'Product information',
              description: 'Interactive showroom item generated from structured scene metadata.',
            }
          : undefined,
    });
  }

  return next;
};

const applyReplaceScene = (_scene: Scene, incoming: Scene): Scene => {
  if (!validateScene(incoming)) return _scene;
  return cloneSceneFromJson(incoming);
};

const applyArrangeNodes = (
  scene: Scene,
  nodeIds: string[],
  layout: ArrangeLayout,
  options?: ArrangeOptions,
): Scene => {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const id of nodeIds) {
    if (!id || id === scene.rootId) continue;
    if (!scene.nodes[id]) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    targets.push(id);
  }
  if (targets.length === 0) return scene;

  const positions = computeArrangement(targets.length, layout, options ?? {});

  let nextNodes: Record<string, SceneNode> | null = null;
  for (let i = 0; i < targets.length; i += 1) {
    const id = targets[i];
    const node = (nextNodes ?? scene.nodes)[id];
    const pos = positions[i];
    if (!node || vec3Equal(node.transform.position, pos)) continue;
    if (!nextNodes) nextNodes = { ...scene.nodes };
    nextNodes[id] = {
      ...node,
      transform: {
        ...node.transform,
        position: [pos[0], pos[1], pos[2]],
      },
    };
  }

  if (!nextNodes) return scene;
  return { ...scene, nodes: nextNodes };
};

const applyRegisterAsset = (
  scene: Scene,
  asset: DioramaiAsset,
): Scene => {
  const prev = scene.assets?.[asset.id];
  if (JSON.stringify(prev) === JSON.stringify(asset)) return scene;

  const nextScene: Scene = {
    ...scene,
    assets: {
      ...(scene.assets ?? {}),
      [asset.id]: asset,
    },
  };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

const applySetSelection = (scene: Scene, nodeId: string | null): Scene => {
  if (nodeId !== null && !scene.nodes[nodeId]) return scene;
  if (scene.selection === nodeId) return scene;
  return { ...scene, selection: nodeId };
};

const applyUpdateLight = (
  scene: Scene,
  nodeId: string,
  light: SceneLight,
): Scene => {
  const node = scene.nodes[nodeId];
  if (!node) return scene;
  if (node.id === scene.rootId) return scene;
  if (JSON.stringify(node.light) === JSON.stringify(light) && node.type === 'light') {
    return scene;
  }

  const nextNode: SceneNode = {
    ...node,
    type: node.type === 'root' ? node.type : 'light',
    light,
  };
  const nextScene: Scene = {
    ...scene,
    nodes: { ...scene.nodes, [nodeId]: nextNode },
  };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

const applyUpdateEnvironment = (
  scene: Scene,
  patch: Partial<SceneEnvironment>,
): Scene => {
  const current: SceneEnvironment = scene.environment ?? {
    enabled: true,
    showBackground: false,
  };
  const next: SceneEnvironment = { ...current, ...patch };
  if (JSON.stringify(scene.environment) === JSON.stringify(next)) return scene;

  const nextScene: Scene = { ...scene, environment: next };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

const applySetNodeVisible = (
  scene: Scene,
  nodeId: string,
  visible: boolean,
): Scene => {
  const node = scene.nodes[nodeId];
  if (!node) return scene;
  if (node.visible === visible) return scene;

  const nextScene: Scene = {
    ...scene,
    nodes: { ...scene.nodes, [nodeId]: { ...node, visible } },
  };
  if (!validateScene(nextScene)) return scene;
  return nextScene;
};

export const applyCommand = (scene: Scene, command: Command): Scene => {
  switch (command.type) {
    case 'ADD_NODE':
      return applyAddNode(scene, command.parentId, command.node);
    case 'DELETE_NODE':
      return applyDeleteNode(scene, command.nodeId);
    case 'SET_PARENT':
      return applySetParent(scene, command);
    case 'UPDATE_TRANSFORM':
      return applyUpdateTransform(scene, command.nodeId, command.patch);
    case 'STRUCTURE_SCENE':
      return command.preset === 'showroom' ? applyStructureShowroomScene(scene) : scene;
    case 'MAKE_INTERACTIVE':
      return applyMakeInteractive(scene, command.targetRole);
    case 'CREATE_SEMANTIC_GROUP':
      return applyCreateSemanticGroup(scene, command.group);
    case 'ASSIGN_TO_SEMANTIC_GROUP':
      return applyAssignToSemanticGroup(scene, command.groupId, command.nodeIds);
    case 'SET_NODE_SEMANTICS':
      return applySetNodeSemantics(scene, command.nodeIds, command.semantics);
    case 'ADD_BEHAVIOR':
      return applyAddBehaviorDefinition(scene, command.behavior);
    case 'REMOVE_BEHAVIOR':
      return applyRemoveBehavior(scene, command.behaviorId);
    case 'DUPLICATE_NODE':
      return duplicateNodeInScene(
        scene,
        command.nodeId,
        command.includeSubtree,
        command.newParentId,
        command.idMap,
      );
    case 'ARRANGE_NODES':
      return applyArrangeNodes(
        scene,
        command.nodeIds,
        command.layout,
        command.options,
      );
    case 'REGISTER_ASSET':
      return applyRegisterAsset(scene, command.asset);
    case 'REPLACE_SCENE':
      return applyReplaceScene(scene, command.scene);
    case 'SET_SELECTION':
      return applySetSelection(scene, command.nodeId);
    case 'UPDATE_LIGHT':
      return applyUpdateLight(scene, command.nodeId, command.light);
    case 'UPDATE_ENVIRONMENT':
      return applyUpdateEnvironment(scene, command.patch);
    case 'SET_NODE_VISIBLE':
      return applySetNodeVisible(scene, command.nodeId, command.visible);
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
};

export interface CommandResult {
  scene: Scene;
  changed: boolean;
  summary: CommandSummary;
  error?: string;
  warnings?: string[];
  command: Command;
}

const validDuplicateTargets = (
  scene: Scene,
  nodeId: string,
  includeSubtree: boolean,
): string[] => (includeSubtree ? collectSubtreeIds(scene, nodeId) : [nodeId]);

const commandError = (scene: Scene, command: Command): string | undefined => {
  switch (command.type) {
    case 'ADD_NODE': {
      if (!scene.nodes[command.parentId]) return 'ADD_NODE parentId does not exist';
      if (scene.nodes[command.node.id]) return 'ADD_NODE node id already exists';
      const nextScene: Scene = {
        ...scene,
        nodes: {
          ...scene.nodes,
          [command.parentId]: addChild(scene.nodes[command.parentId], command.node.id),
          [command.node.id]: command.node,
        },
      };
      if (!validateScene(nextScene)) return 'ADD_NODE would violate scene invariants';
      return undefined;
    }
    case 'DELETE_NODE':
      if (command.nodeId === scene.rootId) return 'DELETE_NODE cannot delete root';
      if (!scene.nodes[command.nodeId]) return 'DELETE_NODE nodeId does not exist';
      return undefined;
    case 'UPDATE_TRANSFORM': {
      const node = scene.nodes[command.nodeId];
      if (!node) return 'UPDATE_TRANSFORM nodeId does not exist';
      if (isEmptyPatch(command.patch)) return undefined;
      const nextScene: Scene = {
        ...scene,
        nodes: {
          ...scene.nodes,
          [command.nodeId]: {
            ...node,
            transform: mergeTransform(node.transform, command.patch),
          },
        },
      };
      if (!validateScene(nextScene)) {
        return 'UPDATE_TRANSFORM would violate scene invariants';
      }
      return undefined;
    }
    case 'STRUCTURE_SCENE':
      return command.preset === 'showroom' && applyStructureShowroomScene(scene) !== scene
        ? undefined
        : 'STRUCTURE_SCENE found no showroom nodes to structure';
    case 'MAKE_INTERACTIVE':
      return applyMakeInteractive(scene, command.targetRole) !== scene
        ? undefined
        : 'MAKE_INTERACTIVE found no target nodes';
    case 'CREATE_SEMANTIC_GROUP': {
      const targets = validNonRootIds(scene, command.group.nodeIds);
      if (targets.length === 0) return 'CREATE_SEMANTIC_GROUP has no valid non-root targets';
      const nextScene = applyCreateSemanticGroup(scene, command.group);
      if (nextScene === scene) return undefined;
      return undefined;
    }
    case 'ASSIGN_TO_SEMANTIC_GROUP':
      if (!scene.semanticGroups?.[command.groupId]) {
        return 'ASSIGN_TO_SEMANTIC_GROUP groupId does not exist';
      }
      return validNonRootIds(scene, command.nodeIds).length > 0
        ? undefined
        : 'ASSIGN_TO_SEMANTIC_GROUP has no valid non-root targets';
    case 'SET_NODE_SEMANTICS': {
      const hasTarget = command.nodeIds.some(
        (id) => id !== scene.rootId && scene.nodes[id] !== undefined,
      );
      return hasTarget ? undefined : 'SET_NODE_SEMANTICS has no valid non-root targets';
    }
    case 'ADD_BEHAVIOR': {
      const hasTarget = command.behavior.nodeIds.some(
        (id) => id !== scene.rootId && scene.nodes[id] !== undefined,
      );
      return hasTarget ? undefined : 'ADD_BEHAVIOR has no valid non-root targets';
    }
    case 'REMOVE_BEHAVIOR':
      return scene.behaviors?.[command.behaviorId]
        ? undefined
        : 'REMOVE_BEHAVIOR behaviorId does not exist';
    case 'DUPLICATE_NODE': {
      if (command.nodeId === scene.rootId) return 'DUPLICATE_NODE cannot duplicate root';
      if (!scene.nodes[command.nodeId]) return 'DUPLICATE_NODE nodeId does not exist';
      const targetParentId =
        command.newParentId ?? getParent(scene, command.nodeId)?.id ?? scene.rootId;
      if (!scene.nodes[targetParentId]) {
        return 'DUPLICATE_NODE newParentId does not exist';
      }
      const duplicatedIds = validDuplicateTargets(
        scene,
        command.nodeId,
        command.includeSubtree,
      );
      if (duplicatedIds.includes(targetParentId)) {
        return 'DUPLICATE_NODE cannot parent duplicate under its own subtree';
      }
      if (command.idMap !== undefined) {
        const expected = new Set(duplicatedIds);
        const actual = Object.keys(command.idMap);
        const used = new Set<string>();
        if (actual.length !== duplicatedIds.length) {
          return 'DUPLICATE_NODE idMap must map each duplicated node';
        }
        for (const oldId of actual) {
          const newId = command.idMap[oldId];
          if (!expected.has(oldId)) {
            return 'DUPLICATE_NODE idMap contains unknown source id';
          }
          if (!newId) return 'DUPLICATE_NODE idMap contains empty target id';
          if (scene.nodes[newId]) return 'DUPLICATE_NODE idMap target id already exists';
          if (used.has(newId)) return 'DUPLICATE_NODE idMap target ids must be unique';
          used.add(newId);
        }
      }
      return undefined;
    }
    case 'SET_PARENT': {
      if (command.nodeId === scene.rootId) return 'SET_PARENT cannot reparent root';
      if (command.nodeId === command.parentId) {
        return 'SET_PARENT nodeId cannot equal parentId';
      }
      if (!scene.nodes[command.nodeId]) return 'SET_PARENT nodeId does not exist';
      if (!scene.nodes[command.parentId]) return 'SET_PARENT parentId does not exist';
      if (isDescendant(scene, command.nodeId, command.parentId)) {
        return 'SET_PARENT cannot create a cycle';
      }
      return undefined;
    }
    case 'ARRANGE_NODES': {
      const hasTarget = command.nodeIds.some(
        (id) => id !== scene.rootId && scene.nodes[id] !== undefined,
      );
      return hasTarget ? undefined : 'ARRANGE_NODES has no valid non-root targets';
    }
    case 'REGISTER_ASSET':
      if (command.asset.id.length === 0) return 'REGISTER_ASSET asset id cannot be empty';
      if (JSON.stringify(scene.assets?.[command.asset.id]) === JSON.stringify(command.asset)) {
        return undefined;
      }
      if (
        !validateScene({
          ...scene,
          assets: {
            ...(scene.assets ?? {}),
            [command.asset.id]: command.asset,
          },
        })
      ) {
        return 'REGISTER_ASSET would violate scene invariants';
      }
      return undefined;
    case 'REPLACE_SCENE':
      return validateScene(command.scene)
        ? undefined
        : 'REPLACE_SCENE scene failed validation';
    case 'SET_SELECTION':
      if (command.nodeId !== null && !scene.nodes[command.nodeId]) {
        return 'SET_SELECTION nodeId does not exist';
      }
      return undefined;
    case 'UPDATE_LIGHT': {
      const node = scene.nodes[command.nodeId];
      if (!node) return 'UPDATE_LIGHT nodeId does not exist';
      if (command.nodeId === scene.rootId) return 'UPDATE_LIGHT cannot target root';
      const nextScene: Scene = {
        ...scene,
        nodes: {
          ...scene.nodes,
          [command.nodeId]: { ...node, type: 'light', light: command.light },
        },
      };
      if (!validateScene(nextScene)) return 'UPDATE_LIGHT would violate scene invariants';
      return undefined;
    }
    case 'UPDATE_ENVIRONMENT': {
      const current: SceneEnvironment = scene.environment ?? {
        enabled: true,
        showBackground: false,
      };
      if (!validateScene({ ...scene, environment: { ...current, ...command.patch } })) {
        return 'UPDATE_ENVIRONMENT would violate scene invariants';
      }
      return undefined;
    }
    case 'SET_NODE_VISIBLE':
      if (!scene.nodes[command.nodeId]) return 'SET_NODE_VISIBLE nodeId does not exist';
      return undefined;
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
};

const commandWarnings = (command: Command): string[] | undefined => {
  if (command.type === 'DUPLICATE_NODE' && command.idMap === undefined) {
    return ['DUPLICATE_NODE without idMap uses generated ids'];
  }
  return undefined;
};

export const applyCommandWithResult = (
  scene: Scene,
  command: Command,
): CommandResult => {
  const error = commandError(scene, command);
  const next = applyCommand(scene, command);
  const result: CommandResult = {
    scene: next,
    changed: next !== scene,
    summary: summarizeCommand(command),
    command,
  };
  if (error !== undefined && next === scene) result.error = error;
  const warnings = commandWarnings(command);
  if (warnings !== undefined) result.warnings = warnings;
  return result;
};

import type { Command } from './commands';

export interface CommandSummary {
  title: string;
  detail: string;
}

const shortId = (id: string): string =>
  id.length <= 10 ? id : `${id.slice(0, 8)}...`;

export const summarizeCommand = (command: Command): CommandSummary => {
  switch (command.type) {
    case 'ADD_NODE':
      return {
        title: 'Add node',
        detail: `${command.node.name} -> parent ${shortId(command.parentId)} - id ${shortId(command.node.id)}`,
      };
    case 'DELETE_NODE':
      return {
        title: 'Delete node',
        detail: `node ${shortId(command.nodeId)}`,
      };
    case 'SET_PARENT':
      return {
        title: 'Set parent',
        detail: `${shortId(command.nodeId)} -> ${shortId(command.parentId)}${command.preserveWorldTransform ? ' - preserve world' : ''}`,
      };
    case 'UPDATE_TRANSFORM':
      return {
        title: 'Update transform',
        detail: `node ${shortId(command.nodeId)}`,
      };
    case 'STRUCTURE_SCENE':
      return {
        title: 'Structure scene',
        detail: `preset ${command.preset} - semantic groups and node roles`,
      };
    case 'MAKE_INTERACTIVE':
      return {
        title: 'Make interactive',
        detail: `target role ${command.targetRole ?? 'product'} - hover, click, info`,
      };
    case 'CREATE_SEMANTIC_GROUP':
      return {
        title: 'Create semantic group',
        detail: `${command.group.name} (${command.group.role}) - ${command.group.nodeIds.length} node(s)`,
      };
    case 'ASSIGN_TO_SEMANTIC_GROUP':
      return {
        title: 'Assign semantic group',
        detail: `${command.nodeIds.length} node(s) -> ${shortId(command.groupId)}`,
      };
    case 'SET_NODE_SEMANTICS':
      return {
        title: 'Set node semantics',
        detail: `${command.semantics.role ?? 'metadata'}${command.semantics.groupId ? ` in ${shortId(command.semantics.groupId)}` : ''} - ${command.nodeIds.length} node(s)`,
      };
    case 'ADD_BEHAVIOR':
      return {
        title: 'Add behavior',
        detail: `${command.behavior.type} - ${command.behavior.nodeIds.length} node(s)`,
      };
    case 'REMOVE_BEHAVIOR':
      return {
        title: 'Remove behavior',
        detail: shortId(command.behaviorId),
      };
    case 'DUPLICATE_NODE':
      return {
        title: 'Duplicate node',
        detail: `${shortId(command.nodeId)} - subtree=${command.includeSubtree}${command.newParentId ? ` -> ${shortId(command.newParentId)}` : ''}`,
      };
    case 'ARRANGE_NODES':
      return {
        title: `Arrange (${command.layout})`,
        detail: `${command.nodeIds.length} node(s): ${command.nodeIds.slice(0, 4).map(shortId).join(', ')}${command.nodeIds.length > 4 ? '...' : ''}`,
      };
    case 'REGISTER_ASSET':
      return {
        title: 'Register asset',
        detail: `${command.asset.kind} ${shortId(command.asset.id)}${command.asset.uri ? ` -> ${command.asset.uri}` : ''}`,
      };
    case 'REPLACE_SCENE':
      return {
        title: 'Replace scene',
        detail: `root ${shortId(command.scene.rootId)} - ${Object.keys(command.scene.nodes).length} nodes`,
      };
    case 'SET_SELECTION':
      return {
        title: 'Selection',
        detail:
          command.nodeId === null
            ? 'clear'
            : `node ${shortId(command.nodeId)}`,
      };
    case 'UPDATE_LIGHT':
      return {
        title: 'Update light',
        detail: `${command.light.kind} light on ${shortId(command.nodeId)}`,
      };
    case 'UPDATE_ENVIRONMENT':
      return {
        title: 'Update environment',
        detail: Object.keys(command.patch).join(', ') || 'no changes',
      };
    case 'UPDATE_RENDER_SETTINGS':
      return {
        title: 'Update render settings',
        detail: Object.keys(command.patch).join(', ') || 'no changes',
      };
    case 'SET_NODE_VISIBLE':
      return {
        title: 'Set visibility',
        detail: `node ${shortId(command.nodeId)} -> ${command.visible ? 'visible' : 'hidden'}`,
      };
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
};

import { useSceneStore } from '../store/sceneStore';
import type { Scene, SceneNode } from '@dioramai/core';

interface TreeRowProps {
  scene: Scene;
  nodeId: string;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const LIGHT_ICONS: Record<string, string> = {
  ambient: '◌',
  directional: '☀',
  point: '●',
  spot: '▼',
};

const nodeKindIcon = (node: SceneNode): string => {
  if (node.type === 'light' || node.light) {
    return LIGHT_ICONS[node.light?.kind ?? 'directional'] ?? '☀';
  }
  if (node.type === 'group') return '▸';
  if (node.type === 'mesh') return '◆';
  return '·';
};

function TreeRow({ scene, nodeId, depth, selectedId, onSelect }: TreeRowProps) {
  const dispatch = useSceneStore((s) => s.dispatch);
  const node = scene.nodes[nodeId];
  if (!node) return null;

  const isSelected = selectedId === nodeId;
  const isRoot = nodeId === scene.rootId;
  const role = node.semantics?.role ?? node.semanticRole;
  const groupId = node.semantics?.groupId ?? node.semanticGroupId;
  const isLight = node.type === 'light' || node.light !== undefined;
  const lightLabel = isLight ? `light:${node.light?.kind ?? 'directional'}` : null;
  const nodeKindMeta = lightLabel ?? (role
    ? `${role}${groupId ? ` @ ${groupId}` : ''}`
    : `${node.type} - ${node.children.length} child${node.children.length === 1 ? '' : 'ren'}`);
  const nodeMeta = [nodeKindMeta, node.visible ? null : 'hidden']
    .filter((part): part is string => part !== null)
    .join(' · ');

  const toggleVisible = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'SET_NODE_VISIBLE', nodeId, visible: !node.visible });
  };

  return (
    <div className="tree-group">
      <div
        className={`tree-row${isSelected ? ' tree-row--selected' : ''}${node.visible ? '' : ' tree-row--hidden'}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="tree-row__select"
          onClick={() => onSelect(nodeId)}
        >
          <span className="tree-row__icon" aria-hidden="true">{nodeKindIcon(node)}</span>
          <span className="tree-row__name">{node.name}</span>
          <span className="tree-row__meta">
            {isRoot ? 'root' : nodeMeta}
          </span>
        </button>
        {!isRoot ? (
          <button
            type="button"
            className="tree-row__eye"
            title={node.visible ? 'Hide node' : 'Show node'}
            aria-label={node.visible ? 'Hide node' : 'Show node'}
            onClick={toggleVisible}
          >
            {node.visible ? '👁' : '⦸'}
          </button>
        ) : null}
      </div>
      {node.children.map((childId) => (
        <TreeRow
          key={childId}
          scene={scene}
          nodeId={childId}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function TreeView() {
  const scene = useSceneStore((s) => s.scene);
  const select = useSceneStore((s) => s.select);
  const selectedId = scene.selection;

  return (
    <div className="tree-view">
      <div className="tree-view__header">Outline</div>
      <div className="tree-view__body">
        {scene.semanticGroups && Object.keys(scene.semanticGroups).length > 0 ? (
          <div className="semantic-groups">
            <div className="semantic-groups__label">Node groups</div>
            {Object.values(scene.semanticGroups).map((group) => (
              <div key={group.id} className="semantic-groups__row">
                <span>{group.name}</span>
                <span>{group.role} · {group.nodeIds.length}</span>
              </div>
            ))}
          </div>
        ) : null}
        <TreeRow
          scene={scene}
          nodeId={scene.rootId}
          depth={0}
          selectedId={selectedId}
          onSelect={select}
        />
      </div>
    </div>
  );
}

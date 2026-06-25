import { useState, type DragEvent, type MouseEvent } from 'react';
import { useSceneStore } from '../store/sceneStore';
import type { Scene, SceneNode } from '@dioramai/core';

const NODE_DRAG_MIME = 'application/x-dioramai-node';

interface TreeRowProps {
  scene: Scene;
  nodeId: string;
  depth: number;
  selectedId: string | null;
  draggedId: string | null;
  dropTargetId: string | null;
  collapsedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleNode: (id: string) => void;
  onDragNodeStart: (id: string) => void;
  onDragNodeOver: (id: string | null) => void;
  onDragNodeEnd: () => void;
  onDropNode: (nodeId: string, parentId: string) => void;
}

const LIGHT_ICONS: Record<string, string> = {
  ambient: '\u25CB',
  directional: '\u2600',
  point: '\u25CF',
  spot: '\u25BC',
};

const nodeKindIcon = (node: SceneNode): string => {
  if (node.type === 'light' || node.light) {
    return LIGHT_ICONS[node.light?.kind ?? 'directional'] ?? '\u2600';
  }
  if (node.type === 'group') return '\u25B8';
  if (node.type === 'mesh') return '\u25C6';
  return '\u00B7';
};

const findParentId = (scene: Scene, nodeId: string): string | null => {
  for (const node of Object.values(scene.nodes)) {
    if (node.children.includes(nodeId)) return node.id;
  }
  return null;
};

const isInSubtree = (scene: Scene, rootId: string, targetId: string): boolean => {
  if (rootId === targetId) return true;
  const root = scene.nodes[rootId];
  if (!root) return false;
  const stack = [...root.children];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === targetId) return true;
    const current = scene.nodes[currentId];
    if (current) stack.push(...current.children);
  }
  return false;
};

const canDropNode = (scene: Scene, draggedId: string | null, targetId: string): draggedId is string => {
  if (!draggedId) return false;
  if (draggedId === scene.rootId || draggedId === targetId) return false;
  if (!scene.nodes[draggedId] || !scene.nodes[targetId]) return false;
  if (isInSubtree(scene, draggedId, targetId)) return false;
  return findParentId(scene, draggedId) !== targetId;
};

function TreeRow({
  scene,
  nodeId,
  depth,
  selectedId,
  draggedId,
  dropTargetId,
  collapsedIds,
  onSelect,
  onToggleNode,
  onDragNodeStart,
  onDragNodeOver,
  onDragNodeEnd,
  onDropNode,
}: TreeRowProps) {
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
    .join(' - ');
  const isDragging = draggedId === nodeId;
  const isDropTarget = dropTargetId === nodeId && canDropNode(scene, draggedId, nodeId);
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(nodeId);

  const toggleVisible = (e: MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'SET_NODE_VISIBLE', nodeId, visible: !node.visible });
  };

  const toggleCollapsed = (e: MouseEvent) => {
    e.stopPropagation();
    onToggleNode(nodeId);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (isRoot) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(NODE_DRAG_MIME, nodeId);
    e.dataTransfer.setData('text/plain', nodeId);
    onSelect(nodeId);
    onDragNodeStart(nodeId);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    const activeDraggedId = draggedId ?? (e.dataTransfer.getData(NODE_DRAG_MIME) || null);
    if (!canDropNode(scene, activeDraggedId, nodeId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragNodeOver(nodeId);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (related && e.currentTarget.contains(related)) return;
    if (dropTargetId === nodeId) onDragNodeOver(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData(NODE_DRAG_MIME) || draggedId;
    if (canDropNode(scene, droppedId, nodeId)) onDropNode(droppedId, nodeId);
    onDragNodeEnd();
  };

  return (
    <div className="tree-group">
      <div
        className={`tree-row${isSelected ? ' tree-row--selected' : ''}${node.visible ? '' : ' tree-row--hidden'}${isDragging ? ' tree-row--dragging' : ''}${isDropTarget ? ' tree-row--drop-target' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!isRoot}
        aria-grabbed={!isRoot && isDragging ? true : undefined}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={onDragNodeEnd}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tree-row__twisty"
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
            aria-expanded={!isCollapsed}
            onClick={toggleCollapsed}
          >
            {isCollapsed ? '\u25B8' : '\u25BE'}
          </button>
        ) : (
          <span className="tree-row__twisty tree-row__twisty--empty" aria-hidden="true" />
        )}
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
            {node.visible ? '\u25C9' : '\u25CE'}
          </button>
        ) : null}
      </div>
      {isCollapsed ? null : node.children.map((childId) => (
        <TreeRow
          key={childId}
          scene={scene}
          nodeId={childId}
          depth={depth + 1}
          selectedId={selectedId}
          draggedId={draggedId}
          dropTargetId={dropTargetId}
          collapsedIds={collapsedIds}
          onSelect={onSelect}
          onToggleNode={onToggleNode}
          onDragNodeStart={onDragNodeStart}
          onDragNodeOver={onDragNodeOver}
          onDragNodeEnd={onDragNodeEnd}
          onDropNode={onDropNode}
        />
      ))}
    </div>
  );
}

export function TreeView() {
  const scene = useSceneStore((s) => s.scene);
  const select = useSceneStore((s) => s.select);
  const dispatch = useSceneStore((s) => s.dispatch);
  const selectedId = scene.selection;
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropTargetId(null);
  };

  const handleToggleNode = (nodeId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleDropNode = (nodeId: string, parentId: string) => {
    dispatch({ type: 'SET_PARENT', nodeId, parentId, preserveWorldTransform: true });
    select(nodeId);
    setCollapsedIds((current) => {
      if (!current.has(parentId)) return current;
      const next = new Set(current);
      next.delete(parentId);
      return next;
    });
    handleDragEnd();
  };

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
                <span>{group.role} - {group.nodeIds.length}</span>
              </div>
            ))}
          </div>
        ) : null}
        <TreeRow
          scene={scene}
          nodeId={scene.rootId}
          depth={0}
          selectedId={selectedId}
          draggedId={draggedId}
          dropTargetId={dropTargetId}
          collapsedIds={collapsedIds}
          onSelect={select}
          onToggleNode={handleToggleNode}
          onDragNodeStart={setDraggedId}
          onDragNodeOver={setDropTargetId}
          onDragNodeEnd={handleDragEnd}
          onDropNode={handleDropNode}
        />
      </div>
    </div>
  );
}
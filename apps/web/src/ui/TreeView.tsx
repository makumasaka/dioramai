import { useState } from 'react';
import { useSceneStore } from '../store/sceneStore';
import type { Scene, SceneNode, BehaviorDefinition } from '@dioramai/core';

// ─── Outline tab ──────────────────────────────────────────────────────────────

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

// ─── Runtime tab ──────────────────────────────────────────────────────────────

type RuntimeNode = {
  node: SceneNode;
  role: string;
  activeBehaviors: BehaviorDefinition[];
};

const BEHAVIOR_LABELS: Record<string, string> = {
  hover_highlight: 'hover',
  click_select: 'click',
  show_info: 'info',
  anchor_point: 'anchor',
};

function getBehaviorLabel(type: string): string {
  return BEHAVIOR_LABELS[type] ?? type;
}

function collectRuntimeNodes(scene: Scene): RuntimeNode[] {
  const results: RuntimeNode[] = [];
  for (const node of Object.values(scene.nodes)) {
    if (node.id === scene.rootId) continue;
    const role = node.semantics?.role ?? node.semanticRole;
    const hasBehaviorRefs = node.behaviorRefs && node.behaviorRefs.length > 0;
    const hasLegacyBehaviors = node.behaviors && Object.keys(node.behaviors).length > 0;
    if (!role && !hasBehaviorRefs && !hasLegacyBehaviors) continue;

    const activeBehaviors: BehaviorDefinition[] = (node.behaviorRefs ?? [])
      .map((id) => scene.behaviors?.[id])
      .filter((b): b is BehaviorDefinition => Boolean(b));

    results.push({ node, role: role ?? 'unknown', activeBehaviors });
  }
  return results;
}

function groupByRole(nodes: RuntimeNode[]): Map<string, RuntimeNode[]> {
  const map = new Map<string, RuntimeNode[]>();
  for (const rn of nodes) {
    const key = rn.role;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(rn);
  }
  return map;
}

function countGlobalBehaviors(scene: Scene): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of Object.values(scene.behaviors ?? {})) {
    counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  }
  return counts;
}

interface RuntimeViewProps {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function RuntimeView({ scene, selectedId, onSelect }: RuntimeViewProps) {
  const runtimeNodes = collectRuntimeNodes(scene);
  const byRole = groupByRole(runtimeNodes);
  const globalBehaviorCounts = countGlobalBehaviors(scene);

  if (runtimeNodes.length === 0 && globalBehaviorCounts.size === 0) {
    return (
      <div className="runtime-view__empty">
        <p>No interactive nodes yet.</p>
        <p className="runtime-view__hint">
          Select a node in the Outline and add a Role or Behavior in the Inspector.
        </p>
      </div>
    );
  }

  return (
    <div className="runtime-view">
      {byRole.size > 0 ? (
        <div className="runtime-section">
          <div className="runtime-section__label">
            Interactive nodes ({runtimeNodes.length})
          </div>
          {[...byRole.entries()].map(([role, nodes]) => (
            <div key={role} className="runtime-role-group">
              <div className="runtime-role-group__label">{role}</div>
              {nodes.map(({ node, activeBehaviors }) => {
                const behaviorSummary = activeBehaviors
                  .map((b) => getBehaviorLabel(b.type))
                  .join(', ');
                const legacyHover = node.behaviors?.hoverHighlight;
                const legacyClick = node.behaviors?.clickSelect;
                const legacySummary = [
                  legacyHover ? 'hover' : '',
                  legacyClick ? 'click' : '',
                ].filter(Boolean).join(', ');
                const summary = behaviorSummary || legacySummary;
                const isSelected = selectedId === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`runtime-node-row${isSelected ? ' runtime-node-row--selected' : ''}`}
                    onClick={() => onSelect(node.id)}
                  >
                    <span className="runtime-node-row__name">{node.name}</span>
                    {summary ? (
                      <span className="runtime-node-row__behaviors">{summary}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {globalBehaviorCounts.size > 0 ? (
        <div className="runtime-section">
          <div className="runtime-section__label">
            Active behaviors ({[...globalBehaviorCounts.values()].reduce((a, b) => a + b, 0)})
          </div>
          {[...globalBehaviorCounts.entries()].map(([type, count]) => (
            <div key={type} className="runtime-behavior-row">
              <span className="runtime-behavior-row__type">{getBehaviorLabel(type)}</span>
              <span className="runtime-behavior-row__count">×{count}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── TreeView shell ───────────────────────────────────────────────────────────

type Tab = 'outline' | 'runtime';

export function TreeView() {
  const [tab, setTab] = useState<Tab>('outline');
  const scene = useSceneStore((s) => s.scene);
  const select = useSceneStore((s) => s.select);
  const selectedId = scene.selection;

  return (
    <div className="tree-view">
      <div className="tree-view__tabs">
        <button
          type="button"
          className={`tree-view__tab${tab === 'outline' ? ' tree-view__tab--active' : ''}`}
          onClick={() => setTab('outline')}
        >
          Outline
        </button>
        <button
          type="button"
          className={`tree-view__tab${tab === 'runtime' ? ' tree-view__tab--active' : ''}`}
          onClick={() => setTab('runtime')}
        >
          Runtime
        </button>
      </div>

      <div className="tree-view__body">
        {tab === 'outline' ? (
          <>
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
          </>
        ) : (
          <RuntimeView scene={scene} selectedId={selectedId} onSelect={select} />
        )}
      </div>
    </div>
  );
}

/* eslint-disable react-refresh/only-export-components -- retained module is not mounted, so fast refresh does not apply */
import type { Scene, SceneNode, BehaviorDefinition } from '@dioramai/core';

/** Retained for post-MVP Runtime panel; not mounted in the default TreeView shell. */

export type RuntimeNode = {
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

export function getBehaviorLabel(type: string): string {
  return BEHAVIOR_LABELS[type] ?? type;
}

export function collectRuntimeNodes(scene: Scene): RuntimeNode[] {
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

export function groupRuntimeNodesByRole(nodes: RuntimeNode[]): Map<string, RuntimeNode[]> {
  const map = new Map<string, RuntimeNode[]>();
  for (const rn of nodes) {
    const key = rn.role;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(rn);
  }
  return map;
}

export function countGlobalBehaviors(scene: Scene): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of Object.values(scene.behaviors ?? {})) {
    counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  }
  return counts;
}

export interface RuntimeViewProps {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RuntimeView({ scene, selectedId, onSelect }: RuntimeViewProps) {
  const runtimeNodes = collectRuntimeNodes(scene);
  const byRole = groupRuntimeNodesByRole(runtimeNodes);
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

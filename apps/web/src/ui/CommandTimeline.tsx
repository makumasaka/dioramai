import { useState } from 'react';
import { summarizeCommand, type Command, type Scene } from '@dioramai/core';
import { useSceneStore } from '../store/sceneStore';

const fmt = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

const parseNumeric = (raw: string): number => {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const commandTouchedNodes = (scene: Scene, command: Command): string[] => {
  const label = (id: string): string => {
    const node = scene.nodes[id];
    return node ? `${node.name} (${id})` : id;
  };
  switch (command.type) {
    case 'UPDATE_TRANSFORM':
    case 'DELETE_NODE':
    case 'DUPLICATE_NODE':
      return [label(command.nodeId)];
    case 'STRUCTURE_SCENE':
      return ['display_area', 'seating_area', 'lighting_zone', 'environment'];
    case 'MAKE_INTERACTIVE':
      return [`role ${command.targetRole ?? 'product'}`];
    case 'CREATE_SEMANTIC_GROUP':
      return [command.group.name, ...command.group.nodeIds.slice(0, 3).map(label)];
    case 'ASSIGN_TO_SEMANTIC_GROUP':
      return command.nodeIds.slice(0, 4).map(label);
    case 'SET_NODE_SEMANTICS':
      return command.nodeIds.slice(0, 4).map(label);
    case 'ADD_BEHAVIOR':
      return command.behavior.nodeIds.slice(0, 4).map(label);
    case 'REMOVE_BEHAVIOR':
      return [command.behaviorId];
    case 'SET_PARENT':
      return [label(command.nodeId), label(command.parentId)];
    case 'ARRANGE_NODES':
      return command.nodeIds.slice(0, 4).map(label);
    case 'REGISTER_ASSET':
      return [command.asset.name, command.asset.uri ?? command.asset.id];
    case 'ADD_NODE':
      return [command.node.name, label(command.parentId)];
    case 'UPDATE_LIGHT':
      return [label(command.nodeId), command.light.kind];
    case 'UPDATE_ENVIRONMENT':
      return Object.keys(command.patch);
    case 'SET_NODE_VISIBLE':
      return [label(command.nodeId), command.visible ? 'visible' : 'hidden'];
    case 'SET_SELECTION':
      return command.nodeId ? [label(command.nodeId)] : ['selection cleared'];
    case 'REPLACE_SCENE':
      return [`root ${command.scene.rootId}`];
    default: {
      const _never: never = command;
      return _never;
    }
  }
};

const commandKey = (command: Command): string => JSON.stringify(command);

function Vec3Inputs({
  legend,
  values,
  onChange,
}: {
  legend: string;
  values: [number, number, number];
  onChange: (next: [number, number, number]) => void;
}) {
  return (
    <div className="timeline-card__vec3">
      <span className="timeline-card__label">{legend}</span>
      <div className="timeline-card__vec3-grid">
        {(['x', 'y', 'z'] as const).map((axis, index) => (
          <label key={axis} className="timeline-card__number">
            <span>{axis}</span>
            <input
              aria-label={`${legend} ${axis}`}
              type="number"
              value={fmt(values[index])}
              onChange={(e) => {
                const next = [...values] as [number, number, number];
                next[index] = parseNumeric(e.target.value);
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function EditableFields({
  command,
  onChange,
}: {
  command: Command;
  onChange: (next: Command) => void;
}) {
  if (command.type === 'UPDATE_TRANSFORM') {
    return (
      <div className="timeline-card__fields">
        {command.patch.position ? (
          <Vec3Inputs
            legend="Position"
            values={command.patch.position}
            onChange={(position) =>
              onChange({
                ...command,
                patch: { ...command.patch, position },
              })
            }
          />
        ) : null}
        {command.patch.rotation ? (
          <Vec3Inputs
            legend="Rotation"
            values={command.patch.rotation}
            onChange={(rotation) =>
              onChange({
                ...command,
                patch: { ...command.patch, rotation },
              })
            }
          />
        ) : null}
        {command.patch.scale ? (
          <Vec3Inputs
            legend="Scale"
            values={command.patch.scale}
            onChange={(scale) =>
              onChange({
                ...command,
                patch: { ...command.patch, scale },
              })
            }
          />
        ) : null}
        {!command.patch.position && !command.patch.rotation && !command.patch.scale ? (
          <div className="timeline-card__readonly">No editable transform fields in this patch.</div>
        ) : null}
      </div>
    );
  }

  if (command.type === 'ARRANGE_NODES') {
    return (
      <div className="timeline-card__fields timeline-card__fields--inline">
        <label className="timeline-card__select">
          <span>Layout</span>
          <select
            value={command.layout}
            onChange={(e) =>
              onChange({
                ...command,
                layout: e.target.value as typeof command.layout,
              })
            }
          >
            <option value="line">line</option>
            <option value="grid">grid</option>
            <option value="circle">circle</option>
          </select>
        </label>
        <label className="timeline-card__number">
          <span>Spacing</span>
          <input
            type="number"
            value={fmt(command.options?.spacing ?? 0)}
            onChange={(e) =>
              onChange({
                ...command,
                options: { ...command.options, spacing: parseNumeric(e.target.value) },
              })
            }
          />
        </label>
        <label className="timeline-card__number">
          <span>Columns</span>
          <input
            type="number"
            value={fmt(command.options?.cols ?? 0)}
            onChange={(e) =>
              onChange({
                ...command,
                options: { ...command.options, cols: parseNumeric(e.target.value) },
              })
            }
          />
        </label>
        <label className="timeline-card__number">
          <span>Radius</span>
          <input
            type="number"
            value={fmt(command.options?.radius ?? 0)}
            onChange={(e) =>
              onChange({
                ...command,
                options: { ...command.options, radius: parseNumeric(e.target.value) },
              })
            }
          />
        </label>
      </div>
    );
  }

  return <div className="timeline-card__readonly">Read-only for this command type.</div>;
}

export function CommandTimeline() {
  const [expanded, setExpanded] = useState(false);
  const scene = useSceneStore((s) => s.scene);
  const commandLog = useSceneStore((s) => s.commandLog);
  const timelineCommands = useSceneStore((s) => s.timelineCommands);
  const setTimelineCommandAt = useSceneStore((s) => s.setTimelineCommandAt);
  const recomputeFromTimeline = useSceneStore((s) => s.recomputeFromTimeline);
  const timelineError = useSceneStore((s) => s.timelineError);
  const clearTimelineError = useSceneStore((s) => s.clearTimelineError);

  const editedCount = timelineCommands.reduce((count, command, index) => {
    const original = commandLog[index]?.command;
    return commandKey(command) !== commandKey(original ?? command) ? count + 1 : count;
  }, 0);

  const count = timelineCommands.length;

  return (
    <section
      className={`command-timeline${expanded ? ' command-timeline--expanded' : ''}`}
      aria-label="Command timeline"
    >
      <header className="command-timeline__header">
        <button
          type="button"
          className="command-timeline__toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? 'Collapse command timeline' : 'Expand command timeline'}
        >
          <span className="command-timeline__toggle-arrow">{expanded ? '▼' : '▶'}</span>
          <span className="command-timeline__title">Commands</span>
          <span className="command-timeline__count">
            {count === 0 ? 'none' : `${count} step${count === 1 ? '' : 's'}`}
            {editedCount > 0 ? ` · ${editedCount} edited` : ''}
          </span>
        </button>
        {editedCount > 0 ? (
          <button
            type="button"
            className="command-timeline__recompute"
            onClick={() => {
              const ok = recomputeFromTimeline();
              if (ok) clearTimelineError();
            }}
          >
            Recompute
          </button>
        ) : null}
      </header>

      {expanded ? (
        <>
          {timelineError ? <div className="command-timeline__error">{timelineError}</div> : null}
          <div className="command-timeline__body">
            {timelineCommands.length === 0 ? (
              <div className="command-timeline__empty">No commands yet.</div>
            ) : (
              timelineCommands.map((command, index) => {
                const original = commandLog[index]?.command;
                const edited = commandKey(command) !== commandKey(original ?? command);
                const summary = summarizeCommand(command);
                const touched = commandTouchedNodes(scene, command);
                return (
                  <article key={`${index}-${command.type}`} className="timeline-card">
                    <div className="timeline-card__top">
                      <span className="timeline-card__step">#{index + 1}</span>
                      <span className="timeline-card__type">{command.type}</span>
                      {edited ? <span className="timeline-card__badge">edited</span> : null}
                    </div>
                    <div className="timeline-card__summary">{summary.title}</div>
                    <div className="timeline-card__detail">{summary.detail}</div>
                    <div className="timeline-card__nodes">
                      {touched.length > 0 ? `Nodes: ${touched.join(' | ')}` : 'Nodes: -'}
                    </div>
                    <EditableFields
                      command={command}
                      onChange={(nextCommand) => setTimelineCommandAt(index, nextCommand)}
                    />
                  </article>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

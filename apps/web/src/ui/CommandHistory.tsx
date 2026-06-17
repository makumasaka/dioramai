import { summarizeCommand } from '@dioramai/core';
import { useSceneStore, type CommandLogEntry } from '../store/sceneStore';

function HistoryRow({ entry, step }: { entry: CommandLogEntry; step: number }) {
  const { title, detail } = summarizeCommand(entry.command);
  return (
    <div className="command-history__row">
      <div className="command-history__row-top">
        <span className="command-history__step">#{step}</span>
        <span className="command-history__type">{entry.command.type}</span>
      </div>
      <div className="command-history__title">{title}</div>
      {detail ? <div className="command-history__detail">{detail}</div> : null}
    </div>
  );
}

export function CommandHistory() {
  const log = useSceneStore((s) => s.commandLog);
  const reversed = [...log].reverse();
  const count = log.length;

  return (
    <section className="command-history" aria-label="Command history">
      <div className="command-history__header">
        <span className="command-history__label">History</span>
        <span className="command-history__count">
          {count === 0 ? 'none' : `${count} step${count === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="command-history__body">
        {reversed.length === 0 ? (
          <div className="command-history__empty">No commands yet.</div>
        ) : (
          reversed.map((entry, index) => (
            <HistoryRow key={entry.id} entry={entry} step={count - index} />
          ))
        )}
      </div>
    </section>
  );
}

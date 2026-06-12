import { useSceneStore } from '../store/sceneStore';
import { SceneLoader } from './SceneLoader';

export function Toolbar() {
  const scene = useSceneStore((s) => s.scene);
  const selectedId = scene.selection;
  const dispatch = useSceneStore((s) => s.dispatch);
  const clearScene = useSceneStore((s) => s.clearScene);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const pastCount = useSceneStore((s) => s.past.length);
  const futureCount = useSceneStore((s) => s.future.length);
  const bridgeConnected = useSceneStore((s) => s.bridgeConnected);
  const bridgeLastError = useSceneStore((s) => s.bridgeLastError);
  const disconnect = useSceneStore((s) => s.disconnect);

  const selectedNode = selectedId ? scene.nodes[selectedId] : null;
  const isRootSelected = selectedId === scene.rootId;

  const handleDelete = () => {
    if (!selectedId || isRootSelected) return;
    dispatch({ type: 'DELETE_NODE', nodeId: selectedId });
  };

  return (
    <header className="toolbar">
      <div className="toolbar__row toolbar__row--intents">
        <div className="toolbar__brand">
          <span className="toolbar__title">Dioramai</span>
          <span className="toolbar__subtitle">Runtime sync · local R3F</span>
        </div>

        <div className="toolbar__status">
          {bridgeConnected ? (
            <span className="toolbar__status--connected">
              Bridge connected
              <button
                type="button"
                className="toolbar__disconnect-btn"
                onClick={disconnect}
                title="Disconnect from bridge and return to onboarding"
              >
                Disconnect
              </button>
            </span>
          ) : bridgeLastError ? (
            <span className="toolbar__status--muted" title={bridgeLastError}>
              Bridge offline
            </span>
          ) : selectedNode ? (
            <>
              Selected: <strong>{selectedNode.name}</strong>
            </>
          ) : (
            <span className="toolbar__status--muted">No selection</span>
          )}
        </div>
      </div>

      <div
        className="toolbar__row toolbar__tool-strip"
        role="toolbar"
        aria-label="Scene editing tools"
      >
        <div className="toolbar__tool-group">
          <button type="button" onClick={undo} disabled={pastCount === 0} title="Undo (Ctrl/Cmd+Z)">
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={futureCount === 0}
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            Redo
          </button>
        </div>

        <div className="toolbar__tool-divider" aria-hidden="true" />

        <div className="toolbar__tool-group">
          <button type="button" onClick={handleDelete} disabled={!selectedId || isRootSelected}>
            Delete
          </button>
          <button
            type="button"
            className="toolbar__ghost"
            onClick={clearScene}
            title="Remove all nodes and start with an empty scene"
          >
            Clear Scene
          </button>
        </div>

        <div className="toolbar__scene-tools">
          <SceneLoader />
        </div>
      </div>
    </header>
  );
}

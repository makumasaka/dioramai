import { useSceneStore } from '../store/sceneStore';
import { createNode, getParent, type Vec3 } from '@dioramai/core';
import { SceneLoader } from './SceneLoader';

const PALETTE: Vec3[] = [
  [0, 0.5, 0],
  [1.5, 0.5, 0],
  [-1.5, 0.5, 0],
  [0, 0.5, 1.5],
  [0, 0.5, -1.5],
  [1.5, 0.5, 1.5],
  [-1.5, 0.5, -1.5],
];

export function Toolbar() {
  const scene = useSceneStore((s) => s.scene);
  const selectedId = scene.selection;
  const dispatch = useSceneStore((s) => s.dispatch);
  const reset = useSceneStore((s) => s.reset);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const pastCount = useSceneStore((s) => s.past.length);
  const futureCount = useSceneStore((s) => s.future.length);
  const bridgeConnected = useSceneStore((s) => s.bridgeConnected);
  const bridgeLastError = useSceneStore((s) => s.bridgeLastError);
  const disconnect = useSceneStore((s) => s.disconnect);

  const selectedNode = selectedId ? scene.nodes[selectedId] : null;
  const isRootSelected = selectedId === scene.rootId;
  const parentOfSelected = selectedId ? getParent(scene, selectedId) : undefined;

  const totalNodes = Object.keys(scene.nodes).length - 1;

  const handleAdd = () => {
    const parentId = selectedId ?? scene.rootId;
    const position = PALETTE[totalNodes % PALETTE.length];
    const node = createNode({
      name: `Cube ${totalNodes + 1}`,
      transform: { position },
    });
    dispatch({ type: 'ADD_NODE', parentId, node });
  };

  const handleDelete = () => {
    if (!selectedId || isRootSelected) return;
    dispatch({ type: 'DELETE_NODE', nodeId: selectedId });
  };

  const handleMoveToRoot = () => {
    if (!selectedId || isRootSelected) return;
    if (parentOfSelected?.id === scene.rootId) return;
    dispatch({ type: 'SET_PARENT', nodeId: selectedId, parentId: scene.rootId });
  };

  const handleDuplicate = (includeSubtree: boolean) => {
    if (!selectedId || isRootSelected) return;
    dispatch({
      type: 'DUPLICATE_NODE',
      nodeId: selectedId,
      includeSubtree,
    });
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
          <button type="button" onClick={handleAdd}>
            Add Cube
          </button>
          <button type="button" onClick={handleDelete} disabled={!selectedId || isRootSelected}>
            Delete
          </button>
          <button
            type="button"
            onClick={handleMoveToRoot}
            disabled={
              !selectedId ||
              isRootSelected ||
              parentOfSelected?.id === scene.rootId
            }
            title="Reparent under root"
          >
            To root
          </button>
          <button
            type="button"
            onClick={() => handleDuplicate(false)}
            disabled={!selectedId || isRootSelected}
            title="Duplicate node only"
          >
            Dup
          </button>
          <button
            type="button"
            onClick={() => handleDuplicate(true)}
            disabled={!selectedId || isRootSelected}
            title="Duplicate subtree"
          >
            Dup tree
          </button>
        </div>

        <button type="button" className="toolbar__ghost toolbar__tool-reset" onClick={reset}>
          Reset
        </button>
      </div>

      <div className="toolbar__secondary">
        <SceneLoader />
      </div>
    </header>
  );
}

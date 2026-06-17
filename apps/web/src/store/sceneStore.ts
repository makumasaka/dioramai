import { create } from 'zustand';
import {
  applyCommand,
  cloneSceneImmutable,
  createEmptyScene,
  getStarterScene,
  replayCommands,
  serializeScene,
  type Command,
  type Scene,
} from '@dioramai/core';
import {
  clearBridgeStorage,
  postBridgeAddBehavior,
  postBridgeLoadScene,
  postBridgeRemoveBehavior,
  postBridgeSetNodeSemantics,
  postBridgeUpdateEnvironment,
  postBridgeUpdateTransform,
} from '../bridge/bridgeClient';

const HISTORY_LIMIT = 100;
const LOG_LIMIT = 200;

let logSeq = 0;
let bridgeMutationQueue: Promise<void> = Promise.resolve();

type BridgeMutationResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string } };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const enqueueBridgeMutation = (
  operation: () => Promise<BridgeMutationResult>,
  handlers: {
    onBridgeError: (message: string) => void;
    onTransportError: (message: string) => void;
  },
): void => {
  bridgeMutationQueue = bridgeMutationQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const result = await operation();
        if (!result.ok) handlers.onBridgeError(result.error.message);
      } catch (error) {
        handlers.onTransportError(errorMessage(error));
      }
    });
};

export interface CommandLogEntry {
  id: string;
  ts: number;
  command: Command;
}

interface CoalesceTag {
  type: 'UPDATE_TRANSFORM';
  nodeId: string;
}

const buildInitialScene = (): Scene => getStarterScene('default');
const cloneScene = (scene: Scene): Scene => cloneSceneImmutable(scene);
const initialScene = buildInitialScene();

const pushPast = (past: Scene[], entry: Scene): Scene[] => {
  const next = past.length >= HISTORY_LIMIT ? past.slice(1) : past.slice();
  next.push(entry);
  return next;
};

const getCoalesceTag = (command: Command): CoalesceTag | null =>
  command.type === 'UPDATE_TRANSFORM'
    ? { type: 'UPDATE_TRANSFORM', nodeId: command.nodeId }
    : null;

const sameTag = (a: CoalesceTag | null, b: CoalesceTag | null): boolean =>
  a !== null &&
  b !== null &&
  a.type === b.type &&
  a.nodeId === b.nodeId;

const pushLog = (log: CommandLogEntry[], command: Command): CommandLogEntry[] => {
  const entry: CommandLogEntry = {
    id: `log_${++logSeq}`,
    ts: Date.now(),
    command,
  };
  const next = [...log, entry];
  if (next.length > LOG_LIMIT) return next.slice(-LOG_LIMIT);
  return next;
};

const timelineToLog = (commands: Command[]): CommandLogEntry[] =>
  commands.map((command, i) => ({
    id: `log_${++logSeq}`,
    ts: Date.now() + i,
    command,
  }));

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface SceneState {
  scene: Scene;
  baseScene: Scene;
  /** Viewport gizmo (TransformControls) mode; not part of the scene graph. */
  gizmoMode: GizmoMode;
  past: Scene[];
  future: Scene[];
  lastTag: CoalesceTag | null;
  commandLog: CommandLogEntry[];
  timelineCommands: Command[];
  timelineError: string | null;
  bridgeConnected: boolean;
  bridgeConnecting: boolean;
  bridgeEnabled: boolean;
  bridgeLastError: string | null;
  bridgeSessionKey: number;
  dispatch: (command: Command) => void;
  applyBridgeScene: (scene: Scene, command?: Command) => void;
  setBridgeStatus: (connected: boolean, error: string | null) => void;
  setBridgeConnecting: (connecting: boolean) => void;
  setBridgeEnabled: (enabled: boolean) => void;
  disconnect: () => void;
  setTimelineCommandAt: (index: number, command: Command) => void;
  recomputeFromTimeline: () => boolean;
  clearTimelineError: () => void;
  select: (id: string | null) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  reset: () => void;
  clearScene: () => void;
  exportSceneJson: () => string;
}

export const useSceneStore = create<SceneState>()((set, get) => ({
  scene: initialScene,
  baseScene: cloneScene(initialScene),
  gizmoMode: 'translate',
  past: [],
  future: [],
  lastTag: null,
  commandLog: [],
  timelineCommands: [],
  timelineError: null,
  bridgeConnected: false,
  bridgeConnecting: true,
  bridgeEnabled: true,
  bridgeLastError: null,
  bridgeSessionKey: 0,

  dispatch: (command) => {
    const syncSceneToBridge = (scene: Scene) => {
      enqueueBridgeMutation(
        () => postBridgeLoadScene(serializeScene(scene)),
        {
          onBridgeError: (message) => get().setBridgeStatus(true, message),
          onTransportError: (message) => get().setBridgeStatus(false, message),
        },
      );
    };

    const applyLocalCommand = (localCommand: Command): Scene | null => {
      const localState = get();
      const nextScene = applyCommand(localState.scene, localCommand);
      if (nextScene === localState.scene) return null;

      if (localCommand.type === 'REPLACE_SCENE') {
        set({
          scene: nextScene,
          baseScene: cloneScene(nextScene),
          gizmoMode: 'translate',
          past: [],
          future: [],
          lastTag: null,
          commandLog: [],
          timelineCommands: [],
          timelineError: null,
        });
        return nextScene;
      }

      const tag = getCoalesceTag(localCommand);
      const shouldCoalesce = sameTag(localState.lastTag, tag) && localState.past.length > 0;

      const nextPast = shouldCoalesce
        ? localState.past
        : pushPast(localState.past, localState.scene);

      set({
        scene: nextScene,
        past: nextPast,
        future: [],
        lastTag: tag,
        timelineError: null,
        commandLog:
          localCommand.type === 'SET_SELECTION'
            ? localState.commandLog
            : pushLog(localState.commandLog, localCommand),
        timelineCommands:
          localCommand.type === 'SET_SELECTION'
            ? localState.timelineCommands
            : [...localState.timelineCommands, localCommand],
      });
      return nextScene;
    };

    const applyLocalAndSync = (localCommand: Command) => {
      const nextScene = applyLocalCommand(localCommand);
      if (nextScene && get().bridgeConnected && localCommand.type !== 'SET_SELECTION') {
        syncSceneToBridge(nextScene);
      }
    };

    const state = get();
    if (state.bridgeConnected && command.type !== 'SET_SELECTION') {
      if (command.type === 'UPDATE_TRANSFORM') {
        enqueueBridgeMutation(
          () => postBridgeUpdateTransform(command),
          {
            onBridgeError: (message) => {
              get().setBridgeStatus(true, message);
              applyLocalAndSync(command);
            },
            onTransportError: (message) => {
              get().setBridgeStatus(false, message);
              applyLocalCommand(command);
            },
          },
        );
        return;
      }
      if (command.type === 'UPDATE_ENVIRONMENT') {
        enqueueBridgeMutation(
          () => postBridgeUpdateEnvironment(command),
          {
            onBridgeError: (message) => {
              get().setBridgeStatus(true, message);
              applyLocalAndSync(command);
            },
            onTransportError: (message) => {
              get().setBridgeStatus(false, message);
              applyLocalCommand(command);
            },
          },
        );
        return;
      }
      if (command.type === 'REPLACE_SCENE') {
        const nextScene = applyLocalCommand(command);
        if (nextScene) syncSceneToBridge(nextScene);
        return;
      }
      if (command.type === 'SET_NODE_SEMANTICS') {
        enqueueBridgeMutation(
          () => postBridgeSetNodeSemantics(command),
          {
            onBridgeError: (message) => {
              get().setBridgeStatus(true, message);
              applyLocalAndSync(command);
            },
            onTransportError: (message) => {
              get().setBridgeStatus(false, message);
              applyLocalCommand(command);
            },
          },
        );
        return;
      }
      if (command.type === 'ADD_BEHAVIOR') {
        enqueueBridgeMutation(
          () => postBridgeAddBehavior(command),
          {
            onBridgeError: (message) => {
              get().setBridgeStatus(true, message);
              applyLocalAndSync(command);
            },
            onTransportError: (message) => {
              get().setBridgeStatus(false, message);
              applyLocalCommand(command);
            },
          },
        );
        return;
      }
      if (command.type === 'REMOVE_BEHAVIOR') {
        enqueueBridgeMutation(
          () => postBridgeRemoveBehavior(command),
          {
            onBridgeError: (message) => {
              get().setBridgeStatus(true, message);
              applyLocalAndSync(command);
            },
            onTransportError: (message) => {
              get().setBridgeStatus(false, message);
              applyLocalCommand(command);
            },
          },
        );
        return;
      }
    }
    applyLocalAndSync(command);
  },

  applyBridgeScene: (incomingScene, command) => {
    const scene = cloneScene(incomingScene);
    set((state) => {
      if (command === undefined || command.type === 'REPLACE_SCENE') {
        return {
          scene,
          baseScene: cloneScene(scene),
          gizmoMode: 'translate',
          past: [],
          future: [],
          lastTag: null,
          bridgeConnected: true,
          bridgeLastError: null,
          ...(command === undefined
            ? {}
            : {
                commandLog: [],
                timelineCommands: [],
                timelineError: null,
              }),
        };
      }

      const tag = getCoalesceTag(command);
      const shouldCoalesce = sameTag(state.lastTag, tag) && state.past.length > 0;
      return {
        scene,
        past: shouldCoalesce ? state.past : pushPast(state.past, state.scene),
        future: [],
        lastTag: tag,
        bridgeConnected: true,
        bridgeLastError: null,
        timelineError: null,
        commandLog:
          command.type === 'SET_SELECTION'
            ? state.commandLog
            : pushLog(state.commandLog, command),
        timelineCommands:
          command.type === 'SET_SELECTION'
            ? state.timelineCommands
            : [...state.timelineCommands, command],
      };
    });
  },

  setBridgeStatus: (bridgeConnected, bridgeLastError) =>
    set({ bridgeConnected, bridgeLastError }),

  setBridgeConnecting: (bridgeConnecting) => set({ bridgeConnecting }),

  setBridgeEnabled: (bridgeEnabled) => set({ bridgeEnabled }),

  disconnect: () => {
    clearBridgeStorage();
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }
    set((state) => ({
      bridgeConnected: false,
      bridgeConnecting: false,
      bridgeEnabled: true,
      bridgeLastError: null,
      bridgeSessionKey: state.bridgeSessionKey + 1,
    }));
  },

  setTimelineCommandAt: (index, command) =>
    set((state) => {
      if (index < 0 || index >= state.timelineCommands.length) return state;
      const timelineCommands = state.timelineCommands.slice();
      timelineCommands[index] = command;
      return {
        timelineCommands,
        timelineError: null,
      };
    }),

  recomputeFromTimeline: () => {
    const state = get();
    try {
      const nextScene = replayCommands(state.baseScene, state.timelineCommands);
      set({
        scene: nextScene,
        past: [],
        future: [],
        lastTag: null,
        commandLog: timelineToLog(state.timelineCommands),
        timelineError: null,
      });
      return true;
    } catch {
      set({ timelineError: 'Failed to recompute from timeline.' });
      return false;
    }
  },

  clearTimelineError: () => set({ timelineError: null }),

  select: (id) => get().dispatch({ type: 'SET_SELECTION', nodeId: id }),

  setGizmoMode: (gizmoMode) => set({ gizmoMode }),

  undo: () => {
    const state = get();
    if (state.past.length === 0) return;
    const previous = state.past[state.past.length - 1];
    const nextPast = state.past.slice(0, -1);
    const nextFuture = [...state.future, state.scene];
    set({
      scene: previous,
      past: nextPast,
      future: nextFuture,
      lastTag: null,
    });
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const next = state.future[state.future.length - 1];
    const nextFuture = state.future.slice(0, -1);
    const nextPast = pushPast(state.past, state.scene);
    set({
      scene: next,
      past: nextPast,
      future: nextFuture,
      lastTag: null,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  reset: () => get().dispatch({ type: 'REPLACE_SCENE', scene: buildInitialScene() }),

  clearScene: () => {
    const state = get();
    const nextScene = createEmptyScene();
    const nextPast = pushPast(state.past, state.scene);
    set({
      scene: nextScene,
      past: nextPast,
      future: [],
      lastTag: null,
    });
    if (state.bridgeConnected) {
      enqueueBridgeMutation(
        () => postBridgeLoadScene(serializeScene(nextScene)),
        {
          onBridgeError: (message) => get().setBridgeStatus(true, message),
          onTransportError: (message) => get().setBridgeStatus(false, message),
        },
      );
    }
  },

  exportSceneJson: () => serializeScene(get().scene),
}));

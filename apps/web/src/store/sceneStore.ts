import { create } from 'zustand';
import {
  applyCommand,
  cloneSceneImmutable,
  getStarterScene,
  replayCommands,
  serializeScene,
  type Command,
  type Scene,
} from '@dioramai/core';
import { postBridgeLoadScene, postBridgeUpdateTransform } from '../bridge/bridgeClient';

const HISTORY_LIMIT = 100;
const LOG_LIMIT = 200;

let logSeq = 0;

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
  dispatch: (command: Command) => void;
  applyBridgeScene: (scene: Scene, command?: Command) => void;
  setBridgeStatus: (connected: boolean, error: string | null) => void;
  setBridgeConnecting: (connecting: boolean) => void;
  setBridgeEnabled: (enabled: boolean) => void;
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

  dispatch: (command) => {
    const state = get();
    if (state.bridgeConnected && command.type !== 'SET_SELECTION') {
      if (command.type === 'UPDATE_TRANSFORM') {
        void postBridgeUpdateTransform(command)
          .then((result) => {
            if (result.ok) return;
            get().setBridgeStatus(false, result.error.message);
            get().dispatch(command);
          })
          .catch((error) => {
            get().setBridgeStatus(false, error instanceof Error ? error.message : String(error));
            get().dispatch(command);
          });
        return;
      }
      if (command.type === 'REPLACE_SCENE') {
        void postBridgeLoadScene(serializeScene(command.scene))
          .then((result) => {
            if (result.ok) return;
            get().setBridgeStatus(false, result.error.message);
            get().dispatch(command);
          })
          .catch((error) => {
            get().setBridgeStatus(false, error instanceof Error ? error.message : String(error));
            get().dispatch(command);
          });
        return;
      }
    }
    const nextScene = applyCommand(state.scene, command);
    if (nextScene === state.scene) return;

    if (command.type === 'REPLACE_SCENE') {
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
      return;
    }

    const tag = getCoalesceTag(command);
    const shouldCoalesce = sameTag(state.lastTag, tag) && state.past.length > 0;

    const nextPast = shouldCoalesce
      ? state.past
      : pushPast(state.past, state.scene);

    set({
      scene: nextScene,
      past: nextPast,
      future: [],
      lastTag: tag,
      timelineError: null,
      commandLog:
        command.type === 'SET_SELECTION'
          ? state.commandLog
          : pushLog(state.commandLog, command),
      timelineCommands:
        command.type === 'SET_SELECTION'
          ? state.timelineCommands
          : [...state.timelineCommands, command],
    });
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

  exportSceneJson: () => serializeScene(get().scene),
}));

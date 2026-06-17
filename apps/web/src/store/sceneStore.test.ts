import { describe, expect, it, beforeEach, vi } from 'vitest';
import { exportSceneToR3fJsx } from '@dioramai/export-r3f';
import { createLightNode, getStarterScene, parseSceneJson } from '@dioramai/core';
import { useSceneStore } from './sceneStore';

vi.mock('../bridge/bridgeClient', async (importActual) => ({
  ...(await importActual<typeof import('../bridge/bridgeClient')>()),
  postBridgeLoadScene: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  postBridgeUpdateTransform: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  postBridgeUpdateEnvironment: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  postBridgeSetNodeSemantics: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  postBridgeAddBehavior: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  postBridgeRemoveBehavior: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}));

const flushBridgeQueue = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('sceneStore — history + command log regression', () => {
  beforeEach(async () => {
    await flushBridgeQueue();
    vi.clearAllMocks();
    useSceneStore.setState({ bridgeConnected: false, bridgeLastError: null });
    useSceneStore.getState().reset();
    await flushBridgeQueue();
  });

  it('does not append SET_SELECTION to the command log', () => {
    const root = useSceneStore.getState().scene.rootId;
    useSceneStore.getState().select(root);
    expect(useSceneStore.getState().commandLog).toHaveLength(0);
  });

  it('clears history and command log on REPLACE_SCENE', () => {
    const cube = useSceneStore.getState().scene.nodes[
      useSceneStore.getState().scene.rootId
    ]!.children[0]!;
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: cube,
      patch: { position: [0, 2, 0] },
    });
    expect(useSceneStore.getState().commandLog.length).toBeGreaterThan(0);
    useSceneStore.getState().dispatch({
      type: 'REPLACE_SCENE',
      scene: getStarterScene('showroom'),
    });
    expect(useSceneStore.getState().commandLog).toHaveLength(0);
    expect(useSceneStore.getState().past).toHaveLength(0);
    expect(useSceneStore.getState().future).toHaveLength(0);
    expect(useSceneStore.getState().baseScene.rootId).toBe('showroom-root');
    expect(useSceneStore.getState().timelineCommands).toHaveLength(0);
  });

  it('resets to the default scene as a session boundary', () => {
    useSceneStore.getState().dispatch({
      type: 'REPLACE_SCENE',
      scene: getStarterScene('gallery'),
    });
    const child = useSceneStore.getState().scene.nodes[
      useSceneStore.getState().scene.rootId
    ]!.children[0]!;
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: child,
      patch: { position: [4, 0, 0] },
    });

    useSceneStore.getState().reset();

    expect(useSceneStore.getState().scene.rootId).toBe('default-root');
    expect(useSceneStore.getState().commandLog).toHaveLength(0);
    expect(useSceneStore.getState().past).toHaveLength(0);
    expect(useSceneStore.getState().future).toHaveLength(0);
  });

  it('clearScene replaces the graph with root-only empty scene while preserving history', () => {
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [0, 2, 0] },
    });

    useSceneStore.getState().clearScene();

    const scene = useSceneStore.getState().scene;
    expect(Object.keys(scene.nodes)).toHaveLength(1);
    expect(scene.nodes[scene.rootId]?.type).toBe('root');
    expect(scene.nodes[scene.rootId]?.children).toHaveLength(0);
    expect(scene.nodes['default-cube-1']).toBeUndefined();
    expect(useSceneStore.getState().commandLog).toHaveLength(1);
    expect(useSceneStore.getState().timelineCommands).toHaveLength(1);
    expect(useSceneStore.getState().past.length).toBeGreaterThan(0);

    useSceneStore.getState().undo();
    expect(useSceneStore.getState().scene.nodes['default-cube-1']).toBeDefined();
  });

  it('clearScene forwards empty scene to bridge when connected', async () => {
    const { postBridgeLoadScene } = await import('../bridge/bridgeClient');
    vi.mocked(postBridgeLoadScene).mockClear();

    useSceneStore.setState({ bridgeConnected: true });
    useSceneStore.getState().clearScene();
    await flushBridgeQueue();

    expect(Object.keys(useSceneStore.getState().scene.nodes)).toHaveLength(1);
    expect(postBridgeLoadScene).toHaveBeenCalledTimes(1);
    const sentJson = vi.mocked(postBridgeLoadScene).mock.calls[0]?.[0] as string;
    const parsed = parseSceneJson(sentJson);
    expect(parsed && Object.keys(parsed.nodes)).toHaveLength(1);
    expect(parsed?.nodes[parsed.rootId]?.children).toHaveLength(0);
  });

  it('coalesces consecutive UPDATE_TRANSFORM for the same node into one past entry', () => {
    const cube = useSceneStore.getState().scene.nodes[
      useSceneStore.getState().scene.rootId
    ]!.children[0]!;
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: cube,
      patch: { position: [0, 1.5, 0] },
    });
    const pastAfterFirst = useSceneStore.getState().past.length;
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: cube,
      patch: { position: [0, 2.5, 0] },
    });
    expect(useSceneStore.getState().past.length).toBe(pastAfterFirst);
    useSceneStore.getState().undo();
    const y = useSceneStore.getState().scene.nodes[cube]!.transform.position[1];
    expect(y).toBe(0.5);
  });

  it('undo/redo restores scene snapshots', () => {
    const cube = useSceneStore.getState().scene.nodes[
      useSceneStore.getState().scene.rootId
    ]!.children[0]!;
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: cube,
      patch: { position: [3, 0, 0] },
    });
    useSceneStore.getState().undo();
    expect(useSceneStore.getState().scene.nodes[cube]!.transform.position[0]).toBe(0);
    useSceneStore.getState().redo();
    expect(useSceneStore.getState().scene.nodes[cube]!.transform.position[0]).toBe(3);
  });

  it('exportSceneJson roundtrips through parseSceneJson', () => {
    const text = useSceneStore.getState().exportSceneJson();
    const parsed = parseSceneJson(text);
    expect(parsed).toEqual(useSceneStore.getState().scene);
  });

  it('export R3F string is stable for the current scene graph', () => {
    const jsx = exportSceneToR3fJsx(useSceneStore.getState().scene);
    expect(jsx).toContain('<group name="Root"');
    expect(jsx).toContain('/* Auto-generated for React Three Fiber');
  });

  it('forwards DELETE_NODE to the bridge via postBridgeLoadScene when connected', async () => {
    const { postBridgeLoadScene } = await import('../bridge/bridgeClient');
    vi.mocked(postBridgeLoadScene).mockClear();

    // Simulate bridge connected
    useSceneStore.setState({ bridgeConnected: true });

    const cubeId = 'default-cube-1';
    expect(useSceneStore.getState().scene.nodes[cubeId]).toBeDefined();

    useSceneStore.getState().dispatch({ type: 'DELETE_NODE', nodeId: cubeId });
    await flushBridgeQueue();

    // Node removed from local scene immediately
    expect(useSceneStore.getState().scene.nodes[cubeId]).toBeUndefined();

    // Bridge receives the updated scene (without the cube)
    expect(postBridgeLoadScene).toHaveBeenCalledTimes(1);
    const sentJson = vi.mocked(postBridgeLoadScene).mock.calls[0]?.[0] as string;
    const parsed = parseSceneJson(sentJson);
    expect(parsed?.nodes[cubeId]).toBeUndefined();
  });

  it('does not call postBridgeLoadScene for SET_SELECTION even when connected', async () => {
    const { postBridgeLoadScene } = await import('../bridge/bridgeClient');
    vi.mocked(postBridgeLoadScene).mockClear();

    useSceneStore.setState({ bridgeConnected: true });
    useSceneStore.getState().select('default-cube-1');

    expect(postBridgeLoadScene).not.toHaveBeenCalled();
  });

  it('forwards UPDATE_ENVIRONMENT to the dedicated bridge route when connected', async () => {
    const { postBridgeLoadScene, postBridgeUpdateEnvironment } = await import('../bridge/bridgeClient');
    vi.mocked(postBridgeLoadScene).mockClear();
    vi.mocked(postBridgeUpdateEnvironment).mockClear();

    useSceneStore.setState({ bridgeConnected: true });
    const command = {
      type: 'UPDATE_ENVIRONMENT' as const,
      patch: { hdriUri: '/assets/hdri/studio.hdr', enabled: true },
    };
    useSceneStore.getState().dispatch(command);
    await flushBridgeQueue();

    expect(postBridgeUpdateEnvironment).toHaveBeenCalledTimes(1);
    expect(postBridgeUpdateEnvironment).toHaveBeenCalledWith(command);
    expect(postBridgeLoadScene).not.toHaveBeenCalled();
  });

  it('queues transform updates behind scene syncs for newly added light nodes', async () => {
    const { postBridgeLoadScene, postBridgeUpdateTransform } = await import('../bridge/bridgeClient');
    let resolveLoadScene: (value: Awaited<ReturnType<typeof postBridgeLoadScene>>) => void = () => undefined;
    vi.mocked(postBridgeLoadScene).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoadScene = resolve;
      }),
    );

    useSceneStore.setState({ bridgeConnected: true });
    const rootId = useSceneStore.getState().scene.rootId;
    const light = createLightNode('point');

    useSceneStore.getState().dispatch({ type: 'ADD_NODE', parentId: rootId, node: light });
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: light.id,
      patch: { position: [1, 2, 3] },
    });
    await flushBridgeQueue();

    expect(postBridgeLoadScene).toHaveBeenCalledTimes(1);
    expect(postBridgeUpdateTransform).not.toHaveBeenCalled();

    resolveLoadScene({ ok: true, data: { scene: useSceneStore.getState().scene, changed: true } });
    await flushBridgeQueue();

    expect(postBridgeUpdateTransform).toHaveBeenCalledTimes(1);
    expect(postBridgeUpdateTransform).toHaveBeenCalledWith({
      type: 'UPDATE_TRANSFORM',
      nodeId: light.id,
      patch: { position: [1, 2, 3] },
    });
  });

  it('keeps the bridge connected when a command validation error falls back to full scene sync', async () => {
    const { postBridgeLoadScene, postBridgeUpdateTransform } = await import('../bridge/bridgeClient');
    vi.mocked(postBridgeUpdateTransform).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'UPDATE_TRANSFORM nodeId does not exist',
      },
    });

    useSceneStore.setState({ bridgeConnected: true, bridgeLastError: null });
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [4, 0.5, 0] },
    });
    await flushBridgeQueue();

    expect(useSceneStore.getState().bridgeConnected).toBe(true);
    expect(useSceneStore.getState().bridgeLastError).toBe('UPDATE_TRANSFORM nodeId does not exist');
    expect(useSceneStore.getState().scene.nodes['default-cube-1']?.transform.position).toEqual([4, 0.5, 0]);
    expect(postBridgeLoadScene).toHaveBeenCalledTimes(1);
  });

  it('recomputes scene from edited timeline commands', () => {
    useSceneStore.getState().dispatch({
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [2, 0.5, 0] },
    });

    useSceneStore.getState().setTimelineCommandAt(0, {
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [7, 0.5, 0] },
    });
    const ok = useSceneStore.getState().recomputeFromTimeline();

    expect(ok).toBe(true);
    expect(useSceneStore.getState().scene.nodes['default-cube-1']?.transform.position[0]).toBe(7);
    expect(useSceneStore.getState().past).toHaveLength(0);
    expect(useSceneStore.getState().future).toHaveLength(0);
  });
});

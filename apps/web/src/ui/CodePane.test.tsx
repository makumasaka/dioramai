import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommand, getStarterScene } from '@dioramai/core';
import {
  fetchBridgeProjectStatus,
  postBridgeReloadSceneFromFile,
  postBridgeWriteSceneToFile,
} from '../bridge/bridgeClient';
import { useSceneStore } from '../store/sceneStore';
import { CodePane } from './CodePane';

vi.mock('../bridge/bridgeClient', async () => ({
  ...(await vi.importActual<typeof import('../bridge/bridgeClient')>('../bridge/bridgeClient')),
  fetchBridgeProjectStatus: vi.fn(),
  postBridgeReloadSceneFromFile: vi.fn(),
  postBridgeWriteSceneToFile: vi.fn(),
}));

describe('CodePane sync controls', () => {
  beforeEach(() => {
    useSceneStore.getState().setBridgeStatus(false, null);
    useSceneStore.getState().reset();
    useSceneStore.getState().setBridgeStatus(true, null);
    vi.clearAllMocks();
    vi.mocked(fetchBridgeProjectStatus).mockResolvedValue({
      ok: true,
      data: {
        bridgeConnected: true,
        projectRoot: '/project',
        configFound: true,
        configPath: '/project/dioramai.config.json',
        configWarnings: [],
        assetDir: '/project/public/assets/models',
        assetDirExists: true,
        generatedSceneFile: '/project/src/generated/DioramaiScene.generated.tsx',
        generatedFileExists: true,
        publicAssetBase: '/assets/models',
        sceneJsonFile: '/project/src/generated/dioramai.scene.json',
        sceneJsonFileExists: true,
        projectWarnings: [],
        currentSceneLoaded: true,
        nodeCount: 2,
        assetCount: 0,
        lastSync: null,
      },
    });
    vi.mocked(postBridgeWriteSceneToFile).mockResolvedValue({ ok: true, data: {} });
  });

  it('applies the scene returned by reload_scene_from_file immediately', async () => {
    const base = getStarterScene('default');
    const reloaded = applyCommand(base, {
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [0, 0, 0] },
    });
    const moved = applyCommand(base, {
      type: 'UPDATE_TRANSFORM',
      nodeId: 'default-cube-1',
      patch: { position: [5, 0, 0] },
    });
    useSceneStore.getState().applyBridgeScene(moved);
    vi.mocked(postBridgeReloadSceneFromFile).mockResolvedValue({
      ok: true,
      data: {
        scene: reloaded,
        path: '/project/src/generated/DioramaiScene.generated.tsx',
        changed: true,
      },
    });

    render(<CodePane />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(useSceneStore.getState().scene.nodes['default-cube-1']?.transform.position).toEqual([0, 0, 0]);
    });
  });

  it('shows project warnings from bridge status', async () => {
    vi.mocked(fetchBridgeProjectStatus).mockResolvedValue({
      ok: true,
      data: {
        bridgeConnected: true,
        projectRoot: '/project',
        configFound: true,
        configPath: '/project/dioramai.config.json',
        configWarnings: [],
        assetDir: '/project/public/assets/models',
        assetDirExists: true,
        generatedSceneFile: '/project/src/generated/DioramaiScene.generated.tsx',
        generatedFileExists: true,
        publicAssetBase: '/assets/models',
        sceneJsonFile: '/project/src/generated/dioramai.scene.json',
        sceneJsonFileExists: true,
        projectWarnings: ['App code loads /assets/models/android.glb outside the canonical scene.'],
        currentSceneLoaded: true,
        nodeCount: 2,
        assetCount: 0,
        lastSync: null,
      },
    });

    render(<CodePane />);

    expect(await screen.findByText(/outside the canonical scene/)).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStarterScene } from '@dioramai/core';
import {
  postBridgeImportGlbAsset,
  postBridgeRegisterGlbAssetPath,
} from '../bridge/bridgeClient';
import { useSceneStore } from '../store/sceneStore';
import { SceneLoader } from './SceneLoader';

vi.mock('../bridge/bridgeClient', async () => ({
  ...(await vi.importActual<typeof import('../bridge/bridgeClient')>('../bridge/bridgeClient')),
  postBridgeImportGlbAsset: vi.fn(),
  postBridgeRegisterGlbAssetPath: vi.fn(),
}));

describe('SceneLoader GLB import', () => {
  beforeEach(() => {
    useSceneStore.getState().reset();
    vi.clearAllMocks();
  });

  it('sends selected GLB files to the bridge import endpoint and applies the returned scene', async () => {
    const scene = getStarterScene('showroom');
    vi.mocked(postBridgeImportGlbAsset).mockResolvedValue({
      ok: true,
      data: {
        assetId: 'asset-sample',
        commands: [],
        warnings: [],
        sceneSummary: {
          nodeCount: Object.keys(scene.nodes).length,
          assetCount: 1,
          rootChildCount: scene.nodes[scene.rootId]?.children.length ?? 0,
        },
        importedNodeIds: ['asset-sample-node'],
        hierarchySummary: {
          nodeCount: 0,
          rootNodeIds: [],
        },
        scene,
        changed: true,
        dryRun: false,
        appliedCommandCount: 2,
      },
    });

    const { container } = render(<SceneLoader />);
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.glb', {
      type: 'model/gltf-binary',
    });
    const input = container.querySelector(
      'input[accept=".glb,.gltf,model/gltf-binary,model/gltf+json"]',
    ) as HTMLInputElement | null;

    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
      expect(postBridgeImportGlbAsset).toHaveBeenCalledWith(file);
    });
    expect(await screen.findByText('Copied sample.glb into project')).toBeInTheDocument();
    expect(useSceneStore.getState().scene.rootId).toBe(scene.rootId);
    expect(useSceneStore.getState().bridgeConnected).toBe(true);
  });

  it('registers an existing project-relative GLB path through the bridge', async () => {
    const scene = getStarterScene('showroom');
    vi.mocked(postBridgeRegisterGlbAssetPath).mockResolvedValue({
      ok: true,
      data: {
        assetId: 'asset-chair',
        commands: [],
        warnings: [],
        sceneSummary: {
          nodeCount: Object.keys(scene.nodes).length,
          assetCount: 1,
          rootChildCount: scene.nodes[scene.rootId]?.children.length ?? 0,
        },
        importedNodeIds: ['asset-chair-node'],
        hierarchySummary: {
          nodeCount: 0,
          rootNodeIds: [],
        },
        scene,
        changed: true,
        dryRun: false,
        appliedCommandCount: 2,
      },
    });

    render(<SceneLoader />);

    fireEvent.change(screen.getByPlaceholderText('public/assets/models/chair.glb'), {
      target: { value: 'public/assets/models/chair.glb' },
    });
    fireEvent.click(screen.getByText('Register GLB'));

    await waitFor(() => {
      expect(postBridgeRegisterGlbAssetPath).toHaveBeenCalledWith(
        'public/assets/models/chair.glb',
      );
    });
    expect(await screen.findByText('Registered public/assets/models/chair.glb')).toBeInTheDocument();
  });
});

import { useEffect, useMemo, useState } from 'react';
import type { Scene } from '@dioramai/core';
import { exportSceneToR3fSyncModule } from '@dioramai/export-r3f';
import { useSceneStore } from '../store/sceneStore';
import {
  fetchBridgeProjectStatus,
  postBridgeReloadSceneFromFile,
  postBridgeWriteSceneToFile,
  type BridgeProjectStatus,
} from '../bridge/bridgeClient';

export function CodePane() {
  const scene = useSceneStore((s) => s.scene);
  const applyBridgeScene = useSceneStore((s) => s.applyBridgeScene);
  const bridgeConnected = useSceneStore((s) => s.bridgeConnected);
  const bridgeLastError = useSceneStore((s) => s.bridgeLastError);
  const [projectStatus, setProjectStatus] = useState<BridgeProjectStatus | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const codePreview = useMemo(
    () => exportSceneToR3fSyncModule(scene, { includeStudioLights: true }).code,
    [scene],
  );
  const projectWarning = projectStatus?.projectWarnings[0] ?? projectStatus?.configWarnings[0];

  useEffect(() => {
    if (!bridgeConnected) return;
    let closed = false;
    void fetchBridgeProjectStatus()
      .then((result) => {
        if (closed) return;
        if (result.ok) setProjectStatus(result.data);
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [bridgeConnected, scene]);

  const sceneFromReloadResult = (value: unknown): Scene | null => {
    if (typeof value !== 'object' || value === null || !('scene' in value)) return null;
    return (value as { scene: Scene }).scene;
  };

  const handleSync = (direction: 'toCode' | 'fromCode') => {
    setStatus(direction === 'toCode' ? 'Writing generated module' : 'Reading scene block');
    const request = direction === 'toCode'
      ? postBridgeWriteSceneToFile()
      : postBridgeReloadSceneFromFile();
    void request
      .then((result) => {
        if (!result.ok) {
          setStatus(result.error.message);
          return;
        }
        if (direction === 'fromCode') {
          const reloadedScene = sceneFromReloadResult(result.data);
          if (reloadedScene) {
            applyBridgeScene(reloadedScene, { type: 'REPLACE_SCENE', scene: reloadedScene });
          }
        }
        setStatus('Code sync complete');
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => window.setTimeout(() => setStatus(null), 2500));
  };

  return (
    <section className="code-pane" aria-label="Generated R3F code">
      <div className="code-pane__header">
        <div>
          <div className="code-pane__title">Generated R3F module</div>
          <div className="code-pane__subtitle">
            {projectStatus?.generatedSceneFile ?? 'Bridge generated module'}
          </div>
        </div>
        <div className="code-pane__actions">
          <button
            type="button"
            onClick={() => handleSync('toCode')}
            disabled={!bridgeConnected}
          >
            Sync
          </button>
          <button
            type="button"
            onClick={() => handleSync('fromCode')}
            disabled={!bridgeConnected}
          >
            Reload
          </button>
        </div>
      </div>
      <div className="code-pane__status">
        {status ??
          (bridgeConnected
            ? projectWarning ?? `Bridge connected - ${projectStatus?.assetDirExists ? 'assets ready' : 'asset dir missing'}`
            : bridgeLastError ?? 'Bridge offline')}
      </div>
      <pre className="code-pane__preview">{codePreview}</pre>
    </section>
  );
}

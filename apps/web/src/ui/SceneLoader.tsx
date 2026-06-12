import { useRef, useState } from 'react';
import { exportSceneToR3fJsx } from '@dioramai/export-r3f';
import { useSceneStore } from '../store/sceneStore';
import {
  postBridgeImportGlbAsset,
  postBridgeRegisterGlbAssetPath,
} from '../bridge/bridgeClient';

export function SceneLoader() {
  const exportSceneJson = useSceneStore((s) => s.exportSceneJson);
  const scene = useSceneStore((s) => s.scene);
  const applyBridgeScene = useSceneStore((s) => s.applyBridgeScene);
  const setBridgeStatus = useSceneStore((s) => s.setBridgeStatus);

  const glbFileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [glbPath, setGlbPath] = useState('');

  const handleExportJson = () => {
    const blob = new Blob([exportSceneJson()], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scene.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported scene.json');
    window.setTimeout(() => setStatus(null), 2000);
  };

  const handleImportGlbClick = () => glbFileRef.current?.click();

  const handleGlbFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatus('Copying GLB into project...');
    void postBridgeImportGlbAsset(file, { importMode: 'single' })
      .then((result) => {
        if (result.ok) {
          applyBridgeScene(result.data.scene);
          setBridgeStatus(true, null);
          setStatus(`Copied ${file.name} into project`);
          return;
        }
        setBridgeStatus(false, result.error.message);
        setStatus('Could not copy GLB into project');
      })
      .catch((error) => {
        setBridgeStatus(false, error instanceof Error ? error.message : String(error));
        setStatus('Could not copy GLB into project');
      })
      .finally(() => window.setTimeout(() => setStatus(null), 2500));
  };

  const handleRegisterGlbPath = () => {
    const path = glbPath.trim();
    if (path.length === 0) {
      setStatus('Enter a project-relative GLB path');
      window.setTimeout(() => setStatus(null), 2500);
      return;
    }
    setStatus('Registering GLB');
    void postBridgeRegisterGlbAssetPath(path, { importMode: 'single' })
      .then((result) => {
        if (result.ok) {
          applyBridgeScene(result.data.scene);
          setBridgeStatus(true, null);
          setStatus(`Registered ${path}`);
          return;
        }
        setBridgeStatus(false, result.error.message);
        setStatus(result.error.message);
      })
      .catch((error) => {
        setBridgeStatus(false, error instanceof Error ? error.message : String(error));
        setStatus('Register GLB failed');
      })
      .finally(() => window.setTimeout(() => setStatus(null), 3000));
  };

  const handleCopyR3f = async () => {
    const jsx = exportSceneToR3fJsx(scene, { includeStudioLights: true });
    try {
      await navigator.clipboard.writeText(jsx);
      setStatus('Copied R3F JSX');
    } catch {
      setStatus('Copy failed');
    }
    window.setTimeout(() => setStatus(null), 2000);
  };

  return (
    <div className="scene-loader">
      <button type="button" onClick={handleImportGlbClick}>
        Copy GLB Into Project
      </button>
      <input
        ref={glbFileRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        hidden
        onChange={handleGlbFile}
      />
      <label className="scene-loader__path">
        <span className="scene-loader__muted">Path</span>
        <input
          type="text"
          value={glbPath}
          placeholder="public/assets/models/chair.glb"
          onChange={(event) => setGlbPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleRegisterGlbPath();
          }}
        />
      </label>
      <button type="button" onClick={handleRegisterGlbPath}>
        Register GLB
      </button>
      <div className="scene-loader__divider" aria-hidden="true" />
      <div className="scene-loader__group scene-loader__group--export" aria-label="Export options">
        <span className="scene-loader__muted">Export</span>
        <button type="button" onClick={handleExportJson}>
          JSON
        </button>
        <button type="button" onClick={handleCopyR3f} title="Copy JSX for React Three Fiber">
          R3F
        </button>
      </div>
      {status ? <span className="scene-loader__status">{status}</span> : null}
    </div>
  );
}

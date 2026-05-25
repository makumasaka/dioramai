import { useState } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { fetchBridgeScene, getBridgeUrl } from '../bridge/bridgeClient';

export function Onboarding() {
  const setBridgeStatus = useSceneStore((s) => s.setBridgeStatus);
  const setBridgeConnecting = useSceneStore((s) => s.setBridgeConnecting);
  const setBridgeEnabled = useSceneStore((s) => s.setBridgeEnabled);
  const applyBridgeScene = useSceneStore((s) => s.applyBridgeScene);
  const bridgeLastError = useSceneStore((s) => s.bridgeLastError);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    setBridgeEnabled(true);
    setBridgeConnecting(true);
    try {
      const result = await fetchBridgeScene();
      if (result.ok) {
        applyBridgeScene(result.data.scene);
        setBridgeStatus(true, null);
      } else {
        setBridgeStatus(false, result.error.message);
      }
    } catch (error) {
      setBridgeStatus(false, error instanceof Error ? error.message : String(error));
    } finally {
      setBridgeConnecting(false);
      setRetrying(false);
    }
  };

  const bridgeUrl = getBridgeUrl();

  return (
    <div className="onboarding">
      <div className="onboarding__content">
        <div className="onboarding__header">
          <h1 className="onboarding__title">Dioramai</h1>
          <p className="onboarding__tagline">Runtime orchestration layer for React Three Fiber</p>
        </div>

        <p className="onboarding__description">
          Dioramai is a local runtime sync layer. This browser shell connects to a bridge
          running alongside your R3F project — it cannot access your filesystem directly.
        </p>

        <div className="onboarding__section">
          <h2 className="onboarding__section-title">Quick Start</h2>
          <ol className="onboarding__steps">
            <li>
              <strong>Create a project:</strong>
              <pre className="onboarding__code">npx dioramai init --template vite-r3f --install</pre>
            </li>
            <li>
              <strong>Open the repo in Cursor</strong>
            </li>
            <li>
              <strong>Start the runtime:</strong>
              <pre className="onboarding__code">npx dioramai dev --open</pre>
              <span className="onboarding__note">This will open this shell with your bridge URL automatically.</span>
            </li>
          </ol>
        </div>

        <div className="onboarding__section">
          <h2 className="onboarding__section-title">Already have a project running?</h2>
          <p>Run the following in your project directory:</p>
          <pre className="onboarding__code">npx dioramai dev --open</pre>
          <p className="onboarding__note">
            Or connect manually by adding{' '}
            <code>?bridgeUrl=http://127.0.0.1:7777&amp;bridgeToken=&lt;token&gt;</code>{' '}
            to this URL.
          </p>
        </div>

        <div className="onboarding__status">
          <div className="onboarding__status-row">
            <span className="onboarding__status-label">Bridge URL:</span>
            <code className="onboarding__status-value">{bridgeUrl}</code>
          </div>
          <div className="onboarding__status-row">
            <span
              className={`onboarding__status-indicator onboarding__status-indicator--${bridgeLastError ? 'error' : 'waiting'}`}
            >
              {bridgeLastError
                ? `Bridge offline — ${bridgeLastError}`
                : 'Searching for local runtime\u2026'}
            </span>
          </div>
          <button
            type="button"
            className="onboarding__retry-btn"
            onClick={() => { void handleRetry(); }}
            disabled={retrying}
          >
            {retrying ? 'Searching\u2026' : 'Search Local Runtime'}
          </button>
        </div>
      </div>
    </div>
  );
}

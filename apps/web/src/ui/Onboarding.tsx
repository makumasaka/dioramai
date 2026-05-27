import { useState } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { fetchBridgeScene, getBridgeUrl, getBridgeToken } from '../bridge/bridgeClient';

const BRIDGE_TOKEN_STORAGE_KEY = 'dioramai.bridgeToken';
const BRIDGE_URL_STORAGE_KEY = 'dioramai.bridgeUrl';

export function Onboarding() {
  const setBridgeStatus = useSceneStore((s) => s.setBridgeStatus);
  const setBridgeConnecting = useSceneStore((s) => s.setBridgeConnecting);
  const setBridgeEnabled = useSceneStore((s) => s.setBridgeEnabled);
  const applyBridgeScene = useSceneStore((s) => s.applyBridgeScene);
  const bridgeLastError = useSceneStore((s) => s.bridgeLastError);
  const [retrying, setRetrying] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualUrl, setManualUrl] = useState('http://127.0.0.1:7777');
  const [manualToken, setManualToken] = useState('');

  const attemptConnect = async () => {
    setRetrying(true);
    setBridgeEnabled(true);
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

  const handleRetry = () => { void attemptConnect(); };

  const handleManualConnect = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BRIDGE_URL_STORAGE_KEY, manualUrl.replace(/\/+$/, ''));
      if (manualToken.trim()) {
        window.localStorage.setItem(BRIDGE_TOKEN_STORAGE_KEY, manualToken.trim());
      }
    }
    setBridgeConnecting(true);
    void attemptConnect();
  };

  const bridgeUrl = getBridgeUrl();
  const bridgeToken = getBridgeToken();

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
          {bridgeToken && (
            <div className="onboarding__status-row">
              <span className="onboarding__status-label">Token:</span>
              <code className="onboarding__status-value onboarding__status-value--muted">
                {bridgeToken.slice(0, 6)}&hellip;{bridgeToken.slice(-4)}
              </code>
            </div>
          )}
          <div className="onboarding__status-row">
            <span
              className={`onboarding__status-indicator onboarding__status-indicator--${bridgeLastError ? 'error' : 'waiting'}`}
            >
              {bridgeLastError
                ? `No local runtime detected — ${bridgeLastError}`
                : 'Searching for local runtime\u2026'}
            </span>
          </div>
          <div className="onboarding__status-actions">
            <button
              type="button"
              className="onboarding__retry-btn"
              onClick={handleRetry}
              disabled={retrying}
            >
              {retrying ? 'Searching\u2026' : 'Search Local Runtime'}
            </button>
            <button
              type="button"
              className="onboarding__manual-toggle"
              onClick={() => { setShowManual((v) => !v); }}
            >
              {showManual ? 'Cancel' : 'Connect manually'}
            </button>
          </div>

          {showManual && (
            <div className="onboarding__manual">
              <p className="onboarding__manual-hint">
                Paste the bridge URL and token from your terminal output.
              </p>
              <div className="onboarding__manual-field">
                <label className="onboarding__manual-label" htmlFor="manual-bridge-url">
                  Bridge URL
                </label>
                <input
                  id="manual-bridge-url"
                  type="text"
                  className="onboarding__manual-input"
                  value={manualUrl}
                  onChange={(e) => { setManualUrl(e.target.value); }}
                  placeholder="http://127.0.0.1:7777"
                  spellCheck={false}
                />
              </div>
              <div className="onboarding__manual-field">
                <label className="onboarding__manual-label" htmlFor="manual-bridge-token">
                  Bridge Token
                </label>
                <input
                  id="manual-bridge-token"
                  type="text"
                  className="onboarding__manual-input"
                  value={manualToken}
                  onChange={(e) => { setManualToken(e.target.value); }}
                  placeholder="Paste token from terminal"
                  spellCheck={false}
                />
              </div>
              <button
                type="button"
                className="onboarding__retry-btn"
                onClick={handleManualConnect}
                disabled={retrying || !manualUrl.trim()}
              >
                {retrying ? 'Connecting\u2026' : 'Connect to this bridge'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

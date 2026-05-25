import { useEffect } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { bridgeUrlFor, fetchBridgeScene, type BridgeSceneEvent } from './bridgeClient';

const shouldConnectBridge =
  import.meta.env.MODE !== 'test' && import.meta.env.VITE_DIORAMAI_BRIDGE_ENABLED !== 'false';

export function BridgeSession() {
  const applyBridgeScene = useSceneStore((s) => s.applyBridgeScene);
  const setBridgeStatus = useSceneStore((s) => s.setBridgeStatus);
  const setBridgeConnecting = useSceneStore((s) => s.setBridgeConnecting);
  const setBridgeEnabled = useSceneStore((s) => s.setBridgeEnabled);

  useEffect(() => {
    if (!shouldConnectBridge) {
      setBridgeEnabled(false);
      setBridgeConnecting(false);
      return;
    }
    let closed = false;

    void fetchBridgeScene()
      .then((result) => {
        if (closed) return;
        if (result.ok) {
          applyBridgeScene(result.data.scene);
          setBridgeStatus(true, null);
        } else {
          setBridgeStatus(false, result.error.message);
        }
      })
      .catch((error) => {
        if (!closed) {
          setBridgeStatus(false, error instanceof Error ? error.message : String(error));
        }
      });

    if (typeof EventSource === 'undefined') {
      setBridgeConnecting(false);
      return () => {
        closed = true;
      };
    }

    const events = new EventSource(bridgeUrlFor('/events'));
    events.onopen = () => {
      if (!closed) {
        setBridgeConnecting(false);
        setBridgeStatus(true, null);
      }
    };
    events.addEventListener('scene', (event) => {
      if (closed) return;
      const data = JSON.parse((event as MessageEvent<string>).data) as BridgeSceneEvent;
      applyBridgeScene(data.scene, data.command);
      setBridgeStatus(true, null);
    });
    events.onerror = () => {
      if (!closed) {
        setBridgeConnecting(false);
        setBridgeStatus(false, 'Bridge event stream disconnected.');
      }
    };

    return () => {
      closed = true;
      events.close();
    };
  }, [applyBridgeScene, setBridgeStatus, setBridgeConnecting, setBridgeEnabled]);

  return null;
}

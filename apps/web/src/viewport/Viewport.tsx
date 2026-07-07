import { Canvas } from '@react-three/fiber';
import { Environment, Grid, OrbitControls } from '@react-three/drei';
import { useShallow } from 'zustand/react/shallow';
import { RuntimeScene, createRuntimeNodeRegistry } from '@dioramai/r3f-bridge';
import { Suspense, useMemo } from 'react';
import type { SceneEnvironment } from '@dioramai/core';
import { useSceneStore } from '../store/sceneStore';
import { bridgeAssetUrl } from '../bridge/bridgeClient';

function SceneEnvironmentView({ environment }: { environment: SceneEnvironment }) {
  if (!environment.enabled || !environment.hdriUri) return null;
  const rotationY = environment.rotationY ?? 0;
  return (
    <Suspense fallback={null}>
      <Environment
        files={bridgeAssetUrl(environment.hdriUri)}
        background={environment.showBackground}
        environmentIntensity={environment.intensity ?? 1}
        environmentRotation={[0, rotationY, 0]}
        backgroundRotation={[0, rotationY, 0]}
      />
    </Suspense>
  );
}

export function Viewport() {
  const { scene, gizmoMode, dispatch, select } = useSceneStore(
    useShallow((s) => ({
      scene: s.scene,
      gizmoMode: s.gizmoMode,
      dispatch: s.dispatch,
      select: s.select,
    })),
  );
  const registry = useMemo(() => createRuntimeNodeRegistry(), []);
  const root = scene.nodes[scene.rootId];
  const environment = scene.environment;
  const environmentActive = Boolean(environment?.enabled && environment.hdriUri);
  const backgroundColor =
    environment?.backgroundColor && !(environmentActive && environment.showBackground)
      ? environment.backgroundColor
      : '#181e2e';

  const renderSettings = scene.renderSettings ?? {};
  const shadowsEnabled = renderSettings.shadows ?? true;
  const maxPixelRatio = renderSettings.maxPixelRatio ?? 2;
  const shadowMapSize = renderSettings.shadowMapSize ?? 1024;
  const antialias = renderSettings.antialias ?? true;
  const powerPreference = renderSettings.powerPreference ?? 'default';
  // shadows, shadow map allocation, and gl context options only apply at context
  // creation, so remount the canvas when they change. dpr and frameloop are
  // applied live by R3F.
  const canvasKey = `${shadowsEnabled}:${shadowMapSize}:${antialias}:${powerPreference}`;

  return (
    <div className="viewport">
      <Canvas
        key={canvasKey}
        shadows={shadowsEnabled}
        dpr={[Math.min(1, maxPixelRatio), maxPixelRatio]}
        frameloop={renderSettings.renderOnDemand ? 'demand' : 'always'}
        gl={{ antialias, powerPreference }}
        camera={{ position: [5, 5, 7], fov: 50 }}
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={[backgroundColor]} />
        {environment ? <SceneEnvironmentView environment={environment} /> : null}
        {!environmentActive ? (
          <>
            <ambientLight intensity={0.45} />
            <directionalLight
              castShadow={shadowsEnabled}
              position={[5, 8, 5]}
              intensity={1.2}
              shadow-mapSize={[shadowMapSize, shadowMapSize]}
            />
          </>
        ) : (
          <directionalLight
            castShadow={shadowsEnabled}
            position={[5, 8, 5]}
            intensity={0.4}
            shadow-mapSize={[shadowMapSize, shadowMapSize]}
          />
        )}

        <Grid
          position={[0, 0, 0]}
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#353d52"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#4a556e"
          fadeDistance={25}
          fadeStrength={1}
          infiniteGrid
        />

        {root ? (
          <RuntimeScene
            scene={scene}
            selectedId={scene.selection}
            gizmoMode={gizmoMode}
            registry={registry}
            assetUrlResolver={bridgeAssetUrl}
            onCommand={dispatch}
            onSelect={select}
          />
        ) : null}

        <OrbitControls makeDefault enableDamping />
      </Canvas>
    </div>
  );
}

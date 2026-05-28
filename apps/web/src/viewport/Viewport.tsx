import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { useShallow } from 'zustand/react/shallow';
import { RuntimeScene, createRuntimeNodeRegistry } from '@dioramai/r3f-bridge';
import { useMemo } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { bridgeAssetUrl } from '../bridge/bridgeClient';

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

  return (
    <div className="viewport">
      <Canvas
        shadows
        camera={{ position: [5, 5, 7], fov: 50 }}
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={['#181e2e']} />
        <ambientLight intensity={0.45} />
        <directionalLight
          castShadow
          position={[5, 8, 5]}
          intensity={1.2}
          shadow-mapSize={[1024, 1024]}
        />

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

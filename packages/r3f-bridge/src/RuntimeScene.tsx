import {
  Suspense,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { TransformControls, useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Command, Scene } from '@dioramai/core';
import type { Group, Object3D } from 'three';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import {
  commandFromObject3DTransform,
} from './transformCommand';
import type { RuntimeNodeRegistry } from './registry';

export type RuntimeSceneProps = {
  scene: Scene;
  selectedId: string | null;
  gizmoMode: RuntimeGizmoMode;
  registry?: RuntimeNodeRegistry;
  assetUrlResolver?: (uri: string) => string;
  onCommand: (command: Command) => void;
  onSelect: (nodeId: string | null) => void;
};

export type RuntimeGizmoMode = 'translate' | 'rotate' | 'scale';

export type RuntimeNodeProps = RuntimeSceneProps & {
  nodeId: string;
  children?: ReactNode;
};

export const isRenderableAssetUri = (uri: string | undefined): string | undefined => {
  if (uri === undefined) return undefined;
  const value = uri.trim();
  if (!/\.(glb|gltf)(\?|#|$)/i.test(value)) return undefined;
  if (value.length === 0 || value.startsWith('file://')) return undefined;
  if (value.startsWith('http://') || value.startsWith('https://')) return undefined;
  if (value.includes('/Users/') || value.includes('\\Users\\')) return undefined;
  if (/^[a-zA-Z]:\\/.test(value)) return undefined;
  if (
    value.startsWith('/assets/') ||
    value.startsWith('assets/') ||
    value.startsWith('./') ||
    value.startsWith('../')
  ) {
    return value;
  }
  return undefined;
};

function AssetModel({ uri }: { uri: string }) {
  const gltf = useGLTF(uri);
  const object = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={object} />;
}

function ProxyMesh({ isSelected, isHovered }: { isSelected: boolean; isHovered: boolean }) {
  const color = isSelected ? '#fbbf24' : isHovered ? '#38bdf8' : '#94a3b8';
  const emissive = isSelected ? '#f59e0b' : isHovered ? '#0284c7' : '#000000';
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={isSelected || isHovered ? 0.3 : 0}
      />
    </mesh>
  );
}

function RuntimeNodeInner({
  scene,
  nodeId,
  selectedId,
  gizmoMode,
  registry,
  assetUrlResolver,
  onCommand,
  onSelect,
  children,
}: RuntimeNodeProps) {
  const groupRef = useRef<Group | null>(null);
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const node = scene.nodes[nodeId];
  const isSelected = selectedId === nodeId;

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group || !registry) return undefined;
    return registry.register({ nodeId, object: group });
  }, [nodeId, registry]);

  const commitTransform = useCallback(() => {
    const object = groupRef.current;
    if (!object) return;
    onCommand(commandFromObject3DTransform({ nodeId, object }));
  }, [nodeId, onCommand]);

  useLayoutEffect(() => {
    if (!isSelected) return undefined;
    const controls = controlsRef.current as unknown as {
      addEventListener: (name: 'dragging-changed', listener: (event: { value: boolean }) => void) => void;
      removeEventListener: (name: 'dragging-changed', listener: (event: { value: boolean }) => void) => void;
    } | null;
    if (!controls) return undefined;
    const onDraggingChanged = (event: { value: boolean }): void => {
      if (!event.value) commitTransform();
    };
    controls.addEventListener('dragging-changed', onDraggingChanged);
    return () => controls.removeEventListener('dragging-changed', onDraggingChanged);
  }, [commitTransform, isSelected]);

  const assetUri = useMemo(
    () => isRenderableAssetUri(node?.assetRef?.kind === 'uri' ? node.assetRef.uri : undefined),
    [node?.assetRef],
  );
  const resolvedAssetUri = useMemo(
    () => assetUri !== undefined ? assetUrlResolver?.(assetUri) ?? assetUri : undefined,
    [assetUri, assetUrlResolver],
  );

  if (!node || node.visible === false) return null;

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
    onSelect(nodeId);
  };

  const handlePointerOver = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation();
    setIsHovered(true);
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation();
    setIsHovered(false);
  };

  const hasLight = node.light !== undefined || node.type === 'light';
  const inspectOnly = node.metadata.renderMode === 'gltf-inspect-only';
  const showMesh = node.type === 'mesh' && !hasLight;
  const showAsset = showMesh && resolvedAssetUri !== undefined;
  // Inspect-only sub-nodes without an asset are rendered by external code; skip proxy only.
  const showProxy = showMesh && !showAsset && !inspectOnly;

  return (
    <>
      <group
        ref={groupRef}
        name={node.name}
        position={node.transform.position}
        rotation={node.transform.rotation}
        scale={node.transform.scale}
        userData={{ dioramaiId: node.id, sourceId: node.id }}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        {hasLight && node.light?.kind === 'ambient' ? (
          <ambientLight intensity={node.light.intensity ?? 0.4} />
        ) : null}
        {hasLight && node.light?.kind === 'directional' ? (
          <directionalLight
            castShadow={node.light.castShadow}
            intensity={node.light.intensity ?? 1}
          />
        ) : null}
        {showAsset ? (
          <Suspense fallback={<ProxyMesh isHovered={isHovered} isSelected={isSelected} />}>
            <AssetModel uri={resolvedAssetUri} />
          </Suspense>
        ) : null}
        {showProxy ? <ProxyMesh isHovered={isHovered} isSelected={isSelected} /> : null}
        {children}
      </group>
      {isSelected ? (
        <TransformControls
          key={`dioramai-tc-${nodeId}`}
          ref={controlsRef}
          object={groupRef as RefObject<Object3D | null> as RefObject<Object3D>}
          mode={gizmoMode}
        />
      ) : null}
    </>
  );
}

export const RuntimeNode = memo(RuntimeNodeInner);

function RuntimeNodeTree(props: RuntimeSceneProps & { nodeId: string }) {
  const node = props.scene.nodes[props.nodeId];
  if (!node) return null;
  return (
    <RuntimeNode {...props}>
      {node.children.map((childId) => (
        <RuntimeNodeTree key={childId} {...props} nodeId={childId} />
      ))}
    </RuntimeNode>
  );
}

export function RuntimeScene(props: RuntimeSceneProps) {
  return <RuntimeNodeTree {...props} nodeId={props.scene.rootId} />;
}

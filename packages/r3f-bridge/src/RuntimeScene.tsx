import {
  Suspense,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { TransformControls, useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Command, Scene, SceneLight } from '@dioramai/core';
import type {
  DirectionalLight,
  Group,
  Object3D,
  SpotLight,
} from 'three';
import { SkeletonUtils, type TransformControls as TransformControlsImpl } from 'three-stdlib';
import {
  commandFromObject3DTransform,
} from './transformCommand';
import type { RuntimeNodeRegistry } from './registry';
import { buildGltfNodeIndexMap, type GltfLike } from './gltfObjectBinding';
import {
  applyGltfNodeProjections,
  collectGltfNodeProjections,
  dioramaiIdForObject,
  resolveProjectionObject,
  type GltfNodeProjection,
} from './gltfProjection';

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

/**
 * TransformControls that commit the bound object's local transform back into
 * the canonical scene as an UPDATE_TRANSFORM command on drag end. Shared by
 * normal node groups and by resolved GLB sub-objects.
 */
function CommitTransformControls({
  object,
  mode,
  nodeId,
  onCommand,
}: {
  object: Object3D;
  mode: RuntimeGizmoMode;
  nodeId: string;
  onCommand: (command: Command) => void;
}) {
  const controlsRef = useRef<TransformControlsImpl | null>(null);

  useLayoutEffect(() => {
    const controls = controlsRef.current as unknown as {
      addEventListener: (name: 'dragging-changed', listener: (event: { value: boolean }) => void) => void;
      removeEventListener: (name: 'dragging-changed', listener: (event: { value: boolean }) => void) => void;
    } | null;
    if (!controls) return undefined;
    const onDraggingChanged = (event: { value: boolean }): void => {
      if (!event.value) onCommand(commandFromObject3DTransform({ nodeId, object }));
    };
    controls.addEventListener('dragging-changed', onDraggingChanged);
    return () => controls.removeEventListener('dragging-changed', onDraggingChanged);
  }, [nodeId, object, onCommand]);

  return (
    <TransformControls
      key={`dioramai-tc-${nodeId}`}
      ref={controlsRef}
      object={object}
      mode={mode}
    />
  );
}

function AssetModel({
  uri,
  projections,
  selectedId,
  gizmoMode,
  onSelectNode,
  onCommand,
}: {
  uri: string;
  projections: readonly GltfNodeProjection[];
  selectedId: string | null;
  gizmoMode: RuntimeGizmoMode;
  onSelectNode: (nodeId: string) => void;
  onCommand: (command: Command) => void;
}) {
  const gltf = useGLTF(uri);
  const object = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  // Canonical glTF-node-index -> cloned object map. Robust against loader
  // structural changes (wrapper groups, split multi-primitive meshes).
  const nodeIndexMap = useMemo(
    () => buildGltfNodeIndexMap(gltf as unknown as GltfLike, object),
    [gltf, object],
  );
  useLayoutEffect(() => {
    applyGltfNodeProjections(object, projections, nodeIndexMap);
  }, [object, projections, nodeIndexMap]);

  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    const nodeId = dioramaiIdForObject(event.object);
    if (nodeId === undefined) return;
    event.stopPropagation();
    onSelectNode(nodeId);
  }, [onSelectNode]);

  // When a GLB sub-node is selected, bind the gizmo to its resolved cloned
  // object so individual parts move independently.
  const selectedProjection = useMemo(
    () => (selectedId === null ? null : projections.find((p) => p.nodeId === selectedId) ?? null),
    [projections, selectedId],
  );
  const selectedObject = useMemo(
    () => (selectedProjection === null
      ? null
      : resolveProjectionObject(object, selectedProjection, nodeIndexMap)),
    [object, selectedProjection, nodeIndexMap],
  );

  return (
    <>
      <primitive object={object} onClick={handleClick} />
      {selectedObject && selectedProjection ? (
        <CommitTransformControls
          object={selectedObject}
          mode={gizmoMode}
          nodeId={selectedProjection.nodeId}
          onCommand={onCommand}
        />
      ) : null}
    </>
  );
}

/**
 * Editor-only clickable proxy so lights (which have no geometry) can be picked
 * in the viewport. Direction-bearing lights also get a small cone gnomon.
 */
function LightHelperProxy({
  kind,
  color,
  isSelected,
}: {
  kind: SceneLight['kind'];
  color: string;
  isSelected: boolean;
}) {
  const hasDirection = kind === 'directional' || kind === 'spot';
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshBasicMaterial color={isSelected ? '#fbbf24' : color} />
      </mesh>
      {hasDirection ? (
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.12, 0.4, 12]} />
          <meshBasicMaterial color={isSelected ? '#fbbf24' : color} wireframe />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Renders a three.js light from a {@link SceneLight}. Direction for
 * directional/spot lights derives from the parent group's rotation via a child
 * target placed along local -Z.
 */
function LightView({ light }: { light: SceneLight }) {
  const directionalRef = useRef<DirectionalLight | null>(null);
  const spotRef = useRef<SpotLight | null>(null);
  const targetRef = useRef<Object3D | null>(null);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    if (directionalRef.current) {
      directionalRef.current.target = target;
      target.updateMatrixWorld();
    }
    if (spotRef.current) {
      spotRef.current.target = target;
      target.updateMatrixWorld();
    }
  });

  const color = light.color ?? '#ffffff';

  switch (light.kind) {
    case 'ambient':
      return <ambientLight color={color} intensity={light.intensity ?? 0.4} />;
    case 'point':
      return (
        <pointLight
          color={color}
          intensity={light.intensity ?? 1}
          distance={light.distance ?? 0}
          decay={light.decay ?? 2}
          castShadow={light.castShadow ?? false}
        />
      );
    case 'directional':
      return (
        <>
          <directionalLight
            ref={directionalRef}
            color={color}
            intensity={light.intensity ?? 1}
            castShadow={light.castShadow ?? false}
          />
          <object3D ref={targetRef} position={[0, 0, -1]} />
        </>
      );
    case 'spot':
      return (
        <>
          <spotLight
            ref={spotRef}
            color={color}
            intensity={light.intensity ?? 1}
            distance={light.distance ?? 0}
            decay={light.decay ?? 2}
            angle={light.angle ?? Math.PI / 6}
            penumbra={light.penumbra ?? 0}
            castShadow={light.castShadow ?? false}
          />
          <object3D ref={targetRef} position={[0, 0, -1]} />
        </>
      );
  }
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

function HiddenNodeMarker() {
  return (
    <mesh>
      <boxGeometry args={[0.9, 0.9, 0.9]} />
      <meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.45} />
    </mesh>
  );
}

const subtreeContains = (scene: Scene, nodeId: string, targetId: string): boolean => {
  if (nodeId === targetId) return true;
  const node = scene.nodes[nodeId];
  if (!node) return false;
  return node.children.some((childId) => subtreeContains(scene, childId, targetId));
};

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
  // Track the live group instance in state so TransformControls and the
  // registry re-attach whenever React replaces the underlying Object3D.
  // Passing a RefObject to drei's TransformControls is unsafe: drei reads
  // `ref.current` once and never re-attaches, leaving the gizmo bound to a
  // stale, detached group.
  const [groupObject, setGroupObject] = useState<Group | null>(null);
  const handleGroupRef = useCallback((group: Group | null) => {
    setGroupObject(group);
  }, []);
  const [isHovered, setIsHovered] = useState(false);

  const node = scene.nodes[nodeId];
  const isSelected = selectedId === nodeId;
  const isHidden = node?.visible === false;
  const shouldRenderHiddenBranch =
    isHidden &&
    selectedId !== null &&
    subtreeContains(scene, nodeId, selectedId);

  useLayoutEffect(() => {
    if (!groupObject || !registry) return undefined;
    return registry.register({ nodeId, object: groupObject });
  }, [nodeId, registry, groupObject]);

  const assetUri = useMemo(
    () => isRenderableAssetUri(node?.assetRef?.kind === 'uri' ? node.assetRef.uri : undefined),
    [node?.assetRef],
  );
  const resolvedAssetUri = useMemo(
    () => assetUri !== undefined ? assetUrlResolver?.(assetUri) ?? assetUri : undefined,
    [assetUri, assetUrlResolver],
  );
  const gltfNodeProjections = useMemo(
    () => resolvedAssetUri !== undefined ? collectGltfNodeProjections(scene, nodeId) : [],
    [nodeId, resolvedAssetUri, scene],
  );

  if (!node || (isHidden && !shouldRenderHiddenBranch)) return null;

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
  const showHiddenMarker = isHidden && isSelected;
  const showAsset = !isHidden && showMesh && resolvedAssetUri !== undefined;
  // Inspect-only sub-nodes without an asset are rendered by external code; skip proxy only.
  const showProxy = !isHidden && showMesh && !showAsset && !inspectOnly;
  // GLB-embedded lights (inspect-only) render via the cloned GLB; only authored
  // light nodes render their own three.js light here.
  const showAuthoredLight = !isHidden && hasLight && !inspectOnly && node.light !== undefined;

  return (
    <>
      <group
        ref={handleGroupRef}
        name={node.name}
        position={node.transform.position}
        rotation={node.transform.rotation}
        scale={node.transform.scale}
        userData={{ dioramaiId: node.id, sourceId: node.id }}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        {showAuthoredLight && node.light ? <LightView light={node.light} /> : null}
        {showAuthoredLight && node.light && node.light.kind !== 'ambient' ? (
          <LightHelperProxy
            kind={node.light.kind}
            color={node.light.color ?? '#ffffff'}
            isSelected={isSelected}
          />
        ) : null}
        {showAsset ? (
          <Suspense fallback={<ProxyMesh isHovered={isHovered} isSelected={isSelected} />}>
            <AssetModel
              uri={resolvedAssetUri}
              projections={gltfNodeProjections}
              selectedId={selectedId}
              gizmoMode={gizmoMode}
              onSelectNode={onSelect}
              onCommand={onCommand}
            />
          </Suspense>
        ) : null}
        {showHiddenMarker ? <HiddenNodeMarker /> : null}
        {showProxy ? <ProxyMesh isHovered={isHovered} isSelected={isSelected} /> : null}
        {children}
      </group>
      {isSelected && groupObject && !inspectOnly ? (
        <CommitTransformControls
          object={groupObject}
          mode={gizmoMode}
          nodeId={nodeId}
          onCommand={onCommand}
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

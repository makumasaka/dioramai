import {
  parseSceneJson,
  serializeScene,
  type Scene,
} from '@dioramai/schema';
import { sanitizeIdentifier } from './semanticMapper';
import type { R3fExportResult, R3fSyncModuleExportOptions } from './types';

export const DIORAMAI_GENERATED_MARKER = '// @dioramai-generated';
export const DIORAMAI_SCENE_BLOCK_START = '// @dioramai-scene-start';
export const DIORAMAI_SCENE_BLOCK_END = '// @dioramai-scene-end';

export type R3fSyncModuleSceneParseResult =
  | { ok: true; scene: Scene; json: string }
  | {
      ok: false;
      error: {
        code: 'SCENE_BLOCK_NOT_FOUND' | 'SCENE_BLOCK_INVALID';
        message: string;
      };
    };

const safeComponentName = (value: string | undefined): string =>
  sanitizeIdentifier(value ?? 'DioramaiScene', 'DioramaiScene');

const renderSyncModule = (
  sceneJson: string,
  componentName: string,
  includeStudioLights: boolean,
): string =>
  `/* eslint-disable */\n` +
  `${DIORAMAI_GENERATED_MARKER}\n` +
  `/* This file is owned by Dioramai. Edit dioramaiScene for MVP code -> runtime sync. */\n` +
  `import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';\n` +
  `import { Environment, useGLTF } from '@react-three/drei';\n` +
  `import { SkeletonUtils } from 'three-stdlib';\n\n` +
  `type Vec3 = readonly [number, number, number];\n` +
  `type DioramaiLight =\n` +
  `  | { kind: 'ambient'; intensity?: number; color?: string }\n` +
  `  | { kind: 'directional'; intensity?: number; color?: string; castShadow?: boolean }\n` +
  `  | { kind: 'point'; intensity?: number; color?: string; distance?: number; decay?: number; castShadow?: boolean }\n` +
  `  | { kind: 'spot'; intensity?: number; color?: string; distance?: number; decay?: number; angle?: number; penumbra?: number; castShadow?: boolean };\n` +
  `type DioramaiEnvironment = { hdriUri?: string; enabled?: boolean; showBackground?: boolean; intensity?: number; rotationY?: number; backgroundColor?: string };\n` +
  `type DioramaiRenderSettings = { maxPixelRatio?: number; shadows?: boolean; shadowMapSize?: number; renderOnDemand?: boolean; antialias?: boolean; powerPreference?: 'default' | 'high-performance' | 'low-power' };\n` +
  `type DioramaiNode = {\n` +
  `  id: string;\n` +
  `  name: string;\n` +
  `  type: 'root' | 'group' | 'mesh' | 'light' | 'empty';\n` +
  `  visible: boolean;\n` +
  `  children: readonly string[];\n` +
  `  transform: { position: Vec3; rotation: Vec3; scale: Vec3 };\n` +
  `  metadata: Record<string, unknown>;\n` +
  `  assetRef?: { kind: 'none' } | { kind: 'uri'; uri: string };\n` +
  `  light?: DioramaiLight;\n` +
  `  [key: string]: unknown;\n` +
  `};\n` +
  `type DioramaiSceneData = { rootId: string; nodes: Record<string, DioramaiNode>; environment?: DioramaiEnvironment; renderSettings?: DioramaiRenderSettings; [key: string]: unknown };\n` +
  `type DioramaiSceneDocument = { format: 'dioramai-scene'; version: 2; data: DioramaiSceneData };\n\n` +
  `type GltfProjection = { nodeId: string; name: string; gltfPath: string; visible: boolean; transform: DioramaiNode['transform'] };\n\n` +
  `export const dioramaiScene = (\n` +
  `${DIORAMAI_SCENE_BLOCK_START}\n` +
  `${sceneJson}\n` +
  `${DIORAMAI_SCENE_BLOCK_END}\n` +
  `) as const satisfies DioramaiSceneDocument;\n\n` +
  `const dioramaiRenderSettings: DioramaiRenderSettings = dioramaiScene.data.renderSettings ?? {};\n` +
  `const dioramaiShadowMapSize: [number, number] = [dioramaiRenderSettings.shadowMapSize ?? 1024, dioramaiRenderSettings.shadowMapSize ?? 1024];\n\n` +
  `/** Performance-tuned props for the host <Canvas>; spread these in your app shell. */\n` +
  `export const dioramaiCanvasProps = {\n` +
  `  shadows: dioramaiRenderSettings.shadows ?? true,\n` +
  `  dpr: [Math.min(1, dioramaiRenderSettings.maxPixelRatio ?? 2), dioramaiRenderSettings.maxPixelRatio ?? 2] as [number, number],\n` +
  `  frameloop: (dioramaiRenderSettings.renderOnDemand ? 'demand' : 'always') as 'demand' | 'always',\n` +
  `  gl: {\n` +
  `    antialias: dioramaiRenderSettings.antialias ?? true,\n` +
  `    powerPreference: dioramaiRenderSettings.powerPreference ?? 'default',\n` +
  `  },\n` +
  `};\n\n` +
  `function vec3(value: Vec3): [number, number, number] {\n` +
  `  return [value[0], value[1], value[2]];\n` +
  `}\n\n` +
  `function isRenderableAssetUri(uri: string | undefined): string | undefined {\n` +
  `  if (!uri || !/\\.(glb|gltf)(\\?|#|$)/i.test(uri)) return undefined;\n` +
  `  if (uri.startsWith('file://') || uri.startsWith('http://') || uri.startsWith('https://')) return undefined;\n` +
  `  if (uri.includes('/Users/') || uri.includes('\\\\Users\\\\')) return undefined;\n` +
  `  if (/^[a-zA-Z]:\\\\/.test(uri)) return undefined;\n` +
  `  if (uri.startsWith('/assets/') || uri.startsWith('assets/') || uri.startsWith('./') || uri.startsWith('../')) return uri;\n` +
  `  return undefined;\n` +
  `}\n\n` +
  `function collectGltfNodeProjections(scene: DioramaiSceneData, assetNodeId: string): GltfProjection[] {\n` +
  `  const out: GltfProjection[] = [];\n` +
  `  const visit = (nodeId: string) => {\n` +
  `    const node = scene.nodes[nodeId];\n` +
  `    if (!node) return;\n` +
  `    if (node.metadata.renderMode === 'gltf-inspect-only' && node.metadata.source === 'gltf' && typeof node.metadata.gltfPath === 'string' && typeof node.metadata.gltfNodeIndex === 'number') {\n` +
  `      out.push({ nodeId: node.id, name: node.name, gltfPath: node.metadata.gltfPath, visible: node.visible !== false, transform: node.transform });\n` +
  `    }\n` +
  `    node.children.forEach(visit);\n` +
  `  };\n` +
  `  scene.nodes[assetNodeId]?.children.forEach(visit);\n` +
  `  return out;\n` +
  `}\n\n` +
  `function gltfScenePathSlots(gltfPath: string): number[] | null {\n` +
  `  const match = /^scene:\\d+\\/(.+)$/.exec(gltfPath);\n` +
  `  if (!match) return null;\n` +
  `  const slots = match[1].split('/').map((part) => Number(part));\n` +
  `  return slots.every((slot) => Number.isInteger(slot) && slot >= 0) ? slots : null;\n` +
  `}\n\n` +
  `function objectAtGltfScenePath(root: any, gltfPath: string): any | null {\n` +
  `  const slots = gltfScenePathSlots(gltfPath);\n` +
  `  if (!slots || !Array.isArray(root?.children)) return null;\n` +
  `  let current = root;\n` +
  `  for (const slot of slots) {\n` +
  `    const next = current.children?.[slot];\n` +
  `    if (!next || !Array.isArray(next.children)) return null;\n` +
  `    current = next;\n` +
  `  }\n` +
  `  return current;\n` +
  `}\n\n` +
  `function applyGltfProjectionTransform(object: any, transform: DioramaiNode['transform']) {\n` +
  `  object.position?.set?.(transform.position[0], transform.position[1], transform.position[2]);\n` +
  `  object.rotation?.set?.(transform.rotation[0], transform.rotation[1], transform.rotation[2]);\n` +
  `  object.scale?.set?.(transform.scale[0], transform.scale[1], transform.scale[2]);\n` +
  `}\n\n` +
  `function applyGltfNodeProjections(root: any, projections: readonly GltfProjection[]) {\n` +
  `  const depth = (projection: GltfProjection) => gltfScenePathSlots(projection.gltfPath)?.length ?? 0;\n` +
  `  for (const projection of [...projections].sort((a, b) => depth(a) - depth(b))) {\n` +
  `    const target = objectAtGltfScenePath(root, projection.gltfPath);\n` +
  `    if (!target) continue;\n` +
  `    applyGltfProjectionTransform(target, projection.transform);\n` +
  `    target.visible = projection.visible;\n` +
  `    target.name = target.name || projection.name;\n` +
  `    target.traverse?.((object: any) => {\n` +
  `      object.userData = { ...object.userData, dioramaiId: projection.nodeId, sourceId: projection.nodeId };\n` +
  `    });\n` +
  `  }\n` +
  `}\n\n` +
  `function AssetModel({ uri, projections }: { uri: string; projections: readonly GltfProjection[] }) {\n` +
  `  const gltf = useGLTF(uri);\n` +
  `  const object = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);\n` +
  `  useLayoutEffect(() => {\n` +
  `    applyGltfNodeProjections(object, projections);\n` +
  `  }, [object, projections]);\n` +
  `  return <primitive object={object} />;\n` +
  `}\n\n` +
  `function ProxyMesh() {\n` +
  `  return (\n` +
  `    <mesh castShadow receiveShadow>\n` +
  `      <boxGeometry args={[1, 1, 1]} />\n` +
  `      <meshStandardMaterial color="#94a3b8" />\n` +
  `    </mesh>\n` +
  `  );\n` +
  `}\n\n` +
  `function DioramaiLightView({ light }: { light: DioramaiLight }) {\n` +
  `  const targetRef = useRef<any>(null);\n` +
  `  const lightRef = useRef<any>(null);\n` +
  `  useLayoutEffect(() => {\n` +
  `    if (lightRef.current && targetRef.current && 'target' in lightRef.current) {\n` +
  `      lightRef.current.target = targetRef.current;\n` +
  `      targetRef.current.updateMatrixWorld?.();\n` +
  `    }\n` +
  `  });\n` +
  `  const color = light.color ?? '#ffffff';\n` +
  `  if (light.kind === 'ambient') return <ambientLight color={color} intensity={light.intensity ?? 0.4} />;\n` +
  `  if (light.kind === 'point') return <pointLight color={color} intensity={light.intensity ?? 1} distance={light.distance ?? 0} decay={light.decay ?? 2} castShadow={light.castShadow ?? false} shadow-mapSize={dioramaiShadowMapSize} />;\n` +
  `  if (light.kind === 'spot') return (\n` +
  `    <>\n` +
  `      <spotLight ref={lightRef} color={color} intensity={light.intensity ?? 1} distance={light.distance ?? 0} decay={light.decay ?? 2} angle={light.angle ?? Math.PI / 6} penumbra={light.penumbra ?? 0} castShadow={light.castShadow ?? false} shadow-mapSize={dioramaiShadowMapSize} />\n` +
  `      <object3D ref={targetRef} position={[0, 0, -1]} />\n` +
  `    </>\n` +
  `  );\n` +
  `  return (\n` +
  `    <>\n` +
  `      <directionalLight ref={lightRef} color={color} intensity={light.intensity ?? 1} castShadow={light.castShadow ?? false} shadow-mapSize={dioramaiShadowMapSize} />\n` +
  `      <object3D ref={targetRef} position={[0, 0, -1]} />\n` +
  `    </>\n` +
  `  );\n` +
  `}\n\n` +
  `function DioramaiEnvironmentView({ environment }: { environment?: DioramaiEnvironment }) {\n` +
  `  if (!environment?.enabled || !environment.hdriUri) return null;\n` +
  `  return (\n` +
  `    <Suspense fallback={null}>\n` +
  `      <Environment files={environment.hdriUri} background={environment.showBackground ?? false} environmentIntensity={environment.intensity ?? 1} environmentRotation={[0, environment.rotationY ?? 0, 0]} backgroundRotation={[0, environment.rotationY ?? 0, 0]} />\n` +
  `    </Suspense>\n` +
  `  );\n` +
  `}\n\n` +
  `function SceneNode({ scene, nodeId }: { scene: DioramaiSceneData; nodeId: string }) {\n` +
  `  const node = scene.nodes[nodeId];\n` +
  `  if (!node || node.visible === false) return null;\n` +
  `  const hasLight = node.light !== undefined || node.type === 'light';\n` +
  `  const inspectOnly = node.metadata.renderMode === 'gltf-inspect-only';\n` +
  `  const assetUri = isRenderableAssetUri(node.assetRef?.kind === 'uri' ? node.assetRef.uri : undefined);\n` +
  `  const showMesh = node.type === 'mesh' && !hasLight && !inspectOnly;\n` +
  `  const showAsset = showMesh && assetUri !== undefined;\n` +
  `  const showProxy = showMesh && !showAsset;\n` +
  `  const gltfNodeProjections = showAsset ? collectGltfNodeProjections(scene, nodeId) : [];\n` +
  `  return (\n` +
  `    <group\n` +
  `      name={node.name}\n` +
  `      position={vec3(node.transform.position)}\n` +
  `      rotation={vec3(node.transform.rotation)}\n` +
  `      scale={vec3(node.transform.scale)}\n` +
  `      userData={{ dioramaiId: node.id, sourceId: node.id }}\n` +
  `    >\n` +
  `      {hasLight && node.light && !inspectOnly ? <DioramaiLightView light={node.light} /> : null}\n` +
  `      {showAsset ? (\n` +
  `        <Suspense fallback={<ProxyMesh />}>\n` +
  `          <AssetModel uri={assetUri} projections={gltfNodeProjections} />\n` +
  `        </Suspense>\n` +
  `      ) : null}\n` +
  `      {showProxy ? <ProxyMesh /> : null}\n` +
  `      {node.children.map((childId) => <SceneNode key={childId} scene={scene} nodeId={childId} />)}\n` +
  `    </group>\n` +
  `  );\n` +
  `}\n\n` +
  `export function ${componentName}() {\n` +
  `  const scene = dioramaiScene.data;\n` +
  `  const environmentActive = Boolean(scene.environment?.enabled && scene.environment.hdriUri);\n` +
  `  return (\n` +
  `    <>\n` +
  `      <DioramaiEnvironmentView environment={scene.environment} />\n` +
  (includeStudioLights
    ? `      {!environmentActive ? (\n` +
      `        <>\n` +
      `          <ambientLight intensity={0.4} />\n` +
      `          <directionalLight castShadow position={[5, 8, 5]} intensity={1.1} shadow-mapSize={dioramaiShadowMapSize} />\n` +
      `        </>\n` +
      `      ) : null}\n`
    : '') +
  `      <SceneNode scene={scene} nodeId={scene.rootId} />\n` +
  `    </>\n` +
  `  );\n` +
  `}\n`;

export const exportSceneToR3fSyncModule = (
  scene: Scene,
  options: R3fSyncModuleExportOptions = {},
): R3fExportResult => ({
  code: renderSyncModule(
    serializeScene(scene),
    safeComponentName(options.componentName),
    options.includeStudioLights === true || options.includeLights === true,
  ),
  diagnostics: [],
});

export const extractSceneJsonFromR3fSyncModule = (code: string): string | null => {
  const start = code.indexOf(DIORAMAI_SCENE_BLOCK_START);
  const end = code.indexOf(DIORAMAI_SCENE_BLOCK_END);
  if (start < 0 || end < 0 || end <= start) return null;
  return code.slice(start + DIORAMAI_SCENE_BLOCK_START.length, end).trim();
};

export const parseSceneFromR3fSyncModule = (
  code: string,
): R3fSyncModuleSceneParseResult => {
  const json = extractSceneJsonFromR3fSyncModule(code);
  if (json === null) {
    return {
      ok: false,
      error: {
        code: 'SCENE_BLOCK_NOT_FOUND',
        message: 'Generated Dioramai scene block was not found.',
      },
    };
  }
  const scene = parseSceneJson(json);
  if (scene === null) {
    return {
      ok: false,
      error: {
        code: 'SCENE_BLOCK_INVALID',
        message: 'Generated Dioramai scene block failed JSON parsing or schema validation.',
      },
    };
  }
  return { ok: true, scene, json };
};

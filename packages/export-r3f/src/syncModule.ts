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
  `import { Suspense, useLayoutEffect, useMemo } from 'react';\n` +
  `import { useGLTF } from '@react-three/drei';\n` +
  `import { SkeletonUtils } from 'three-stdlib';\n\n` +
  `type Vec3 = readonly [number, number, number];\n` +
  `type DioramaiNode = {\n` +
  `  id: string;\n` +
  `  name: string;\n` +
  `  type: 'root' | 'group' | 'mesh' | 'light' | 'empty';\n` +
  `  visible: boolean;\n` +
  `  children: readonly string[];\n` +
  `  transform: { position: Vec3; rotation: Vec3; scale: Vec3 };\n` +
  `  metadata: Record<string, unknown>;\n` +
  `  assetRef?: { kind: 'none' } | { kind: 'uri'; uri: string };\n` +
  `  light?: { kind: 'ambient'; intensity?: number } | { kind: 'directional'; intensity?: number; castShadow?: boolean };\n` +
  `  [key: string]: unknown;\n` +
  `};\n` +
  `type DioramaiSceneData = { rootId: string; nodes: Record<string, DioramaiNode>; [key: string]: unknown };\n` +
  `type DioramaiSceneDocument = { format: 'dioramai-scene'; version: 2; data: DioramaiSceneData };\n\n` +
  `type GltfProjection = { nodeId: string; name: string; gltfPath: string; visible: boolean; transform: DioramaiNode['transform'] };\n\n` +
  `export const dioramaiScene = (\n` +
  `${DIORAMAI_SCENE_BLOCK_START}\n` +
  `${sceneJson}\n` +
  `${DIORAMAI_SCENE_BLOCK_END}\n` +
  `) as const satisfies DioramaiSceneDocument;\n\n` +
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
  `      {hasLight && node.light?.kind === 'ambient' ? <ambientLight intensity={node.light.intensity ?? 0.4} /> : null}\n` +
  `      {hasLight && node.light?.kind === 'directional' ? <directionalLight intensity={node.light.intensity ?? 1} castShadow={node.light.castShadow} /> : null}\n` +
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
  `  return (\n` +
  `    <>\n` +
  (includeStudioLights
    ? `      <ambientLight intensity={0.4} />\n` +
      `      <directionalLight castShadow position={[5, 8, 5]} intensity={1.1} />\n`
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

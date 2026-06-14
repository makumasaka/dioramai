import { relative } from 'node:path';
import type { Scene } from '@dioramai/core';
import { comparableAssetUri, type OutOfBandAssetUsage } from './outOfBandAssetUsage';

export type HiddenCanonicalAssetNode = {
  nodeId: string;
  nodeName: string;
  assetUri: string;
  comparableUri: string;
  matchedOutOfBandLoader: boolean;
};

export type OpaqueCanonicalAssetNode = {
  nodeId: string;
  nodeName: string;
  assetUri: string;
  comparableUri: string;
};

const normalizeRelativePath = (value: string): string => value.replace(/\\/g, '/');

const summarizeList = (values: string[], max = 3): string => {
  if (values.length <= max) return values.join(', ');
  return `${values.slice(0, max).join(', ')}, +${values.length - max} more`;
};

const isGltfAssetUri = (value: string): boolean =>
  /\.(glb|gltf)(\?|#|$)/i.test(value.trim());

export const findHiddenCanonicalAssetNodes = (
  scene: Scene | null,
  options: {
    projectRoot: string;
    assetDirPath: string;
    publicAssetBase: string;
    outOfBandAssetUsages: OutOfBandAssetUsage[];
  },
): HiddenCanonicalAssetNode[] => {
  if (scene === null) return [];
  const assetDirRelativePath = normalizeRelativePath(relative(options.projectRoot, options.assetDirPath));
  const outOfBandUris = new Set(
    options.outOfBandAssetUsages.flatMap((usage) => usage.assetUris),
  );

  return Object.values(scene.nodes)
    .filter((node) =>
      node.visible === false &&
      node.assetRef?.kind === 'uri' &&
      isGltfAssetUri(node.assetRef.uri),
    )
    .map((node) => {
      const assetUri = node.assetRef?.kind === 'uri' ? node.assetRef.uri : '';
      const comparableUri = comparableAssetUri(
        assetUri,
        options.publicAssetBase,
        assetDirRelativePath,
      );
      return {
        nodeId: node.id,
        nodeName: node.name,
        assetUri,
        comparableUri,
        matchedOutOfBandLoader: outOfBandUris.has(comparableUri),
      };
    });
};

export const hiddenCanonicalAssetNodesMessage = (
  nodes: HiddenCanonicalAssetNode[],
): string => {
  const nodeSummary = summarizeList(
    nodes.map((node) => `${node.nodeName} (${node.comparableUri})`),
  );
  if (nodes.some((node) => node.matchedOutOfBandLoader)) {
    return `Canonical GLB/GLTF nodes are hidden while app code also loads the same asset outside Dioramai: ${nodeSummary}. These models can render in npm run dev while disappearing from the dioramai.design shell.`;
  }
  return `Canonical GLB/GLTF nodes are hidden: ${nodeSummary}. Hidden asset nodes stay in the outline but are skipped by the runtime viewport.`;
};

export const hiddenCanonicalAssetNodesFix =
  'Keep canonical GLB nodes visible and bind animation/playback logic to scene node IDs; remove duplicate app-side useGLTF loaders instead of hiding the scene node.';

const hasImportedGltfDescendant = (
  scene: Scene,
  nodeId: string,
  assetId: unknown,
): boolean => {
  const node = scene.nodes[nodeId];
  if (!node) return false;
  for (const childId of node.children) {
    const child = scene.nodes[childId];
    if (!child) continue;
    const isGltfInspectNode =
      child.metadata.renderMode === 'gltf-inspect-only' &&
      child.metadata.source === 'gltf' &&
      (assetId === undefined || child.metadata.assetId === assetId);
    if (isGltfInspectNode || hasImportedGltfDescendant(scene, childId, assetId)) {
      return true;
    }
  }
  return false;
};

export const findOpaqueCanonicalAssetNodes = (
  scene: Scene | null,
  options: {
    projectRoot: string;
    assetDirPath: string;
    publicAssetBase: string;
  },
): OpaqueCanonicalAssetNode[] => {
  if (scene === null) return [];
  const assetDirRelativePath = normalizeRelativePath(relative(options.projectRoot, options.assetDirPath));

  return Object.values(scene.nodes)
    .filter((node) =>
      node.visible !== false &&
      node.assetRef?.kind === 'uri' &&
      isGltfAssetUri(node.assetRef.uri) &&
      !hasImportedGltfDescendant(scene, node.id, node.metadata.assetId),
    )
    .map((node) => {
      const assetUri = node.assetRef?.kind === 'uri' ? node.assetRef.uri : '';
      const comparableUri = comparableAssetUri(
        assetUri,
        options.publicAssetBase,
        assetDirRelativePath,
      );
      return {
        nodeId: node.id,
        nodeName: node.name,
        assetUri,
        comparableUri,
      };
    });
};

export const opaqueCanonicalAssetNodesMessage = (
  nodes: OpaqueCanonicalAssetNode[],
): string => {
  const nodeSummary = summarizeList(
    nodes.map((node) => `${node.nodeName} (${node.comparableUri})`),
  );
  return `Canonical GLB/GLTF asset nodes have no imported internal hierarchy: ${nodeSummary}. They render as opaque single nodes, so the outline cannot expose meshes, bones, or joints for editor/MCP operations.`;
};

export const opaqueCanonicalAssetNodesFix =
  'Re-import the asset with import_glb_asset using importMode "hierarchy" (the default) so Dioramai creates stable glTF child nodes.';

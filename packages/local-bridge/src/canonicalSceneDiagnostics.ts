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

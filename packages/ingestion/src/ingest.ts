import { createNode, type Command, type DioramaiAsset } from '@dioramai/core';
import type { IngestAssetInput, IngestionOptions, IngestionResult } from './types';
import { planGltfHierarchyFromFile } from './gltfHierarchy';

const hashText = (value: string): string => {
  let hash = 2166136261;
  for (const ch of value) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
};

const basenameNoExt = (path: string): string => {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(0, idx) : fileName;
};

const localPathFromInput = (input: IngestAssetInput): string =>
  typeof input.localPath === 'string' ? input.localPath : '';

const defaultIdFromInput = (input: IngestAssetInput): string => {
  if ('id' in input && typeof input.id === 'string' && input.id.length > 0) {
    return input.id;
  }
  const seed = 'prompt' in input && typeof input.prompt === 'string' && input.prompt.length > 0
    ? input.prompt
    : localPathFromInput(input);
  return `asset-${hashText(seed)}`;
};

const providerFromInput = (input: IngestAssetInput): string =>
  input.provider !== undefined ? input.provider : 'manual';

const sourceFromInput = (input: IngestAssetInput): 'manual' | 'upload' | 'generator' =>
  input.source ?? 'manual';

const promptFromInput = (input: IngestAssetInput): string | undefined =>
  'prompt' in input && typeof input.prompt === 'string' ? input.prompt : undefined;

const uriFromInput = (input: IngestAssetInput): string | undefined => {
  if ('uri' in input && typeof input.uri === 'string' && input.uri.length > 0) {
    return input.uri;
  }
  return undefined;
};

const toAsset = (input: IngestAssetInput, assetId: string): DioramaiAsset => {
  const localPath = localPathFromInput(input);
  const format = input.format === 'gltf' ? 'gltf' : 'glb';
  const localName = basenameNoExt(localPath);
  const prompt = promptFromInput(input);
  const uri = uriFromInput(input);
  const source = sourceFromInput(input);
  return {
    id: assetId,
    name: localName.length > 0 ? localName : 'Generated Asset',
    kind: format,
    ...(uri ? { uri } : {}),
    source,
    ...(source === 'generator'
      ? {
          generator: {
            provider: providerFromInput(input),
            ...(prompt ? { prompt } : {}),
          },
        }
      : {}),
    metadata: {
      source,
      provider: providerFromInput(input),
      ...(prompt ? { prompt } : {}),
      ...(localPath.length > 0 ? { localPath } : {}),
      ...(input.metadata !== undefined ? input.metadata : {}),
    },
  };
};

export const ingestAsset = (
  input: IngestAssetInput,
  options: IngestionOptions = {},
): IngestionResult => {
  const warnings: string[] = [];
  const localPath = localPathFromInput(input);
  if (localPath.trim().length === 0) {
    return {
      commands: [],
      warnings: ['ingestAsset requires a non-empty localPath'],
    };
  }

  const parentId = options.parentId ?? 'root';
  const assetId = defaultIdFromInput(input);
  const asset = toAsset(input, assetId);
  if (asset.uri === undefined) {
    warnings.push('Asset URI is missing; exporter may use placeholder output until uri is set.');
  }

  const nodeId = options.nodeId ?? `${assetId}-node`;
  const node = createNode({
    id: nodeId,
    name: options.nodeName ?? 'Generated Product',
    type: 'mesh',
    assetRef: asset.uri ? { kind: 'uri', uri: asset.uri } : { kind: 'none' },
    metadata: {
      source: sourceFromInput(input),
      provider: providerFromInput(input),
      ...(promptFromInput(input) ? { prompt: promptFromInput(input) } : {}),
      assetId,
      localPath,
    },
    semantics: {
      role: 'product',
      source: 'import',
    },
    semanticRole: 'product',
  });

  const commands: Command[] = [
    { type: 'REGISTER_ASSET', asset },
    { type: 'ADD_NODE', parentId, node },
  ];

  return {
    commands,
    warnings,
    assets: [asset],
  };
};

export const ingestAssetWithHierarchy = async (
  input: IngestAssetInput,
  options: IngestionOptions = {},
): Promise<IngestionResult> => {
  const result = ingestAsset(input, options);
  if (options.includeHierarchy !== true || result.commands.length === 0) return result;

  const asset = result.assets?.[0];
  const localPath = localPathFromInput(input);
  const assetNode = result.commands.find((command) => command.type === 'ADD_NODE');
  if (asset === undefined || assetNode?.type !== 'ADD_NODE') {
    return {
      ...result,
      warnings: [
        ...result.warnings,
        'GLB hierarchy introspection skipped because ingestAsset did not create an asset node.',
      ],
    };
  }

  try {
    const hierarchy = await planGltfHierarchyFromFile(options.sourceFilePath ?? localPath, {
      assetId: asset.id,
      ...(asset.uri !== undefined ? { assetUri: asset.uri } : {}),
      parentNodeId: assetNode.node.id,
      ...(options.maxHierarchyNodes !== undefined ? { maxNodes: options.maxHierarchyNodes } : {}),
    });
    return {
      ...result,
      commands: [...result.commands, ...hierarchy.commands],
      warnings: [...result.warnings, ...hierarchy.warnings],
    };
  } catch (error) {
    return {
      ...result,
      warnings: [
        ...result.warnings,
        `GLB hierarchy introspection failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
};

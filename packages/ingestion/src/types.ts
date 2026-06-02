import type { Command, DioramaiAsset } from '@dioramai/core';

export type AssetProvider = 'manual' | 'upload' | 'mock';

export type IngestAssetInput =
  {
    localPath: string;
    format: 'glb' | 'gltf';
    id?: string;
    uri?: string;
    prompt?: string;
    provider?: AssetProvider;
    source?: 'manual' | 'upload' | 'generator';
    metadata?: Record<string, unknown>;
  };

export type IngestionOptions = {
  parentId?: string;
  nodeId?: string;
  nodeName?: string;
  includeHierarchy?: boolean;
  maxHierarchyNodes?: number;
  sourceFilePath?: string;
};

export type IngestionResult = {
  commands: Command[];
  warnings: string[];
  assets?: DioramaiAsset[];
};

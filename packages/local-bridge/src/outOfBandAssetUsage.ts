import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import type { Scene } from '@dioramai/core';

export type OutOfBandAssetUsage = {
  relativePath: string;
  line: number;
  loaders: string[];
  assetUris: string[];
  unregisteredAssetUris: string[];
};

const DEFAULT_PUBLIC_ASSET_BASE = '/assets/models';
const SOURCE_SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SOURCE_SCAN_SKIP_DIRS = new Set([
  '.dioramai',
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'dist-ssr',
  'node_modules',
]);
const MAX_SOURCE_SCAN_FILES = 300;
const MAX_SOURCE_SCAN_BYTES = 512 * 1024;

const normalizeRelativePath = (value: string): string => value.replace(/\\/g, '/');

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const publicBaseForScan = (publicAssetBase: string): string => {
  const normalized = trimTrailingSlash(publicAssetBase.trim());
  if (normalized.length === 0) return DEFAULT_PUBLIC_ASSET_BASE;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const comparableAssetUri = (
  value: string,
  publicAssetBase: string,
  assetDirRelativePath: string,
): string => {
  const withoutHash = value.trim().replace(/\\/g, '/').split('#')[0] ?? value;
  const clean = withoutHash.split('?')[0] ?? withoutHash;
  const publicBase = publicBaseForScan(publicAssetBase);
  const assetDir = trimTrailingSlash(normalizeRelativePath(assetDirRelativePath).replace(/^\/+/, ''));

  if (assetDir.length > 0 && clean.startsWith(`${assetDir}/`)) {
    return `${publicBase}/${clean.slice(assetDir.length + 1)}`;
  }
  if (clean.startsWith(`${publicBase}/`)) return clean;
  const fallbackIndex = clean.indexOf('/assets/models/');
  if (fallbackIndex >= 0) return clean.slice(fallbackIndex);
  return clean;
};

const sceneAssetUris = (
  scene: Scene | null,
  publicAssetBase: string,
  assetDirRelativePath: string,
): Set<string> => {
  const uris = new Set<string>();
  if (scene === null) return uris;
  for (const asset of Object.values(scene.assets ?? {})) {
    if (typeof asset.uri === 'string') {
      uris.add(comparableAssetUri(asset.uri, publicAssetBase, assetDirRelativePath));
    }
  }
  for (const node of Object.values(scene.nodes)) {
    if (node.assetRef?.kind === 'uri') {
      uris.add(comparableAssetUri(node.assetRef.uri, publicAssetBase, assetDirRelativePath));
    }
  }
  return uris;
};

const lineNumberAt = (content: string, index: number): number =>
  content.slice(0, index).split(/\r\n|\r|\n/).length;

const uniqueSorted = (values: string[]): string[] => Array.from(new Set(values)).sort();

const isLikelyProjectGltfReference = (
  value: string,
  publicAssetBase: string,
  assetDirRelativePath: string,
): boolean => {
  const clean = value.trim().replace(/\\/g, '/');
  const publicBase = publicBaseForScan(publicAssetBase);
  const assetDir = trimTrailingSlash(normalizeRelativePath(assetDirRelativePath).replace(/^\/+/, ''));
  return (
    clean.startsWith(`${publicBase}/`) ||
    clean.includes('/assets/models/') ||
    (assetDir.length > 0 && clean.startsWith(`${assetDir}/`))
  );
};

const extractGltfAssetUris = (
  content: string,
  publicAssetBase: string,
  assetDirRelativePath: string,
): string[] => {
  const uris: string[] = [];
  const literalPattern = /['"`]([^'"`\r\n]*\.(?:glb|gltf)(?:[?#][^'"`\r\n]*)?)['"`]/gi;
  let match: RegExpExecArray | null;
  while ((match = literalPattern.exec(content)) !== null) {
    const uri = match[1] ?? '';
    if (isLikelyProjectGltfReference(uri, publicAssetBase, assetDirRelativePath)) {
      uris.push(comparableAssetUri(uri, publicAssetBase, assetDirRelativePath));
    }
  }
  return uniqueSorted(uris);
};

const gltfLoaderNames = (content: string): string[] => {
  const loaders: string[] = [];
  if (/\buseGLTF\s*(?:<[^>\n]+>)?\(/.test(content)) loaders.push('useGLTF');
  if (/\buseLoader\s*(?:<[^>\n]+>)?\(\s*GLTFLoader\b/.test(content)) loaders.push('useLoader(GLTFLoader)');
  if (/\bnew\s+GLTFLoader\s*\(/.test(content)) loaders.push('new GLTFLoader()');
  return loaders;
};

const shouldSkipSourceFile = (
  relativePath: string,
  generatedModuleRelativePath: string,
  sceneJsonRelativePath: string,
  assetDirRelativePath: string,
): boolean => {
  const normalized = normalizeRelativePath(relativePath);
  const generated = normalizeRelativePath(generatedModuleRelativePath);
  const sceneJson = normalizeRelativePath(sceneJsonRelativePath);
  const assetDir = trimTrailingSlash(normalizeRelativePath(assetDirRelativePath));
  return (
    normalized === generated ||
    normalized === sceneJson ||
    normalized.startsWith('src/generated/') ||
    (assetDir.length > 0 && normalized.startsWith(`${assetDir}/`)) ||
    !SOURCE_SCAN_EXTENSIONS.has(extname(normalized).toLowerCase())
  );
};

const collectSourceFiles = async (
  projectRoot: string,
  directory: string,
  options: {
    generatedModuleRelativePath: string;
    sceneJsonRelativePath: string;
    assetDirRelativePath: string;
  },
  files: string[] = [],
): Promise<string[]> => {
  if (files.length >= MAX_SOURCE_SCAN_FILES) return files;
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= MAX_SOURCE_SCAN_FILES) break;
    const absolutePath = resolve(directory, entry.name);
    const relativePath = normalizeRelativePath(relative(projectRoot, absolutePath));
    if (entry.isDirectory()) {
      if (SOURCE_SCAN_SKIP_DIRS.has(entry.name) || relativePath.startsWith('src/generated')) continue;
      await collectSourceFiles(projectRoot, absolutePath, options, files);
    } else if (
      entry.isFile() &&
      !shouldSkipSourceFile(
        relativePath,
        options.generatedModuleRelativePath,
        options.sceneJsonRelativePath,
        options.assetDirRelativePath,
      )
    ) {
      files.push(absolutePath);
    }
  }
  return files;
};

export const scanOutOfBandAssetUsage = async (
  projectRoot: string,
  options: {
    generatedModulePath: string;
    sceneJsonPath: string;
    assetDirPath: string;
    publicAssetBase: string;
    canonicalScene: Scene | null;
  },
): Promise<OutOfBandAssetUsage[]> => {
  const generatedModuleRelativePath = normalizeRelativePath(relative(projectRoot, options.generatedModulePath));
  const sceneJsonRelativePath = normalizeRelativePath(relative(projectRoot, options.sceneJsonPath));
  const assetDirRelativePath = normalizeRelativePath(relative(projectRoot, options.assetDirPath));
  const canonicalUris = sceneAssetUris(options.canonicalScene, options.publicAssetBase, assetDirRelativePath);
  const files = await collectSourceFiles(projectRoot, projectRoot, {
    generatedModuleRelativePath,
    sceneJsonRelativePath,
    assetDirRelativePath,
  });
  const usages: OutOfBandAssetUsage[] = [];

  for (const file of files) {
    try {
      const sourceStat = await stat(file);
      if (!sourceStat.isFile() || sourceStat.size > MAX_SOURCE_SCAN_BYTES) continue;
      const content = await readFile(file, 'utf8');
      const loaders = gltfLoaderNames(content);
      const assetUris = extractGltfAssetUris(content, options.publicAssetBase, assetDirRelativePath);
      if (loaders.length === 0 && assetUris.length === 0) continue;
      const loaderMatch =
        /\buseGLTF\s*(?:<[^>\n]+>)?\(/.exec(content) ??
        /\buseLoader\s*(?:<[^>\n]+>)?\(\s*GLTFLoader\b/.exec(content) ??
        /\bnew\s+GLTFLoader\s*\(/.exec(content);
      const assetMatch = /['"`][^'"`\r\n]*\.(?:glb|gltf)(?:[?#][^'"`\r\n]*)?['"`]/i.exec(content);
      usages.push({
        relativePath: normalizeRelativePath(relative(projectRoot, file)),
        line: lineNumberAt(content, loaderMatch?.index ?? assetMatch?.index ?? 0),
        loaders,
        assetUris,
        unregisteredAssetUris: assetUris.filter((uri) => !canonicalUris.has(uri)),
      });
    } catch {
      // Source scanning is advisory; unreadable files should not block doctor/dev.
    }
  }

  return usages;
};

const summarizeList = (values: string[], max = 3): string => {
  if (values.length <= max) return values.join(', ');
  return `${values.slice(0, max).join(', ')}, +${values.length - max} more`;
};

export const outOfBandAssetUsageMessage = (usages: OutOfBandAssetUsage[]): string => {
  const locations = uniqueSorted(usages.map((usage) => `${usage.relativePath}:${usage.line}`));
  const unregisteredUris = uniqueSorted(usages.flatMap((usage) => usage.unregisteredAssetUris));
  const assetUris = uniqueSorted(usages.flatMap((usage) => usage.assetUris));
  if (unregisteredUris.length > 0) {
    return `App code loads ${summarizeList(unregisteredUris)} outside the canonical scene (${summarizeList(locations)}). These assets can render in npm run dev while staying invisible to Dioramai.`;
  }
  if (assetUris.length > 0) {
    return `App code references GLB/GLTF asset URLs outside the generated Dioramai scene (${summarizeList(locations)}). Keep GLB rendering in the canonical scene and bind runtime behavior to scene node IDs.`;
  }
  return `App code calls GLB/GLTF loader APIs outside the generated Dioramai scene (${summarizeList(locations)}). Keep GLB rendering in the canonical scene and bind runtime behavior to scene node IDs.`;
};

export const outOfBandAssetUsageFix =
  'Register GLBs with import_glb_asset, then bind animation/playback logic to the canonical node instead of loading the asset in sibling R3F components.';

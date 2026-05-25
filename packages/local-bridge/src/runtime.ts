import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import {
  applyCommandWithResult,
  cloneSceneImmutable,
  getStarterScene,
  validateScene,
  type Command,
  type Scene,
  type SemanticRole,
} from '@dioramai/core';
import { ingestAssetWithHierarchy, type IngestionResult } from '@dioramai/ingestion';
import {
  exportSceneToR3fSyncModule,
  parseSceneFromR3fSyncModule,
} from '@dioramai/export-r3f';
import { parseSceneJson, serializeScene } from '@dioramai/schema';

export const DEFAULT_BRIDGE_PORT = 7777;

type AgentResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; issues?: unknown } };

export type BridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; issues?: unknown } };

type JsonRecord = Record<string, unknown>;

type SceneEvent = {
  type: 'scene';
  scene: Scene;
  command?: Command;
  summary?: unknown;
  source: 'bridge' | 'mcp' | 'web' | 'code';
};

type BridgeLastSync =
  | { ok: true; path: string; bytesChanged: boolean; ts: number }
  | { ok: false; error: string; ts: number }
  | null;

type RuntimeApplyOptions = {
  dryRun?: boolean;
  source?: 'agent' | 'user' | 'system';
};

type LocalSceneRuntime = {
  getScene(): AgentResult<{ scene: Scene }>;
  applyCommand(command: unknown, options?: RuntimeApplyOptions): AgentResult<{
    scene: Scene;
    changed: boolean;
    summary: unknown;
    error?: string;
    warnings: string[];
    command: Command;
  }>;
  applyCommandBatch(commands: unknown, options?: RuntimeApplyOptions): AgentResult<{
    scene: Scene;
    changed: boolean;
    errors: unknown[];
    warnings: string[];
    dryRun: boolean;
    appliedCommandCount: number;
  }>;
  exportJSON(): AgentResult<{
    content: string;
    mediaType: 'application/json';
    scene: Scene;
  }>;
};

export type ImportAssetSource =
  | { kind: 'workspacePath'; path: string }
  | { kind: 'uploadedFile'; name: string; data: Buffer };

export type ImportAssetInput = {
  source: ImportAssetSource;
  importMode?: 'single' | 'shallow';
  name?: string;
  semanticRole?: SemanticRole;
  parentId?: string;
  dryRun?: boolean;
};

export type DioramaiBridgeRuntimeOptions = {
  projectRoot?: string;
  sessionRelativePath?: string;
  generatedModuleRelativePath?: string;
  assetDirRelativePath?: string;
  publicUrlBase?: string;
  watchCode?: boolean;
  codeWatchDebounceMs?: number;
  pairingToken?: string;
  allowedOrigins?: string[];
  onBrowserConnect?: (clientCount: number) => void;
};

export type DioramaiProjectConfig = {
  projectRoot?: string;
  assetDir?: string;
  generatedSceneFile?: string;
  publicAssetBase?: string;
  sceneJsonFile?: string;
};

export type ImportAssetResult = {
  assetId: string;
  commands: Command[];
  warnings: string[];
  sceneSummary: {
    nodeCount: number;
    assetCount: number;
    rootChildCount: number;
  };
  importedNodeIds: string[];
  hierarchySummary?: {
    nodeCount: number;
    rootNodeIds: string[];
  };
  scene: Scene;
  changed: boolean;
  dryRun: boolean;
  errors: unknown[];
  appliedCommandCount: number;
};

const DEFAULT_PROJECT_ROOT = resolve(process.env.DIORAMAI_PROJECT_ROOT ?? process.cwd());
const PRIMARY_CONFIG_FILE_NAME = 'dioramai.config.json';
const LEGACY_CONFIG_FILE_NAME = 'diorama.config.json';
const CONFIG_FILE_NAME = PRIMARY_CONFIG_FILE_NAME;
const DEFAULT_SESSION_RELATIVE_PATH = 'src/generated/dioramai.scene.json';
const DEFAULT_GENERATED_MODULE_RELATIVE_PATH = 'src/generated/DioramaiScene.generated.tsx';
const DEFAULT_ASSET_DIR_RELATIVE_PATH = 'public/assets/models';
const DEFAULT_PUBLIC_URL_BASE = '/assets/models';
const DEFAULT_COMPONENT_NAME = 'DioramaiScene';
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SEMANTIC_ROLES = new Set<SemanticRole>([
  'product',
  'display',
  'seating',
  'lighting',
  'light',
  'environment',
  'navigation',
  'decor',
  'container',
  'unknown',
]);

export const DEFAULT_PROJECT_CONFIG: Required<DioramaiProjectConfig> = {
  projectRoot: '.',
  assetDir: DEFAULT_ASSET_DIR_RELATIVE_PATH,
  generatedSceneFile: DEFAULT_GENERATED_MODULE_RELATIVE_PATH,
  publicAssetBase: DEFAULT_PUBLIC_URL_BASE,
  sceneJsonFile: DEFAULT_SESSION_RELATIVE_PATH,
};

const ok = <T>(data: T): BridgeResult<T> => ({ ok: true, data });

const fail = (code: string, message: string, issues?: unknown): BridgeResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(issues !== undefined ? { issues } : {}),
  },
});

const unwrap = <T>(result: AgentResult<T>, step: string): BridgeResult<T> =>
  result.ok ? ok(result.data) : fail(result.error.code, `${step}: ${result.error.message}`, result.error.issues);

const baseJsonHeaders = {
  'Access-Control-Allow-Headers': 'content-type,x-dioramai-token',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const semanticRoleFromValue = (value: unknown): SemanticRole | undefined =>
  typeof value === 'string' && SEMANTIC_ROLES.has(value as SemanticRole)
    ? value as SemanticRole
    : undefined;

const importModeFromValue = (value: unknown): ImportAssetInput['importMode'] | undefined =>
  value === 'single' || value === 'shallow' ? value : undefined;

const isCommand = (value: unknown): value is Command =>
  isRecord(value) && typeof value.type === 'string';

const localRuntimeError = (code: string, message: string, issues?: unknown): AgentResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(issues !== undefined ? { issues } : {}),
  },
});

const createLocalSceneRuntime = (initialScene: Scene): LocalSceneRuntime => {
  let currentScene = cloneSceneImmutable(initialScene);

  return {
    getScene() {
      return ok({ scene: cloneSceneImmutable(currentScene) });
    },

    applyCommand(command, options = {}) {
      if (!isCommand(command)) {
        return localRuntimeError('VALIDATION_ERROR', 'Expected a Dioramai command object.');
      }
      const result = applyCommandWithResult(currentScene, command);
      if (result.error !== undefined && !result.changed) {
        return localRuntimeError('COMMAND_REJECTED', result.error);
      }
      if (options.dryRun !== true) {
        currentScene = result.scene;
      }
      return ok({
        scene: cloneSceneImmutable(result.scene),
        changed: result.changed,
        summary: result.summary,
        ...(result.error !== undefined ? { error: result.error } : {}),
        warnings: result.warnings ?? [],
        command,
      });
    },

    applyCommandBatch(commands, options = {}) {
      if (!Array.isArray(commands)) {
        return localRuntimeError('VALIDATION_ERROR', 'Expected an array of Dioramai commands.');
      }

      let draft = currentScene;
      const errors: unknown[] = [];
      const warnings: string[] = [];
      let appliedCommandCount = 0;

      for (let index = 0; index < commands.length; index += 1) {
        const command = commands[index];
        if (!isCommand(command)) {
          errors.push({ index, error: 'Expected a Dioramai command object.' });
          continue;
        }
        const result = applyCommandWithResult(draft, command);
        if (result.error !== undefined && !result.changed) {
          errors.push({ index, command, error: result.error });
          continue;
        }
        if (result.warnings !== undefined) warnings.push(...result.warnings);
        if (result.changed) appliedCommandCount += 1;
        draft = result.scene;
      }

      const changed = draft !== currentScene;
      if (options.dryRun !== true) {
        currentScene = draft;
      }
      return ok({
        scene: cloneSceneImmutable(draft),
        changed,
        errors,
        warnings,
        dryRun: options.dryRun === true,
        appliedCommandCount,
      });
    },

    exportJSON() {
      return ok({
        content: serializeScene(currentScene),
        mediaType: 'application/json',
        scene: cloneSceneImmutable(currentScene),
      });
    },
  };
};

const isPathInside = (targetPath: string, rootPath: string): boolean => {
  const rel = relative(rootPath, targetPath);
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'));
};

const resolveProjectRoot = (projectRoot: string | undefined): string =>
  resolve(projectRoot ?? DEFAULT_PROJECT_ROOT);

const configString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const isRelativeProjectPath = (value: string): boolean =>
  !/^[a-zA-Z]:[\\/]/.test(value) &&
  !value.startsWith('/') &&
  !value.startsWith('\\') &&
  !value.includes('\0');

const readProjectConfigSync = (projectRoot: string): {
  found: boolean;
  path: string;
  config: DioramaiProjectConfig;
  warnings: string[];
} => {
  const primaryConfigPath = resolve(projectRoot, PRIMARY_CONFIG_FILE_NAME);
  const legacyConfigPath = resolve(projectRoot, LEGACY_CONFIG_FILE_NAME);
  const usingLegacyConfig = !existsSync(primaryConfigPath) && existsSync(legacyConfigPath);
  const configPath = usingLegacyConfig ? legacyConfigPath : primaryConfigPath;
  const baseWarnings = usingLegacyConfig
    ? [`Using legacy ${LEGACY_CONFIG_FILE_NAME}; prefer ${PRIMARY_CONFIG_FILE_NAME}.`]
    : [];
  if (!existsSync(configPath)) {
    return { found: false, path: configPath, config: {}, warnings: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    if (!isRecord(raw)) {
      return {
        found: true,
        path: configPath,
        config: {},
        warnings: [...baseWarnings, `${basename(configPath)} must contain a JSON object.`],
      };
    }
    return {
      found: true,
      path: configPath,
      config: {
        ...(configString(raw.projectRoot) !== undefined ? { projectRoot: configString(raw.projectRoot) } : {}),
        ...(configString(raw.assetDir) !== undefined ? { assetDir: configString(raw.assetDir) } : {}),
        ...(configString(raw.generatedSceneFile) !== undefined
          ? { generatedSceneFile: configString(raw.generatedSceneFile) }
          : {}),
        ...(configString(raw.publicAssetBase) !== undefined ? { publicAssetBase: configString(raw.publicAssetBase) } : {}),
        ...(configString(raw.sceneJsonFile) !== undefined ? { sceneJsonFile: configString(raw.sceneJsonFile) } : {}),
      },
      warnings: baseWarnings,
    };
  } catch (error) {
    return {
      found: true,
      path: configPath,
      config: {},
      warnings: [
        ...baseWarnings,
        `Failed to parse ${basename(configPath)}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
};

const configuredRelativePath = (
  config: DioramaiProjectConfig,
  key: 'assetDir' | 'generatedSceneFile' | 'sceneJsonFile',
  fallback: string,
): string => {
  const value = config[key] ?? fallback;
  if (!isRelativeProjectPath(value)) {
    throw new Error(`${key} in dioramai.config.json must be relative to the explicit project root.`);
  }
  return value.replace(/\\/g, '/');
};

export const resolveWorkspaceRelativePath = (
  workspaceRelativePath: string,
  projectRoot = DEFAULT_PROJECT_ROOT,
): BridgeResult<string> => {
  if (workspaceRelativePath.trim().length === 0 || workspaceRelativePath.includes('\0')) {
    return fail('VALIDATION_ERROR', 'workspaceRelativePath must be a non-empty workspace-relative path.');
  }
  if (/^[a-zA-Z]:[\\/]/.test(workspaceRelativePath) || workspaceRelativePath.startsWith('/') || workspaceRelativePath.startsWith('\\')) {
    return fail('VALIDATION_ERROR', 'workspaceRelativePath must be relative to the Dioramai project root.');
  }
  const root = resolveProjectRoot(projectRoot);
  const absolutePath = resolve(root, workspaceRelativePath);
  if (!isPathInside(absolutePath, root)) {
    return fail('VALIDATION_ERROR', 'workspaceRelativePath must stay inside the Dioramai project root.');
  }
  return ok(absolutePath);
};

const resolveProjectRelativePath = (
  projectRoot: string,
  workspaceRelativePath: string,
): BridgeResult<string> => resolveWorkspaceRelativePath(workspaceRelativePath, projectRoot);

const readRequestBuffer = async (
  req: IncomingMessage,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const raw = (await readRequestBuffer(req)).toString('utf8').trim();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as unknown;
};

const writeJson = (
  res: ServerResponse,
  statusCode: number,
  value: unknown,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(statusCode, { ...baseJsonHeaders, ...headers });
  res.end(JSON.stringify(value));
};

const isLocalHostname = (host: string): boolean =>
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host === '::1' ||
  host === '[::1]';

const isLocalHostHeader = (hostHeader: string | undefined): boolean => {
  if (!hostHeader) return false;
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0] ?? '';
  return isLocalHostname(host);
};

const originAllowedByList = (origin: string, allowedOrigins: string[]): boolean => {
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
};

const corsHeadersFor = (
  req: IncomingMessage,
  allowedOrigins: string[],
): Record<string, string> => {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return {};
  return originAllowedByList(origin, allowedOrigins)
    ? {
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
      }
    : {
        'Access-Control-Allow-Origin': 'null',
        Vary: 'Origin',
      };
};

const requestToken = (req: IncomingMessage, url: URL): string | undefined => {
  const header = req.headers['x-dioramai-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  return url.searchParams.get('token') ?? undefined;
};

const isBrowserRequestAuthorized = (
  req: IncomingMessage,
  url: URL,
  pairingToken: string,
): boolean => {
  if (typeof req.headers.origin !== 'string') return true;
  return requestToken(req, url) === pairingToken;
};

const contentTypeForAsset = (absolutePath: string): string => {
  switch (extname(absolutePath).toLowerCase()) {
    case '.glb':
      return 'model/gltf-binary';
    case '.gltf':
      return 'model/gltf+json';
    case '.bin':
      return 'application/octet-stream';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
};

const sendSse = (res: ServerResponse, event: SceneEvent): void => {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

const sanitizeStem = (stem: string): string => {
  const sanitized = stem
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'asset';
};

const safeFileNameFor = (sourcePath: string): { fileName: string; slug: string; format: 'glb' | 'gltf' } => {
  const fileName = basename(sourcePath);
  const rawExt = extname(fileName);
  const ext = rawExt.toLowerCase();
  if (ext !== '.glb' && ext !== '.gltf') {
    throw new Error('Expected a .glb or .gltf file.');
  }
  const rawStem = rawExt.length > 0 ? fileName.slice(0, -rawExt.length) : fileName;
  const stem = sanitizeStem(rawStem);
  return {
    fileName: `${stem}${ext}`,
    slug: stem.toLowerCase(),
    format: ext === '.gltf' ? 'gltf' : 'glb',
  };
};

const samePath = (left: string, right: string): boolean =>
  resolve(left).toLowerCase() === resolve(right).toLowerCase();

const copyFileIfDifferent = async (sourcePath: string, targetPath: string): Promise<void> => {
  if (samePath(sourcePath, targetPath)) return;
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
};

const writeFileIfDifferent = async (targetPath: string, data: Buffer): Promise<void> => {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, data);
};

const uniqueRecordId = <T>(
  baseId: string,
  record: Record<string, T> | undefined,
): string => {
  if (record?.[baseId] === undefined) return baseId;
  let suffix = 2;
  let candidate = `${baseId}-${suffix}`;
  while (record[candidate] !== undefined) {
    suffix += 1;
    candidate = `${baseId}-${suffix}`;
  }
  return candidate;
};

const commandNodeIds = (commands: Command[]): string[] =>
  commands
    .filter((command): command is Extract<Command, { type: 'ADD_NODE' }> => command.type === 'ADD_NODE')
    .map((command) => command.node.id);

const commandAssetId = (commands: Command[]): string | undefined =>
  commands.find((command): command is Extract<Command, { type: 'REGISTER_ASSET' }> =>
    command.type === 'REGISTER_ASSET',
  )?.asset.id;

const sceneSummary = (scene: Scene): ImportAssetResult['sceneSummary'] => ({
  nodeCount: Object.keys(scene.nodes).length,
  assetCount: Object.keys(scene.assets ?? {}).length,
  rootChildCount: scene.nodes[scene.rootId]?.children.length ?? 0,
});

const loadSceneFromFile = async (path: string): Promise<Scene | null> => {
  try {
    const text = await readFile(path, 'utf8');
    return parseSceneJson(text);
  } catch {
    return null;
  }
};

export const loadInitialBridgeScene = async (
  options: DioramaiBridgeRuntimeOptions = {},
): Promise<Scene> => {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const loadedConfig = readProjectConfigSync(projectRoot);
  const sessionRelativePath =
    options.sessionRelativePath ??
    configuredRelativePath(loadedConfig.config, 'sceneJsonFile', DEFAULT_SESSION_RELATIVE_PATH);
  const sessionPath = resolve(projectRoot, sessionRelativePath);
  return (await loadSceneFromFile(sessionPath)) ?? getStarterScene('default');
};

export type DioramaiInitTemplate = 'vite-r3f' | 'config';

export type DioramaiProjectInitOptions = {
  template?: DioramaiInitTemplate;
  force?: boolean;
};

export type DioramaiDoctorItem = {
  status: 'pass' | 'warn' | 'fail';
  label: string;
  message: string;
  fix?: string;
};

export type DioramaiDoctorResult = {
  ok: boolean;
  projectRoot: string;
  configPath: string;
  items: DioramaiDoctorItem[];
  glbFiles: string[];
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const isDirectoryEmpty = async (path: string): Promise<boolean> => {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    throw error;
  }
};

const projectFilePath = (projectRoot: string, relativePath: string): string => {
  if (!isRelativeProjectPath(relativePath)) {
    throw new Error(`${relativePath} must be relative to the Dioramai project root.`);
  }
  const absolutePath = resolve(projectRoot, relativePath);
  if (!isPathInside(absolutePath, projectRoot)) {
    throw new Error(`${relativePath} must stay inside the Dioramai project root.`);
  }
  return absolutePath;
};

const writeProjectTextFile = async (
  projectRoot: string,
  relativePath: string,
  content: string,
  force: boolean,
  wroteFiles: string[],
): Promise<void> => {
  const absolutePath = projectFilePath(projectRoot, relativePath);
  if (!force && existsSync(absolutePath)) {
    throw new Error(`${relativePath} already exists. Pass --force to overwrite it.`);
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
  wroteFiles.push(relativePath);
};

const ensureProjectDirectory = async (
  projectRoot: string,
  relativePath: string,
  wroteFiles: string[],
): Promise<void> => {
  const absolutePath = projectFilePath(projectRoot, relativePath);
  const existed = existsSync(absolutePath);
  await mkdir(absolutePath, { recursive: true });
  if (!existed) wroteFiles.push(`${relativePath.replace(/\\/g, '/')}/`);
};

const packageNameForRoot = (projectRoot: string): string => {
  const name = sanitizeStem(basename(projectRoot).toLowerCase()).replace(/^[._-]+/, '');
  return name.length > 0 ? name : 'dioramai-r3f-app';
};

const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const vitePackageJson = (projectRoot: string): string => jsonFile({
  name: packageNameForRoot(projectRoot),
  private: true,
  version: '0.0.0',
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'tsc -b && vite build',
    preview: 'vite preview',
    doctor: 'dioramai doctor',
    dioramai: 'dioramai',
    'dioramai:dev': 'dioramai dev --open',
    'dioramai:doctor': 'dioramai doctor',
  },
  dependencies: {
    '@react-three/drei': '^10.7.7',
    '@react-three/fiber': '^9.6.0',
    react: '^19.2.5',
    'react-dom': '^19.2.5',
    three: '^0.184.0',
  },
  devDependencies: {
    '@types/react': '^19.2.14',
    '@types/react-dom': '^19.2.3',
    '@vitejs/plugin-react': '^6.0.1',
    typescript: '~6.0.2',
    vite: '^8.0.9',
    dioramai: '^0.1.0',
  },
});

const gitignoreFile = (): string =>
  [
    'node_modules/',
    'dist/',
    'dist-ssr/',
    '.vite/',
    '.DS_Store',
    '',
    '.env',
    '.env.local',
    '.env.*.local',
    '!.env.example',
    '',
    '.dioramai/',
    '',
  ].join('\n');

const indexHtml = (): string =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <title>Dioramai R3F App</title>',
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');

const mainTsx = (): string =>
  [
    "import { StrictMode } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import './style.css';",
    "import { App } from './App';",
    '',
    "createRoot(document.getElementById('root')!).render(",
    '  <StrictMode>',
    '    <App />',
    '  </StrictMode>,',
    ');',
    '',
  ].join('\n');

const appTsx = (): string =>
  [
    "import { DioramaiApp } from './DioramaiApp';",
    '',
    'export function App() {',
    '  return <DioramaiApp />;',
    '}',
    '',
  ].join('\n');

const dioramaiAppTsx = (): string =>
  [
    "import { Canvas } from '@react-three/fiber';",
    "import { OrbitControls } from '@react-three/drei';",
    "import { DioramaiScene } from './generated/DioramaiScene.generated';",
    '',
    'export function DioramaiApp() {',
    '  return (',
    '    <main className="dioramai-app">',
    '      <Canvas camera={{ position: [4, 3, 6], fov: 50 }} shadows>',
    '        <color attach="background" args={["#0f172a"]} />',
    '        <OrbitControls makeDefault />',
    '        <DioramaiScene />',
    '      </Canvas>',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');

const styleCss = (): string =>
  [
    ':root {',
    '  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  color: #e5e7eb;',
    '  background: #0f172a;',
    '}',
    '',
    '* {',
    '  box-sizing: border-box;',
    '}',
    '',
    'body {',
    '  margin: 0;',
    '}',
    '',
    '.dioramai-app {',
    '  width: 100vw;',
    '  height: 100vh;',
    '  overflow: hidden;',
    '}',
    '',
  ].join('\n');

const componentsReadme = (): string =>
  [
    '# Components',
    '',
    'Put app-specific React components here. Keep Dioramai-generated scene code in `src/generated`.',
    '',
  ].join('\n');

const cursorRule = (): string =>
  [
    '---',
    'description: Dioramai local runtime sync guidance',
    'alwaysApply: true',
    '---',
    '',
    '- DioramaiScene.generated.tsx is generated by Dioramai.',
    '- Prefer editing the embedded `dioramaiScene` block for scene state changes.',
    '- Do not manually edit generated JSX unless intentionally changing Dioramai export output.',
    '- Put custom app logic in `App.tsx`, `DioramaiApp.tsx`, or separate user components.',
    '- Put GLB/GLTF assets under `public/assets/models` unless `dioramai.config.json` says otherwise.',
    '- Use Dioramai MCP tools for scene operations when available.',
    '',
  ].join('\n');

export const initializeDioramaiProject = async (
  projectRootInput: string,
  options: DioramaiProjectInitOptions = {},
): Promise<BridgeResult<{
  projectRoot: string;
  configPath: string;
  wroteConfig: boolean;
  assetDir: string;
  generatedModule: string;
  generatedDir: string;
  wroteFiles: string[];
}>> => {
  try {
    const projectRoot = resolveProjectRoot(projectRootInput);
    const template = options.template ?? 'vite-r3f';
    const force = options.force === true;
    await mkdir(projectRoot, { recursive: true });
    if (template === 'vite-r3f' && !force && !(await isDirectoryEmpty(projectRoot))) {
      return fail(
        'PROJECT_NOT_EMPTY',
        `Dioramai init expected an empty folder: ${projectRoot}`,
      );
    }

    const configPath = resolve(projectRoot, CONFIG_FILE_NAME);
    const wroteFiles: string[] = [];
    const starterScene = getStarterScene('default');
    const generatedModuleContent = exportSceneToR3fSyncModule(starterScene, {
      componentName: DEFAULT_COMPONENT_NAME,
      includeStudioLights: true,
    }).code;

    await writeProjectTextFile(projectRoot, CONFIG_FILE_NAME, jsonFile(DEFAULT_PROJECT_CONFIG), force, wroteFiles);
    const wroteConfig = wroteFiles.includes(CONFIG_FILE_NAME);

    const loadedConfig = readProjectConfigSync(projectRoot);
    const assetDir = resolve(projectRoot, configuredRelativePath(loadedConfig.config, 'assetDir', DEFAULT_ASSET_DIR_RELATIVE_PATH));
    const generatedModule = resolve(projectRoot, configuredRelativePath(loadedConfig.config, 'generatedSceneFile', DEFAULT_GENERATED_MODULE_RELATIVE_PATH));
    const sceneJson = resolve(projectRoot, configuredRelativePath(loadedConfig.config, 'sceneJsonFile', DEFAULT_SESSION_RELATIVE_PATH));
    if (!isPathInside(assetDir, projectRoot) || !isPathInside(generatedModule, projectRoot)) {
      return fail('VALIDATION_ERROR', 'Configured Dioramai paths must stay inside the explicit project root.');
    }
    await ensureProjectDirectory(projectRoot, loadedConfig.config.assetDir ?? DEFAULT_ASSET_DIR_RELATIVE_PATH, wroteFiles);
    await ensureProjectDirectory(projectRoot, dirname(loadedConfig.config.generatedSceneFile ?? DEFAULT_GENERATED_MODULE_RELATIVE_PATH).replace(/\\/g, '/'), wroteFiles);

    if (template === 'vite-r3f') {
      await writeProjectTextFile(projectRoot, 'package.json', vitePackageJson(projectRoot), force, wroteFiles);
      await writeProjectTextFile(projectRoot, '.gitignore', gitignoreFile(), force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'index.html', indexHtml(), force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'src/main.tsx', mainTsx(), force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'src/App.tsx', appTsx(), force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'src/DioramaiApp.tsx', dioramaiAppTsx(), force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'src/style.css', styleCss(), force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'src/components/README.md', componentsReadme(), force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'src/generated/DioramaiScene.generated.tsx', generatedModuleContent, force, wroteFiles);
      await writeProjectTextFile(projectRoot, 'src/generated/dioramai.scene.json', serializeScene(starterScene), force, wroteFiles);
      await writeProjectTextFile(projectRoot, '.cursor/rules/dioramai.mdc', cursorRule(), force, wroteFiles);
    } else {
      if (!existsSync(generatedModule)) {
        await writeProjectTextFile(projectRoot, loadedConfig.config.generatedSceneFile ?? DEFAULT_GENERATED_MODULE_RELATIVE_PATH, generatedModuleContent, force, wroteFiles);
      }
      if (!existsSync(sceneJson)) {
        await writeProjectTextFile(projectRoot, loadedConfig.config.sceneJsonFile ?? DEFAULT_SESSION_RELATIVE_PATH, serializeScene(starterScene), force, wroteFiles);
      }
    }

    return ok({
      projectRoot,
      configPath,
      wroteConfig,
      assetDir,
      generatedModule,
      generatedDir: dirname(generatedModule),
      wroteFiles,
    });
  } catch (error) {
    return fail(
      error instanceof Error && error.message.includes('already exists') ? 'FILE_EXISTS' : 'INIT_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  }
};

const listGlbFiles = async (
  projectRoot: string,
  assetDirPath: string,
): Promise<string[]> => {
  try {
    const entries = await readdir(assetDirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(glb|gltf)$/i.test(entry.name))
      .map((entry) => relative(projectRoot, resolve(assetDirPath, entry.name)).replace(/\\/g, '/'))
      .sort();
  } catch {
    return [];
  }
};

const readJsonObjectFile = async (path: string): Promise<JsonRecord | null> => {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
};

const hasDependency = (packageJson: JsonRecord, name: string): boolean => {
  const dependencies = isRecord(packageJson.dependencies) ? packageJson.dependencies : {};
  const devDependencies = isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {};
  return typeof dependencies[name] === 'string' || typeof devDependencies[name] === 'string';
};

const appImportsGeneratedScene = async (projectRoot: string): Promise<boolean | null> => {
  const candidates = [
    'src/DioramaiApp.tsx',
    'src/App.tsx',
    'src/main.tsx',
  ];
  let foundReadableFile = false;
  for (const candidate of candidates) {
    try {
      const content = await readFile(resolve(projectRoot, candidate), 'utf8');
      foundReadableFile = true;
      if (
        content.includes('DioramaiScene.generated') ||
        content.includes('DioramaScene.generated')
      ) {
        return true;
      }
    } catch {
      // Missing app files are handled by the final null/false result.
    }
  }
  return foundReadableFile ? false : null;
};

const bridgeIsReachable = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

export const doctorDioramaiProject = async (
  projectRootInput: string,
  options: { port?: number } = {},
): Promise<BridgeResult<DioramaiDoctorResult>> => {
  try {
    const projectRoot = resolveProjectRoot(projectRootInput);
    const items: DioramaiDoctorItem[] = [];
    const add = (item: DioramaiDoctorItem): void => {
      items.push(item);
    };
    const loadedConfig = readProjectConfigSync(projectRoot);
    const packageJsonPath = resolve(projectRoot, 'package.json');
    const packageJson = await readJsonObjectFile(packageJsonPath);

    if (packageJson === null) {
      add({
        status: 'fail',
        label: 'package.json',
        message: 'No package.json was found in the project root.',
        fix: 'Run npx dioramai init --template vite-r3f in an empty folder.',
      });
    } else {
      add({
        status: 'pass',
        label: 'package.json',
        message: 'package.json exists.',
      });

      const requiredDependencies = [
        'react',
        'react-dom',
        'three',
        '@react-three/fiber',
        '@react-three/drei',
      ];
      const missingDependencies = requiredDependencies.filter((dependency) =>
        !hasDependency(packageJson, dependency),
      );
      if (missingDependencies.length > 0) {
        add({
          status: 'fail',
          label: 'React/R3F dependencies',
          message: `Missing dependencies: ${missingDependencies.join(', ')}.`,
          fix: `npm install ${missingDependencies.join(' ')}`,
        });
      } else {
        add({
          status: 'pass',
          label: 'React/R3F dependencies',
          message: 'React, Three, R3F, and Drei are listed.',
        });
      }

      const nodeModulesPath = resolve(projectRoot, 'node_modules');
      if (await fileExists(nodeModulesPath)) {
        add({
          status: 'pass',
          label: 'Dependencies installed',
          message: 'node_modules exists.',
        });
      } else {
        add({
          status: 'warn',
          label: 'Dependencies installed',
          message: 'Dependencies are listed but node_modules is not present.',
          fix: 'Run npm install before starting the target app.',
        });
      }
    }

    if (!loadedConfig.found) {
      add({
        status: 'fail',
        label: 'dioramai.config.json',
        message: 'No Dioramai config was found.',
        fix: 'Run npx dioramai init --template vite-r3f or add dioramai.config.json.',
      });
    } else if (loadedConfig.warnings.some((warning) => warning.startsWith('Failed to parse'))) {
      add({
        status: 'fail',
        label: 'dioramai.config.json',
        message: loadedConfig.warnings.join(' '),
        fix: 'Fix the JSON syntax in dioramai.config.json.',
      });
    } else {
      add({
        status: loadedConfig.warnings.length > 0 ? 'warn' : 'pass',
        label: 'dioramai.config.json',
        message: loadedConfig.warnings.length > 0
          ? loadedConfig.warnings.join(' ')
          : 'Dioramai config exists and is JSON.',
      });
    }

    let assetDirPath = resolve(projectRoot, DEFAULT_ASSET_DIR_RELATIVE_PATH);
    let generatedModulePath = resolve(projectRoot, DEFAULT_GENERATED_MODULE_RELATIVE_PATH);
    let sceneJsonPath = resolve(projectRoot, DEFAULT_SESSION_RELATIVE_PATH);
    try {
      assetDirPath = resolve(projectRoot, configuredRelativePath(loadedConfig.config, 'assetDir', DEFAULT_ASSET_DIR_RELATIVE_PATH));
      generatedModulePath = resolve(projectRoot, configuredRelativePath(loadedConfig.config, 'generatedSceneFile', DEFAULT_GENERATED_MODULE_RELATIVE_PATH));
      sceneJsonPath = resolve(projectRoot, configuredRelativePath(loadedConfig.config, 'sceneJsonFile', DEFAULT_SESSION_RELATIVE_PATH));
      if (![assetDirPath, generatedModulePath, sceneJsonPath].every((path) => isPathInside(path, projectRoot))) {
        add({
          status: 'fail',
          label: 'Configured paths',
          message: 'One or more configured paths resolve outside the project root.',
          fix: 'Keep assetDir, generatedSceneFile, and sceneJsonFile relative to the project root.',
        });
      } else {
        add({
          status: 'pass',
          label: 'Configured paths',
          message: 'Configured paths stay inside the project root.',
        });
      }
    } catch (error) {
      add({
        status: 'fail',
        label: 'Configured paths',
        message: error instanceof Error ? error.message : String(error),
        fix: 'Use project-relative paths in dioramai.config.json.',
      });
    }

    const assetDirExists = await fileExists(assetDirPath);
    add(assetDirExists
      ? {
          status: 'pass',
          label: 'Asset directory',
          message: `${relative(projectRoot, assetDirPath).replace(/\\/g, '/')} exists.`,
        }
      : {
          status: 'fail',
          label: 'Asset directory',
          message: `${relative(projectRoot, assetDirPath).replace(/\\/g, '/')} is missing.`,
          fix: `Create ${relative(projectRoot, assetDirPath).replace(/\\/g, '/')} or rerun init with --force.`,
        });

    const generatedFileExists = await fileExists(generatedModulePath);
    add(generatedFileExists
      ? {
          status: 'pass',
          label: 'Generated scene module',
          message: `${relative(projectRoot, generatedModulePath).replace(/\\/g, '/')} exists.`,
        }
      : {
          status: 'fail',
          label: 'Generated scene module',
          message: `${relative(projectRoot, generatedModulePath).replace(/\\/g, '/')} is missing.`,
          fix: 'Run npx dioramai export after starting the bridge, or rerun init with --force.',
        });

    if (generatedFileExists) {
      const code = await readFile(generatedModulePath, 'utf8');
      const parsed = parseSceneFromR3fSyncModule(code);
      add(parsed.ok
        ? {
            status: 'pass',
            label: 'Generated scene parses',
            message: 'Embedded dioramaiScene block parses and validates.',
          }
        : {
            status: 'fail',
            label: 'Generated scene parses',
            message: parsed.error.message,
            fix: 'Fix the embedded dioramaiScene block or run npx dioramai export.',
          });
    } else if (await fileExists(sceneJsonPath)) {
      const parsedScene = parseSceneJson(await readFile(sceneJsonPath, 'utf8'));
      add(parsedScene
        ? {
            status: 'pass',
            label: 'Generated scene parses',
            message: 'Scene JSON parses and validates.',
          }
        : {
            status: 'fail',
            label: 'Generated scene parses',
            message: 'Scene JSON exists but failed parsing or validation.',
            fix: 'Fix the scene JSON or rerun init/export.',
          });
    }

    const reachable = await bridgeIsReachable(options.port ?? DEFAULT_BRIDGE_PORT);
    add(reachable
      ? {
          status: 'pass',
          label: 'Local bridge',
          message: `Bridge is reachable on port ${options.port ?? DEFAULT_BRIDGE_PORT}.`,
        }
      : {
          status: 'warn',
          label: 'Local bridge',
          message: `Bridge is not currently running on port ${options.port ?? DEFAULT_BRIDGE_PORT}.`,
          fix: 'Run npx dioramai dev --open when you are ready to sync.',
        });

    const glbFiles = await listGlbFiles(projectRoot, assetDirPath);
    add(glbFiles.length > 0
      ? {
          status: 'pass',
          label: 'GLB assets',
          message: `${glbFiles.length} GLB/GLTF asset(s) found.`,
        }
      : {
          status: 'warn',
          label: 'GLB assets',
          message: 'No GLB/GLTF assets were found yet.',
          fix: 'Drop .glb or .gltf files into public/assets/models.',
        });

    const appImport = await appImportsGeneratedScene(projectRoot);
    add(appImport === true
      ? {
          status: 'pass',
          label: 'App wiring',
          message: 'The app imports the generated Dioramai scene module.',
        }
      : appImport === false
        ? {
            status: 'fail',
            label: 'App wiring',
            message: 'App files exist but do not appear to import DioramaiScene.generated.',
            fix: 'Render <DioramaiScene /> from src/generated/DioramaiScene.generated inside your Canvas.',
          }
        : {
            status: 'warn',
            label: 'App wiring',
            message: 'No app source files were found to inspect.',
            fix: 'Run npx dioramai init --template vite-r3f in an empty folder.',
          });

    return ok({
      ok: !items.some((item) => item.status === 'fail'),
      projectRoot,
      configPath: loadedConfig.path,
      items,
      glbFiles,
    });
  } catch (error) {
    return fail('DOCTOR_ERROR', error instanceof Error ? error.message : String(error));
  }
};

export const validateDioramaiProject = async (
  projectRootInput: string,
): Promise<BridgeResult<unknown>> => {
  try {
    const projectRoot = resolveProjectRoot(projectRootInput);
    const runtime = new DioramaiBridgeRuntime(await loadInitialBridgeScene({ projectRoot }), { projectRoot });
    const status = await runtime.getProjectStatus();
    runtime.close();
    return status;
  } catch (error) {
    return fail('VALIDATION_ERROR', error instanceof Error ? error.message : String(error));
  }
};

export class DioramaiBridgeRuntime {
  private runtime: LocalSceneRuntime;
  private clients = new Set<ServerResponse>();
  private readonly onBrowserConnect: ((clientCount: number) => void) | undefined;
  private readonly projectRoot: string;
  private readonly configFound: boolean;
  private readonly configPath: string;
  private readonly configWarnings: string[];
  private readonly sessionPath: string;
  private readonly sessionRelativePath: string;
  private readonly generatedModulePath: string;
  private readonly generatedModuleRelativePath: string;
  private readonly assetDirPath: string;
  private readonly assetDirRelativePath: string;
  private readonly publicUrlBase: string;
  private readonly codeWatchDebounceMs: number;
  private codeWatcher: FSWatcher | null = null;
  private codeWatchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGeneratedModuleCode: string | null = null;
  private lastSync: BridgeLastSync = null;

  constructor(initialScene: Scene, options: DioramaiBridgeRuntimeOptions = {}) {
    this.projectRoot = resolveProjectRoot(options.projectRoot);
    const loadedConfig = readProjectConfigSync(this.projectRoot);
    this.configFound = loadedConfig.found;
    this.configPath = loadedConfig.path;
    this.configWarnings = loadedConfig.warnings;
    if (loadedConfig.config.projectRoot !== undefined) {
      const configuredRoot = resolve(this.projectRoot, loadedConfig.config.projectRoot);
      if (!samePath(configuredRoot, this.projectRoot)) {
        throw new Error('projectRoot in dioramai.config.json must resolve to the explicit project root.');
      }
    }
    const sessionRelativePath =
      options.sessionRelativePath ??
      configuredRelativePath(loadedConfig.config, 'sceneJsonFile', DEFAULT_SESSION_RELATIVE_PATH);
    const generatedModuleRelativePath =
      options.generatedModuleRelativePath ??
      configuredRelativePath(loadedConfig.config, 'generatedSceneFile', DEFAULT_GENERATED_MODULE_RELATIVE_PATH);
    this.assetDirRelativePath =
      options.assetDirRelativePath ??
      configuredRelativePath(loadedConfig.config, 'assetDir', DEFAULT_ASSET_DIR_RELATIVE_PATH);
    this.publicUrlBase = (
      options.publicUrlBase ??
      loadedConfig.config.publicAssetBase ??
      DEFAULT_PUBLIC_URL_BASE
    ).replace(/\/+$/, '');
    this.sessionRelativePath = sessionRelativePath;
    this.generatedModuleRelativePath = generatedModuleRelativePath;
    this.sessionPath = resolve(this.projectRoot, sessionRelativePath);
    this.generatedModulePath = resolve(this.projectRoot, generatedModuleRelativePath);
    this.assetDirPath = resolve(this.projectRoot, this.assetDirRelativePath);
    this.codeWatchDebounceMs = options.codeWatchDebounceMs ?? 100;

    for (const targetPath of [this.sessionPath, this.generatedModulePath, this.assetDirPath]) {
      if (!isPathInside(targetPath, this.projectRoot)) {
        throw new Error('Dioramai bridge paths must stay inside the project root.');
      }
    }

    this.runtime = createLocalSceneRuntime(initialScene);
    this.onBrowserConnect = options.onBrowserConnect;
    if (options.watchCode === true) this.startCodeWatcher();
  }

  addClient(res: ServerResponse): void {
    this.clients.add(res);
    this.onBrowserConnect?.(this.clients.size);
    const scene = this.getSceneResult();
    if (scene.ok) {
      sendSse(res, {
        type: 'scene',
        scene: scene.data.scene,
        source: 'bridge',
      });
    }
    res.on('close', () => {
      this.clients.delete(res);
      this.onBrowserConnect?.(this.clients.size);
    });
  }

  private getSceneResult(): BridgeResult<{ scene: Scene }> {
    return unwrap(this.runtime.getScene(), 'get_scene');
  }

  private async persistScene(scene: Scene): Promise<void> {
    const json = serializeScene(scene);
    await mkdir(dirname(this.sessionPath), { recursive: true });
    await writeFile(this.sessionPath, json, 'utf8');
  }

  private async publishScene(
    source: SceneEvent['source'],
    command?: Command,
    summary?: unknown,
    syncCode = true,
  ): Promise<void> {
    const scene = this.getSceneResult();
    if (!scene.ok) return;
    await this.persistScene(scene.data.scene);
    if (syncCode) await this.syncCodeToProject(scene.data.scene);
    const event: SceneEvent = {
      type: 'scene',
      scene: scene.data.scene,
      source,
      ...(command !== undefined ? { command } : {}),
      ...(summary !== undefined ? { summary } : {}),
    };
    for (const client of this.clients) sendSse(client, event);
  }

  private async syncCodeToProject(scene: Scene): Promise<BridgeResult<{
    path: string;
    sceneJsonPath: string;
    content: string;
    bytesChanged: boolean;
    sceneJsonBytesChanged: boolean;
  }>> {
    try {
      const exported = exportSceneToR3fSyncModule(scene, {
        componentName: DEFAULT_COMPONENT_NAME,
        includeStudioLights: true,
      });
      const sceneJson = serializeScene(scene);
      let previous: string | null = null;
      try {
        previous = await readFile(this.generatedModulePath, 'utf8');
      } catch {
        previous = null;
      }
      let previousSceneJson: string | null = null;
      try {
        previousSceneJson = await readFile(this.sessionPath, 'utf8');
      } catch {
        previousSceneJson = null;
      }
      const bytesChanged = previous !== exported.code;
      const sceneJsonBytesChanged = previousSceneJson !== sceneJson;
      if (bytesChanged) {
        await mkdir(dirname(this.generatedModulePath), { recursive: true });
        await writeFile(this.generatedModulePath, exported.code, 'utf8');
      }
      this.lastGeneratedModuleCode = exported.code;
      if (sceneJsonBytesChanged) {
        await mkdir(dirname(this.sessionPath), { recursive: true });
        await writeFile(this.sessionPath, sceneJson, 'utf8');
      }
      this.lastSync = {
        ok: true,
        path: this.generatedModulePath,
        bytesChanged: bytesChanged || sceneJsonBytesChanged,
        ts: Date.now(),
      };
      return ok({
        path: this.generatedModulePath,
        sceneJsonPath: this.sessionPath,
        content: exported.code,
        bytesChanged: bytesChanged || sceneJsonBytesChanged,
        sceneJsonBytesChanged,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastSync = { ok: false, error: message, ts: Date.now() };
      return fail('SYNC_ERROR', message);
    }
  }

  private async syncCurrentSceneToProject(): Promise<BridgeResult<unknown>> {
    const scene = this.getSceneResult();
    if (!scene.ok) return scene;
    return this.syncCodeToProject(scene.data.scene);
  }

  private async syncCode(input: unknown): Promise<BridgeResult<unknown>> {
    const direction = isRecord(input) && input.direction === 'fromCode' ? 'fromCode' : 'toCode';
    return direction === 'fromCode'
      ? this.reloadSceneFromFile()
      : this.syncCurrentSceneToProject();
  }

  private startCodeWatcher(): void {
    if (this.codeWatcher !== null) return;
    void mkdir(dirname(this.generatedModulePath), { recursive: true }).then(() => {
      if (this.codeWatcher !== null) return;
      this.codeWatcher = watch(dirname(this.generatedModulePath), (eventType, fileName) => {
        if (eventType !== 'change' && eventType !== 'rename') return;
        if (String(fileName) !== basename(this.generatedModulePath)) return;
        if (this.codeWatchTimer) clearTimeout(this.codeWatchTimer);
        this.codeWatchTimer = setTimeout(() => {
          void this.reloadSceneFromGeneratedModuleChange();
        }, this.codeWatchDebounceMs);
      });
    });
  }

  private async reloadSceneFromGeneratedModuleChange(): Promise<void> {
    try {
      const code = await readFile(this.generatedModulePath, 'utf8');
      if (code === this.lastGeneratedModuleCode) return;
      await this.reloadSceneFromFile();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastSync = { ok: false, error: message, ts: Date.now() };
    }
  }

  private async reloadSceneFromFile(): Promise<BridgeResult<unknown>> {
    try {
      let parsedScene: Scene | null = null;
      let sourcePath = this.generatedModulePath;
      try {
        const code = await readFile(this.generatedModulePath, 'utf8');
        const parsed = parseSceneFromR3fSyncModule(code);
        if (!parsed.ok) {
          this.lastSync = { ok: false, error: parsed.error.message, ts: Date.now() };
          return fail(parsed.error.code, parsed.error.message);
        }
        parsedScene = parsed.scene;
        this.lastGeneratedModuleCode = code;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
        sourcePath = this.sessionPath;
        const sceneJson = await readFile(this.sessionPath, 'utf8');
        parsedScene = parseSceneJson(sceneJson);
        if (parsedScene === null) {
          const message = 'Dioramai scene JSON file failed JSON parsing or schema validation.';
          this.lastSync = { ok: false, error: message, ts: Date.now() };
          return fail('SCENE_BLOCK_INVALID', message);
        }
      }
      const command: Command = { type: 'REPLACE_SCENE', scene: parsedScene };
      const result = unwrap(
        this.runtime.applyCommand(command, { source: 'system' }),
        'reload_scene_from_file',
      );
      if (!result.ok) {
        this.lastSync = { ok: false, error: result.error.message, ts: Date.now() };
        return result;
      }
      await this.publishScene('code', command, result.data.summary, false);
      this.lastSync = {
        ok: true,
        path: sourcePath,
        bytesChanged: false,
        ts: Date.now(),
      };
      return ok({
        scene: parsedScene,
        path: sourcePath,
        changed: result.data.changed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastSync = { ok: false, error: message, ts: Date.now() };
      return fail('SYNC_ERROR', message);
    }
  }

  getProjectInfo(): {
    projectRoot: string;
    configFound: boolean;
    configPath: string;
    sessionPath: string;
    sessionRelativePath: string;
    generatedModulePath: string;
    generatedModuleRelativePath: string;
    assetDirPath: string;
    assetDirRelativePath: string;
    publicUrlBase: string;
    lastSync: BridgeLastSync;
  } {
    return {
      projectRoot: this.projectRoot,
      configFound: this.configFound,
      configPath: this.configPath,
      sessionPath: this.sessionPath,
      sessionRelativePath: this.sessionRelativePath,
      generatedModulePath: this.generatedModulePath,
      generatedModuleRelativePath: this.generatedModuleRelativePath,
      assetDirPath: this.assetDirPath,
      assetDirRelativePath: this.assetDirRelativePath,
      publicUrlBase: this.publicUrlBase,
      lastSync: this.lastSync,
    };
  }

  async getProjectStatus(): Promise<BridgeResult<{
    bridgeConnected: true;
    projectRoot: string;
    configFound: boolean;
    configPath: string;
    configWarnings: string[];
    assetDir: string;
    assetDirExists: boolean;
    generatedSceneFile: string;
    generatedFileExists: boolean;
    publicAssetBase: string;
    sceneJsonFile: string;
    sceneJsonFileExists: boolean;
    currentSceneLoaded: boolean;
    nodeCount: number;
    assetCount: number;
    lastSync: BridgeLastSync;
  }>> {
    const scene = this.getSceneResult();
    const exists = async (path: string): Promise<boolean> => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    };
    return ok({
      bridgeConnected: true,
      projectRoot: this.projectRoot,
      configFound: this.configFound,
      configPath: this.configPath,
      configWarnings: this.configWarnings,
      assetDir: this.assetDirPath,
      assetDirExists: await exists(this.assetDirPath),
      generatedSceneFile: this.generatedModulePath,
      generatedFileExists: await exists(this.generatedModulePath),
      publicAssetBase: this.publicUrlBase,
      sceneJsonFile: this.sessionPath,
      sceneJsonFileExists: await exists(this.sessionPath),
      currentSceneLoaded: scene.ok,
      nodeCount: scene.ok ? Object.keys(scene.data.scene.nodes).length : 0,
      assetCount: scene.ok ? Object.keys(scene.data.scene.assets ?? {}).length : 0,
      lastSync: this.lastSync,
    });
  }

  resolvePublicAssetPath(publicAssetPath: string): BridgeResult<string> {
    const cleanPath = publicAssetPath.split('#')[0]?.split('?')[0] ?? '';
    let decoded = '';
    try {
      decoded = decodeURIComponent(cleanPath);
    } catch {
      return fail('VALIDATION_ERROR', 'Asset path must be URL-decodable.');
    }
    if (decoded.includes('\0')) {
      return fail('VALIDATION_ERROR', 'Asset path contains an invalid null byte.');
    }
    const normalizedPublicPath = decoded.startsWith('/') ? decoded : `/${decoded}`;
    const publicBase = this.publicUrlBase.startsWith('/')
      ? this.publicUrlBase
      : `/${this.publicUrlBase}`;
    if (
      normalizedPublicPath !== publicBase &&
      !normalizedPublicPath.startsWith(`${publicBase}/`)
    ) {
      return fail('VALIDATION_ERROR', 'Asset path is outside the configured public asset base.');
    }

    const assetRelativePath = normalizedPublicPath.slice(publicBase.length).replace(/^\/+/, '');
    if (assetRelativePath.length === 0 || !isRelativeProjectPath(assetRelativePath)) {
      return fail('VALIDATION_ERROR', 'Asset file path must be relative to the configured asset dir.');
    }
    if (!/\.(glb|gltf|bin|png|jpe?g|webp)$/i.test(assetRelativePath)) {
      return fail('VALIDATION_ERROR', 'Asset file extension is not allowed by the local bridge.');
    }

    const absolutePath = resolve(this.assetDirPath, assetRelativePath);
    if (!isPathInside(absolutePath, this.assetDirPath) || !isPathInside(absolutePath, this.projectRoot)) {
      return fail('VALIDATION_ERROR', 'Asset file path must stay inside the configured project asset dir.');
    }
    return ok(absolutePath);
  }

  close(): void {
    if (this.codeWatchTimer) {
      clearTimeout(this.codeWatchTimer);
      this.codeWatchTimer = null;
    }
    this.codeWatcher?.close();
    this.codeWatcher = null;
  }

  async callTool(name: string, input: unknown, source: SceneEvent['source'] = 'mcp'): Promise<BridgeResult<any>> {
    try {
      switch (name) {
        case 'health':
          return ok({ status: 'ok' });
        case 'get_project_status':
        case 'project_status':
          return this.getProjectStatus();
        case 'project_info':
          return ok(this.getProjectInfo());
        case 'get_scene':
          return this.getSceneResult();
        case 'load_scene':
          return this.loadScene(input, source);
        case 'register_asset':
        case 'import_glb_asset':
          return this.importGlbAssetTool(input, source);
        case 'update_transform':
          return this.updateTransform(input, source);
        case 'export_r3f':
          return this.exportR3f(input);
        case 'write_scene_to_file':
          return this.syncCurrentSceneToProject();
        case 'reload_scene_from_file':
          return this.reloadSceneFromFile();
        case 'sync_code':
          return this.syncCode(input);
        default:
          return fail('TOOL_NOT_FOUND', `Unknown Dioramai bridge tool: ${name}`);
      }
    } catch (error) {
      return fail('BRIDGE_ERROR', error instanceof Error ? error.message : String(error));
    }
  }

  private async applyCommand(input: unknown, source: SceneEvent['source']): Promise<BridgeResult<unknown>> {
    const payload = isRecord(input) && 'command' in input ? input.command : input;
    const dryRun = isRecord(input) && input.dryRun === true;
    const result = unwrap(this.runtime.applyCommand(payload, { dryRun, source: source === 'web' ? 'user' : 'agent' }), 'apply_command');
    if (!result.ok) return result;
    if (!dryRun && result.data.changed) {
      await this.publishScene(source, isRecord(payload) && typeof payload.type === 'string' ? payload as Command : undefined, result.data.summary);
    }
    return result;
  }

  private async applyCommandBatch(input: unknown, source: SceneEvent['source']): Promise<BridgeResult<unknown>> {
    const payload = isRecord(input) && Array.isArray(input.commands) ? input.commands : input;
    const dryRun = isRecord(input) && input.dryRun === true;
    const result = unwrap(
      this.runtime.applyCommandBatch(payload, { dryRun, source: source === 'web' ? 'user' : 'agent' }),
      'apply_command_batch',
    );
    if (!result.ok) return result;
    if (!dryRun && result.data.changed) await this.publishScene(source);
    return result;
  }

  private async applyIngestionPlan(
    ingestion: IngestionResult,
    input: unknown,
    source: SceneEvent['source'],
    step: string,
  ): Promise<BridgeResult<unknown>> {
    const dryRun = isRecord(input) && input.dryRun === true;
    const result = unwrap(
      this.runtime.applyCommandBatch(ingestion.commands, { dryRun, source: source === 'web' ? 'user' : 'agent' }),
      step,
    );
    if (!result.ok) return result;
    if (!dryRun && result.data.changed) await this.publishScene(source);
    return ok({
      ...result.data,
      warnings: [...result.data.warnings, ...ingestion.warnings],
      ...(ingestion.assets !== undefined ? { assets: ingestion.assets } : {}),
    });
  }

  private async loadScene(input: unknown, source: SceneEvent['source']): Promise<BridgeResult<unknown>> {
    const scene =
      isRecord(input) && typeof input.json === 'string'
        ? parseSceneJson(input.json)
        : isRecord(input) && isRecord(input.scene)
          ? input.scene as Scene
          : null;
    if (scene === null) return fail('PARSE_ERROR', 'load_scene requires { json } or { scene }.');
    const dryRun = isRecord(input) && input.dryRun === true;
    const result = unwrap(
      this.runtime.applyCommand({ type: 'REPLACE_SCENE', scene }, { dryRun, source: source === 'web' ? 'user' : 'agent' }),
      'load_scene',
    );
    if (!result.ok) return result;
    if (!dryRun) await this.publishScene(source, { type: 'REPLACE_SCENE', scene });
    return result;
  }

  private async updateTransform(input: unknown, source: SceneEvent['source']): Promise<BridgeResult<unknown>> {
    const patch = isRecord(input) && isRecord(input.patch)
      ? input.patch
      : isRecord(input) && isRecord(input.transform)
        ? input.transform
        : undefined;
    if (!isRecord(input) || typeof input.nodeId !== 'string' || patch === undefined) {
      return fail('VALIDATION_ERROR', 'update_transform requires { nodeId, patch } or { nodeId, transform }.');
    }
    return this.applyCommand({
      command: {
        type: 'UPDATE_TRANSFORM',
        nodeId: input.nodeId,
        patch,
      },
      ...(input.dryRun === true ? { dryRun: true } : {}),
    }, source);
  }

  async importAsset(
    input: ImportAssetInput,
    source: SceneEvent['source'] = 'mcp',
  ): Promise<BridgeResult<ImportAssetResult>> {
    const scene = this.getSceneResult();
    if (!scene.ok) return scene;

    const mode = input.importMode ?? 'single';
    const sourcePath = await this.prepareImportAssetFile(input.source);
    if (!sourcePath.ok) return sourcePath;

    const { fileName, slug, format } = safeFileNameFor(sourcePath.data.localPath);
    const publicUri = `${this.publicUrlBase}/${fileName}`;
    const assetId = uniqueRecordId(`asset-${slug}`, scene.data.scene.assets);
    const nodeId = uniqueRecordId(`${assetId}-node`, scene.data.scene.nodes);
    const semanticRole = input.semanticRole;

    const ingestion = await ingestAssetWithHierarchy({
      localPath: sourcePath.data.workspaceRelativePath,
      format,
      id: assetId,
      uri: publicUri,
      provider: 'manual',
      source: input.source.kind === 'uploadedFile' ? 'upload' : 'manual',
      metadata: {
        importedFrom: sourcePath.data.workspaceRelativePath,
        importSource: input.source.kind,
      },
    }, {
      parentId: input.parentId ?? scene.data.scene.rootId,
      nodeId,
      nodeName: input.name ?? `${sanitizeStem(slug)} Product`,
      includeHierarchy: mode === 'shallow',
      sourceFilePath: sourcePath.data.localPath,
    });

    const importedNodeIds = commandNodeIds(ingestion.commands);
    if (semanticRole !== undefined && importedNodeIds[0] !== undefined) {
      ingestion.commands.push({
        type: 'SET_NODE_SEMANTICS',
        nodeIds: [importedNodeIds[0]],
        semantics: {
          role: semanticRole,
          source: 'agent',
        },
      });
    }

    return this.applyImportPlan(ingestion, input, source, {
      assetId,
      importedNodeIds,
      hierarchyRootNodeIds: importedNodeIds.slice(1).filter((id) =>
        ingestion.commands.some((command) =>
          command.type === 'ADD_NODE' && command.parentId === importedNodeIds[0] && command.node.id === id,
        ),
      ),
    });
  }

  private async importGlbAssetTool(input: unknown, source: SceneEvent['source']): Promise<BridgeResult<unknown>> {
    const workspaceRelativePath = isRecord(input) && typeof input.path === 'string'
      ? input.path
      : isRecord(input) && typeof input.workspaceRelativePath === 'string'
        ? input.workspaceRelativePath
        : undefined;
    if (!isRecord(input) || workspaceRelativePath === undefined) {
      return fail('VALIDATION_ERROR', 'import_glb_asset requires { path } or { workspaceRelativePath }.');
    }
    if (input.importMode !== undefined && importModeFromValue(input.importMode) === undefined) {
      return fail('VALIDATION_ERROR', 'importMode must be "single" or "shallow".');
    }
    if (input.semanticRole !== undefined && semanticRoleFromValue(input.semanticRole) === undefined) {
      return fail('VALIDATION_ERROR', 'semanticRole is not a supported Dioramai semantic role.');
    }
    const resolved = resolveWorkspaceRelativePath(workspaceRelativePath, this.projectRoot);
    if (!resolved.ok) return resolved;
    const sourceStat = await stat(resolved.data);
    if (!sourceStat.isFile()) {
      return fail('VALIDATION_ERROR', `Not a file: ${workspaceRelativePath}`);
    }
    return this.importAsset({
      source: { kind: 'workspacePath', path: workspaceRelativePath },
      importMode: importModeFromValue(input.importMode) ?? 'single',
      ...(typeof input.name === 'string' ? { name: input.name } : {}),
      ...(semanticRoleFromValue(input.semanticRole) !== undefined
        ? { semanticRole: semanticRoleFromValue(input.semanticRole) }
        : {}),
      ...(typeof input.parentId === 'string' ? { parentId: input.parentId } : {}),
      ...(input.dryRun === true ? { dryRun: true } : {}),
    }, source);
  }

  private async prepareImportAssetFile(source: ImportAssetSource): Promise<BridgeResult<{
    localPath: string;
    workspaceRelativePath: string;
  }>> {
    const sourceInfo = source.kind === 'workspacePath'
      ? safeFileNameFor(source.path)
      : safeFileNameFor(source.name);
    const publicFileName = sourceInfo.fileName;
    const projectAssetPath = resolve(this.assetDirPath, publicFileName);
    const workspaceRelativePath = `${this.assetDirRelativePath.replace(/\\/g, '/')}/${publicFileName}`;

    if (source.kind === 'workspacePath') {
      const resolved = resolveWorkspaceRelativePath(source.path, this.projectRoot);
      if (!resolved.ok) return resolved;
      const sourceStat = await stat(resolved.data);
      if (!sourceStat.isFile()) return fail('VALIDATION_ERROR', `Not a file: ${source.path}`);
      await copyFileIfDifferent(resolved.data, projectAssetPath);
      return ok({ localPath: resolved.data, workspaceRelativePath });
    }

    if (source.data.byteLength === 0) {
      return fail('VALIDATION_ERROR', 'Uploaded GLB file is empty.');
    }
    if (source.data.byteLength > MAX_UPLOAD_BYTES) {
      return fail('VALIDATION_ERROR', `Uploaded GLB file exceeds ${MAX_UPLOAD_BYTES} bytes.`);
    }
    await writeFileIfDifferent(projectAssetPath, source.data);
    return ok({ localPath: projectAssetPath, workspaceRelativePath });
  }

  private async applyImportPlan(
    ingestion: IngestionResult,
    input: ImportAssetInput,
    source: SceneEvent['source'],
    summary: {
      assetId: string;
      importedNodeIds: string[];
      hierarchyRootNodeIds: string[];
    },
  ): Promise<BridgeResult<ImportAssetResult>> {
    const result = unwrap(
      this.runtime.applyCommandBatch(ingestion.commands, { dryRun: input.dryRun === true, source: source === 'web' ? 'user' : 'agent' }),
      'import_glb_asset',
    );
    if (!result.ok) return result;
    if (input.dryRun !== true && result.data.changed) await this.publishScene(source);
    const warnings = [...result.data.warnings, ...ingestion.warnings];
    return ok({
      ...result.data,
      assetId: commandAssetId(ingestion.commands) ?? summary.assetId,
      commands: ingestion.commands,
      warnings,
      sceneSummary: sceneSummary(result.data.scene),
      importedNodeIds: summary.importedNodeIds,
      hierarchySummary: {
        nodeCount: Math.max(0, summary.importedNodeIds.length - 1),
        rootNodeIds: summary.hierarchyRootNodeIds,
      },
    });
  }

  private async exportJson(input: unknown): Promise<BridgeResult<unknown>> {
    const exported = unwrap(this.runtime.exportJSON(), 'export_json');
    if (!exported.ok) return exported;
    if (!isRecord(input) || input.write !== false) {
      await mkdir(dirname(this.sessionPath), { recursive: true });
      await writeFile(this.sessionPath, exported.data.content, 'utf8');
    }
    return ok({
      ...exported.data,
      path: this.sessionPath,
    });
  }

  private async exportR3f(input: unknown): Promise<BridgeResult<unknown>> {
    const scene = this.getSceneResult();
    if (!scene.ok) return scene;
    const exported = exportSceneToR3fSyncModule(scene.data.scene, {
      componentName: DEFAULT_COMPONENT_NAME,
      includeStudioLights: true,
    });
    const shouldWrite = !isRecord(input) || input.write !== false;
    const sync = shouldWrite
      ? await this.syncCodeToProject(scene.data.scene)
      : ok({
          path: this.generatedModulePath,
          sceneJsonPath: this.sessionPath,
          content: exported.code,
          bytesChanged: false,
          sceneJsonBytesChanged: false,
        });
    if (!sync.ok) return sync;
    return ok({
      format: 'r3f',
      content: exported.code,
      mediaType: 'text/jsx',
      diagnostics: exported.diagnostics,
      componentPath: this.generatedModulePath,
      bytesChanged: sync.data.bytesChanged,
    });
  }
}

export type StartedBridgeServer = {
  server: Server;
  runtime: DioramaiBridgeRuntime;
  requestedPort: number;
  port: number;
  pairingToken: string;
  close: () => Promise<void>;
};

const SAFE_ROUTE_TO_TOOL: Record<string, string> = {
  '/load-scene': 'load_scene',
  '/register-asset': 'register_asset',
  '/update-transform': 'update_transform',
  '/import-glb-asset-json': 'import_glb_asset',
  '/export-r3f': 'export_r3f',
  '/write-scene-to-file': 'write_scene_to_file',
  '/reload-scene-from-file': 'reload_scene_from_file',
  '/sync-code': 'sync_code',
};

const SAFE_TOOL_NAMES = new Set([
  'get_project_status',
  'project_status',
  'project_info',
  'get_scene',
  'load_scene',
  'register_asset',
  'import_glb_asset',
  'update_transform',
  'export_r3f',
  'write_scene_to_file',
  'reload_scene_from_file',
  'sync_code',
]);

export const startDioramaiBridgeServer = async (
  port = Number(process.env.DIORAMAI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT),
  options: DioramaiBridgeRuntimeOptions = {},
): Promise<StartedBridgeServer> => {
  const runtime = new DioramaiBridgeRuntime(await loadInitialBridgeScene(options), options);
  const pairingToken =
    options.pairingToken ??
    process.env.DIORAMAI_BRIDGE_TOKEN ??
    randomBytes(16).toString('hex');
  const allowedOrigins = options.allowedOrigins ?? (
    process.env.DIORAMAI_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? []
  );
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${port}`}`);
    const corsHeaders = corsHeadersFor(req, allowedOrigins);
    const sendJson = (statusCode: number, value: unknown): void =>
      writeJson(res, statusCode, value, corsHeaders);

    try {
      if (req.method === 'OPTIONS') {
        sendJson(204, {});
        return;
      }

      if (!isLocalHostHeader(req.headers.host)) {
        sendJson(403, fail('FORBIDDEN', 'Dioramai bridge only accepts localhost host headers.'));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        const status = await runtime.getProjectStatus();
        sendJson(200, {
          ok: true,
          data: {
            status: 'ok',
            bridgeRunning: true,
            projectLoaded: status.ok,
            sceneLoaded: status.ok ? status.data.currentSceneLoaded : false,
            assetCount: status.ok ? status.data.assetCount : 0,
            lastSync: status.ok ? status.data.lastSync : null,
          },
        });
        return;
      }

      if (!isBrowserRequestAuthorized(req, url, pairingToken)) {
        sendJson(403, fail('FORBIDDEN', 'Dioramai bridge pairing token is required for browser requests.'));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/scene') {
        sendJson(200, await runtime.callTool('get_scene', {}));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/project-info') {
        sendJson(200, await runtime.callTool('project_info', {}));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/project-status') {
        sendJson(200, await runtime.callTool('get_project_status', {}));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, {
          ...corsHeaders,
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Content-Type': 'text/event-stream',
        });
        runtime.addClient(res);
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/project-assets/')) {
        const resolved = runtime.resolvePublicAssetPath(url.pathname.slice('/project-assets'.length));
        if (!resolved.ok) {
          sendJson(400, resolved);
          return;
        }
        const assetStat = await stat(resolved.data);
        if (!assetStat.isFile()) {
          sendJson(404, fail('NOT_FOUND', 'Project asset was not found.'));
          return;
        }
        res.writeHead(200, {
          ...corsHeaders,
          'Cache-Control': 'no-store',
          'Content-Length': String(assetStat.size),
          'Content-Type': contentTypeForAsset(resolved.data),
        });
        createReadStream(resolved.data).pipe(res);
        return;
      }
      if (req.method !== 'POST') {
        sendJson(404, fail('NOT_FOUND', `No route for ${req.method ?? 'GET'} ${url.pathname}`));
        return;
      }
      if (url.pathname === '/import-glb-asset') {
        const fileName = url.searchParams.get('fileName') ?? '';
        const data = await readRequestBuffer(req);
        const rawImportMode = url.searchParams.get('importMode');
        const semanticRole = url.searchParams.get('semanticRole');
        if (rawImportMode !== null && importModeFromValue(rawImportMode) === undefined) {
          sendJson(400, fail('VALIDATION_ERROR', 'importMode must be "single" or "shallow".'));
          return;
        }
        if (semanticRole !== null && semanticRoleFromValue(semanticRole) === undefined) {
          sendJson(400, fail('VALIDATION_ERROR', 'semanticRole is not a supported Dioramai semantic role.'));
          return;
        }
        const result = await runtime.importAsset({
          source: { kind: 'uploadedFile', name: fileName, data },
          importMode: importModeFromValue(rawImportMode) ?? 'single',
          ...(semanticRoleFromValue(semanticRole) !== undefined
            ? { semanticRole: semanticRoleFromValue(semanticRole) }
            : {}),
          ...(url.searchParams.get('parentId') ? { parentId: url.searchParams.get('parentId') as string } : {}),
          ...(url.searchParams.get('dryRun') === 'true' ? { dryRun: true } : {}),
        }, 'web');
        sendJson(result.ok ? 200 : 400, result);
        return;
      }
      const body = await readJson(req);
      const routeTool = SAFE_ROUTE_TO_TOOL[url.pathname];
      const dynamicTool = url.pathname.match(/^\/tools\/([^/]+)$/)?.[1];
      const toolName = routeTool ?? dynamicTool;
      if (!toolName || !SAFE_TOOL_NAMES.has(toolName)) {
        sendJson(404, fail('NOT_FOUND', `No safe route for POST ${url.pathname}`));
        return;
      }
      const result = await runtime.callTool(toolName, body, dynamicTool ? 'mcp' : 'web');
      sendJson(result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(500, fail('BRIDGE_ERROR', error instanceof Error ? error.message : String(error)));
    }
  });

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });
  } catch (error) {
    runtime.close();
    server.close();
    throw error;
  }
  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    server,
    runtime,
    requestedPort: port,
    port: actualPort,
    pairingToken,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        runtime.close();
        server.close((error) => error ? rejectClose(error) : resolveClose());
      }),
  };
};

const isPortInUseError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'EADDRINUSE';

export const startDioramaiBridgeServerWithFallback = async (
  preferredPort = Number(process.env.DIORAMAI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT),
  options: DioramaiBridgeRuntimeOptions = {},
  maxAttempts = 20,
): Promise<StartedBridgeServer> => {
  if (preferredPort === 0) return startDioramaiBridgeServer(0, options);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidatePort = preferredPort + attempt;
    try {
      const started = await startDioramaiBridgeServer(candidatePort, options);
      return {
        ...started,
        requestedPort: preferredPort,
      };
    } catch (error) {
      if (!isPortInUseError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`No available Dioramai bridge port found from ${preferredPort}.`);
};

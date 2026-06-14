import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { createEmptyScene, applyCommand, getStarterScene, type Command, type SceneNode } from '@dioramai/core';
import { exportSceneToR3fSyncModule, parseSceneFromR3fSyncModule } from '@dioramai/export-r3f';
import {
  DioramaiBridgeRuntime,
  doctorDioramaiProject,
  initializeDioramaiProject,
  resolveWorkspaceRelativePath,
  startDioramaiBridgeServer,
  startDioramaiBridgeServerWithFallback,
} from './runtime';

let projectRoot = '';
const sourceRel = 'fixtures/bridge-import-test.glb';

const createTestGlb = (): Buffer => {
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Fixture Root', children: [1], translation: [0, 1, 0] },
      { name: 'Fixture Mesh', mesh: 0 },
    ],
    meshes: [{}],
  };
  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const padding = Buffer.alloc((4 - (json.byteLength % 4)) % 4, 0x20);
  const jsonChunk = Buffer.concat([json, padding]);
  const totalLength = 12 + 8 + jsonChunk.byteLength;
  const buffer = Buffer.alloc(totalLength);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(totalLength, 8);
  buffer.writeUInt32LE(jsonChunk.byteLength, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(buffer, 20);
  return buffer;
};

const createHiddenAndroidScene = () => {
  const scene = createEmptyScene('Hidden Android Test');
  const androidNode = {
    id: 'asset-android-node',
    name: 'Orange Armor Android',
    type: 'mesh',
    children: [],
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: false,
    metadata: {},
    assetRef: { kind: 'uri', uri: '/assets/models/android.glb' },
  } satisfies SceneNode;
  return applyCommand(scene, {
    type: 'ADD_NODE',
    parentId: scene.rootId,
    node: androidNode,
  });
};

const createOpaqueAndroidScene = () => {
  const scene = createEmptyScene('Opaque Android Test');
  const androidNode = {
    id: 'asset-android-node',
    name: 'Orange Armor Android',
    type: 'mesh',
    children: [],
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
    metadata: { assetId: 'asset-android' },
    assetRef: { kind: 'uri', uri: '/assets/models/android.glb' },
  } satisfies SceneNode;
  return applyCommand(scene, {
    type: 'ADD_NODE',
    parentId: scene.rootId,
    node: androidNode,
  });
};

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 1500): Promise<boolean> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return false;
};

const listenOnRandomPort = async (server: NetServer): Promise<number> =>
  new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      const address = server.address();
      if (typeof address === 'object' && address !== null) resolveListen(address.port);
      else rejectListen(new Error('Expected TCP server address.'));
    });
  });

const closeNetServer = async (server: NetServer): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });

describe('Dioramai project onboarding', () => {
  let initRoot = '';

  afterEach(async () => {
    if (initRoot) await rm(initRoot, { recursive: true, force: true });
    initRoot = '';
  });

  it('scaffolds a minimal Vite/R3F project in an empty folder', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-init-'));

    const result = await initializeDioramaiProject(initRoot, {
      template: 'vite-r3f',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.configPath.endsWith('dioramai.config.json')).toBe(true);
    expect(result.data.generatedModule.endsWith('src\\generated\\DioramaiScene.generated.tsx') ||
      result.data.generatedModule.endsWith('src/generated/DioramaiScene.generated.tsx')).toBe(true);
    expect(result.data.wroteFiles).toEqual(expect.arrayContaining([
      'package.json',
      '.gitignore',
      'index.html',
      'src/main.tsx',
      'src/App.tsx',
      'src/DioramaiApp.tsx',
      'src/generated/DioramaiScene.generated.tsx',
      'src/generated/dioramai.scene.json',
      'src/components/README.md',
      '.cursor/rules/dioramai.mdc',
      '.cursor/mcp.json',
    ]));

    const packageJson = JSON.parse(await readFile(resolve(initRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      dev: 'vite',
      build: 'tsc -b && vite build',
      preview: 'vite preview',
      doctor: 'dioramai doctor',
      dioramai: 'dioramai',
      'dioramai:dev': 'dioramai dev --open',
      'dioramai:doctor': 'dioramai doctor',
    });
    const gitignore = await readFile(resolve(initRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.env.local');
    expect(gitignore).toContain('.dioramai/');
    expect(await stat(resolve(initRoot, 'src/components/README.md'))).toBeTruthy();
    const wrapper = await readFile(resolve(initRoot, 'src/DioramaiApp.tsx'), 'utf8');
    expect(wrapper).toContain("import { DioramaiScene } from './generated/DioramaiScene.generated';");
    const generated = await readFile(resolve(initRoot, 'src/generated/DioramaiScene.generated.tsx'), 'utf8');
    expect(generated).not.toContain(initRoot);
    expect(parseSceneFromR3fSyncModule(generated).ok).toBe(true);
    await expect(stat(resolve(initRoot, '.dioramai'))).rejects.toThrow();
  });

  it('treats folders containing only IDE/OS artifacts as empty', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-init-artifacts-'));
    // Simulate what macOS + Cursor create automatically
    await mkdir(resolve(initRoot, '.cursor'), { recursive: true });
    await writeFile(resolve(initRoot, '.DS_Store'), '', 'utf8');

    const result = await initializeDioramaiProject(initRoot, { template: 'vite-r3f' });
    expect(result.ok).toBe(true);
  });

  it('writes .cursor/mcp.json and .cursor/rules/dioramai.mdc for config template', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-init-config-'));

    const result = await initializeDioramaiProject(initRoot, { template: 'config' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wroteFiles).toContain('.cursor/rules/dioramai.mdc');
    expect(result.data.wroteFiles).toContain('.cursor/mcp.json');

    const rule = await readFile(resolve(initRoot, '.cursor/rules/dioramai.mdc'), 'utf8');
    expect(rule).toContain('dioramai-scene-start');
    expect(rule).toContain('import_glb_asset');

    const mcp = JSON.parse(await readFile(resolve(initRoot, '.cursor/mcp.json'), 'utf8')) as {
      mcpServers: { dioramai: { command: string; args: string[] } };
    };
    expect(mcp.mcpServers.dioramai.command).toBe('npx');
    expect(mcp.mcpServers.dioramai.args).toEqual(['dioramai', 'mcp']);
  });

  it('refuses to scaffold a non-empty folder without --force', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-init-nonempty-'));
    // package.json is a real project file — not a new-repo boilerplate entry
    await writeFile(resolve(initRoot, 'package.json'), '{"name":"existing"}', 'utf8');

    const result = await initializeDioramaiProject(initRoot, {
      template: 'vite-r3f',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROJECT_NOT_EMPTY');
    expect(await readFile(resolve(initRoot, 'package.json'), 'utf8')).toBe('{"name":"existing"}');
  });

  it('succeeds when the folder only contains new-repo boilerplate files (.gitignore, README.md, LICENSE)', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-init-newclone-'));
    await writeFile(resolve(initRoot, '.gitignore'), 'node_modules\n', 'utf8');
    await writeFile(resolve(initRoot, 'README.md'), '# My project\n', 'utf8');
    await writeFile(resolve(initRoot, 'LICENSE'), 'MIT\n', 'utf8');
    await mkdir(resolve(initRoot, '.git'), { recursive: true });

    const result = await initializeDioramaiProject(initRoot, {
      template: 'vite-r3f',
    });

    expect(result.ok).toBe(true);
    // .gitignore from the init template should overwrite the placeholder
    if (!result.ok) return;
    expect(result.data.wroteFiles).toContain('package.json');
  });

  it('reports a fresh scaffold as doctor-ready with only non-blocking warnings', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-doctor-'));
    const initialized = await initializeDioramaiProject(initRoot, {
      template: 'vite-r3f',
    });
    expect(initialized.ok).toBe(true);

    const doctor = await doctorDioramaiProject(initRoot, { port: 9 });

    expect(doctor.ok).toBe(true);
    if (!doctor.ok) return;
    expect(doctor.data.ok).toBe(true);
    expect(doctor.data.items.filter((item) => item.status === 'fail')).toEqual([]);
    expect(doctor.data.items.map((item) => item.label)).toEqual(expect.arrayContaining([
      'package.json',
      'React/R3F dependencies',
      'dioramai.config.json',
      'Generated scene parses',
      'App wiring',
    ]));
  });

  it('warns when app code loads a GLB outside the canonical scene', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-doctor-out-of-band-'));
    const initialized = await initializeDioramaiProject(initRoot, {
      template: 'vite-r3f',
    });
    expect(initialized.ok).toBe(true);
    await writeFile(resolve(initRoot, 'src/WalkingAndroid.tsx'), [
      "import { useGLTF } from '@react-three/drei';",
      '',
      "const MODEL_URL = '/assets/models/android.glb';",
      '',
      'export function WalkingAndroid() {',
      '  useGLTF(MODEL_URL);',
      '  return null;',
      '}',
      '',
    ].join('\n'), 'utf8');

    const doctor = await doctorDioramaiProject(initRoot, { port: 9 });

    expect(doctor.ok).toBe(true);
    if (!doctor.ok) return;
    expect(doctor.data.ok).toBe(true);
    const warning = doctor.data.items.find((item) => item.label === 'Out-of-band GLB rendering');
    expect(warning?.status).toBe('warn');
    expect(warning?.message).toContain('/assets/models/android.glb');
    expect(warning?.message).toContain('src/WalkingAndroid.tsx');
    expect(warning?.fix).toContain('import_glb_asset');
  });

  it('fails doctor when a canonical GLB node is hidden and app code loads the same asset', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-doctor-hidden-canonical-'));
    const initialized = await initializeDioramaiProject(initRoot, {
      template: 'vite-r3f',
    });
    expect(initialized.ok).toBe(true);
    await writeFile(
      resolve(initRoot, 'src/generated/DioramaiScene.generated.tsx'),
      exportSceneToR3fSyncModule(createHiddenAndroidScene()).code,
      'utf8',
    );
    await writeFile(resolve(initRoot, 'src/AnimatedAndroid.tsx'), [
      "import { useGLTF } from '@react-three/drei';",
      '',
      "const ANDROID_URI = '/assets/models/android.glb';",
      '',
      'export function AnimatedAndroid() {',
      '  useGLTF(ANDROID_URI);',
      '  return null;',
      '}',
      '',
    ].join('\n'), 'utf8');

    const doctor = await doctorDioramaiProject(initRoot, { port: 9 });

    expect(doctor.ok).toBe(true);
    if (!doctor.ok) return;
    expect(doctor.data.ok).toBe(false);
    const hidden = doctor.data.items.find((item) => item.label === 'Hidden canonical GLB assets');
    expect(hidden?.status).toBe('fail');
    expect(hidden?.message).toContain('Orange Armor Android');
    expect(hidden?.message).toContain('/assets/models/android.glb');
    expect(hidden?.fix).toContain('Keep canonical GLB nodes visible');
  });

  it('warns when a canonical GLB asset has no imported internal hierarchy', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-doctor-opaque-glb-'));
    const initialized = await initializeDioramaiProject(initRoot, {
      template: 'vite-r3f',
    });
    expect(initialized.ok).toBe(true);
    await writeFile(
      resolve(initRoot, 'src/generated/DioramaiScene.generated.tsx'),
      exportSceneToR3fSyncModule(createOpaqueAndroidScene()).code,
      'utf8',
    );

    const doctor = await doctorDioramaiProject(initRoot, { port: 9 });

    expect(doctor.ok).toBe(true);
    if (!doctor.ok) return;
    expect(doctor.data.ok).toBe(true);
    const opaque = doctor.data.items.find((item) => item.label === 'Opaque GLB hierarchy');
    expect(opaque?.status).toBe('warn');
    expect(opaque?.message).toContain('Orange Armor Android');
    expect(opaque?.message).toContain('no imported internal hierarchy');
    expect(opaque?.fix).toContain('importMode "hierarchy"');
  });

  it('reports clear doctor failures for missing project essentials', async () => {
    initRoot = await mkdtemp(join(tmpdir(), 'dioramai-doctor-missing-'));

    const doctor = await doctorDioramaiProject(initRoot, { port: 9 });

    expect(doctor.ok).toBe(true);
    if (!doctor.ok) return;
    expect(doctor.data.ok).toBe(false);
    const failedLabels = doctor.data.items
      .filter((item) => item.status === 'fail')
      .map((item) => item.label);
    expect(failedLabels).toEqual(expect.arrayContaining([
      'package.json',
      'dioramai.config.json',
      'Asset directory',
      'Generated scene module',
    ]));
  });
});

describe('DioramaiBridgeRuntime importAsset and sync', () => {
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dioramai-bridge-'));
    await mkdir(resolve(projectRoot, 'fixtures'), { recursive: true });
    await writeFile(resolve(projectRoot, sourceRel), createTestGlb());
  });

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    projectRoot = '';
  });

  it('imports a project GLB through validated commands with shallow hierarchy', async () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Import Test'), {
      projectRoot,
    });

    const result = await runtime.callTool('import_glb_asset', {
      path: sourceRel,
      name: 'Fixture Chair',
      importMode: 'shallow',
      semanticRole: 'decor',
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.assetId).toBe('asset-bridge-import-test');
    expect(result.data.commands.map((command: Command) => command.type)).toEqual([
      'REGISTER_ASSET',
      'ADD_NODE',
      'ADD_NODE',
      'ADD_NODE',
      'SET_NODE_SEMANTICS',
    ]);
    expect(result.data.importedNodeIds).toEqual([
      'asset-bridge-import-test-node',
      'asset-bridge-import-test-node-gltf-0-fixture-root',
      'asset-bridge-import-test-node-gltf-1-fixture-mesh',
    ]);
    expect(result.data.hierarchySummary?.nodeCount).toBe(2);
    expect(result.data.scene.nodes['asset-bridge-import-test-node']?.assetRef).toEqual({
      kind: 'uri',
      uri: '/assets/models/bridge-import-test.glb',
    });
    expect(result.data.scene.nodes['asset-bridge-import-test-node']?.name).toBe('Fixture Chair');
    expect(result.data.scene.nodes['asset-bridge-import-test-node']?.semantics?.role).toBe('decor');
    expect(result.data.scene.assets?.['asset-bridge-import-test']?.kind).toBe('glb');
    expect(result.data.scene.assets?.['asset-bridge-import-test']?.source).toBe('manual');
  });

  it('registers a project GLB with glTF hierarchy by default', async () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Import Test'), {
      projectRoot,
    });

    const result = await runtime.callTool('register_asset', {
      path: sourceRel,
      name: 'Fixture Chair',
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.commands.map((command: Command) => command.type)).toEqual([
      'REGISTER_ASSET',
      'ADD_NODE',
      'ADD_NODE',
      'ADD_NODE',
    ]);
    expect(result.data.importedNodeIds).toEqual([
      'asset-bridge-import-test-node',
      'asset-bridge-import-test-node-gltf-0-fixture-root',
      'asset-bridge-import-test-node-gltf-1-fixture-mesh',
    ]);
    expect(result.data.hierarchySummary?.nodeCount).toBe(2);
    const renderableNodes = (Object.values(result.data.scene.nodes) as SceneNode[]).filter((node) =>
      node.assetRef?.kind === 'uri' &&
      node.metadata.renderMode !== 'gltf-inspect-only',
    );
    expect(renderableNodes).toHaveLength(1);
    expect(renderableNodes[0]?.assetRef).toEqual({
      kind: 'uri',
      uri: '/assets/models/bridge-import-test.glb',
    });
  });

  it('registers a project GLB as a single placed asset when importMode is single', async () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Import Test'), {
      projectRoot,
    });

    const result = await runtime.callTool('register_asset', {
      path: sourceRel,
      name: 'Fixture Chair',
      importMode: 'single',
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.commands.map((command: Command) => command.type)).toEqual([
      'REGISTER_ASSET',
      'ADD_NODE',
    ]);
    expect(result.data.importedNodeIds).toEqual(['asset-bridge-import-test-node']);
    expect(result.data.hierarchySummary?.nodeCount).toBe(0);
    const renderableNodes = (Object.values(result.data.scene.nodes) as SceneNode[]).filter((node) =>
      node.assetRef?.kind === 'uri' &&
      node.metadata.renderMode !== 'gltf-inspect-only',
    );
    expect(renderableNodes).toHaveLength(1);
    expect(renderableNodes[0]?.assetRef).toEqual({
      kind: 'uri',
      uri: '/assets/models/bridge-import-test.glb',
    });
  });

  it('loads dioramai.config.json and reports project status', async () => {
    await writeFile(resolve(projectRoot, 'dioramai.config.json'), JSON.stringify({
      projectRoot: '.',
      assetDir: 'public/assets/models',
      generatedSceneFile: 'src/generated/DioramaiScene.generated.tsx',
      publicAssetBase: '/assets/models',
      sceneJsonFile: 'src/generated/dioramai.scene.json',
    }, null, 2));

    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Config Test'), {
      projectRoot,
    });

    const status = await runtime.callTool('get_project_status', {});
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.configFound).toBe(true);
    expect(status.data.assetDirExists).toBe(false);
    expect(status.data.generatedFileExists).toBe(false);
    expect(status.data.currentSceneLoaded).toBe(true);
    expect(status.data.publicAssetBase).toBe('/assets/models');
  });

  it('includes out-of-band GLB warnings in project status', async () => {
    await mkdir(resolve(projectRoot, 'src'), { recursive: true });
    await writeFile(resolve(projectRoot, 'src/WalkingAndroid.tsx'), [
      "import { useGLTF } from '@react-three/drei';",
      "const MODEL_URL = '/assets/models/android.glb';",
      'export function WalkingAndroid() {',
      '  useGLTF(MODEL_URL);',
      '  return null;',
      '}',
      '',
    ].join('\n'), 'utf8');
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Config Test'), {
      projectRoot,
    });

    const status = await runtime.callTool('get_project_status', {});

    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.projectWarnings).toHaveLength(1);
    expect(status.data.projectWarnings[0]).toContain('/assets/models/android.glb');
    expect(status.data.projectWarnings[0]).toContain('src/WalkingAndroid.tsx');
  });

  it('includes hidden canonical GLB warnings in project status', async () => {
    await mkdir(resolve(projectRoot, 'src'), { recursive: true });
    await writeFile(resolve(projectRoot, 'src/AnimatedAndroid.tsx'), [
      "import { useGLTF } from '@react-three/drei';",
      "const ANDROID_URI = '/assets/models/android.glb';",
      'export function AnimatedAndroid() {',
      '  useGLTF(ANDROID_URI);',
      '  return null;',
      '}',
      '',
    ].join('\n'), 'utf8');
    const runtime = new DioramaiBridgeRuntime(createHiddenAndroidScene(), {
      projectRoot,
    });

    const status = await runtime.callTool('get_project_status', {});

    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.projectWarnings).toHaveLength(2);
    expect(status.data.projectWarnings[1]).toContain('Canonical GLB/GLTF nodes are hidden');
    expect(status.data.projectWarnings[1]).toContain('Orange Armor Android');
  });

  it('includes opaque GLB hierarchy warnings in project status', async () => {
    const runtime = new DioramaiBridgeRuntime(createOpaqueAndroidScene(), {
      projectRoot,
    });

    const status = await runtime.callTool('get_project_status', {});

    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.projectWarnings).toHaveLength(1);
    expect(status.data.projectWarnings[0]).toContain('no imported internal hierarchy');
    expect(status.data.projectWarnings[0]).toContain('Orange Armor Android');
  });

  it('rejects workspace paths outside the project root', async () => {
    expect(resolveWorkspaceRelativePath('../secret.glb', projectRoot).ok).toBe(false);

    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Import Test'), {
      projectRoot,
    });
    const result = await runtime.callTool('register_asset', {
      workspaceRelativePath: '../secret.glb',
      importMode: 'shallow',
    });
    expect(result.ok).toBe(false);
  });

  it('maps public asset URLs only into the configured project asset dir', () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Asset Route Test'), {
      projectRoot,
    });

    expect(runtime.resolvePublicAssetPath('/assets/models/chair.glb').ok).toBe(true);
    expect(runtime.resolvePublicAssetPath('/assets/other/chair.glb').ok).toBe(false);
    expect(runtime.resolvePublicAssetPath('/assets/models/../secret.glb').ok).toBe(false);
    expect(runtime.resolvePublicAssetPath('/assets/models/chair.exe').ok).toBe(false);
  });

  it('writes deterministic generated R3F sync modules from runtime commands', async () => {
    const scene = createEmptyScene('Sync Test');
    const runtime = new DioramaiBridgeRuntime(scene, { projectRoot });
    const node = {
      ...Object.values(scene.nodes)[0]!,
      id: 'box',
      name: 'Box',
      type: 'mesh' as const,
    };

    const loaded = await runtime.callTool('load_scene', {
      scene: applyCommand(scene, { type: 'ADD_NODE', parentId: scene.rootId, node }),
    });
    expect(loaded.ok).toBe(true);
    const transformed = await runtime.callTool('update_transform', {
      nodeId: 'box',
      patch: { position: [1, 2, 3] },
    });

    expect(transformed.ok).toBe(true);
    const generatedPath = runtime.getProjectInfo().generatedModulePath;
    const code = await readFile(generatedPath, 'utf8');
    expect(code).not.toContain(projectRoot);
    expect(code).not.toContain(projectRoot.replace(/\\/g, '\\\\'));
    const parsed = parseSceneFromR3fSyncModule(code);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.nodes.box?.transform.position).toEqual([1, 2, 3]);

    const sceneJson = await readFile(runtime.getProjectInfo().sessionPath, 'utf8');
    expect(sceneJson).not.toContain(projectRoot);
    const secondWrite = await runtime.callTool('write_scene_to_file', {});
    expect(secondWrite.ok).toBe(true);
    if (secondWrite.ok) {
      expect((secondWrite.data as { bytesChanged: boolean }).bytesChanged).toBe(false);
    }
  });

  it('loads code edits from the generated scene block through sync_code parsing', async () => {
    const scene = createEmptyScene('Sync Test');
    const runtime = new DioramaiBridgeRuntime(scene, { projectRoot });
    const rootId = scene.rootId;
    const nextScene = applyCommand(scene, {
      type: 'UPDATE_TRANSFORM',
      nodeId: rootId,
      patch: { position: [4, 5, 6] },
    });

    const exported = await runtime.callTool('export_r3f', {});
    expect(exported.ok).toBe(true);
    const generatedPath = runtime.getProjectInfo().generatedModulePath;
    let code = await readFile(generatedPath, 'utf8');
    code = code.replace(
      '"position": [\n            0,\n            0,\n            0\n          ]',
      '"position": [\n            4,\n            5,\n            6\n          ]',
    );
    await writeFile(generatedPath, code, 'utf8');

    const synced = await runtime.callTool('reload_scene_from_file', {});
    expect(synced.ok).toBe(true);
    const current = await runtime.callTool('get_scene', {});
    expect(current).toEqual({ ok: true, data: { scene: nextScene } });
  });

  it('watches generated module edits without suppressing real user changes after Dioramai writes', async () => {
    const scene = createEmptyScene('Watch Sync Test');
    const runtime = new DioramaiBridgeRuntime(scene, {
      projectRoot,
      watchCode: true,
      codeWatchDebounceMs: 10,
    });
    try {
      const rootId = scene.rootId;
      const exported = await runtime.callTool('write_scene_to_file', {});
      expect(exported.ok).toBe(true);

      let code = await readFile(runtime.getProjectInfo().generatedModulePath, 'utf8');
      code = code.replace(
        '"position": [\n            0,\n            0,\n            0\n          ]',
        '"position": [\n            8,\n            0,\n            0\n          ]',
      );
      await writeFile(runtime.getProjectInfo().generatedModulePath, code, 'utf8');

      const reloaded = await waitFor(async () => {
        const current = await runtime.callTool('get_scene', {});
        return current.ok && current.data.scene.nodes[rootId]?.transform.position[0] === 8;
      });
      expect(reloaded).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it('rejects invalid scene JSON when reloading from file fallback', async () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Invalid Reload'), { projectRoot });
    await mkdir(resolve(projectRoot, 'src/generated'), { recursive: true });
    await writeFile(runtime.getProjectInfo().sessionPath, '{"format":"dioramai-scene","version":2,"data":{}}', 'utf8');

    const result = await runtime.callTool('reload_scene_from_file', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCENE_BLOCK_INVALID');
  });

  it('rejects unsafe generic bridge tools over the HTTP tool route', async () => {
    const started = await startDioramaiBridgeServer(0, {
      projectRoot,
      pairingToken: 'test-token',
    });
    try {
      const response = await fetch(`http://127.0.0.1:${started.port}/tools/apply_command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: { type: 'SET_SELECTION', nodeId: null } }),
      });
      const payload = await response.json() as { ok: boolean; error?: { code: string } };
      expect(response.status).toBe(404);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('NOT_FOUND');
    } finally {
      await started.close();
    }
  });

  it('requires a pairing token for browser-origin bridge requests', async () => {
    const started = await startDioramaiBridgeServer(0, {
      projectRoot,
      pairingToken: 'test-token',
    });
    try {
      const rejected = await fetch(`http://127.0.0.1:${started.port}/scene`, {
        headers: { Origin: 'https://example.com' },
      });
      expect(rejected.status).toBe(403);

      const accepted = await fetch(`http://127.0.0.1:${started.port}/scene?token=test-token`, {
        headers: { Origin: 'https://example.com' },
      });
      expect(accepted.status).toBe(200);
    } finally {
      await started.close();
    }
  });

  it('falls back to the next available port when the preferred bridge port is busy', async () => {
    const blocker = createNetServer();
    const preferredPort = await listenOnRandomPort(blocker);
    const started = await startDioramaiBridgeServerWithFallback(preferredPort, {
      projectRoot,
      pairingToken: 'test-token',
    });
    try {
      expect(started.requestedPort).toBe(preferredPort);
      expect(started.port).not.toBe(preferredPort);
      const health = await fetch(`http://127.0.0.1:${started.port}/health`);
      const payload = await health.json() as { ok: boolean; data?: { bridgeRunning?: boolean; sceneLoaded?: boolean } };
      expect(health.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.data?.bridgeRunning).toBe(true);
      expect(payload.data?.sceneLoaded).toBe(true);
    } finally {
      await started.close();
      await closeNetServer(blocker);
    }
  });
});

// ─── Semantic and behavior bridge tools ─────────────────────────────────────

describe('DioramaiBridgeRuntime — semantic and behavior tools', () => {
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dioramai-sem-'));
    await mkdir(resolve(projectRoot, 'src/generated'), { recursive: true });
  });

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    projectRoot = '';
  });

  it('set_node_semantics applies role and tags through the command reducer', async () => {
    const scene = getStarterScene('default');
    const nodeId = 'default-cube-1';
    const runtime = new DioramaiBridgeRuntime(scene, { projectRoot });

    const result = await runtime.callTool('set_node_semantics', {
      nodeIds: [nodeId],
      semantics: { role: 'product', tags: ['featured', 'new'] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sceneResult = await runtime.callTool('get_scene', {});
    expect(sceneResult.ok).toBe(true);
    if (!sceneResult.ok) return;
    const node = (sceneResult.data.scene as typeof scene).nodes[nodeId];
    expect(node?.semantics?.role).toBe('product');
    expect(node?.semantics?.tags).toEqual(['featured', 'new']);
  });

  it('set_node_semantics returns VALIDATION_ERROR for missing nodeIds', async () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Sem Err'), { projectRoot });
    const result = await runtime.callTool('set_node_semantics', { semantics: { role: 'product' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('add_behavior attaches a behavior definition to a node', async () => {
    const scene = getStarterScene('default');
    const nodeId = 'default-cube-1';
    const runtime = new DioramaiBridgeRuntime(scene, { projectRoot });

    const result = await runtime.callTool('add_behavior', {
      behavior: { id: 'beh-hover-1', type: 'hover_highlight', nodeIds: [nodeId] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sceneResult = await runtime.callTool('get_scene', {});
    expect(sceneResult.ok).toBe(true);
    if (!sceneResult.ok) return;
    const s = sceneResult.data.scene as typeof scene;
    expect(s.behaviors?.['beh-hover-1']?.type).toBe('hover_highlight');
    expect(s.nodes[nodeId]?.behaviorRefs).toContain('beh-hover-1');
  });

  it('add_behavior supports params for show_info type', async () => {
    const scene = getStarterScene('default');
    const nodeId = 'default-cube-1';
    const runtime = new DioramaiBridgeRuntime(scene, { projectRoot });

    const result = await runtime.callTool('add_behavior', {
      behavior: {
        id: 'beh-info-1',
        type: 'show_info',
        nodeIds: [nodeId],
        params: { title: 'Oak Chair', description: 'Handcrafted oak seat.' },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sceneResult = await runtime.callTool('get_scene', {});
    expect(sceneResult.ok).toBe(true);
    if (!sceneResult.ok) return;
    const s = sceneResult.data.scene as typeof scene;
    const beh = s.behaviors?.['beh-info-1'];
    expect(beh?.params?.title).toBe('Oak Chair');
    expect(beh?.params?.description).toBe('Handcrafted oak seat.');
  });

  it('add_behavior returns VALIDATION_ERROR for missing behavior object', async () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Beh Err'), { projectRoot });
    const result = await runtime.callTool('add_behavior', { behaviorId: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('remove_behavior detaches a behavior definition from a node', async () => {
    const scene = getStarterScene('default');
    const nodeId = 'default-cube-1';
    const runtime = new DioramaiBridgeRuntime(scene, { projectRoot });

    // First add a behavior through the tool so it's in the canonical scene
    await runtime.callTool('add_behavior', {
      behavior: { id: 'beh-rm-1', type: 'click_select', nodeIds: [nodeId] },
    });

    const result = await runtime.callTool('remove_behavior', { behaviorId: 'beh-rm-1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sceneResult = await runtime.callTool('get_scene', {});
    expect(sceneResult.ok).toBe(true);
    if (!sceneResult.ok) return;
    const s = sceneResult.data.scene as typeof scene;
    expect(s.behaviors?.['beh-rm-1']).toBeUndefined();
  });

  it('remove_behavior returns VALIDATION_ERROR for missing behaviorId', async () => {
    const runtime = new DioramaiBridgeRuntime(createEmptyScene('Rm Err'), { projectRoot });
    const result = await runtime.callTool('remove_behavior', { behavior: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('semantic and behavior tools are accessible via the HTTP /tools/ route', async () => {
    const started = await startDioramaiBridgeServer(0, {
      projectRoot,
      // Use starter scene so a non-root node exists for set_node_semantics
      sessionRelativePath: 'src/generated/dioramai.scene.json',
    });
    try {
      // Use a known non-root node from the starter scene
      const res = await fetch(`http://127.0.0.1:${started.port}/tools/set_node_semantics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds: ['default-cube-1'], semantics: { role: 'product' } }),
      });
      expect(res.status).toBe(200);
      const payload = await res.json() as { ok: boolean };
      expect(payload.ok).toBe(true);
    } finally {
      await started.close();
    }
  });
});

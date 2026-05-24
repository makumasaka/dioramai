import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeDioramaiProject, type StartedBridgeServer } from '@dioramai/local-bridge';
import { runCli } from './index';

const createIo = () => {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
};

const fakeStartedBridge = (
  projectRoot: string,
  requestedPort: number,
  selectedPort: number,
  pairingToken = 'abcdef1234567890',
): StartedBridgeServer => ({
  server: {} as StartedBridgeServer['server'],
  requestedPort,
  port: selectedPort,
  pairingToken,
  runtime: {
    getProjectInfo: () => ({
      projectRoot,
      configFound: true,
      configPath: resolve(projectRoot, 'dioramai.config.json'),
      sessionPath: resolve(projectRoot, 'src/generated/dioramai.scene.json'),
      sessionRelativePath: 'src/generated/dioramai.scene.json',
      generatedModulePath: resolve(projectRoot, 'src/generated/DioramaiScene.generated.tsx'),
      generatedModuleRelativePath: 'src/generated/DioramaiScene.generated.tsx',
      assetDirPath: resolve(projectRoot, 'public/assets/models'),
      assetDirRelativePath: 'public/assets/models',
      publicUrlBase: '/assets/models',
      lastSync: null,
    }),
  } as StartedBridgeServer['runtime'],
  close: async () => undefined,
});

describe('dioramai init CLI', () => {
  let projectRoot = '';

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    projectRoot = '';
  });

  it('prints manual install, doctor, and dev next steps without --install', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dioramai-cli-init-'));
    const capture = createIo();
    let installCalled = false;

    const exitCode = await runCli(
      ['init', '--template', 'vite-r3f', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        installDependencies: async () => {
          installCalled = true;
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(installCalled).toBe(false);
    expect(capture.stdout()).toContain('Next steps:');
    expect(capture.stdout()).toContain('1. npm install');
    expect(capture.stdout()).toContain('2. npx dioramai doctor');
    expect(capture.stdout()).toContain('3. npx dioramai dev --open');
    expect(capture.stdout()).toContain('4. Add GLBs to public/assets/models');
    expect(capture.stdout()).toContain('5. Open this repo in Cursor');
    expect(capture.stdout()).not.toContain('Pairing token:');
    await expect(stat(resolve(projectRoot, '.dioramai'))).rejects.toThrow();
  });

  it('runs mocked npm install with --install and marks install complete', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dioramai-cli-install-'));
    const capture = createIo();
    const installRoots: string[] = [];

    const exitCode = await runCli(
      ['init', '--template', 'vite-r3f', '--install', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        installDependencies: async (root) => {
          installRoots.push(root);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(installRoots).toEqual([projectRoot]);
    expect(capture.stdout()).toContain('Installing dependencies with npm install...');
    expect(capture.stdout()).toContain('Dependencies installed.');
    expect(capture.stdout()).toContain('1. npm install (complete)');
    expect(capture.stdout()).toContain('2. npx dioramai doctor');
    expect(capture.stdout()).toContain('3. npx dioramai dev --open');
  });

  it('prints recovery instructions when --install fails after scaffolding', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dioramai-cli-install-fail-'));
    const capture = createIo();

    const exitCode = await runCli(
      ['init', '--template', 'vite-r3f', '--install', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        installDependencies: async () => 1,
      },
    );

    expect(exitCode).toBe(1);
    expect(capture.stderr()).toContain('Dependency install failed.');
    expect(capture.stderr()).toContain('Run npm install');
    expect(capture.stdout()).toContain('1. npm install (retry)');
    expect(await readFile(resolve(projectRoot, 'package.json'), 'utf8')).toContain('"dev": "vite"');
  });

  it('still refuses a non-empty folder unless --force', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dioramai-cli-nonempty-'));
    await writeFile(resolve(projectRoot, 'README.md'), 'keep me', 'utf8');
    const capture = createIo();

    const exitCode = await runCli(
      ['init', '--template', 'vite-r3f', '--projectRoot', projectRoot],
      {},
      capture.io,
    );

    expect(exitCode).toBe(1);
    expect(capture.stderr()).toContain('Dioramai init expected an empty folder');
    expect(capture.stderr()).toContain('pass --force');
    expect(await readFile(resolve(projectRoot, 'README.md'), 'utf8')).toBe('keep me');
  });
});

describe('dioramai dev CLI', () => {
  let projectRoot = '';

  const initProject = async (): Promise<void> => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dioramai-cli-dev-'));
    const initialized = await initializeDioramaiProject(projectRoot, {
      template: 'vite-r3f',
    });
    expect(initialized.ok).toBe(true);
  };

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    projectRoot = '';
  });

  it('runs a non-blocking preflight and prints dev status for a valid project', async () => {
    await initProject();
    const capture = createIo();
    let started = false;

    const exitCode = await runCli(
      ['dev', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        startBridgeServer: async (requestedPort) => {
          started = true;
          return fakeStartedBridge(projectRoot, requestedPort ?? 7777, requestedPort ?? 7777);
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(started).toBe(true);
    expect(capture.stdout()).toContain('Preflight warnings:');
    expect(capture.stdout()).toContain('GLB assets: No GLB/GLTF assets were found yet.');
    expect(capture.stdout()).toContain('Dioramai dev started');
    expect(capture.stdout()).toContain('Bridge:');
    expect(capture.stdout()).toContain('- URL: http://127.0.0.1:7777');
    expect(capture.stdout()).toContain('- Shell (local): http://localhost:5173/');
    expect(capture.stdout()).toContain('- Code watcher: enabled');
    expect(capture.stdout()).toContain('- GLBs discovered: 0');
    expect(capture.stdout()).toContain('1. In another terminal, run:');
    expect(capture.stdout()).toContain('   npm run dev');
  });

  it('fails dev preflight for invalid config JSON', async () => {
    await initProject();
    await writeFile(resolve(projectRoot, 'dioramai.config.json'), '{ nope', 'utf8');
    const capture = createIo();
    let started = false;

    const exitCode = await runCli(
      ['dev', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        startBridgeServer: async (requestedPort) => {
          started = true;
          return fakeStartedBridge(projectRoot, requestedPort ?? 7777, requestedPort ?? 7777);
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(started).toBe(false);
    expect(capture.stderr()).toContain('Dioramai dev preflight failed:');
    expect(capture.stderr()).toContain('dioramai.config.json');
  });

  it('fails dev preflight for configured paths outside the project root', async () => {
    await initProject();
    await writeFile(resolve(projectRoot, 'dioramai.config.json'), JSON.stringify({
      projectRoot: '.',
      assetDir: 'public/assets/models',
      generatedSceneFile: '../outside/DioramaiScene.generated.tsx',
      publicAssetBase: '/assets/models',
      sceneJsonFile: 'src/generated/dioramai.scene.json',
    }, null, 2), 'utf8');
    const capture = createIo();

    const exitCode = await runCli(
      ['dev', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        startBridgeServer: async (requestedPort) => fakeStartedBridge(projectRoot, requestedPort ?? 7777, requestedPort ?? 7777),
      },
    );

    expect(exitCode).toBe(1);
    expect(capture.stderr()).toContain('Configured paths');
    expect(capture.stderr()).toContain('outside the project root');
  });

  it('fails dev preflight when the generated scene cannot parse', async () => {
    await initProject();
    await writeFile(resolve(projectRoot, 'src/generated/DioramaiScene.generated.tsx'), 'export const nope = true;', 'utf8');
    const capture = createIo();

    const exitCode = await runCli(
      ['dev', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        startBridgeServer: async (requestedPort) => fakeStartedBridge(projectRoot, requestedPort ?? 7777, requestedPort ?? 7777),
      },
    );

    expect(exitCode).toBe(1);
    expect(capture.stderr()).toContain('Generated scene parses');
  });

  it('counts discovered GLB and GLTF assets during dev startup', async () => {
    await initProject();
    await mkdir(resolve(projectRoot, 'public/assets/models'), { recursive: true });
    await writeFile(resolve(projectRoot, 'public/assets/models/chair.glb'), 'glb', 'utf8');
    await writeFile(resolve(projectRoot, 'public/assets/models/table.gltf'), '{}', 'utf8');
    const capture = createIo();

    const exitCode = await runCli(
      ['dev', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        startBridgeServer: async (requestedPort) => fakeStartedBridge(projectRoot, requestedPort ?? 7777, requestedPort ?? 7777),
      },
    );

    expect(exitCode).toBe(0);
    expect(capture.stdout()).toContain('- GLBs discovered: 2');
    expect(capture.stdout()).toContain('public/assets/models/chair.glb');
    expect(capture.stdout()).toContain('public/assets/models/table.gltf');
  });

  it('uses fallback bridge ports and opens the selected shell URL with token params', async () => {
    await initProject();
    const capture = createIo();
    const openedUrls: string[] = [];

    const exitCode = await runCli(
      ['dev', '--open', '--projectRoot', projectRoot, '--port', '7777', '--shellUrl', 'https://dioramai.design/'],
      {},
      capture.io,
      {
        startBridgeServer: async (requestedPort) =>
          fakeStartedBridge(projectRoot, requestedPort ?? 7777, 7781, 'token-1234567890'),
        openUrl: (url) => {
          openedUrls.push(url);
          return true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(openedUrls).toHaveLength(1);
    const opened = new URL(openedUrls[0]!);
    expect(opened.origin).toBe('https://dioramai.design');
    expect(opened.searchParams.get('bridgeToken')).toBe('token-1234567890');
    expect(opened.searchParams.get('bridgeUrl')).toBe('http://127.0.0.1:7781');
    expect(capture.stdout()).toContain('Requested port 7777 was unavailable; using 7781.');
    expect(capture.stdout()).toContain('- URL: http://127.0.0.1:7781');
    expect(capture.stdout()).toContain('- Shell (hosted): https://dioramai.design/');
    expect(capture.stdout()).toContain('Opening Dioramai shell:');
  });

  it('prints the manual shell URL when browser opening fails', async () => {
    await initProject();
    const capture = createIo();

    const exitCode = await runCli(
      ['dev', '--open', '--projectRoot', projectRoot],
      {},
      capture.io,
      {
        startBridgeServer: async (requestedPort) => fakeStartedBridge(projectRoot, requestedPort ?? 7777, requestedPort ?? 7777),
        openUrl: () => false,
      },
    );

    expect(exitCode).toBe(0);
    expect(capture.stderr()).toContain('Could not open the browser automatically.');
    expect(capture.stderr()).toContain('bridgeToken=');
    expect(capture.stderr()).toContain('bridgeUrl=');
  });
});

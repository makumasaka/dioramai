#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  DEFAULT_BRIDGE_PORT,
  DioramaiBridgeRuntime,
  doctorDioramaiProject,
  initializeDioramaiProject,
  loadInitialBridgeScene,
  startDioramaiBridgeServer,
  validateDioramaiProject,
} from '@dioramai/local-bridge';

const argValue = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const projectRootArg = (): string =>
  argValue('projectRoot') ?? argValue('root') ?? process.cwd();

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const openUrl = (url: string): void => {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
};

const shellUrlFor = (pairingToken: string, port: number): string => {
  const base = argValue('shellUrl') ?? process.env.DIORAMAI_WEB_SHELL_URL ?? 'http://localhost:5173/';
  const url = new URL(base);
  url.searchParams.set('bridgeToken', pairingToken);
  url.searchParams.set('bridgeUrl', `http://127.0.0.1:${port}`);
  return url.toString();
};

const printNextSteps = (): void => {
  process.stdout.write('\nNext steps:\n');
  process.stdout.write('1. Drop GLBs into public/assets/models.\n');
  process.stdout.write('2. Run npx dioramai doctor.\n');
  process.stdout.write('3. Open this project in Cursor.\n');
  process.stdout.write('4. Use Dioramai UI or MCP tools to register assets.\n');
};

const printDoctor = (result: Awaited<ReturnType<typeof doctorDioramaiProject>>): void => {
  if (!result.ok) {
    printJson(result);
    return;
  }
  process.stdout.write(`Dioramai doctor for ${result.data.projectRoot}\n`);
  for (const item of result.data.items) {
    const marker = item.status === 'pass' ? '[ok]' : item.status === 'warn' ? '[warn]' : '[fail]';
    process.stdout.write(`${marker} ${item.label}: ${item.message}\n`);
    if (item.fix) process.stdout.write(`      fix: ${item.fix}\n`);
  }
  if (result.data.glbFiles.length > 0) {
    process.stdout.write(`\nGLBs:\n${result.data.glbFiles.map((file) => `- ${file}`).join('\n')}\n`);
  }
  process.stdout.write(`\n${result.data.ok ? 'Doctor passed.' : 'Doctor found blocking issues.'}\n`);
};

const run = async (): Promise<void> => {
  const command = process.argv[2] ?? 'help';
  const projectRoot = projectRootArg();
  const port = Number(argValue('port') ?? process.env.DIORAMAI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);

  switch (command) {
    case 'init': {
      const result = await initializeDioramaiProject(projectRoot, {
        template: (argValue('template') ?? 'vite-r3f') as 'vite-r3f' | 'config',
        force: hasFlag('force'),
      });
      if (result.ok) {
        process.stdout.write(`Initialized Dioramai project at ${result.data.projectRoot}\n`);
        process.stdout.write(`Config: ${result.data.configPath}\n`);
        process.stdout.write(`Generated scene: ${result.data.generatedModule}\n`);
        process.stdout.write(`Asset dir: ${result.data.assetDir}\n`);
        if (result.data.wroteFiles.length > 0) {
          process.stdout.write(`Wrote ${result.data.wroteFiles.length} files/directories.\n`);
        }
        printNextSteps();
      } else {
        process.stderr.write(`${result.error.message}\n`);
        if (result.error.code === 'PROJECT_NOT_EMPTY') {
          process.stderr.write('Run in an empty folder, pass --force, or add dioramai.config.json manually.\n');
        }
        process.exitCode = 1;
      }
      return;
    }

    case 'doctor': {
      const result = await doctorDioramaiProject(projectRoot, { port });
      printDoctor(result);
      if (!result.ok || !result.data.ok) process.exitCode = 1;
      return;
    }

    case 'dev': {
      const started = await startDioramaiBridgeServer(port, {
        projectRoot,
        watchCode: process.env.DIORAMAI_WATCH_CODE !== 'false',
        pairingToken: argValue('token') ?? process.env.DIORAMAI_BRIDGE_TOKEN,
      });
      const info = started.runtime.getProjectInfo();
      const bridgeUrl = `http://127.0.0.1:${started.port}`;
      const shellUrl = shellUrlFor(started.pairingToken, started.port);
      process.stdout.write(`Dioramai local bridge listening on ${bridgeUrl}\n`);
      process.stdout.write(`Project root: ${info.projectRoot}\n`);
      process.stdout.write(`Config: ${info.configFound ? info.configPath : 'not found; defaults active'}\n`);
      process.stdout.write(`Generated module: ${info.generatedModulePath}\n`);
      process.stdout.write(`Scene JSON: ${info.sessionPath}\n`);
      process.stdout.write(`Asset dir: ${info.assetDirPath}\n`);
      process.stdout.write(`Pairing token: ${started.pairingToken}\n`);
      process.stdout.write(`Web shell URL: ${shellUrl}\n`);
      if (hasFlag('open')) openUrl(shellUrl);
      printNextSteps();
      return;
    }

    case 'export': {
      const runtime = new DioramaiBridgeRuntime(await loadInitialBridgeScene({ projectRoot }), { projectRoot });
      const result = await runtime.callTool('write_scene_to_file', {});
      runtime.close();
      printJson(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }

    case 'validate': {
      const result = await validateDioramaiProject(projectRoot);
      printJson(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }

    default:
      process.stdout.write(
        [
          'Usage: dioramai <command> [--projectRoot path] [--port 7777]',
          '',
          'Commands:',
          '  init --template vite-r3f  Scaffold a minimal local Vite/R3F project',
          '  doctor                    Check local project readiness',
          '  dev --open                Start the local repo bridge',
          '  export                    Write the generated R3F scene module',
          '  validate                  Return raw bridge project status JSON',
          '',
          'Compatibility alias: diorama <command>',
        ].join('\n'),
      );
      process.stdout.write('\n');
  }
};

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

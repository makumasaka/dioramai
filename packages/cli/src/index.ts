#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BRIDGE_PORT,
  DioramaiBridgeRuntime,
  doctorDioramaiProject,
  initializeDioramaiProject,
  loadInitialBridgeScene,
  startDioramaiBridgeServerWithFallback,
  validateDioramaiProject,
  type DioramaiDoctorItem,
} from '@dioramai/local-bridge';

type CliIo = {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
};

type InitInstallStatus = 'skipped' | 'completed' | 'failed';

type CliHooks = {
  installDependencies?: (projectRoot: string, io: CliIo) => Promise<number>;
  openUrl?: (url: string) => boolean | void;
  doctorProject?: typeof doctorDioramaiProject;
  startBridgeServer?: typeof startDioramaiBridgeServerWithFallback;
};

const defaultIo: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
};

const argValue = (argv: string[], name: string): string | undefined => {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const hasFlag = (argv: string[], name: string): boolean => argv.includes(`--${name}`);

const projectRootArg = (argv: string[]): string =>
  argValue(argv, 'projectRoot') ?? argValue(argv, 'root') ?? process.cwd();

const printJson = (io: CliIo, value: unknown): void => {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const openUrl = (url: string): boolean => {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
};

export const installDependencies = async (projectRoot: string): Promise<number> => {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolveInstall) => {
    const child = spawn(command, ['install'], {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => resolveInstall(1));
    child.once('exit', (code) => resolveInstall(code ?? 1));
  });
};

const shellUrlFor = (argv: string[], env: NodeJS.ProcessEnv, pairingToken: string, port: number): string => {
  const base = argValue(argv, 'shellUrl') ?? env.DIORAMAI_WEB_SHELL_URL ?? 'https://dioramai.design';
  const url = new URL(base);
  url.searchParams.set('bridgeToken', pairingToken);
  url.searchParams.set('bridgeUrl', `http://127.0.0.1:${port}`);
  return url.toString();
};

const maskToken = (token: string): string =>
  token.length <= 10 ? token : `${token.slice(0, 6)}...${token.slice(-4)}`;

const shellKindFor = (url: string): 'local' | 'hosted' => {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
      ? 'local'
      : 'hosted';
  } catch {
    return 'hosted';
  }
};

const DEV_FATAL_PREFLIGHT_LABELS = new Set([
  'dioramai.config.json',
  'Configured paths',
  'Generated scene parses',
]);

const devFatalItems = (items: DioramaiDoctorItem[]): DioramaiDoctorItem[] =>
  items.filter((item) =>
    item.status === 'fail' &&
    DEV_FATAL_PREFLIGHT_LABELS.has(item.label),
  );

const devWarningItems = (items: DioramaiDoctorItem[]): DioramaiDoctorItem[] =>
  items.filter((item) =>
    item.status !== 'pass' &&
    item.label !== 'Local bridge' &&
    !DEV_FATAL_PREFLIGHT_LABELS.has(item.label),
  );

const printInitNextSteps = (io: CliIo, installStatus: InitInstallStatus): void => {
  const installStep =
    installStatus === 'completed'
      ? 'npm install (complete)'
      : installStatus === 'failed'
        ? 'npm install (retry)'
        : 'npm install';
  io.stdout.write('\nNext steps:\n');
  io.stdout.write(`1. ${installStep}\n`);
  io.stdout.write('2. npx dioramai doctor\n');
  io.stdout.write('3. npx dioramai dev --open\n');
  io.stdout.write('4. Add GLBs to public/assets/models\n');
  io.stdout.write('5. Open this repo in Cursor\n');
};

const printDevNextSteps = (io: CliIo): void => {
  io.stdout.write('\nNext steps:\n');
  io.stdout.write('1. In another terminal, run:\n');
  io.stdout.write('   npm run dev\n');
  io.stdout.write('2. Open the Dioramai shell if it did not open automatically.\n');
  io.stdout.write('3. Add GLBs to:\n');
  io.stdout.write('   public/assets/models\n');
  io.stdout.write('4. Use Dioramai or Cursor MCP tools to register/import GLBs.\n');
  io.stdout.write('5. Run:\n');
  io.stdout.write('   npm run build\n');
};

const printPreflightWarnings = (io: CliIo, warnings: DioramaiDoctorItem[]): void => {
  if (warnings.length === 0) return;
  io.stdout.write('\nPreflight warnings:\n');
  for (const warning of warnings) {
    io.stdout.write(`- ${warning.label}: ${warning.message}\n`);
    if (warning.fix) io.stdout.write(`  fix: ${warning.fix}\n`);
  }
};

const printPreflightFatal = (io: CliIo, failures: DioramaiDoctorItem[]): void => {
  io.stderr.write('Dioramai dev preflight failed:\n');
  for (const failure of failures) {
    io.stderr.write(`- ${failure.label}: ${failure.message}\n`);
    if (failure.fix) io.stderr.write(`  fix: ${failure.fix}\n`);
  }
};

const printDevStatus = (
  io: CliIo,
  status: {
    bridgeUrl: string;
    token: string;
    shellUrl: string;
    shellKind: 'local' | 'hosted';
    requestedPort: number;
    selectedPort: number;
    watchCode: boolean;
    projectRoot: string;
    configPath: string;
    generatedModulePath: string;
    sessionPath: string;
    assetDirPath: string;
    publicUrlBase: string;
    glbFiles: string[];
  },
): void => {
  io.stdout.write('\nDioramai dev started\n\n');
  if (status.selectedPort !== status.requestedPort) {
    io.stdout.write(`Requested port ${status.requestedPort} was unavailable; using ${status.selectedPort}.\n\n`);
  }
  io.stdout.write('Bridge:\n');
  io.stdout.write(`- URL: ${status.bridgeUrl}\n`);
  io.stdout.write(`- Token: ${maskToken(status.token)}\n`);
  io.stdout.write('- SSE/runtime sync: enabled\n');
  io.stdout.write(`- Code watcher: ${status.watchCode ? 'enabled' : 'disabled'}\n`);
  io.stdout.write('- Safe localhost APIs: enabled\n');
  io.stdout.write('- MCP-lite tool layer: enabled\n');
  io.stdout.write(`- Project root: ${status.projectRoot}\n`);
  io.stdout.write(`- Config: ${status.configPath}\n`);
  io.stdout.write(`- Shell (${status.shellKind}): ${status.shellUrl}\n`);
  io.stdout.write('- Shell connection: waiting\n');
  io.stdout.write('\nProject:\n');
  io.stdout.write(`- Generated scene: ${status.generatedModulePath}\n`);
  io.stdout.write(`- Scene JSON: ${status.sessionPath}\n`);
  io.stdout.write(`- Generated output: ${status.generatedModulePath}\n`);
  io.stdout.write(`- Asset dir: ${status.assetDirPath}\n`);
  io.stdout.write(`- Public asset base: ${status.publicUrlBase}\n`);
  io.stdout.write(`- GLBs discovered: ${status.glbFiles.length}\n`);
  for (const file of status.glbFiles.slice(0, 5)) {
    io.stdout.write(`  - ${file}\n`);
  }
  if (status.glbFiles.length > 5) {
    io.stdout.write(`  - ...and ${status.glbFiles.length - 5} more\n`);
  }
  io.stdout.write('- Runtime synced: canonical scene loaded\n');
  io.stdout.write('- Target app dev server: not managed by Dioramai\n');
};

const printDoctor = (io: CliIo, result: Awaited<ReturnType<typeof doctorDioramaiProject>>): void => {
  if (!result.ok) {
    printJson(io, result);
    return;
  }
  io.stdout.write(`Dioramai doctor for ${result.data.projectRoot}\n`);
  for (const item of result.data.items) {
    const marker = item.status === 'pass' ? '[ok]' : item.status === 'warn' ? '[warn]' : '[fail]';
    io.stdout.write(`${marker} ${item.label}: ${item.message}\n`);
    if (item.fix) io.stdout.write(`      fix: ${item.fix}\n`);
  }
  if (result.data.glbFiles.length > 0) {
    io.stdout.write(`\nGLBs:\n${result.data.glbFiles.map((file) => `- ${file}`).join('\n')}\n`);
  }
  io.stdout.write(`\n${result.data.ok ? 'Doctor passed.' : 'Doctor found blocking issues.'}\n`);
};

export const runCli = async (
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = defaultIo,
  hooks: CliHooks = {},
): Promise<number> => {
  const command = argv[0] ?? 'help';
  const projectRoot = projectRootArg(argv);
  const port = Number(argValue(argv, 'port') ?? env.DIORAMAI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);

  switch (command) {
    case 'init': {
      const result = await initializeDioramaiProject(projectRoot, {
        template: (argValue(argv, 'template') ?? 'vite-r3f') as 'vite-r3f' | 'config',
        force: hasFlag(argv, 'force'),
      });
      if (!result.ok) {
        io.stderr.write(`${result.error.message}\n`);
        if (result.error.code === 'PROJECT_NOT_EMPTY') {
          io.stderr.write('Run in an empty folder, pass --force, or add dioramai.config.json manually.\n');
        }
        return 1;
      }

      io.stdout.write(`Initialized Dioramai project at ${result.data.projectRoot}\n`);
      io.stdout.write(`Config: ${result.data.configPath}\n`);
      io.stdout.write(`Generated scene: ${result.data.generatedModule}\n`);
      io.stdout.write(`Asset dir: ${result.data.assetDir}\n`);
      if (result.data.wroteFiles.length > 0) {
        io.stdout.write(`Wrote ${result.data.wroteFiles.length} files/directories.\n`);
      }

      let installStatus: InitInstallStatus = 'skipped';
      if (hasFlag(argv, 'install')) {
        io.stdout.write('\nInstalling dependencies with npm install...\n');
        const exitCode = await (hooks.installDependencies ?? installDependencies)(result.data.projectRoot, io);
        if (exitCode === 0) {
          installStatus = 'completed';
          io.stdout.write('Dependencies installed.\n');
        } else {
          installStatus = 'failed';
          io.stderr.write('\nDependency install failed. The Dioramai scaffold was still created.\n');
          io.stderr.write(`Run npm install in ${result.data.projectRoot}, then run npx dioramai doctor.\n`);
        }
      }

      printInitNextSteps(io, installStatus);
      return installStatus === 'failed' ? 1 : 0;
    }

    case 'doctor': {
      const result = await doctorDioramaiProject(projectRoot, { port });
      printDoctor(io, result);
      return !result.ok || !result.data.ok ? 1 : 0;
    }

    case 'dev': {
      const preflight = await (hooks.doctorProject ?? doctorDioramaiProject)(projectRoot, { port });
      if (!preflight.ok) {
        io.stderr.write(`Dioramai dev preflight failed: ${preflight.error.message}\n`);
        return 1;
      }
      const fatalItems = devFatalItems(preflight.data.items);
      if (fatalItems.length > 0) {
        printPreflightFatal(io, fatalItems);
        return 1;
      }
      printPreflightWarnings(io, devWarningItems(preflight.data.items));

      const watchCode = env.DIORAMAI_WATCH_CODE !== 'false';
      const started = await (hooks.startBridgeServer ?? startDioramaiBridgeServerWithFallback)(port, {
        projectRoot,
        watchCode,
        pairingToken: argValue(argv, 'token') ?? env.DIORAMAI_BRIDGE_TOKEN,
        onBrowserConnect: (count) => {
          io.stdout.write(
            count > 0
              ? `\nBridge: ${count} browser client${count === 1 ? '' : 's'} connected.\n`
              : '\nBridge: browser client disconnected.\n',
          );
        },
      });
      const info = started.runtime.getProjectInfo();
      const bridgeUrl = `http://127.0.0.1:${started.port}`;
      const shellUrl = shellUrlFor(argv, env, started.pairingToken, started.port);
      printDevStatus(io, {
        bridgeUrl,
        token: started.pairingToken,
        shellUrl,
        shellKind: shellKindFor(shellUrl),
        requestedPort: started.requestedPort,
        selectedPort: started.port,
        watchCode,
        projectRoot: info.projectRoot,
        configPath: info.configFound ? info.configPath : 'not found; defaults active',
        generatedModulePath: info.generatedModulePath,
        sessionPath: info.sessionPath,
        assetDirPath: info.assetDirPath,
        publicUrlBase: info.publicUrlBase,
        glbFiles: preflight.data.glbFiles,
      });
      if (hasFlag(argv, 'open')) {
        io.stdout.write(`\nOpening Dioramai shell: ${shellUrl}\n`);
        const opened = (hooks.openUrl ?? openUrl)(shellUrl);
        if (opened === false) {
          io.stderr.write(`Could not open the browser automatically. Open this URL manually:\n${shellUrl}\n`);
        }
      } else {
        io.stdout.write(`\nDioramai shell URL:\n${shellUrl}\n`);
      }
      printDevNextSteps(io);
      return 0;
    }

    case 'export': {
      const runtime = new DioramaiBridgeRuntime(await loadInitialBridgeScene({ projectRoot }), { projectRoot });
      const result = await runtime.callTool('write_scene_to_file', {});
      runtime.close();
      printJson(io, result);
      return result.ok ? 0 : 1;
    }

    case 'validate': {
      const result = await validateDioramaiProject(projectRoot);
      printJson(io, result);
      return result.ok ? 0 : 1;
    }

    default:
      io.stdout.write(
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
      io.stdout.write('\n');
      return 0;
  }
};

const isDirectRun = (): boolean => {
  if (process.argv[1] === undefined) return false;
  const modulePath = resolve(fileURLToPath(import.meta.url));
  const argvPath = resolve(process.argv[1]);
  try {
    return realpathSync.native(modulePath) === realpathSync.native(argvPath);
  } catch {
    return modulePath === argvPath;
  }
};

if (isDirectRun()) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

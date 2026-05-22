import { chmod } from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  external: [
    'node:*',
  ],
});

await chmod('dist/index.js', 0o755);

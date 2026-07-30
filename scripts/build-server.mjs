import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const projectRoot = process.cwd();
const serverOutDir = path.join(projectRoot, 'dist', 'server');

fs.rmSync(serverOutDir, { recursive: true, force: true });

await build({
  entryPoints: [path.join(projectRoot, 'server', 'index.ts')],
  outfile: path.join(serverOutDir, 'index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
});

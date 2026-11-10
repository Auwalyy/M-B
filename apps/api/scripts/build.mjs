// Bundles the API (including @mb/shared, which ships as TypeScript) into dist/.
// npm dependencies stay external and are installed in production with `npm ci --omit=dev`.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@mb/shared');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: {
    server: 'src/server.ts',
    'scripts/seed': 'src/scripts/seed.ts',
    'scripts/create-super-admin': 'src/scripts/create-super-admin.ts',
  },
  outdir: 'dist',
});

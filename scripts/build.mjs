// Bundles everything into single files with no runtime dependencies.
import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const rules = Object.fromEntries(
  readdirSync('rules').filter((n) => n.endsWith('.yml')).sort().map((n) => [n, readFileSync(join('rules', n), 'utf8').replace(/\r\n/g, '\n')]),
);

await build({
  entryPoints: { cli: 'src/cli.ts', action: 'src/action.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  charset: 'ascii',
  legalComments: 'none',
  // jsonc-parser ships a UMD build that cannot be bundled.
  mainFields: ['module', 'main'],
  define: {
    __BEFOREOPEN_RULES__: JSON.stringify(rules),
    __BEFOREOPEN_VERSION__: JSON.stringify(pkg.version),
  },
  // Some dependencies are CommonJS and expect `require`.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

const cli = readFileSync('dist/cli.js', 'utf8');
if (cli.startsWith('#!') === false) writeFileSync('dist/cli.js', `#!/usr/bin/env node\n${cli.replace(/^#!.*\n/m, '')}`);

const notices = ['jsonc-parser', 'yaml'].map((name) => {
  const dir = join('node_modules', name);
  const license = ['LICENSE.md', 'LICENSE', 'LICENSE.txt'].map((f) => join(dir, f)).find(existsSync);
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return `## ${name} ${version}\n\n${readFileSync(license, 'utf8').replace(/\r\n/g, '\n').trim()}\n`;
});
writeFileSync('THIRD-PARTY-NOTICES.md', `# Third-party notices\n\nThe published files include code from these packages.\n\n${notices.join('\n')}`);

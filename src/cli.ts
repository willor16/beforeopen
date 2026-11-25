#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { detectLang } from './i18n.ts';
import { renderDiffJson, renderScanJson } from './report/json.ts';
import { renderMarkdown } from './report/markdown.ts';
import { renderDiff, renderScan } from './report/terminal.ts';
import { RuleError, bundledRules, loadRulesFrom, mergeRules, type Rules } from './rules.ts';
import { clean } from './sanitize.ts';
import { compare, scan } from './scan.ts';
import { GitError, LocalGit, parseRemote, remoteTree } from './tree/git.ts';
import { localTree } from './tree/local.ts';
import { SEVERITIES, rank, type ExecutionPoint, type Lang, type Severity, type Text } from './types.ts';

declare const __BEFOREOPEN_VERSION__: string | undefined;
const VERSION = typeof __BEFOREOPEN_VERSION__ === 'undefined' ? 'dev' : __BEFOREOPEN_VERSION__;

const HELP: Record<Lang, string> = {
  en: `beforeopen ${VERSION}
See what a repository will run on your machine before you open it.

Usage
  beforeopen [target]                 Scan a folder or a remote repository
  beforeopen diff <base> [head]       New execution points between two commits

Target
  .                                   A folder (default)
  owner/repo                          A GitHub repository
  https://gitlab.com/owner/repo       Any git repository over https or ssh
  https://github.com/o/r/pull/12      A pull request

Options
  --ref <name>       Branch, tag or commit of a remote repository
  --repo <folder>    Repository for "diff" (default: current folder)
  --all              Show low severity findings too
  --json             JSON output
  --markdown         Markdown output
  --fail-on <level>  low, medium, high or never (default: high)
  --rules <folder>   Extra YAML rules. Never point it inside the scanned repository
  --lang <en|es>     Language
  --no-color         Plain output
  -v, --version      -h, --help

Exit codes
  0  Nothing at or above --fail-on
  1  Something at or above --fail-on
  2  Error, or the scan was incomplete

Nothing from the repository is executed, installed or checked out.
`,
  es: `beforeopen ${VERSION}
Mira qué ejecutará un repositorio en tu máquina antes de abrirlo.

Uso
  beforeopen [destino]                Analiza una carpeta o un repositorio remoto
  beforeopen diff <base> [head]       Puntos de ejecución nuevos entre dos commits

Destino
  .                                   Una carpeta (por defecto)
  owner/repo                          Un repositorio de GitHub
  https://gitlab.com/owner/repo       Cualquier repositorio git por https o ssh
  https://github.com/o/r/pull/12      Un pull request

Opciones
  --ref <nombre>      Rama, etiqueta o commit de un repositorio remoto
  --repo <carpeta>    Repositorio para «diff» (por defecto, la carpeta actual)
  --all               Muestra también los hallazgos de gravedad baja
  --json              Salida JSON
  --markdown          Salida Markdown
  --fail-on <nivel>   low, medium, high o never (por defecto: high)
  --rules <carpeta>   Reglas YAML extra. Nunca dentro del repositorio analizado
  --lang <en|es>      Idioma
  --no-color          Salida sin color
  -v, --version       -h, --help

Códigos de salida
  0  Nada que alcance --fail-on
  1  Algo que alcanza --fail-on
  2  Error, o el análisis quedó incompleto

No se ejecuta, instala ni extrae nada del repositorio.
`,
};

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ref: { type: 'string' },
      repo: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      markdown: { type: 'boolean', default: false },
      'fail-on': { type: 'string', default: 'high' },
      rules: { type: 'string' },
      lang: { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.lang !== undefined && values.lang !== 'en' && values.lang !== 'es') throw new UsageError('--lang: en | es');
  const lang: Lang = values.lang ?? detectLang();
  if (values.help) { process.stdout.write(HELP[lang]); return 0; }
  if (values.version) { process.stdout.write(`${VERSION}\n`); return 0; }

  const failOn = values['fail-on'];
  if (failOn !== 'never' && (failOn === 'info' || !SEVERITIES.includes(failOn as Severity))) {
    throw new UsageError('--fail-on: low | medium | high | never');
  }
  const rules: Rules = values.rules ? mergeRules([bundledRules(), loadRulesFrom(values.rules)]) : bundledRules();
  const color = !values['no-color'] && !process.env['NO_COLOR'] && Boolean(process.stdout.isTTY || process.env['FORCE_COLOR']);
  const options = { lang, color, all: values.all, width: Math.min(process.stdout.columns ?? 100, 140) };

  const exit = (points: ExecutionPoint[], gaps: Text[]): number => {
    if (failOn !== 'never' && points.some((p) => rank(p.severity) >= rank(failOn as Severity))) return 1;
    return gaps.length > 0 ? 2 : 0;
  };

  if (positionals[0] === 'diff' && !existsSync('diff')) {
    const [, base, head = 'HEAD'] = positionals;
    if (!base || positionals.length > 3) throw new UsageError('beforeopen diff <base> [head]');
    const git = await LocalGit.open(values.repo ?? '.');
    try {
      const [from, to] = [await git.resolve(base), await git.resolve(head)];
      const before = await git.tree(from, base);
      const after = await git.tree(to, head);
      const same = { unchanged: (path: string) => before.id?.(path) !== undefined && before.id(path) === after.id?.(path) };
      const [a, b] = [await scan(before, rules, same), await scan(after, rules, same)];
      const changes = compare(a, b);
      const title = `${base} → ${head}`;
      process.stdout.write(
        values.json ? renderDiffJson(title, changes, b.gaps)
          : values.markdown ? renderMarkdown(title, changes.map((c) => ({ point: c.point, change: c })), b.gaps, lang)
            : renderDiff(title, changes, b.gaps, options),
      );
      return exit(changes.map((c) => c.point), b.gaps);
    } finally {
      await git.close();
    }
  }

  if (positionals.length > 1) throw new UsageError('beforeopen [target]');
  const target = positionals[0] ?? '.';
  const local = existsSync(target);
  if (local && !statSync(target).isDirectory()) throw new UsageError(`Not a folder: ${target}`);
  const remote = local ? null : parseRemote(target, values.ref);
  if (!local && !remote) throw new UsageError(`Not a folder or a valid repository address: ${target}`);
  const tree = remote ? await remoteTree(remote) : await localTree(target);
  try {
    const result = await scan(tree, rules);
    process.stdout.write(
      values.json ? renderScanJson(result)
        : values.markdown ? renderMarkdown(result.target, result.points.map((point) => ({ point })), result.gaps, lang)
          : renderScan(result, options),
    );
    return exit(result.points, result.gaps);
  } finally {
    await tree.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e: unknown) => {
    const error = e as Error & { code?: string };
    const expected = error instanceof UsageError || error instanceof GitError || error instanceof RuleError || error.code?.startsWith('ERR_PARSE_ARGS');
    process.stderr.write(`beforeopen: ${clean(expected ? error.message : (error.stack ?? String(error)), 600)}\n`);
    process.exitCode = 2;
  },
);


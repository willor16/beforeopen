import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { renderMarkdown } from './report/markdown.ts';
import { renderDiff } from './report/terminal.ts';
import { bundledRules } from './rules.ts';
import { clean, workflowData, workflowProperty } from './sanitize.ts';
import { compare, scan } from './scan.ts';
import { LocalGit } from './tree/git.ts';
import { SEVERITIES, rank, type Lang, type Severity } from './types.ts';

const input = (name: string): string => (process.env[`INPUT_${name.toUpperCase()}`] ?? '').trim();

interface PullRequestEvent { pull_request?: { base?: { sha?: string }; head?: { sha?: string } }; before?: string }

function readEvent(): PullRequestEvent {
  const path = process.env['GITHUB_EVENT_PATH'];
  return path ? (JSON.parse(readFileSync(path, 'utf8')) as PullRequestEvent) : {};
}

async function main(): Promise<void> {
  const failOn = input('fail-on') || 'high';
  if (failOn !== 'never' && !SEVERITIES.includes(failOn as Severity)) throw new Error('fail-on: low | medium | high | never');
  const lang: Lang = input('lang') === 'es' ? 'es' : 'en';
  const event = readEvent();
  const git = await LocalGit.open(process.env['GITHUB_WORKSPACE'] ?? '.');
  try {
    const head = await git.resolve(input('head') || 'HEAD');
    let base: string;
    if (input('base')) {
      base = await git.resolve(input('base'));
    } else if (event.pull_request) {
      // By default checkout uses the merge commit, whose first parent is the base.
      const parents = await git.parents(head);
      if (head === process.env['GITHUB_SHA'] && parents.length === 2) {
        base = await git.resolve(parents[0]!);
      } else {
        base = await git.mergeBase(await git.resolve(event.pull_request.base?.sha ?? ''), head);
      }
    } else if (event.before && !/^0+$/.test(event.before)) {
      base = await git.resolve(event.before);
    } else {
      throw new Error('There is nothing to compare. Run on pull_request or set the "base" input.');
    }

    const rules = bundledRules();
    const before = await git.tree(base, base);
    const after = await git.tree(head, head);
    const [a, b] = [await scan(before, rules), await scan(after, rules)];
    const changes = compare(a, b);
    const title = `${base.slice(0, 10)} → ${head.slice(0, 10)}`;

    // Nothing printed here can be understood as a workflow command.
    const token = randomUUID();
    process.stdout.write(`::stop-commands::${token}\n`);
    process.stdout.write(renderDiff(title, changes, b.gaps, { lang, color: true, all: true, width: 120 }));
    process.stdout.write(`\n::${token}::\n`);

    const order = [...changes].sort((x, y) => rank(y.point.severity) - rank(x.point.severity));
    for (const { point } of order.filter((c) => rank(c.point.severity) >= rank('medium')).slice(0, 10)) {
      const level = point.severity === 'high' ? 'error' : 'warning';
      const reason = point.signals[0] ? `. ${point.signals[0].title[lang]}` : '';
      const message = clean(`${point.title[lang]}${reason}${point.command ? `: ${point.command}` : ''}`, 300);
      process.stdout.write(`::${level} file=${workflowProperty(clean(point.file, 300))},line=${point.line},title=beforeopen::${workflowData(message)}\n`);
    }

    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) appendFileSync(summary, renderMarkdown(title, changes.map((c) => ({ point: c.point, change: c })), b.gaps, lang));
    const highest = order[0]?.point.severity ?? 'none';
    const output = process.env['GITHUB_OUTPUT'];
    if (output) appendFileSync(output, `count=${changes.length}\nhighest=${highest}\n`);

    if (failOn !== 'never' && order[0] && rank(order[0].point.severity) >= rank(failOn as Severity)) process.exitCode = 1;
    else if (b.gaps.length > 0) {
      process.stdout.write(`::error title=beforeopen::${workflowData(clean(b.gaps[0]![lang], 300))}\n`);
      process.exitCode = 1;
    }
  } finally {
    await git.close();
  }
}

main().catch((e: unknown) => {
  process.stdout.write(`::error title=beforeopen::${workflowData(clean((e as Error).message, 400))}\n`);
  process.exitCode = 1;
});

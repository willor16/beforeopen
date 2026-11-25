// Measures detection over the documented attacks in test/attacks/corpus.ts.
//   node scripts/measure.ts             summary and misses
//   node scripts/measure.ts --holdout   the attacks that were not used to make the rules
//   node scripts/measure.ts --markdown  table for docs/detection.md
// Everything stays in memory: nothing from the corpus is written to disk.
import { bundledRules } from '../src/rules.ts';
import { scan } from '../src/scan.ts';
import { memoryTree } from '../src/tree/memory.ts';
import { SEVERITIES, rank, type Severity } from '../src/types.ts';
import { ATTACKS, type Attack, type Kind } from '../test/attacks/corpus.ts';
import { HOLDOUT } from '../test/attacks/holdout.ts';

type Result = Severity | 'missed';

const rules = bundledRules();

export async function result(attack: Attack): Promise<{ result: Result; signals: string[] }> {
  const at = (await scan(memoryTree(attack.files), rules)).points.filter((p) => p.file === attack.trigger);
  if (at.length === 0) return { result: 'missed', signals: [] };
  const top = at.reduce((a, b) => (rank(b.severity) > rank(a.severity) ? b : a));
  return { result: top.severity, signals: top.signals.filter((s) => s.severity === top.severity).map((s) => s.id) };
}

const all: { attack: Attack; result: Result; signals: string[] }[] = [];
for (const attack of process.argv.includes('--holdout') ? HOLDOUT : ATTACKS) all.push({ attack, ...(await result(attack)) });

const order: Result[] = [...SEVERITIES].reverse();
const count = (list: typeof all, r: Result): number => list.filter((x) => x.result === r).length;

if (process.argv.includes('--markdown')) {
  console.log('| Attack | Date | Kind | Result | Report |\n| --- | --- | --- | --- | --- |');
  for (const { attack, result: r } of all) {
    const name = attack.name.replace(/\|/g, '/');
    console.log(`| ${name} | ${attack.date} | ${attack.kind} | ${r === 'missed' ? '**missed**' : r} | [source](${attack.source}) |`);
  }
} else {
  for (const kind of ['automatic', 'agent', 'build', 'run', 'all'] as (Kind | 'all')[]) {
    const list = all.filter((x) => kind === 'all' || x.attack.kind === kind);
    console.log(`${kind.padEnd(10)} ${String(list.length).padStart(3)}  ${[...order, 'missed' as const].map((r) => `${r}=${count(list, r)}`).join('  ')}`);
  }
  console.log('\nNot high:');
  for (const x of all.filter((y) => y.result !== 'high')) console.log(`  ${x.result.padEnd(7)} ${x.attack.kind.padEnd(10)} ${x.attack.id}  [${x.signals.join(', ')}]`);
}

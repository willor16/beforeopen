import { bundledRules } from '../src/rules.ts';
import { scan } from '../src/scan.ts';
import { memoryTree } from '../src/tree/memory.ts';
import type { ExecutionPoint, ScanResult } from '../src/types.ts';

export const rules = bundledRules();

export const scanFiles = (
  files: Record<string, string | Uint8Array>, links: Record<string, string> = {},
): Promise<ScanResult> => scan(memoryTree(files, links), rules);

export async function points(
  files: Record<string, string | Uint8Array>, links: Record<string, string> = {},
): Promise<ExecutionPoint[]> {
  return (await scanFiles(files, links)).points;
}

export const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** Builds characters by number, so that none of them appears in the source. */
export const char = (...codes: number[]): string => String.fromCodePoint(...codes);

// Nothing here is real: `.invalid` addresses never resolve.
export const HOST = 'https://payload.invalid';

export const folderOpen = (command: string, extra: object = {}): string =>
  json({ version: '2.0.0', tasks: [{ label: 'env', type: 'shell', command, runOptions: { runOn: 'folderOpen' }, ...extra }] });

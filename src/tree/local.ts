import { constants } from 'node:fs';
import { lstat, open, readdir, readlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Text } from '../types.ts';
import { MAX_FILE_BYTES, type RawTree } from './tree.ts';

const MAX_FILES = 200_000;
const MAX_DEPTH = 64;

/** Of `.git` only the files that can execute something matter. */
const GIT_EXECUTES = /(^|\/)\.git(\/modules\/.+)?\/(config|config\.worktree|hooks\/[^/]+)$/i;
const GIT_BULK = /(^|\/)\.git(\/modules\/.+)?\/(objects|logs|refs|lfs|info|rr-cache)$/i;

/** Walks a folder with plain file reads. It never runs git inside it. */
export async function localTree(root: string): Promise<RawTree> {
  const base = resolve(root);
  const prefix = base.endsWith(sep) ? base : base + sep;
  const files: string[] = [];
  const links: RawTree['links'] = [];
  const gaps: Text[] = [];
  let truncated = false;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth > MAX_DEPTH) { truncated = true; return; }
    let entries;
    try {
      entries = await readdir(resolve(base, rel), { withFileTypes: true });
    } catch {
      gaps.push({ en: `Could not list ${rel || '.'}`, es: `No se pudo listar ${rel || '.'}` });
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const inGit = /(^|\/)\.git\//i.test(path);
      if (entry.isSymbolicLink()) {
        try {
          let target = await readlink(resolve(base, path));
          // Windows junctions are always absolute, even inside the repository.
          if (target.startsWith(prefix)) {
            target = '../'.repeat(path.split('/').length - 1) + target.slice(prefix.length);
          }
          links.push({ path, target: target.replace(/\\/g, '/').replace(/\/$/, '') });
        } catch {
          gaps.push({ en: `Could not read the link ${path}`, es: `No se pudo leer el enlace ${path}` });
        }
      } else if (entry.isDirectory()) {
        // Installed dependencies are out of scope: their scripts already ran.
        if (entry.name.toLowerCase() === 'node_modules' || GIT_BULK.test(path)) continue;
        await walk(path, depth + 1);
      } else if (entry.isFile()) {
        if (inGit && (!GIT_EXECUTES.test(path) || /\.sample$/i.test(path))) continue;
        if (files.length >= MAX_FILES) { truncated = true; return; }
        files.push(path);
      }
    }
  };
  await walk('', 0);

  if (truncated) {
    gaps.push({
      en: `The folder is too large: only ${files.length} files were listed.`,
      es: `La carpeta es demasiado grande: solo se listaron ${files.length} archivos.`,
    });
  }

  return {
    label: base,
    files,
    links,
    gaps,
    read: async (path) => {
      const full = resolve(base, path);
      try {
        const info = await lstat(full);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
        const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          return await handle.readFile();
        } finally {
          await handle.close();
        }
      } catch {
        return null;
      }
    },
    close: async () => {},
  };
}

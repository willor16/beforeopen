import type { RawTree } from './tree.ts';

/** In-memory tree. The tests use it so that no bait files exist on disk. */
export function memoryTree(
  files: Record<string, string | Uint8Array>,
  links: Record<string, string> = {},
): RawTree {
  const content = new Map(Object.entries(files));
  return {
    label: 'memory',
    files: [...content.keys()],
    links: Object.entries(links).map(([path, target]) => ({ path, target })),
    gaps: [],
    read: async (path) => {
      const value = content.get(path);
      if (value === undefined) return null;
      return typeof value === 'string' ? new TextEncoder().encode(value) : value;
    },
    close: async () => {},
  };
}

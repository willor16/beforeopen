import { findNodeAtLocation, getNodeValue, parseTree, type Node, type ParseError } from 'jsonc-parser';

export type { Node };
export type JsonPath = (string | number)[];

/** JSON with comments, read with the same tolerant parser that VS Code uses. */
export interface JsonDoc {
  root: Node;
  malformed: boolean;
  line(node: Node): number;
}

export function parseJson(text: string): JsonDoc | null {
  const source = text.replace(/^\u{feff}/u, '');
  const errors: ParseError[] = [];
  let root: Node | undefined;
  try {
    root = parseTree(source, errors, { allowTrailingComma: true });
  } catch {
    return null; // Nesting deep enough to exhaust the stack.
  }
  if (!root) return null;
  return {
    root,
    malformed: errors.length > 0,
    line: (node) => lineAt(source, (node.parent?.type === 'property' ? node.parent : node).offset),
  };
}

export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

export const at = (node: Node | undefined, ...path: JsonPath): Node | undefined => {
  if (!node) return undefined;
  // Like JSON.parse, the last duplicated key wins.
  let current: Node | undefined = node;
  for (const part of path) {
    if (!current) return undefined;
    if (typeof part === 'number') current = findNodeAtLocation(current, [part]);
    else current = entries(current).filter((e) => e.key === part).at(-1)?.node;
  }
  return current;
};

export function entries(node: Node | undefined): { key: string; node: Node }[] {
  if (node?.type !== 'object') return [];
  return (node.children ?? []).flatMap((p) => {
    const [k, v] = p.children ?? [];
    return k && v ? [{ key: String(k.value), node: v }] : [];
  });
}

export const items = (node: Node | undefined): Node[] => (node?.type === 'array' ? (node.children ?? []) : []);

export const str = (node: Node | undefined): string | undefined =>
  node?.type === 'string' ? String(node.value) : undefined;

export const value = (node: Node | undefined): unknown => (node ? getNodeValue(node) : undefined);

/** Commands are written as a string, as a list or as `{ value, quoting }`. */
export function commandText(command: Node | undefined, args?: Node): string | undefined {
  const one = (n: Node): string | undefined => {
    if (n.type === 'object') { const v = at(n, 'value'); return v && one(v); }
    if (n.type === 'array') return items(n).map(one).filter((s) => s !== undefined).join(' ');
    return n.type === 'string' || n.type === 'number' ? String(n.value) : undefined;
  };
  const parts = [command && one(command), args && one(args)].filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

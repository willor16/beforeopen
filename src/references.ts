import { at, entries, parseJson, str } from './json.ts';
import { basename, dirname, join } from './paths.ts';
import type { RepoView } from './tree/tree.ts';

const MAX_FILES = 200;
const MAX_LINES = 3_000;
const MAX_IMPORTS = 60;
const MAX_DEPTH = 6;

const INTERPRETER = /^(?:node|nodejs|bun|deno|tsx|ts-node|python[\d.]*|py|ruby|perl|php|pwsh|powershell|bash|sh|zsh|dash|cmd|source|\.|call)(?:\.exe)?$/i;
const SCRIPT_EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.ts', '.sh', '.py', '.ps1', '.cmd', '.bat', '.rb', '/index.js', '/index.cjs', '/index.mjs', '/index.ts', '/__main__.py', '/__init__.py'];
export const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|mp[34]|mov|wasm|exe|dll|so|dylib|node|lock)$/i;
/** Data that a script may read but that nothing executes by accident. */
const DATA = /\.(json[c5]?|md|mdx|ya?ml|toml|css|s[ac]ss|less|html?|txt|xml|csv|svg|map|lock|snap|bin|dat|d\.ts|woff2?|ttf|otf|eot)$/i;
const JS = /\.(c|m)?[jt]sx?$/i;
const RUBY = /(\.(rb|gemspec|rake)|(^|\/)(gemfile|rakefile|podfile))$/i;
const SHELL = /\.(sh|bash|zsh|ps1|cmd|bat|envrc)$/i;

export interface Reached {
  /** Files of the repository that the command ends up running. */
  files: string[];
  /** Commands reached through `npm run` and similar. */
  commands: { text: string; file: string; line: number }[];
  /** There was more to follow than the limits allow. */
  partial: boolean;
}

/** Follows a command to the repository files it runs, without running it. */
export async function follow(
  view: RepoView, start: { command?: string; cwd?: string; runs?: string[]; maxDepth?: number },
): Promise<Reached> {
  const files: string[] = [];
  const commands: Reached['commands'] = [];
  const seenFiles = new Set<string>();
  const seenCommands = new Set<string>();
  let partial = false;
  const maxDepth = start.maxDepth ?? MAX_DEPTH;

  const visitFile = async (path: string, depth: number, interpreted = false): Promise<void> => {
    const file = view.find(path);
    if (file && !interpreted && DATA.test(file.path)) return;
    if (!file || seenFiles.has(file.real)) return;
    if (files.length >= MAX_FILES || depth > maxDepth) { partial = true; return; }
    seenFiles.add(file.real);
    files.push(file.path);
    if (BINARY.test(file.path)) return;
    const text = await view.text(file.path);
    if (text === null) return;
    const dir = dirname(file.path);
    const head = text.slice(0, 200);
    const locals = localImports(file.path, head, text);
    if (locals.length > MAX_IMPORTS) partial = true;
    for (const local of locals.slice(0, MAX_IMPORTS)) {
      const target = resolveFile(view, dir, local);
      if (target) await visitFile(target, depth + 1);
    }
    for (const command of launchedPrograms(file.path, head, text)) await visitCommand(command, dir, depth, file.path);
    if (SHELL.test(file.path) || basename(file.path) === '.envrc' || /^#!.*\b(ba|z|da)?sh\b/.test(head)) {
      for (const line of text.split(/\r?\n/).slice(0, MAX_LINES)) {
        if (!/^\s*#/.test(line) && line.trim()) await visitCommand(line, dir, depth + 1, file.path);
      }
    }
  };

  const visitCommand = async (command: string, cwd: string, depth: number, from?: string): Promise<void> => {
    const id = `${cwd}\0${command}`;
    if (depth > maxDepth || seenCommands.has(id)) return;
    seenCommands.add(id);
    const words = tokenize(command.slice(0, 20_000));
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      const previous = words[i - 1] ?? '';
      if (/^(npm|pnpm|yarn|bun)(\.cmd)?$/i.test(word)) {
        const script = scriptName(words.slice(i + 1));
        if (script && !(await visitScript(script, cwd, depth + 1))) {
          // `bun run file.js` takes a file when there is no script with that name.
          const target = resolveFile(view, cwd, script);
          if (target) await visitFile(target, depth + 1, true);
        }
        continue;
      }
      if (word === '-m' && /^(python[\d.]*|py)$/i.test(previous) && words[i + 1]) {
        const target = resolveFile(view, cwd, words[i + 1]!.replace(/\./g, '/'));
        if (target) await visitFile(target, depth + 1);
        continue;
      }
      if (word.startsWith('-') || word.length > 400) continue;
      const path = word.replace(/^["']|["']$/g, '');
      const interpreted = INTERPRETER.test(basename(previous));
      const looksLikePath = /[\\/]/.test(path) || /\.\w{1,6}$/.test(path) || interpreted ||/^(-r|--require|--import|--loader|-f|-file)$/i.test(previous);
      if (!looksLikePath) continue;
      const target = resolveFile(view, cwd, path);
      if (target && target !== from) await visitFile(target, depth + 1, interpreted);
    }
  };

  const visitScript = async (name: string, cwd: string, depth: number): Promise<boolean> => {
    let found = false;
    for (let dir = cwd; ; dir = dirname(dir)) {
      const path = dir ? `${dir}/package.json` : 'package.json';
      const text = view.find(path) ? await view.text(path) : null;
      const doc = text === null ? null : parseJson(text);
      if (doc) {
        for (const key of [`pre${name}`, name, `post${name}`]) {
          const node = at(doc.root, 'scripts', key);
          const body = str(node);
          if (!node || !body) continue;
          found = true;
          if (seenCommands.has(`${dir}\0${body}`)) continue;
          commands.push({ text: body, file: view.find(path)!.path, line: doc.line(node) });
          await visitCommand(body, dir, depth);
        }
        return found;
      }
      if (dir === '') return false;
    }
  };

  for (const path of start.runs ?? []) await visitFile(path, 0, true);
  if (start.command) await visitCommand(start.command, start.cwd ?? '', 0);
  return { files, commands, partial };
}

/** Resolves a word to a file, the way node, python or a shell would. */
function resolveFile(view: RepoView, cwd: string, raw: string): string | null {
  const word = raw
    .replace(/\$\{(workspaceFolder|workspaceRoot|workspaceFolderBasename|fileWorkspaceFolder)\}|\$\{?(CLAUDE_PROJECT_DIR|GEMINI_PROJECT_DIR|CURSOR_PROJECT_DIR|PWD|INIT_CWD|PROJECT_ROOT)\}?|%(CD|CLAUDE_PROJECT_DIR)%|\$\(pwd\)|\$\(git rev-parse --show-toplevel\)/gi, '.')
    .replace(/["'`;]/g, '');
  if (!word || word.includes('://') || /[$<>|*\0]/.test(word)) return null;
  for (const base of new Set([cwd, ''])) {
    const path = join(base, word);
    if (!path) continue;
    for (const ext of SCRIPT_EXTENSIONS) {
      const file = view.find(path + ext);
      if (file) return file.path;
    }
  }
  return null;
}

/** Relative modules that a script loads. Any `'./x'` string counts. */
function localImports(path: string, head: string, text: string): string[] {
  const out = new Set<string>();
  if (JS.test(path) || /^#!.*\b(node|bun|deno)\b/.test(head)) {
    for (const m of text.matchAll(/["'`](\.{1,2}\/[^"'`\n$]{1,200})["'`]/g)) out.add(m[1]!);
    addScripts(text, out);
  } else if (RUBY.test(path)) {
    addScripts(text, out);
  } else if (/\.py$/i.test(path) || /^#!.*python/.test(head)) {
    addScripts(text, out);
    for (const m of text.matchAll(/^[ \t]*(?:from|import)[ \t]+\.?([A-Za-z_][\w.]{0,100})/gm)) out.add(m[1]!.replace(/\./g, '/'));
  }
  return [...out];
}

/** Quoted names of scripts, as in `spawn(bin, ["task.js"])`. */
function addScripts(text: string, out: Set<string>): void {
  for (const m of text.matchAll(/["'`]([\w@./-]{1,120}\.(?:[cm]?js|ts|py|rb|sh|ps1|bat|cmd))["'`]/g)) out.add(m[1]!);
}

/** Commands that a script starts through a shell, as in `system("node x.js")`. */
function launchedPrograms(path: string, head: string, text: string): string[] {
  if (!JS.test(path) && !RUBY.test(path) && !/\.py$/i.test(path) && !/^#!.*\b(node|bun|deno|python|ruby)/.test(head)) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:system|exec|execSync|spawn|spawnSync|popen|Popen|run|call|check_call|check_output|IO\.popen)\s*\(?\s*["'`]([^"'`\n]{3,400})["'`]/g)) {
    if (/\s/.test(m[1]!)) out.add(m[1]!);
    if (out.size >= MAX_IMPORTS) break;
  }
  return [...out];
}

/** Script that a package manager would run, or null when it is not `run`-like. */
function scriptName(rest: string[]): string | null {
  const words = rest.filter((w) => !w.startsWith('-'));
  const [first, second] = words;
  if (!first) return null;
  if (/^(run|run-script|rum|urn)$/.test(first)) return second ?? null;
  if (/^(exec|x)$/.test(first)) return null;
  if (/^(install|i|ci|add|exec|x|dlx|create|init|publish|pack|link|update|config|set|cache)$/.test(first)) return null;
  return /^[\w:./-]+$/.test(first) ? first : null;
}

/** Splits a command on spaces and shell operators, keeping quoted text together. */
export function tokenize(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|()<>"']+)/g)) {
    const quoted = m[1] ?? m[2];
    // In `sh -c "node x.js"` the quoted text is a command of its own.
    if (quoted !== undefined && /\s/.test(quoted)) out.push(quoted, ...tokenize(quoted));
    else out.push(quoted ?? m[3]!);
  }
  return out;
}

export const scriptsOf = (root: Parameters<typeof entries>[0]): { key: string; node: ReturnType<typeof entries>[number]['node'] }[] =>
  entries(at(root, 'scripts'));

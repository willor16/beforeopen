import { at, commandText, entries, items, parseJson, str, value, type JsonDoc, type Node } from '../json.ts';
import { dirname } from '../paths.ts';
import type { RawPoint, Signal, Text } from '../types.ts';
import { malformed, type Detector } from './detector.ts';

const NEEDS_TRUST: Text = {
  en: 'you trust the folder and automatic tasks are allowed',
  es: 'que confíes en la carpeta y estén permitidas las tareas automáticas',
};
const NEEDS_FOLDER_TRUST: Text = { en: 'you trust the folder', es: 'que confíes en la carpeta' };

/** Settings that make the editor run a program chosen by the repository. */
const PROGRAM_SETTING = /^(git\.path|npm\.packageManager|python\.(defaultInterpreterPath|pythonPath|condaPath|poetryPath|pipenvPath|venvPath)|php\.validate\.executablePath|typescript\.tsdk|js\/ts\.tsdk\.path|eslint\.(nodePath|runtime)|prettier\.(prettierPath|configPath)|deno\.path|go\.(alternateTools|toolsGopath)|rust-analyzer\.(server\.path|check\.overrideCommand|cargo\.buildScripts\.overrideCommand|procMacro\.server|rustfmt\.overrideCommand)|clangd\.(path|arguments)|cmake\.cmakePath|java\.jdt\.ls\.java\.home|ruby\.interpreter\.commandPath|flake8\.path|black-formatter\.path|ruff\.(path|interpreter)|mypy-type-checker\.path|jest\.jestCommandLine|terminal\.integrated\.(automationProfile|profiles|shell|shellArgs|env)\.(windows|linux|osx)|terminal\.external\..+Exec|task\.allowAutomaticTasks|chat\.tools\.(autoApprove|terminal\.autoApprove|global\.autoApprove)|security\.workspace\.trust\..+)$/i;

function taskCommand(task: Node): string | undefined {
  const own = commandText(at(task, 'command'), at(task, 'args'));
  const variants = ['windows', 'linux', 'osx'].flatMap((os) => {
    const text = commandText(at(task, os, 'command') ?? at(task, 'command'), at(task, os, 'args'));
    return at(task, os) && text && text !== own ? [`[${os}] ${text}`] : [];
  });
  const type = str(at(task, 'type'));
  const script = str(at(task, 'script'));
  const implicit = !own && script && (type === 'npm' || type === 'bun') ? `npm run ${script}` : undefined;
  const all = [own ?? implicit, ...variants].filter(Boolean);
  return all.length > 0 ? all.join('  ') : undefined;
}

const labelOf = (task: Node): string => str(at(task, 'label')) ?? str(at(task, 'taskName')) ?? '';

export function folderOpenTasks(doc: JsonDoc, holder: Node | undefined, file: string, cwd: string): RawPoint[] {
  const tasks = items(at(holder, 'tasks'));
  const always = str(at(holder, 'runOptions', 'runOn')) === 'folderOpen';
  const out: RawPoint[] = [];
  tasks.forEach((task, index) => {
    if (!always && str(at(task, 'runOptions', 'runOn')) !== 'folderOpen') return;
    const label = labelOf(task) || `#${index + 1}`;
    const commands: string[] = [];
    const visit = (t: Node, seen: Set<Node>): void => {
      if (seen.has(t)) return;
      seen.add(t);
      const command = taskCommand(t);
      if (command) commands.push(command);
      const depends = at(t, 'dependsOn');
      const names = depends?.type === 'array' ? items(depends).map(str) : [str(depends)];
      for (const name of names) {
        const other = name && tasks.find((x) => labelOf(x) === name);
        if (other) visit(other, seen);
      }
    };
    visit(task, new Set());
    const signals: Signal[] = [];
    const presentation = at(task, 'presentation');
    const reveal = str(at(presentation, 'reveal'));
    if (reveal === 'never' || reveal === 'silent' || value(at(task, 'hide')) === true) {
      signals.push({
        id: 'hidden-task',
        title: { en: 'Hides its terminal or the task itself', es: 'Oculta su terminal o la propia tarea' },
        severity: 'medium',
        file,
        line: doc.line(presentation ?? task),
        excerpt: reveal ? `reveal: ${reveal}` : 'hide: true',
      });
    }
    const optionsCwd = str(at(task, 'options', 'cwd'));
    out.push({
      id: 'vscode/task-on-open',
      trigger: 'editor',
      file,
      line: doc.line(at(task, 'command') ?? task),
      key: label,
      title: { en: `Task that runs when the folder opens: ${label}`, es: `Tarea que se ejecuta al abrir la carpeta: ${label}` },
      severity: 'medium',
      ...(commands.length > 0 && { command: commands.join(' && ') }),
      needs: NEEDS_TRUST,
      cwd: optionsCwd?.replace(/^\$\{workspace(Folder|Root)\}[\\/]?/, '') || cwd,
      signals,
    });
  });
  return out;
}

function programSettings(doc: JsonDoc, holder: Node | undefined, file: string, cwd: string): RawPoint[] {
  return entries(holder).flatMap(({ key, node }): RawPoint[] => {
    if (!PROGRAM_SETTING.test(key)) return [];
    const text = typeof value(node) === 'string' ? String(node.value) : JSON.stringify(value(node)) ?? '';
    const grantsTrust = /^(task\.allowAutomaticTasks|chat\.tools\.|security\.workspace\.trust)/i.test(key);
    if (grantsTrust && /^(off|false|"off"|\{\}|prompt)$/i.test(text)) return [];
    // A virtual environment that does not exist yet cannot be hostile.
    const local = /\.{0,2}[\\/]|\$\{workspace/i.test(text);
    if (!grantsTrust && /^(npm\.packageManager|.*tsdk.*)$/i.test(key) && /node_modules|^\w+$/.test(text)) return [];
    return [{
      id: 'vscode/program-setting',
      trigger: 'editor',
      file,
      line: doc.line(node),
      key,
      title: grantsTrust
        ? { en: `Setting that loosens a protection: ${key}`, es: `Ajuste que relaja una protección: ${key}` }
        : { en: `Setting that chooses a program to run: ${key}`, es: `Ajuste que elige un programa que se ejecutará: ${key}` },
      severity: grantsTrust ? 'medium' : local ? 'low' : 'info',
      command: text,
      needs: NEEDS_FOLDER_TRUST,
      cwd,
    }];
  });
}

export const vscode: Detector = {
  files: ['**/.vscode/tasks.json', '**/.vscode/settings.json', '**/*.code-workspace'],
  async detect(view, file) {
    const text = await view.text(file.path);
    if (text === null) return [];
    const doc = parseJson(text);
    if (!doc) return text.trim() ? [malformed(file.path, 'editor')] : [];
    const out: RawPoint[] = [];
    if (/\.code-workspace$/.test(file.canon)) {
      const cwd = dirname(file.path);
      out.push(...folderOpenTasks(doc, at(doc.root, 'tasks'), file.path, cwd));
      out.push(...programSettings(doc, at(doc.root, 'settings'), file.path, cwd));
    } else {
      const cwd = dirname(dirname(file.path));
      if (/tasks\.json$/.test(file.canon)) out.push(...folderOpenTasks(doc, doc.root, file.path, cwd));
      else out.push(...programSettings(doc, doc.root, file.path, cwd));
    }
    return out;
  },
};

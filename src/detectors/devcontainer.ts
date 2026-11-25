import { at, commandText, entries, items, parseJson, str, value } from '../json.ts';
import { dirname } from '../paths.ts';
import type { RawPoint } from '../types.ts';
import { malformed, type Detector } from './detector.ts';

const INSIDE = ['onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand', 'postAttachCommand'];

export const devcontainer: Detector = {
  files: ['**/.devcontainer/devcontainer.json', '**/.devcontainer/*/devcontainer.json', '**/.devcontainer.json'],
  async detect(view, file) {
    const text = await view.text(file.path);
    if (text === null) return [];
    const doc = parseJson(text);
    if (!doc) return text.trim() ? [malformed(file.path, 'container')] : [];
    const out: RawPoint[] = [];
    const cwd = file.path.split('/').slice(0, Math.max(0, file.path.split('/').findIndex((p) => /^\.devcontainer/i.test(p)))).join('/') || (file.path.includes('/') ? '' : dirname(file.path));

    for (const key of ['initializeCommand', ...INSIDE]) {
      const node = at(doc.root, key);
      if (!node) continue;
      const command = node.type === 'object'
        ? entries(node).map((e) => commandText(e.node)).filter(Boolean).join(' && ')
        : commandText(node);
      if (!command) continue;
      const host = key === 'initializeCommand';
      out.push({
        id: host ? 'devcontainer/host' : 'devcontainer/inside',
        trigger: 'container',
        file: file.path,
        line: doc.line(node),
        key,
        title: host
          ? { en: 'Command that runs on YOUR machine, outside the container', es: 'Comando que se ejecuta en TU máquina, fuera del contenedor' }
          : { en: `Command inside the container: ${key}`, es: `Comando dentro del contenedor: ${key}` },
        severity: host ? 'medium' : 'low',
        command,
        needs: { en: 'you reopen the folder in a container', es: 'que reabras la carpeta en un contenedor' },
        cwd,
      });
    }

    // Settings that let the container reach the host.
    const risky: { key: string; text: string; line: number }[] = [];
    const flag = (node: ReturnType<typeof at>, key: string, s: string | undefined): void => {
      if (node && s && /--privileged|docker\.sock|--pid[= ]host|--network[= ]host|--cap-add[= ](ALL|SYS_ADMIN)|localEnv:(HOME|USERPROFILE)|(source|src)=(\/|~|\/root|\/home)?(,|$)|\/\.ssh|\/\.aws/i.test(s)) {
        risky.push({ key, text: s, line: doc.line(node) });
      }
    };
    items(at(doc.root, 'runArgs')).forEach((n, i, all) => flag(n, `runArgs.${str(n)}`, [str(n), str(all[i + 1])].filter(Boolean).join(' ')));
    items(at(doc.root, 'mounts')).forEach((n) => flag(n, `mounts.${JSON.stringify(value(n))}`, typeof value(n) === 'string' ? str(n) : JSON.stringify(value(n))));
    flag(at(doc.root, 'workspaceMount'), 'workspaceMount', str(at(doc.root, 'workspaceMount')));
    if (value(at(doc.root, 'privileged')) === true) risky.push({ key: 'privileged', text: 'privileged: true', line: doc.line(at(doc.root, 'privileged')!) });
    for (const r of risky) {
      out.push({
        id: 'devcontainer/escape',
        trigger: 'container',
        file: file.path,
        line: r.line,
        key: r.key,
        title: { en: 'The container gets access to your machine', es: 'El contenedor obtiene acceso a tu máquina' },
        severity: 'medium',
        command: r.text,
        needs: { en: 'you reopen the folder in a container', es: 'que reabras la carpeta en un contenedor' },
      });
    }
    return out;
  },
};

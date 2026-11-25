import { at, commandText, entries, items, parseJson, str, value, type JsonDoc, type Node } from '../json.ts';
import { dirname } from '../paths.ts';
import type { RawPoint, Severity, Text } from '../types.ts';
import { malformed, type Detector } from './detector.ts';

const TRUST: Text = { en: 'you trust the folder in the agent', es: 'que confíes en la carpeta dentro del agente' };
const APPROVE: Text = { en: 'you approve the server in the agent', es: 'que apruebes el servidor en el agente' };

/** Folder of the project for a file like `x/.claude/settings.json`. */
function projectDir(path: string): string {
  const parts = path.split('/');
  const dot = parts.findIndex((p, i) => i < parts.length - 1 && /^\.(claude|cursor|gemini|codex|windsurf|github|vscode|kiro|roo|amazonq|opencode|zed|trae|qwen|continue|idea|junie|factory|augment)[. ]*$/i.test(p));
  return dot < 0 ? dirname(path) : parts.slice(0, dot).join('/');
}

/** Hooks have a different shape in every agent. All of them end in a command. */
function hookCommands(root: Node): { path: string; node: Node; command: string }[] {
  const out: { path: string; node: Node; command: string }[] = [];
  const visit = (n: Node, path: string, depth: number): void => {
    if (depth > 12) return;
    if (n.type === 'array') items(n).forEach((c, i) => visit(c, `${path}[${i}]`, depth + 1));
    if (n.type !== 'object') return;
    for (const field of ['command', 'bash', 'powershell', 'windows', 'linux', 'osx', 'run', 'script']) {
      const child = at(n, field);
      const command = child && child.type !== 'object' ? commandText(child, field === 'command' ? at(n, 'args') : undefined) : undefined;
      if (child && command) out.push({ path: `${path}.${field}`, node: child, command });
    }
    for (const e of entries(n)) visit(e.node, path ? `${path}.${e.key}` : e.key, depth + 1);
  };
  visit(root, '', 0);
  return out;
}

function hooks(doc: JsonDoc, root: Node | undefined, file: string, agent: string): RawPoint[] {
  if (!root) return [];
  return hookCommands(root).map(({ path, node, command }) => {
    const event = /^[^.[]+/.exec(path)?.[0] ?? path;
    return {
      id: 'agent/hook',
      trigger: 'agent' as const,
      file,
      line: doc.line(node),
      key: path,
      title: { en: `${agent} hook: ${event}`, es: `Hook de ${agent}: ${event}` },
      severity: 'medium' as const,
      command,
      needs: TRUST,
      cwd: projectDir(file),
    };
  });
}

function mcpServers(doc: JsonDoc, root: Node | undefined, file: string): RawPoint[] {
  return entries(root).flatMap(({ key, node }): RawPoint[] => {
    if (node.type !== 'object') return [];
    const command = commandText(at(node, 'command'), at(node, 'args'));
    const url = str(at(node, 'url')) ?? str(at(node, 'serverUrl')) ?? str(at(node, 'httpUrl'));
    const helper = str(at(node, 'headersHelper'));
    const out: RawPoint[] = [];
    const base = { trigger: 'agent' as const, file, line: doc.line(node), needs: APPROVE, cwd: projectDir(file) };
    if (command) {
      out.push({
        ...base, id: 'agent/mcp-server', key: key,
        title: { en: `MCP server: ${key}`, es: `Servidor MCP: ${key}` },
        severity: 'medium', command,
      });
    } else if (url) {
      out.push({
        ...base, id: 'agent/mcp-remote', key: key,
        title: { en: `Remote MCP server: ${key}`, es: `Servidor MCP remoto: ${key}` },
        severity: /^http:\/\/(?!localhost|127\.|\[::1\])/i.test(url) ? 'medium' : 'low', command: url,
      });
    }
    if (helper) {
      out.push({
        ...base, id: 'agent/mcp-helper', key: `${key}.headersHelper`,
        title: { en: `Command that builds headers for ${key}`, es: `Comando que prepara cabeceras para ${key}` },
        severity: 'medium', command: helper,
      });
    }
    const nodeOptions = entries(at(node, 'env')).find((e) => /^(NODE_OPTIONS|LD_PRELOAD|DYLD_INSERT_LIBRARIES|PYTHONSTARTUP|BASH_ENV)$/i.test(e.key));
    if (nodeOptions) {
      out.push({
        ...base, id: 'agent/mcp-env', key: `${key}.env`, line: doc.line(nodeOptions.node),
        title: { en: `Variable that injects code into ${key}`, es: `Variable que inyecta código en ${key}` },
        severity: 'high', command: `${nodeOptions.key}=${String(value(nodeOptions.node))}`,
      });
    }
    return out;
  });
}

const helperKeys = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'otelHeadersHelper', 'proxyAuthHelper'];

/** Traffic redirection sends the API key of the user to another server. */
const REDIRECT = /^(ANTHROPIC_(BASE_URL|BEDROCK_BASE_URL|VERTEX_BASE_URL|FOUNDRY_BASE_URL)|OPENAI_(BASE_URL|API_BASE)|GEMINI_BASE_URL|GOOGLE_GEMINI_BASE_URL|HTTPS?_PROXY|ALL_PROXY|NODE_EXTRA_CA_CERTS)$/i;
const INJECT = /^(NODE_OPTIONS|LD_PRELOAD|DYLD_INSERT_LIBRARIES|PYTHONSTARTUP|BASH_ENV|GIT_SSH_COMMAND|PATH|CLAUDE_CODE_SHELL_PREFIX)$/i;

function agentSettings(doc: JsonDoc, file: string, agent: string): RawPoint[] {
  const root = doc.root;
  const out: RawPoint[] = [];
  const add = (id: string, node: Node, key: string, title: Text, severity: Severity, command?: string): void => {
    out.push({ id, trigger: 'agent', file, line: doc.line(node), key, title, severity, needs: TRUST, cwd: projectDir(file), ...(command && { command }) });
  };

  out.push(...hooks(doc, at(root, 'hooks'), file, agent));
  out.push(...mcpServers(doc, at(root, 'mcpServers'), file));

  for (const key of helperKeys) {
    const node = at(root, key);
    const command = str(node);
    if (node && command) add('agent/helper', node, key, { en: `${agent} helper command: ${key}`, es: `Comando auxiliar de ${agent}: ${key}` }, 'medium', command);
  }
  for (const key of ['statusLine', 'fileSuggestion', 'subagentStatusLine']) {
    const node = at(root, key, 'command');
    const command = str(node);
    if (node && command) add('agent/helper', node, key, { en: `${agent} command: ${key}`, es: `Comando de ${agent}: ${key}` }, 'medium', command);
  }
  for (const path of [['tools', 'discoveryCommand'], ['tools', 'callCommand'], ['toolDiscoveryCommand'], ['toolCallCommand'], ['mcp', 'serverCommand'], ['mcpServerCommand']]) {
    const node = at(root, ...path);
    const command = str(node);
    if (node && command) add('agent/helper', node, path.join('.'), { en: `${agent} command: ${path.join('.')}`, es: `Comando de ${agent}: ${path.join('.')}` }, 'medium', command);
  }
  for (const { key, node } of entries(at(root, 'env'))) {
    const text = `${key}=${String(value(node))}`;
    if (REDIRECT.test(key)) {
      add('agent/redirect', node, `env.${key}`, { en: 'Redirects the traffic of the agent', es: 'Redirige el tráfico del agente' }, /localhost|127\.0\.0\.1/.test(text) ? 'medium' : 'high', text);
    } else if (INJECT.test(key)) {
      add('agent/inject', node, `env.${key}`, { en: 'Injects code into what the agent runs', es: 'Inyecta código en lo que ejecuta el agente' }, 'high', text);
    }
  }
  const all = at(root, 'enableAllProjectMcpServers');
  if (all && value(all) === true) add('agent/auto-approve', all, 'enableAllProjectMcpServers', { en: 'Approves every MCP server of the project', es: 'Aprueba todos los servidores MCP del proyecto' }, 'high', 'enableAllProjectMcpServers: true');
  const named = at(root, 'enabledMcpjsonServers');
  if (named && items(named).length > 0) add('agent/auto-approve', named, 'enabledMcpjsonServers', { en: 'Approves MCP servers of the project by name', es: 'Aprueba servidores MCP del proyecto por su nombre' }, 'medium', items(named).map(str).filter(Boolean).join(', '));
  const mode = at(root, 'permissions', 'defaultMode');
  if (mode && /^(bypassPermissions|dontAsk)$/.test(str(mode) ?? '')) add('agent/auto-approve', mode, 'permissions.defaultMode', { en: 'Removes permission prompts', es: 'Elimina las preguntas de permiso' }, 'high', `defaultMode: ${str(mode)}`);
  for (const rule of items(at(root, 'permissions', 'allow'))) {
    const text = str(rule) ?? '';
    if (/^(Bash|PowerShell)(\((\*|:\*|(ba|z)?sh( -c)?[: ]\*|curl[: ]\*|wget[: ]\*|node[: ]\*|python3?[: ]\*|eval[: ]\*|sudo[: ]\*)?\))?$|^\*$/i.test(text)) {
      add('agent/auto-approve', rule, `allow.${text}`, { en: 'Lets the agent run commands without asking', es: 'Permite al agente ejecutar comandos sin preguntar' }, 'medium', text);
    }
  }
  for (const key of ['extraKnownMarketplaces', 'enabledPlugins']) {
    const node = at(root, key);
    if (node && entries(node).length > 0) add('agent/plugins', node, key, { en: `${agent} plugins chosen by the repository`, es: `Plugins de ${agent} elegidos por el repositorio` }, 'low', entries(node).map((e) => e.key).join(', '));
  }
  return out;
}

const agentName = (path: string): string => {
  const p = path.toLowerCase();
  if (p.includes('.claude/')) return 'Claude Code';
  if (p.includes('.cursor/')) return 'Cursor';
  if (p.includes('.gemini/')) return 'Gemini CLI';
  if (p.includes('.codex/')) return 'Codex';
  if (p.includes('.windsurf/')) return 'Windsurf';
  if (p.includes('.github/')) return 'Copilot';
  if (p.includes('.qwen/')) return 'Qwen Code';
  if (p.includes('.factory/')) return 'Factory';
  if (p.includes('.kiro/')) return 'Kiro';
  return 'Agent';
};

export const agentConfig: Detector = {
  files: [
    '**/.claude/settings.json', '**/.claude/settings.local.json', '**/.gemini/settings.json', '**/.qwen/settings.json',
    '**/.cursor/hooks.json', '**/.codex/hooks.json', '**/.windsurf/hooks.json', '**/.github/hooks/*.json',
    '**/.factory/settings.json', '**/.factory/hooks.json', '**/.kiro/hooks/*', '**/.kiro/agents/*.json',
    '**/.cursor/environment.json', '**/.cursor/cli.json', '**/hooks/hooks.json',
  ],
  async detect(view, file) {
    const text = await view.text(file.path);
    if (text === null) return [];
    const doc = parseJson(text);
    if (!doc) return text.trim() ? [malformed(file.path, 'agent')] : [];
    const agent = agentName(file.path);
    if (/settings(\.local)?\.json$/.test(file.canon)) return agentSettings(doc, file.path, agent);
    if (/\/cli\.json$/.test(file.canon)) {
      return items(at(doc.root, 'permissions', 'allow')).flatMap((rule): RawPoint[] => {
        const text = str(rule) ?? '';
        if (!/^(Shell|Mcp)\((\*|[^)]*:?\*|(ba|z)?sh|curl|wget|node|python3?|sudo|rm)\)$|^\*$/i.test(text)) return [];
        return [{
          id: 'agent/auto-approve', trigger: 'agent', file: file.path, line: doc.line(rule), key: `allow.${text}`,
          title: { en: 'Lets the agent run commands without asking', es: 'Permite al agente ejecutar comandos sin preguntar' },
          severity: 'medium', command: text, needs: TRUST, cwd: projectDir(file.path),
        }];
      });
    }
    if (/environment\.json$/.test(file.canon)) {
      return ['install', 'start', 'update'].flatMap((key): RawPoint[] => {
        const node = at(doc.root, key);
        const command = str(node);
        return node && command ? [{
          id: 'agent/cloud-setup', trigger: 'agent', file: file.path, line: doc.line(node), key,
          title: { en: `Cloud agent setup: ${key}`, es: `Preparación del agente en la nube: ${key}` },
          severity: 'low', command, cwd: projectDir(file.path),
        }] : [];
      });
    }
    // A plugin's hooks/hooks.json only counts when a plugin manifest exists.
    if (/(^|\/)hooks\/hooks\.json$/.test(file.canon)) {
      const base = dirname(dirname(file.path));
      if (!view.find(`${base ? `${base}/` : ''}.claude-plugin/plugin.json`)) return [];
      return hooks(doc, at(doc.root, 'hooks') ?? doc.root, file.path, 'Claude Code').map((p) => ({
        ...p,
        severity: 'low' as const,
        needs: { en: 'you install this repository as a plugin', es: 'que instales este repositorio como plugin' },
      }));
    }
    return hooks(doc, at(doc.root, 'hooks') ?? doc.root, file.path, agent);
  },
};

export const mcp: Detector = {
  files: [
    '**/.mcp.json', '**/.cursor/mcp.json', '**/.vscode/mcp.json', '**/.kiro/settings/mcp.json', '**/.roo/mcp.json',
    '**/.amazonq/mcp.json', '**/.windsurf/mcp.json', '**/.trae/mcp.json', '**/.junie/mcp/mcp.json', '**/.factory/mcp.json',
    '**/.zed/settings.json', '**/opencode.json', '**/opencode.jsonc', '**/.opencode/opencode.json',
  ],
  async detect(view, file) {
    const text = await view.text(file.path);
    if (text === null) return [];
    const doc = parseJson(text);
    if (!doc) return text.trim() ? [malformed(file.path, 'agent')] : [];
    const out: RawPoint[] = [];
    for (const key of ['mcpServers', 'servers', 'mcp', 'context_servers']) {
      const node = at(doc.root, key);
      const inner = key === 'mcp' ? at(node, 'servers') ?? node : node;
      out.push(...mcpServers(doc, inner, file.path));
    }
    if (/opencode\.jsonc?$/.test(file.canon)) {
      for (const p of [...items(at(doc.root, 'plugin')), ...items(at(doc.root, 'plugins'))]) {
        const name = str(p);
        if (name) out.push({
          id: 'agent/plugins', trigger: 'agent', file: file.path, line: doc.line(p), key: `plugin.${name}`,
          title: { en: 'Opencode plugin chosen by the repository', es: 'Plugin de Opencode elegido por el repositorio' },
          severity: 'medium', command: name, cwd: projectDir(file.path),
        });
      }
    }
    if (/\.zed\/settings\.json$/.test(file.canon)) {
      for (const { key, node } of entries(at(doc.root, 'lsp'))) {
        const command = commandText(at(node, 'binary', 'path'), at(node, 'binary', 'arguments'));
        if (command) out.push({
          id: 'zed/lsp-binary', trigger: 'editor', file: file.path, line: doc.line(node), key: `lsp.${key}`,
          title: { en: `Language server chosen by the repository: ${key}`, es: `Servidor de lenguaje elegido por el repositorio: ${key}` },
          severity: 'medium', command, cwd: projectDir(file.path),
          needs: { en: 'you trust the folder', es: 'que confíes en la carpeta' },
        });
      }
    }
    return out;
  },
};

/** Text that agents read as orders, and the commands embedded in it. */
export const instructions: Detector = {
  files: [
    '**/agents.md', '**/agents.override.md', '**/claude.md', '**/claude.local.md', '**/gemini.md', '**/qwen.md', '**/warp.md', '**/skill.md',
    '**/.cursorrules', '**/.windsurfrules', '**/.clinerules', '**/.clinerules/*', '**/.roorules', '**/.goosehints',
    '**/.cursor/rules/**', '**/.windsurf/rules/**', '**/.roo/rules*/**', '**/.kiro/steering/**', '**/.continue/rules/**', '**/.junie/*.md',
    '**/.github/copilot-instructions.md', '**/.github/instructions/**', '**/.github/agents/*.md', '**/.github/prompts/*.md',
    '**/.claude/rules/**', '**/.claude/commands/**', '**/.claude/agents/**', '**/.claude/skills/**/*.md', '**/.cursor/commands/**', '**/.gemini/commands/**', '**/.agents/skills/**/*.md',
  ],
  async detect(view, file) {
    if (!/\.(md|mdc|txt|toml|ya?ml|json)$|rules$|hints$|\/[^./]+$/.test(file.canon)) return [];
    const text = await view.text(file.path);
    if (text === null) return [];
    const out: RawPoint[] = [{
      id: 'agent/instructions',
      trigger: 'agent',
      file: file.path,
      line: 1,
      key: 'instructions',
      title: { en: 'Instructions that an agent will obey', es: 'Instrucciones que un agente obedecerá' },
      severity: 'info',
      instructions: text,
    }];
    // Slash commands and skills can run a command before the model reads them.
    if (/\.(claude|agents|gemini)\/(commands|skills)\//.test(file.canon)) {
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/!`([^`]{1,2000})`|!\{([^}]{1,2000})\}/g)) {
          const command = m[1] ?? m[2]!;
          out.push({
            id: 'agent/embedded-command', trigger: 'agent', file: file.path, line: i + 1, key: command,
            title: { en: 'Command that runs when the prompt is used', es: 'Comando que se ejecuta al usar el prompt' },
            severity: 'low', command, cwd: projectDir(file.path),
            needs: { en: 'you or the agent use this command or skill', es: 'que tú o el agente uséis este comando o skill' },
          });
        }
      });
    }
    const front = /^\u{feff}?---\r?\n([\s\S]{0,20000}?)\r?\n---/u.exec(text);
    if (front && /^hooks\s*:/m.test(front[1]!)) {
      const lines = front[1]!.split(/\r?\n/);
      lines.forEach((line, i) => {
        const m = /^\s*(?:-\s*)?command\s*:\s*(.+)$/.exec(line);
        if (m) out.push({
          id: 'agent/hook', trigger: 'agent', file: file.path, line: i + 2, key: `frontmatter.${m[1]!}`,
          title: { en: 'Hook declared in a skill or agent', es: 'Hook declarado en una skill o agente' },
          severity: 'medium', command: m[1]!.replace(/^["']|["']$/g, ''), cwd: projectDir(file.path),
          needs: { en: 'the agent uses this file', es: 'que el agente use este archivo' },
        });
      });
    }
    return out;
  },
};

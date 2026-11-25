# beforeopen

**See what a repository will run on your machine before you open it.**

[Español](README.es.md)

![Example of a scan](docs/demo.svg)

Opening a folder can be enough to run someone else's code: editor tasks, AI agent hooks, MCP servers, install scripts, git hooks. `beforeopen` reads all of those places **without executing anything** and shows what would run, when, and why it looks dangerous.

It does not look for known malware. It maps what a repository *can execute*, so it does not depend on having seen an attack before.

## Use it

```sh
npx beforeopen owner/repo                        # a GitHub repository, without cloning it
npx beforeopen https://github.com/o/r/pull/12    # a pull request
npx beforeopen https://gitlab.com/group/repo     # any git server
npx beforeopen ~/Downloads/take-home-test        # a folder or an extracted archive
npx beforeopen diff main feature                 # what a branch adds
```

> Run it from **outside** the folder you do not trust. `npx` itself reads the `.npmrc` and `node_modules` of the current folder. Better still, install it once: `npm install -g beforeopen`.

It needs Node 20 or later and git. There are no runtime dependencies, no install scripts, no telemetry and no account.

| Exit code | Meaning |
| --- | --- |
| 0 | Nothing at or above `--fail-on` (default: `high`) |
| 1 | Something at or above `--fail-on` |
| 2 | Error, or something could not be analysed |

`--json` gives a stable format for other tools. `--all` shows low severity findings. `--help` lists everything.

## In every pull request

A one-time scan is useful. A warning when someone adds a new way to run code is better:

```yaml
# .github/workflows/beforeopen.yml
name: beforeopen
on: pull_request
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 2
          persist-credentials: false
      - uses: willor16/beforeopen@v0   # better: pin a full commit hash
```

It reports only what the pull request **adds or changes**, including changes in scripts that run on install. It needs no token and no secrets, so it is safe for forks. Use `pull_request`, never `pull_request_target`.

## What it looks at

| Moment | Places |
| --- | --- |
| Opening in an editor | VS Code tasks, settings and workspaces, JetBrains startup tasks, Vim, Emacs, Zed, MSBuild |
| Opening with an AI agent | Hooks, helpers, permissions and traffic redirection in Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, Kiro, Opencode. MCP servers. Instruction files and skills with hidden text |
| Entering the folder | direnv, mise, autoenv |
| Using git | Hooks, `.git/config`, hidden embedded repositories, submodules, husky, lefthook, pre-commit |
| Opening in a container | Dev container commands, and access to your machine |
| Installing | npm, pnpm, Yarn, Bun, node-gyp, pip, setup.py, Composer, CocoaPods, registries |
| Building or testing | Cargo, Gradle, Maven, pytest, configuration files that are code |

Every command is followed to the scripts it runs inside the repository. Those scripts are checked for downloads that get executed, stolen keys, hidden or obfuscated code, persistence, and more.

## How it stays safe

A scanner for hostile repositories is a target too:

- Files are read. Nothing is executed, installed or checked out.
- Git never reads the configuration of the target. It runs in an empty repository created for the scan, because settings such as `core.fsmonitor` start programs.
- Git is located by absolute path, so a `git.exe` planted in the folder is not used.
- Tricks with upper case, trailing dots, symbolic links, UTF-16 and invisible characters do not hide a file.
- Output is cleaned, so a repository cannot control your terminal, your GitHub summary or the runner.
- What cannot be analysed is reported, and the exit code says so.

## What it cannot do

- **It never says that a repository is safe.** Any code can be dangerous once you run it.
- It does not analyse your dependencies, only how the repository asks for them.
- Binary files and code built at run time are out of reach. Heavily disguised scripts can avoid the signals, but the execution point is still listed.
- Findings depend on your versions and settings. Many tools ask for trust first, and the report says when.

How noisy is it? On 2026-11-25 it ran on 40 popular repositories that had not been used to adjust the rules: 39 were scanned (one download timed out) and 2 had a high finding, both in legitimate scripts. After adjusting the rules with those results, version 0.1.0 reports a high finding in 1 of 80 repositories. It has not been measured against a collection of real attacks.

## Add a rule

Rules are YAML and need no knowledge of the code. This is a complete one:

```yaml
points:
  - id: editor/example
    trigger: editor
    severity: low
    title: { en: Example script, es: Script de ejemplo }
    files: ['**/.example/start.sh']
```

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a way to run code that goes unnoticed, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). The bundle includes [third-party code](THIRD-PARTY-NOTICES.md).

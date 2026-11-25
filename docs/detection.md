# How well it detects real attacks

Measured on 2026-11-25. In short:

- **Code that runs by itself** (opening, installing, agent hooks): strong. Of 6 attacks never used to make the rules, 5 are shown and none is missed.
- **Text that gives orders to AI agents**: partial. Plain and polite wording is hard to tell from a normal guide.
- **Malicious code inside the program, or in binary files**: weak. Of 6 attacks of this kind never used to make the rules, none is found.

Use it to see what runs on its own. Do not use it to decide that a project is clean.

## Method

Documented attacks were rebuilt as inert text from public reports: the same trigger and the same style of disguise, with no payload and none of the original names, hashes or addresses. They live only in memory, so nothing dangerous is written to disk. Removing the indicators makes the test harder: the rules must recognise behaviour.

An attack counts as **shown** when the file that triggers it is listed as `high` or `medium`, which is what the report displays by default. `low` and `info` need `--all`. `missed` means that the file is not listed at all.

There are two groups:

1. **63 attacks** used to find and fix weaknesses. Its result after the changes is optimistic, because the rules were adjusted while looking at it.
2. **17 attacks** written before looking at any result and measured once, after the rules were closed in commit `37e4fe8`. Nothing was changed afterwards. This is the number to trust.

## Results

| | Version | Attacks | High | Medium | Low or info | Missed | Shown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Group 1 (used) | 0.1.1 | 63 | 15 | 17 | 15 | 16 | 51% |
| Group 1 (used) | 0.1.2 | 63 | 43 | 17 | 2 | 1 | 95% |
| **Group 2 (not used)** | 0.1.1 | 17 | 1 | 4 | 3 | 9 | **29%** |
| **Group 2 (not used)** | 0.1.2 | 17 | 2 | 4 | 2 | 9 | **35%** |

Group 2 by kind, with 0.1.2:

| Kind | Attacks | Shown | Missed |
| --- | --- | --- | --- |
| Runs by itself | 6 | 5 | 0 |
| Text for agents | 1 | 0 | 1 |
| Build or tests | 4 | 1 | 2 |
| When the program is started | 6 | 0 | 6 |

The distance between 95% and 35% is the lesson: fixing known cases does not mean finding new ones. The changes in 0.1.2 helped with problems that appear again and again, such as hidden tasks or code pushed out of sight, and very little with the rest. Group 2 is also small, so each case moves the result by 6 points.

## Noise

| Repositories | Scanned | With a high finding |
| --- | --- | --- |
| 80 popular ones, used to adjust the rules | 80 | 1 |
| 40 popular ones, not used | 39 | 1 |

One of the 40 could not be scanned because its name was wrong. Both findings are in legitimate files: a message with an install command, and a test package that saves the environment. After the last adjustment, only the three of the 80 that had a finding were scanned again.

## Known gaps

- Code that only runs when you start the program, unless it hides itself.
- Binary files: JAR, EXE, DLL, compressed tests.
- Build scripts in Rust that download and start something, and Autotools macros.
- Orders inside a README, which some agents read.
- MCP configuration in unusual places, such as `.cursor/rules/mcp.json`.
- Ordinary-looking build steps that call another file.

## About the sources

Every case links to a public report. Some could not be opened by the tool used to read them, so GitSpawn and the clean repository case come from summaries. Most of group 2 comes from summaries or from general knowledge of well-known incidents, not from a new reading of each page. One case, EvilSln, was removed before measuring because its public pages no longer exist. It would probably have been missed.

Corrections are welcome: the cases are in [`test/attacks`](../test/attacks).

```sh
node scripts/measure.ts             # group 1
node scripts/measure.ts --holdout   # group 2
```

## Group 1, with 0.1.2

| Attack | Date | Kind | Result | Report |
| --- | --- | --- | --- | --- |
| Fake Font (Contagious Interview) | 2026-01 | automatic | high | [source](https://opensourcemalware.com/blog/contagious-code-fake-font) |
| Hijacked npm packages, hidden task | 2026-06 | automatic | high | [source](https://research.jfrog.com/post/hijacked-npm-vscode-tasks-blockchain/) |
| Contagious Interview, trading project | 2026-01 | automatic | high | [source](https://radar.securityalliance.org/vs-code-tasks-abuse-by-contagious-interview-dprk/) |
| Contagious Interview, server code | 2026-01 | run | high | [source](https://radar.securityalliance.org/vs-code-tasks-abuse-by-contagious-interview-dprk/) |
| Contagious Interview on macOS | 2026-01 | automatic | high | [source](https://www.jamf.com/blog/threat-actors-expand-abuse-of-visual-studio-code/) |
| TasksJacker | 2026-03 | automatic | high | [source](https://opensourcemalware.com/blog/tasksjacker-dprk-attack-github-vscode) |
| PolinRider task, runOn outside runOptions | 2026-04 | automatic | high | [source](https://opensourcemalware.com/blog/polinrider-rides-again-north-korean-attack-expands-across-github) |
| PolinRider, game template | 2026-04 | automatic | high | [source](https://opensourcemalware.com/blog/polinrider-rides-again-north-korean-attack-expands-across-github) |
| Malicious Next.js repositories, task | 2026-02 | automatic | high | [source](https://www.microsoft.com/en-us/security/blog/2026/02/24/c2-developer-targeting-campaign/) |
| Codespaces, automatic task | 2026-02 | automatic | medium | [source](https://orca.security/resources/blog/hacking-github-codespaces-rce-supply-chain-attack/) |
| Codespaces, PROMPT_COMMAND in settings | 2026-02 | automatic | medium | [source](https://orca.security/resources/blog/hacking-github-codespaces-rce-supply-chain-attack/) |
| Codespaces, postCreateCommand | 2026-02 | automatic | medium | [source](https://orca.security/resources/blog/hacking-github-codespaces-rce-supply-chain-attack/) |
| Copilot auto approval (CVE-2025-53773) | 2025-08 | automatic | high | [source](https://labs.cloudsecurityalliance.org/research/csa-research-note-agent-instruction-file-poisoning-20261027/) |
| Task inside .cursor with a gist | 2026-05 | automatic | high | [source](https://cloud.google.com/blog/products/identity-security/beyond-source-code-the-files-ai-coding-agents-trust-and-attackers-exploit) |
| PolinRider in postcss.config.mjs | 2026-04 | build | high | [source](https://opensourcemalware.com/blog/polinrider-rides-again-north-korean-attack-expands-across-github) |
| PolinRider, second variant | 2026-04 | build | medium | [source](https://opensourcemalware.com/blog/polinrider-rides-again-north-korean-attack-expands-across-github) |
| PolinRider in babel.config.cjs | 2026-08 | build | high | [source](https://opensourcemalware.com/blog/polinrider-npm-case-study-dprk-attack) |
| Malicious Next.js repositories, next.config.js | 2026-02 | build | low | [source](https://www.microsoft.com/en-us/security/blog/2026/02/24/c2-developer-targeting-campaign/) |
| Malicious Next.js repositories, backend | 2026-02 | run | high | [source](https://www.microsoft.com/en-us/security/blog/2026/02/24/c2-developer-targeting-campaign/) |
| Shai-Hulud 2.0 | 2025-11 | automatic | high | [source](https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/) |
| Miasma, "Phantom Gyp" | 2026-06 | automatic | high | [source](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm) |
| Miasma, RubyGems variant | 2026-06 | automatic | high | [source](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm) |
| Mini Shai-Hulud, preinstall | 2026-05 | automatic | high | [source](https://www.sonarsource.com/blog/mini-shai-hulud-targets-ai-coding-agents/) |
| Mini Shai-Hulud, orphan commit dependency | 2026-05 | automatic | medium | [source](https://www.sonarsource.com/blog/mini-shai-hulud-targets-ai-coding-agents/) |
| PhantomRaven | 2025-08 | automatic | high | [source](https://www.sonatype.com/blog/phantomraven-npm-malware) |
| Nx "s1ngularity" | 2025-08 | automatic | high | [source](https://www.wiz.io/blog/s1ngularity-supply-chain-attack) |
| Miasma, .claude/settings.json | 2026-06 | automatic | high | [source](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/) |
| Miasma, .gemini/settings.json | 2026-06 | automatic | high | [source](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/) |
| Miasma, .vscode/tasks.json | 2026-06 | automatic | high | [source](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/) |
| Miasma, composer.json | 2026-06 | automatic | high | [source](https://safedep.io/config-files-that-run-code/) |
| Miasma, Gemfile | 2026-06 | automatic | high | [source](https://safedep.io/config-files-that-run-code/) |
| Miasma, Cursor rule | 2026-06 | agent | high | [source](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/) |
| Miasma, npm test | 2026-06 | build | **missed** | [source](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/) |
| Hades, setup.py loader | 2026-06 | automatic | medium | [source](https://www.pillar.security/blog/your-agents-answer-to-hades-how-one-commit-hijacks-4-ai-coding-tools) |
| Hades, startup hook | 2026-06 | automatic | high | [source](https://tuxcare.com/?p=35098) |
| Claude Code hook (CVE-2025-59536) | 2025-10 | automatic | medium | [source](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) |
| Claude Code MCP consent (CVE-2025-59536) | 2025-10 | automatic | high | [source](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) |
| Claude Code MCP consent, by name | 2025-10 | automatic | medium | [source](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) |
| Claude Code API key (CVE-2026-21852) | 2026-01 | automatic | high | [source](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) |
| Settings with a foreign API and key | 2026-05 | automatic | high | [source](https://cloud.google.com/blog/products/identity-security/beyond-source-code-the-files-ai-coding-agents-trust-and-attackers-exploit) |
| Cursor CLI permissions (CVE-2025-61592) | 2025-10 | automatic | medium | [source](https://labs.cloudsecurityalliance.org/research/csa-research-note-agent-instruction-file-poisoning-20261027/) |
| Hooks in settings.local.json (CVE-2026-48124) | 2026-10 | automatic | medium | [source](https://labs.cloudsecurityalliance.org/research/csa-research-note-agent-instruction-file-poisoning-20261027/) |
| 22 malicious repositories, hook | 2026-11 | automatic | high | [source](https://bitdefender.com/en-us/blog/labs/how-ai-agents-become-new-targets-in-github-malware-campaign) |
| GitSpawn, core.fsmonitor in an archive | 2026-09 | automatic | high | [source](https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/09/CSA_research_note_gitspawn_ai_coding_agent_rce_20260903-csa-styled.pdf) |
| Rules File Backdoor | 2025-03 | agent | high | [source](https://labs.cloudsecurityalliance.org/research/csa-research-note-agent-instruction-file-poisoning-20261027/) |
| Downloads folder case, AGENTS.md | 2026-10 | agent | medium | [source](https://labs.cloudsecurityalliance.org/research/csa-research-note-agent-instruction-file-poisoning-20261027/) |
| Downloads folder case, CLAUDE.md | 2026-10 | agent | medium | [source](https://labs.cloudsecurityalliance.org/research/csa-research-note-agent-instruction-file-poisoning-20261027/) |
| PromptLogger, prompts sent to a database | 2026-08 | agent | medium | [source](https://www.csoonline.com/article/4204731/attackers-are-crafting-malicious-ai-instruction-files-to-turn-your-agentic-workflows-into-quiet-criminal-helpers.html) |
| PromptLogger, environment sent | 2026-08 | agent | medium | [source](https://www.csoonline.com/article/4204731/attackers-are-crafting-malicious-ai-instruction-files-to-turn-your-agentic-workflows-into-quiet-criminal-helpers.html) |
| PromptLogger, .env sent | 2026-08 | agent | medium | [source](https://www.csoonline.com/article/4204731/attackers-are-crafting-malicious-ai-instruction-files-to-turn-your-agentic-workflows-into-quiet-criminal-helpers.html) |
| PromptLogger, "Zero Trust" block | 2026-08 | agent | medium | [source](https://www.csoonline.com/article/4204731/attackers-are-crafting-malicious-ai-instruction-files-to-turn-your-agentic-workflows-into-quiet-criminal-helpers.html) |
| 22 malicious repositories, AGENTS.md | 2026-11 | agent | high | [source](https://bitdefender.com/en-us/blog/labs/how-ai-agents-become-new-targets-in-github-malware-campaign) |
| Skill that steals keys | 2026-05 | agent | medium | [source](https://cloud.google.com/blog/products/identity-security/beyond-source-code-the-files-ai-coding-agents-trust-and-attackers-exploit) |
| Clean repository with a DNS payload | 2026-06 | agent | high | [source](https://www.eweek.com/security/clean-repo-ai-agent-risk/) |
| Water Curse, PreBuildEvent | 2025-05 | build | high | [source](https://www.trendmicro.com/en_us/research/25/f/water-curse.html) |
| ischhfd83, PreBuild in .vbproj | 2025-06 | build | high | [source](https://www.sophos.com/en-us/blog/the-strange-tale-of-ischhfd83-when-cybercriminals-eat-their-own) |
| ischhfd83, program disguised as a solution | 2025-06 | run | high | [source](https://www.sophos.com/en-us/blog/the-strange-tale-of-ischhfd83-when-cybercriminals-eat-their-own) |
| ischhfd83, Python behind spaces | 2025-06 | run | high | [source](https://www.sophos.com/en-us/blog/the-strange-tale-of-ischhfd83-when-cybercriminals-eat-their-own) |
| GitVenom, Python behind tabs | 2025-02 | run | high | [source](https://securelist.com/gitvenom/115528/) |
| GitVenom, base64 function | 2025-02 | run | high | [source](https://securelist.com/gitvenom/115528/) |
| GitVenom, PreBuildEvent in C++ | 2025-02 | build | low | [source](https://securelist.com/gitvenom/115528/) |
| pytoileur | 2024-05 | automatic | high | [source](https://www.sonatype.com/blog/pypi-crypto-stealer-targets-windows-users-revives-malware-campaign) |
| GlassWorm, invisible code | 2025-10 | run | high | [source](https://snyk.io/articles/defending-against-glassworm/) |

## Group 2, with 0.1.2

| Attack | Date | Kind | Result | Report |
| --- | --- | --- | --- | --- |
| ua-parser-js | 2021-10 | automatic | high | [source](https://www.cert.europa.eu/publications/security-advisories/2021-057/) |
| Toptal, token sent | 2025-07 | automatic | medium | [source](https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published) |
| Toptal, files deleted | 2025-07 | automatic | medium | [source](https://socket.dev/blog/toptal-s-github-organization-hijacked-10-malicious-packages-published) |
| eslint-config-prettier (CVE-2025-54313) | 2025-07 | automatic | medium | [source](https://nvd.nist.gov/vuln/detail/cve-2025-54313) |
| node-ipc | 2022-03 | run | **missed** | [source](https://snyk.io/blog/peacenotwar-malicious-npm-node-ipc-package-vulnerability/) |
| event-stream | 2018-11 | run | **missed** | [source](https://snyk.io/blog/a-post-mortem-of-the-malicious-event-stream-backdoor/) |
| LiteLLM startup hook | 2026-03 | automatic | high | [source](https://tuxcare.com/?p=35098) |
| ctx | 2022-05 | run | **missed** | [source](https://isc.sans.edu/diary/28678) |
| Rust crates, build script | 2026-08 | build | low | [source](https://www.socket.dev/blog/popular-rust-crates-compromised) |
| faster_log and async_println | 2025-09 | run | **missed** | [source](https://blog.rust-lang.org/2025/09/24/crates.io-malicious-crates-fasterlog-and-asyncprintln) |
| Modified Gradle Wrapper JAR | 2023-01 | build | **missed** | [source](https://blog.gradle.org/wrapper-attack-report) |
| Laravel-Lang, autoloaded helper | 2026-05 | run | **missed** | [source](https://www.securityweek.com/laravel-lang-packages-poisoned-for-malware-delivery/) |
| xz backdoor (CVE-2024-3094) | 2024-03 | build | **missed** | [source](https://www.openwall.com/lists/oss-security/2024/03/29/4) |
| Campaign against researchers, build event | 2021-01 | build | medium | [source](https://blog.google/threat-analysis-group/new-campaign-targeting-security-researchers/) |
| MCPoison (CVE-2025-54136) | 2025-08 | automatic | info | [source](https://research.checkpoint.com/2025/cursor-vulnerability-mcpoison/) |
| Gemini CLI, order inside a license | 2025-07 | agent | **missed** | [source](https://tracebit.com/blog/code-exec-deception-gemini-ai-cli-hijack) |
| Fake LDAPNightmare proof of concept | 2025-01 | run | **missed** | [source](https://www.trendmicro.com/en_us/research/25/a/information-stealer-masquerades-as-ldapnightmare-poc-exploit.html) |

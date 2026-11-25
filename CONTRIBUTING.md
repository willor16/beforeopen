# Contributing

Issues and pull requests are welcome in English or Spanish.

## The most useful contributions

1. A place where a repository can run code that is not covered yet.
2. A false positive: the repository, the line, and why it is harmless.
3. A trick that hides an execution point.

## Set up

```sh
npm ci --ignore-scripts
npm run check
```

Node 24 runs the TypeScript sources directly: `node src/cli.ts owner/repo`.

## Rules

| File | Contains |
| --- | --- |
| `rules/points.yml` | Places that execute something |
| `rules/signals.yml` | Evidence that makes a command or script worse |
| `rules/known.yml` | Common commands that start at a low severity |

Each file explains its fields at the top. A rule needs a title in English and Spanish.

Severity before looking at what runs:

- `info`: an ordinary part of the ecosystem that happens to be code.
- `low`: runs after a deliberate action, such as trusting or building.
- `medium`: runs on its own, or is easy to miss.
- `high`: hard to explain in an honest project.

Patterns must be linear: give every repetition a limit and never nest them. A test runs all of them against hostile text.

## Tests

- Every rule or detector needs a test that finds it, and one that stays silent.
- Test repositories are built in memory or in a temporary folder. Do not add bait files to this repository: opening it must stay boring.
- Addresses end in `.invalid`, so they never resolve.
- Invisible characters are built from their number. `node scripts/escape-invisible.mjs` fixes the ones that slip in.

## Detection

`node scripts/measure.ts` measures documented attacks. Add one to `test/attacks/corpus.ts` with its public report. Keep only the shape of the trigger: no payloads and no original names, hashes or addresses, which antivirus programs recognise. Never change a rule because of `test/attacks/holdout.ts`.

`dist/action.js` is committed because GitHub runs it directly. Run `npm run build` before committing.

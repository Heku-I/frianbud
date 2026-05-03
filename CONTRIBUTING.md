# Contributing to frianbud

Thanks for considering a contribution. The fastest way to help:

## High-impact areas

### Keeping Doffin alive

Doffin's webclient API is not officially documented. We use the same endpoints doffin.no's UI talks to. When Doffin's frontend changes, those endpoints may shift.

If you notice Doffin results going to zero, run:

    FRIANBUD_RUN_LIVE=1 npm run test:doffin

If the live test fails:

1. Open https://doffin.no in a browser with devtools open (Network tab, Fetch/XHR filter).
2. Reproduce a search and a detail view, capturing the new request/response shape.
3. Update the URL/body/normalizer in `src/sources/doffin.ts` and `src/sources/doffin-normalizer.ts`.
4. Update the test fixtures in `tests/fixtures/doffin-*-sample.json`.
5. Open a PR. Even partial findings are useful.

### Improving CPV coverage

The bundled `data/cpv-2008.json` has English labels for all entries and Norwegian labels for ~99.5%. The 45 codes without Norwegian labels are mostly stationary supplies. PRs that improve translations or fill in the missing 0.5% are welcome — edit the JSON directly or rerun `scripts/build-cpv.mjs` against a refreshed Doffin source.

### Adding scorer signals

Each scorer signal is a pure function in `src/domain/scorer-signals.ts`. To add one:

1. Define the signal with the same shape as existing signals (`(tender, profile, opts) => ScoreReason`).
2. Add it to `src/domain/scorer.ts` composition with a max contribution.
3. Adjust the existing weights so they still sum to 100, or add it as an extra signal that participates in the redistribution logic.
4. Add unit tests covering boundary cases.

## Development setup

    git clone https://github.com/<your-fork>/frianbud
    cd frianbud
    npm install
    npm run lint
    npm run typecheck
    npm test

All checks must pass before opening a PR. CI runs the same three commands.

## Code style

- TypeScript strict mode. No `any` without an explanation comment.
- Files target under 200 lines. If a file is growing larger, look for a natural split.
- Tests next to what they test in the `tests/` mirror tree.
- One logical change per commit. Conventional Commits style: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`, `refactor:`.

## Reporting issues

Issues with a runnable reproduction get the fastest response. For Doffin breakage, include the exact failing query and the response from the network tab.

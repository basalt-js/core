# CLAUDE.md

`@basalt-js/core` is the Basalt kernel. Read `docs/basalt-design.md` before changing anything. Part II is the kernel spec, Part V lists the decisions, and §16 lists the Moku quirks that Basalt must not repeat.

## Commands

- `bun run check`: the full gate (typecheck, lint, tests with coverage, build, validate, size). Run it before calling work done.
- `bun run test`: Vitest projects `unit`, `integration` and `types`. Type tests use `expectTypeOf` and `@ts-expect-error`.
- `bun run lint:fix`: Biome and ESLint autofix.

## Rules

- **Zero runtime dependencies.** The kernel runs on Bun, Node, browsers and edge workers. Don't use Node or Bun APIs in `src/` (`tsconfig` has `types: []` on purpose).
- **`src/index.ts` is the only public surface.** Update `tests/unit/public-api.test.ts` whenever an export changes.
- **JSDoc:** every function and type in `src/` gets a description, `@param`, `@returns` and `@example` (lint enforces this). API docs go on the exported type, not the implementation.
- **Public export shape:** never write `export const { a, b } = …`, because a destructured export loses its JSDoc in `.d.ts`. Use one documented `export const a = …` per export.
- **Errors:** use `BasaltError` with a code (§30). The message format is `[framework-id] Description. [E_CODE]\n  Actionable suggestion.`
- **Bundle budget:** 12 KB gzipped (`bun run size`).
- Shared tooling lives in the sibling `../ci` repo (`@basalt-js/ci`). Change lint, TS or CI settings there, not here.

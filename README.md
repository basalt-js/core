# @basalt-js/core

The Basalt kernel: a micro-kernel plugin framework for TypeScript, built for codebases that LLMs help write.

> **Status: M0 (scaffold).** The package builds, lints and tests, but exports nothing yet. M1 adds `defineFramework`, plugins, services, config and events.

## Design

[docs/basalt-design.md](docs/basalt-design.md) is the source of truth:

- **Part I:** how Moku core, the inspiration, actually works.
- **Part II:** the Basalt kernel.
- **Part V:** every decision made so far.

## Development

```sh
bun install
bun run check   # typecheck, lint, tests with coverage, build, package validation, size gate
```

| Script | Does |
|---|---|
| `bun run test` | Vitest projects: `unit`, `integration`, `types` |
| `bun run build` | tsdown → ESM + CJS + `.d.ts` in `dist/` |
| `bun run size` | Fails if `dist/index.mjs` is over 12 KB gzipped |
| `bun run validate` | `publint` + `attw` |

Shared tooling comes from [`@basalt-js/ci`](https://github.com/basalt-js/ci). For now it is linked from the sibling folder (`file:../ci`).

## License

MIT

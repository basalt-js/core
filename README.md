# @basalt-js/core

The Basalt kernel: a micro-kernel plugin framework for TypeScript, built for codebases that LLMs help write.

> **Status: M1 (kernel parity).** `defineFramework`, `definePlugin`, `defineService`, packs, config (defaults or Standard Schema), `emit`, and init/start/stop. Next: M2, lifecycle robustness (rollback, best-effort stop, timeouts, `signal`, disposal).

```ts
// framework (Layer 2)
const site = defineFramework("site", {
  config: { siteName: "Untitled" },
  events: { "page:render": event<{ path: string }>("A page finished rendering") }
});
export const definePlugin = site.definePlugin;

const routerPlugin = definePlugin("router", {
  config: { basePath: "/" },
  events: { "router:navigate": event<{ to: string }>("Route changed") },
  state: ({ config }) => ({ current: config.basePath }),
  api: ctx => ({
    navigate: (to: string) => {
      ctx.state.current = to;
      ctx.emit("router:navigate", { to });
    }
  })
});

const composed = site.compose({ plugins: [routerPlugin] });
export const createApp = composed.createApp;

// app (Layer 3)
const app = await createApp({ config: { siteName: "Blog" } });
await app.start();
app.router.navigate("/about");
await app.settled();
await app.stop();
```

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

# Basalt — Design Document

> **Status:** Draft 0.2 · 2026-10-30 (review decisions recorded in Part V); updated 2026-11-01 with O17 (port the Moku family)
> **Baseline analysed:** [`moku-labs/core`](https://github.com/moku-labs/core) at commit `f011a48` (2026-10-11), `package.json` version `1.5.0`.
> The §34 descriptions of the Moku family packages (common / web / worker / room) come from the docs bundled with the `moku` Claude Code plugin v0.60.0, not from their source. Since O17 those packages, and five more, are forked into `basalt-js` and their source is the starting point for each port.
> **Package names:** packages publish under the `@basalt-js` npm org, and repos live under `github.com/basalt-js` (O13).

## How to read this document

| Part | Contents | Status |
|---|---|---|
| **I — Moku core, reverse-engineered** | How Moku actually works, taken from the source and spec, plus the quirks and spec drift found along the way. | Descriptive. This is the reference baseline. |
| **II — Basalt kernel** | Basalt's kernel: what stays, what changes, and four new capabilities. | Proposed. **Decided** = agreed in review (Part V). **Decision** = a recommendation not yet reviewed. **Open** = unresolved. |
| **III — Basalt frameworks** | Layer-2 packages built on the kernel, ported from the Moku family (O17). | Outline. Each framework needs its own spec later. |
| **IV — Repo, tooling, delivery** | Toolchain, testing, and milestones. | Proposed. |
| **V — Decisions and open questions** | What was decided in review, and what is still undecided. | — |

**Ground rules already agreed:**

1. **Clean-slate API.** Moku is inspiration. Basalt does not need to stay compatible with it.
2. **Scope** is the kernel *and* the Layer-2 frameworks.
3. **Four additions** on top of the Moku baseline:
   - shared/global state
   - introspection and tracing
   - async init and awaitable events
   - lifecycle robustness
4. **Review decisions** (names, dependencies, events, repos, config schemas, packs, safety checks) are listed in Part V and marked **Decided** where they apply.

---

# Part I — Moku core, reverse-engineered

## 1. What Moku is

Moku is a **micro-kernel plugin framework for TypeScript** built for codebases that LLMs write. Its thesis is *constraints, not conventions*. The architecture has three layers, and each layer physically limits the one above it. Generated code is confined to plugins, which talk to each other only through typed APIs and typed events.

```
┌──────────────────────────────────────────────────────────┐
│ Layer 3  Consumer app     createApp(), createPlugin()    │  configure, compose, ship
├──────────────────────────────────────────────────────────┤
│ Layer 2  Framework        createCoreConfig + createCore  │  config shape, events, default plugins
├──────────────────────────────────────────────────────────┤
│ Layer 1  @moku-labs/core  2 runtime functions            │  zero domain knowledge
└──────────────────────────────────────────────────────────┘
```

The kernel does **six things and nothing else**:

1. Collect plugins into an ordered list.
2. Validate them: reserved names, duplicates, dependency presence and order.
3. Resolve config with a shallow merge, never a deep one.
4. Run three lifecycle phases: `onInit` → `onStart` → `onStop`. Stop runs in reverse order.
5. Dispatch strictly typed events with `emit`, fire-and-forget.
6. Freeze the app and all configs. Plugin state stays mutable.

The spec also states what Moku is **not**: a reactive UI framework, a streaming engine, a networking/sync engine, zero-overhead, or batteries-included.

## 2. Package facts

| Item | Value |
|---|---|
| Runtime exports | `createCoreConfig`, `createCorePlugin` |
| Public type exports | `PluginCtx`, `EmitFn`, plus declaration-emit types (`App`, `PluginInstance`, `CreateAppOptions`, `CoreConfigResult`, `CreateCoreResult`, `BoundCreatePluginFunction`, `RegisterFunction`, `CorePluginInstance`, …). These are exported only so downstream `.d.ts` files can name them (avoids TS4023). |
| Dependencies | Zero runtime deps. The README targets < 8 KB gzipped. |
| Build | `tsdown` emits ESM `.mjs` + CJS `.cjs` + `.d.mts`/`.d.cts`. `"sideEffects": false`. Checked with `publint` and `attw`. |
| Engines | node ≥ 24, bun ≥ 1.3.8. The repo develops on Bun 1.4.3. |
| TypeScript | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: Preserve`. CI typechecks and tests on TS 6.0 **and** TS 7.0. |
| Version labels | `package.json` says `1.5.0`, but README and CLAUDE.md still say "early release 0.1.x" (see §16). |

## 3. The factory chain

There are three steps, and each one captures types in a closure and hands them downstream:

```ts
// framework/config.ts — Step 1: bind Config + Events (+ core plugins)
export const coreConfig = createCoreConfig<Config, Events>("my-site", {
  config: { siteName: "Untitled", mode: "development" },
  plugins: [logPlugin, envPlugin],          // core plugins (optional)
  pluginConfigs: { log: { level: "warn" } } // core-plugin overrides (optional)
});
export const { createPlugin, createCore } = coreConfig;

// framework/plugins/router.ts — plugins import the BOUND createPlugin
export const routerPlugin = createPlugin("router", { /* spec */ });

// framework/index.ts — Step 2: bind default plugins
export const { createApp, createPlugin } = createCore(coreConfig, {
  plugins: [routerPlugin],
  pluginConfigs: { router: { basePath: "/" } },
  onReady: ({ config }) => {}, onError: (err, coreApis) => {}
});

// app/main.ts — Step 3: consumer
const app = createApp({ plugins: [blogPlugin], config: { siteName: "Blog" },
  pluginConfigs: { router: { basePath: "/blog" } }, onReady, onError, onStart, onStop });
await app.start(); app.router.navigate("/about"); await app.stop();
```

**Why three steps and not two.** Plugin files need a `createPlugin` that is bound to `Config`/`Events`, and the framework's index needs the plugins. If one call did both, `config.ts` and the plugin files would import each other. Splitting setup into Step 1 (`config.ts`) and Step 2 (`index.ts`) breaks that cycle.

Consumers never import `@moku-labs/core`. The Moku tooling treats a direct import as a blocker.

## 4. Source map

The line counts below include heavy JSDoc, because lint requires `@example` on every function and type in `src/`.

| File | Lines | Responsibility |
|---|---|---|
| `src/index.ts` | 45 | The only authority on the public surface. |
| `src/config.ts` | 129 | `createCoreConfig`: captures id, config defaults, and core plugins, validates the core plugins, and builds `createPlugin` + `createCore`. |
| `src/plugin.ts` | 959 | `createPlugin` type machinery (spec, context, event merging, `register`) plus runtime spec assertions. Returns `{ name, spec, _phantom, ...helpers }`. |
| `src/core-plugin.ts` | 391 | `createCorePlugin`: self-contained infrastructure plugins. |
| `src/core.ts` | 260 | `createCore` → `createApp`: merges plugin lists, validates, delegates to the kernel. |
| `src/app.ts` | 813 | **The kernel:** config resolution, state, event bus, context factories, app object, `start`/`stop`. |
| `src/types.ts` | 661 | Context tiers, `PluginInstance`, extraction/aggregate types, `App`, `CreateAppOptions`, `PluginCtx`. |
| `src/utilities.ts` | 330 | `UnionToIntersection`, `IsLiteralString`, `EmitFn`, plus validation (reserved names, duplicates, dependency order). |

## 5. The plugin spec

Every field is optional, and none of them takes an explicit generic. Everything is inferred from the spec object.

| Field | Shape | Receives | Notes |
|---|---|---|---|
| `config` | `C` (full default value) | — | `C` is inferred from it. Consumers override with `Partial<C>`. |
| `events` | `register => ({ "x:y": register<P>("desc") })` | `RegisterFunction` | **Type inference only — the kernel never calls it.** `register.map<EventMap>({...descs})` registers a whole map at once. |
| `depends` | `readonly PluginInstance[]` | — | Validation plus type plumbing only: dependency events become visible, and `require` is typed. No reordering. |
| `createState` | `ctx => S` | `{ global, config }` | Called once per app. This is the only mutable store. |
| `api` | `ctx => A` | full `PluginContext` | Mounted as `app[name]`. Must be sync. The spec says it must not emit. |
| `hooks` | `ctx => ({ "event": handler })` | full `PluginContext` | The handler map is keyed by known event names. Unknown keys fail to compile. |
| `onInit` | `ctx => void` | full `PluginContext` | Sync. Runs inside `createApp`. |
| `onStart` | `ctx => void \| Promise<void>` | full `PluginContext` | Runs during `app.start()` and is awaited sequentially. |
| `onStop` | `ctx => void \| Promise<void>` | `{ global, config, state }` | Runs during `app.stop()` in reverse order and is awaited sequentially. |
| `helpers` | `{ name: (...a) => r }` | — | Pure static functions **spread onto the plugin instance** (`routerPlugin.route(...)`), for use before `createApp`. |

**The instance** is a plain object: `{ name, spec, _phantom: {} as { config; state; api; events }, ...helpers }`. `_phantom` is never read at runtime. It exists only so the type system can carry information.

## 6. Core plugins (`createCorePlugin`)

Core plugins are self-contained infrastructure such as `log`, `env`, and storage.

- **Spec fields:** `config`, `createState({ config })`, `api({ config, state })`, `onInit`, `onStart`, `onStop`. They all receive `{ config, state }` only.
- **Forbidden fields:** `depends`, `events`, `hooks`. Including them is a runtime error. Core plugins also get no `global` config.
- **Registration:** they are passed to `createCoreConfig({ plugins })`.
- **API injection:** their APIs are injected **flat onto every regular plugin's context** (`ctx.log.info()`) and onto the app.
- **Config:** a 4-level merge: spec defaults → `createCoreConfig.pluginConfigs` → `createCore.pluginConfigs` → `createApp.pluginConfigs`.
- **Lifecycle:** they init and start before regular plugins, and stop after them.

## 7. Kernel algorithm — `createApp` (exact order from `core.ts` + `app.ts`)

1. `allPlugins = [...frameworkDefaults, ...consumerExtras]`. Consumers cannot remove defaults.
2. `validatePlugins` checks three things:
   - **Reserved names:** `start stop emit require has config global state __proto__ constructor prototype`.
   - **Duplicates.**
   - **Dependencies:** each `depends` entry must exist and must come earlier in the list, matched **by name**.
3. `checkCorePluginConflicts`: a regular plugin's name must not equal a core plugin's name.
4. `pluginNameSet` = core plugin names + regular plugin names.
5. **Global config:** `Object.freeze({ ...defaults, ...consumer.config })`.
6. **Core plugins**, in forward order: 4-level merge and freeze → `createState({config})` → `api({config,state})` → `onInit({config,state})`. Core APIs go into `coreApis` and into the shared `apis` map.
7. **Regular plugin configs:** a 3-level merge (spec → framework → consumer), then freeze.
8. **States:** `createState({ global, config })`, or `{}` if absent.
9. **Error handler:** `combinedOnError` calls the framework `onError(err, coreApis)` (guarded) and then the consumer `onError(err, callbackCtx)`.
10. **Event bus:** `hookMap: Map<event, handler[]>`.
11. **Hooks registered** for every plugin in forward order: `hooks(ctx)` is called and its handlers are appended. *This happens before any regular API exists* (see §16 Q1).
12. **APIs built** in forward order: `apis.set(name, api(ctx))`.
13. **`onInit`** in forward order, synchronously. The return value is ignored.
14. Framework `onReady({ config })`, then consumer `onReady(callbackCtx)`.
15. `buildApp`: `{ start, stop, emit, require, has, ...all APIs }` → `Object.freeze`.

A fresh `ctx` object is built for every call, but `state` is the same reference each time.

## 8. `start()` / `stop()`

- **`start()`** throws if `started` is already true. It runs `onStart` for core plugins, then regular plugins, in forward order, awaiting each one. Then it runs the consumer `onStart(callbackCtx)` and sets `started = true` only at the very end. **There is no rollback.**
- **`stop()`** throws if `!started`. It runs regular plugins' `onStop({ global, config, state })` in reverse, then core plugins' `onStop({ config, state })` in reverse, then the consumer `onStop(callbackCtx)`. It does not reset `started`. The first error propagates, and the remaining plugins are not stopped.
- **Supported usage** is `createApp → start? → stop?`. Anything else (repeat calls, concurrent calls, recovering after a failure) is explicitly outside the contract.

## 9. Context tiers

| Tier | Used by | Contents |
|---|---|---|
| `MinimalContext` | `createState` | `global`, `config` |
| `PluginContext` | `api`, `hooks`, `onInit`, `onStart` | `global`, `config`, `state`, `emit`, `require`, `has`, plus core APIs flat |
| `TeardownContext` | `onStop` | `global`, `config`, `state` (no communication, no core APIs) |
| `CorePluginContext` | all core-plugin methods | `config`, `state` |
| `AppCallbackContext` | consumer `onReady`/`onStart`/`onStop`/`onError` | `config`, `emit`, `require`, `has`, plus all plugin APIs |

- **`require(pluginInstance)`** accepts an instance only, never a string. It returns the fully typed API or throws, and it is *not* restricted to declared `depends`.
- **`has(name)`** is string-based and returns a boolean.

## 10. Events

- **Sources.** A plugin sees the merge `Events & PluginEvents & DepsEvents<Deps>`:
  - **Global:** the `Events` generic on `createCoreConfig`.
  - **Own:** the plugin's `events`.
  - **Dependencies:** the events of plugins it lists in `depends`, **direct dependencies only (non-transitive)**.
- **Strict emit.** Unknown names and wrong payloads are compile errors, and there is no untyped overload. A framework that wants open events sets `Events = Record<string, unknown>`.
- **Dispatch semantics** (`buildEventBus`):
  - `emit` calls `void dispatch(name, payload)` and is **fire-and-forget**.
  - `dispatch` is `async` and walks the handlers in registration (plugin) order, awaiting each one.
  - Because an `async` function runs synchronously until its first `await`, **the first handler runs synchronously inside `emit()`** and the rest run on later microtasks.
- **Errors.** A throwing handler is reported to `combinedOnError`, and dispatch moves on to the next handler. Errors thrown by the error handlers themselves are discarded. **With no `onError` at either layer, hook errors are silently swallowed.**
- **No barrier.** `createApp()` and `start()` do not wait for async hook work that they triggered.
- **Not in the kernel:** middleware and pipelines. The spec's pattern is an `api.use(fn)` that pushes into plugin state.

## 11. Config

- **Shallow merge only**, at every level. Nested objects are replaced wholesale.
- **Defaults must be complete.** `config` declares the full `C`, every `pluginConfigs` entry is optional `Partial<C>`, and plugins without `config` are excluded from `pluginConfigs`.
- **"Required" values** use a sentinel default (such as `""`) plus a runtime check in `onInit`.
- **Freezing.** All resolved configs are frozen, and the global config is frozen.

## 12. Type-system techniques (Moku's real IP)

These are the parts most worth reusing.

1. **Closure-bound generics.** `Config`/`Events` are bound once in Step 1, so plugin authors never repeat them.
2. **`const` type parameters.** `const PluginName extends string`, `const Plugins extends readonly AnyPluginInstance[]`, and `const ExtraPlugins` keep names as literals and arrays as tuples without `as const`.
3. **Phantom field.** `_phantom: {} as {config; state; api; events}` carries types at zero runtime cost. `ExtractApi`/`ExtractEvents`/`ExtractName`/`ExtractConfig` pull them back out.
4. **Register callback.** `events: register => ({...register<T>()})` lets TypeScript infer the event map without explicit generics.
5. **HookHandlerMap trick.** The *return keys* of `hooks()` are inferred as a separate generic and each key is mapped to `never` unless it is a known event. That rejects unknown hook names even when they are mixed with valid ones.
6. **`UnionToIntersection`.** Used twice:
   - to merge dependency event maps;
   - to turn an event map into overloaded call signatures (`EmitFn<E>`), so extracted domain files can type `emit` without a generic `K` that would fail assignability.
7. **`IsLiteralString` filter.** Plugins with a non-literal `string` name are dropped from `App`/`pluginConfigs`, which avoids index-signature pollution. Plugins with an empty API (`Record<string, never>`) are dropped from the `App` surface.
8. **Identity defaults.** Defaults are `{}` / `Record<never, never>`, never `Record<string, never>`, because the latter's string index turns intersected keys into `never`.
9. **`PluginLike` structural type.** Used in constraint positions to sidestep variance errors that `PluginInstance<string, any…>` causes.
10. **Helpers as an intersection.** The return type is `PluginInstance<…> & Helpers` rather than a sixth generic. The intersection widens away in `depends`/`plugins` arrays.
11. **Known inference hazard.** An unannotated `register => …` is *context-sensitive*, so TypeScript defers it and checks a pre-typed `api` factory against an **empty** own-event map. The workaround is to annotate `register: RegisterFunction` or wrap the factory as `api: ctx => createApi(ctx)` (spec 14 §10 row 8, `tests/sandbox/pretyped-factory-events.test.ts`).
12. **Named return types.** Every type that appears in a public return position is exported, which keeps declaration emit working (`isolatedDeclarations`, TS4023).

## 13. Validation and errors

The format is `[<framework-id>] <description>.\n  <actionable suggestion>.` Validation errors are `TypeError`s and lifecycle errors are `Error`s.

**`createPlugin` and `createCorePlugin` validate:**
- the name is a non-empty string;
- the spec is an object;
- `api`, `createState`, `onInit`, `onStart`, `onStop`, `events`, `hooks` are functions when present;
- `helpers` is an object of functions whose keys don't collide with `name`/`spec`/`_phantom`.

`createCorePlugin` also rejects `depends`, `events`, and `hooks`.

**`createApp` validates** reserved names, duplicates, dependency presence and order, and core/regular name conflicts.

**At runtime** the kernel throws for `require` of an unregistered plugin (three message variants: plugin, app, callback), `start()` twice, and `stop()` before `start()`.

## 14. Conventions (outside the kernel, but part of the product)

**Plugin tiers** (spec 15):

| Tier | Size | Layout |
|---|---|---|
| Nano | < 30 lines | `index.ts`, `README.md`, `__tests__/unit/` |
| Micro | 30–80 lines | `index.ts`, `README.md`, `__tests__/unit/` |
| Standard | Any domain function > 20 lines | `index.ts` (~30-line wiring harness), `types.ts`, `state.ts`, `api.ts`, `handlers.ts`, `helpers.ts` |
| Complex | Sub-domains | Adds subfolders such as `providers/` or `transforms/` (one barrel level max) |
| Very complex | Coupled modules | Module dirs (`content/`, `media/`, …), each with `types/state/api`. Namespaced API (`app.cms.content.create()`), composed state, the plugin owns all events. |

**File contracts:**
- `index.ts` only wires. It holds no logic and no types.
- `state.ts` exports `create<Name>State`, has no side effects, and never emits.
- `api.ts` exports `create<Name>Api` and does no init and no I/O.
- `handlers.ts` holds thin dispatchers.
- Plugins never import each other's internals. They import instances only, for `depends`.

**JSDoc:**
- Lint requires description, `@param`, `@returns`, and `@example` on everything in `src/`.
- API docs go on the exported `XxxApi` type members, because implementation JSDoc never reaches the `.d.ts`.
- **Public export shape:** never `export const { createApp } = createCore(...)`. A destructured binding loses its JSDoc in emitted `.d.ts`, so use `export const createApp = framework.createApp` with its own doc block.

**Tests** use Vitest projects:
- `unit`;
- `integration` (real `createApp`);
- `sandbox` (realistic multi-plugin frameworks plus type tests via `expectTypeOf` and `@ts-expect-error`).

Per plugin: `__tests__/unit/*.test.ts` (flat) and `__tests__/integration/<plugin>.test.ts`. Coverage thresholds are 90%.

**LLM surface:**
- `llms.txt` (~10 KB) and `llms-full.txt` (~31 KB) at the repo root.
- A ready-made "system prompt fragment" (spec 12 §5) that teaches the whole API in under ~1000 tokens.

## 15. Tooling and release

- **Bun:** exact-pinned installs.
- **Lint:** Biome (format + lint) plus ESLint (`jsdoc`, `sonarjs`, `unicorn`, `consistent-type-imports`).
- **Lefthook pre-commit:** build + `publint` + `attw`, Biome, ESLint, and all three test projects.
- **CI:** a matrix over TS 6.0 and 7.0.
- **Release:** auto-release a patch on every merge to `main` through the internal `@moku-labs/ci` (`moku-release`). Dependabot updates `@moku-labs/*` with auto-merge.

## 16. Findings: quirks, gaps, and spec drift

> These come from **reading the source** at `f011a48`. I couldn't execute probe scripts in this session, so treat the runtime behaviours as source-derived and confirm them with a test when you port them. Each row links to how Basalt answers it.

| # | Finding | Evidence | Basalt |
|---|---|---|---|
| Q1 | `hooks(ctx)` runs **before any regular API is built**. Calling `ctx.require(x)` eagerly in the hooks factory body returns a frozen `{}` instead of x's API. It works lazily, inside handlers. | `app.ts` kernel steps 8b→9. `createRequire` returns `EMPTY_API` for registered names that have no API yet. | §32: build APIs first, then hooks |
| Q2 | During `api()`, `require`-ing a registered plugin whose API isn't built yet (a later plugin, or itself) **silently returns `{}`**. A method call on it then fails with a confusing `TypeError`. | `createRequire` | §24: `E_NOT_READY` |
| Q3 | `onInit` is typed `=> void`, so TypeScript accepts an `async` function. The kernel ignores the returned promise, so a rejection becomes an unhandled rejection and `createApp` returns before the init work finishes. | `kernel` step 10 | §27: async init |
| Q4 | If `start()` fails: `started` stays `false`, so `stop()` throws "not started" and the plugins that already started **cannot be torn down**. Calling `start()` again **re-runs `onStart`** on everything, including plugins that already started. | `buildApp.start` | §27: rollback |
| Q5 | `stop()` never flips state: calling it twice runs every `onStop` twice, and `start()` after `stop()` throws "already started". The first `onStop` error aborts the rest of teardown. | `buildApp.stop` | §27: state machine, best-effort stop |
| Q6 | The consumer `onStop` runs **after** every plugin and core plugin has stopped, yet its context exposes all plugin APIs. | `buildApp.stop` | §27: app callbacks stop first |
| Q7 | `events()` is **never called**. The descriptions passed to `register("…")` are unavailable at runtime, so there is no event catalog, even though spec 14 §5 lists "carries runtime metadata" as a benefit. | `plugin.ts` §6 docs; only `assertValidEvents` touches it | §28: catalog |
| Q8 | With no `onError` at either layer, hook errors are **silently discarded**. | `buildEventBus` | §25: default reporter |
| Q9 | `emit()` runs the first handler synchronously and later handlers asynchronously. Nested emits interleave, there is no way to await completion, and nothing records which plugin emitted. | `buildEventBus` | §25, §29 |
| Q10 | `app.emit` is typed with **global** events only, so a consumer cannot emit plugin events from the app at the type level. The runtime accepts any string. | `App` type | §25 |
| Q11 | `depends` is checked **by name**, so a different instance with the same name satisfies it. Plugin instances and specs are **not frozen**; only the app and configs are. | `checkDependencyOrder`, `createPluginFactory` | §30 |
| Q12 | `createCore({ pluginConfigs })` is typed `Record<string, unknown>`, so **framework-level plugin overrides aren't type-checked**. Only the consumer's are. | `CreateCoreOptions` | §23 |
| Q13 | Default-plugin order problems surface only when `createApp` is called, not when the framework is assembled. | `core.ts` validates inside `createApp` | §30: validate at `compose` |
| Q14 | If two plugins declare the same event name with different payloads, the payload silently collapses to `never` at the type level. There is no runtime check. | `type-gaps.test.ts` "conflicting payload types" | §25: namespacing + `E_EVENT_CONFLICT` |
| Q15 | The framework's `onReady` gets only `{ config }`, the framework has no `onStart`/`onStop`, and its `onError` gets core APIs only. | `CreateCoreOptions` | §23 |
| Q16 | Plugin names may contain any characters (the tests use `"b-events"`), which forces `app["b-events"]`. `Object.prototype` keys other than `__proto__`/`constructor` (such as `toString`) are not reserved. | `RESERVED_NAMES` | §30 |

**Spec drift** (the docs disagree with the code):

- **`onStop` context.** Spec 11 §1.11's prose and spec 06 §8's example say `onStop` gets "only `global`". The code, and the table in 11 §1.11, give `{ global, config, state }`.
- **Async `onInit`.** Spec 11 §1.12 says "Plugin A's `onInit` resolves before Plugin B's `onInit` begins", which implies async. In the code `onInit` is sync.
- **Name-conflict errors.** The core/regular name-conflict and core-duplicate messages in spec 11 §1.17 don't match the code's wording.
- **Reserved names.** Spec 06 §2's reserved-name list omits `global` and `state`.
- **Export count.** "One export at Layer 1" (spec README, 01 §3, and the `config.ts` header) is stale. There are now two runtime exports.
- **Version labels.** README and CLAUDE.md say `0.1.x`, `package.json` says `1.5.0`, and the `TeardownContext` comments mention "1.6".

---

# Part II — Basalt kernel

## 17. Goals and non-goals

**Goals:**

- **G1:** Keep Moku's *constraint model*: layered guardrails, inference-only authoring, strict events, frozen contracts, and explicit order.
- **G2:** Fix every Part I §16 finding by design, not by documentation.
- **G3:** Add the four capabilities: shared state, introspection + tracing, async init + awaitable events, and lifecycle robustness.
- **G4:** Keep the kernel small: zero runtime deps, runs on Bun / Node ≥ 24 / browsers / edge workers, target **≤ 12 KB gzipped**.
- **G5:** Keep the whole API learnable from one prompt fragment of about 1500 tokens (Appendix B).

**Non-goals** (unchanged from Moku):
- topological sorting;
- deep merging;
- DI containers, classes, or decorators;
- reactive UI, streaming, or networking inside the kernel;
- letting consumers remove framework defaults.

## 18. What Basalt keeps from Moku (non-negotiable)

1. **Three layers.** Consumers import only from a framework, never from `@basalt-js/core`.
2. **Two-step framework definition** (define → compose). It is required to break the `config.ts` ↔ plugin-file import cycle.
3. **Plugins are plain objects.** APIs are closures over private mutable state. Configs are frozen.
4. **Order is explicit.** Array order is init/start order, and stop runs in reverse. `depends` only validates.
5. **Zero explicit generics** on plugin definitions.
6. **Strict events.** No untyped emit.
7. **Phase-appropriate context tiers.**
8. **Shallow config merge** with optional `Partial` overrides. Defaults come from a complete default object *or* from a schema (§21.1).
9. **Error format** `[id] description.\n  suggestion.`
10. **Moku's conventions:** tiers, file contracts, JSDoc contract, public export shape, test layout, `llms.txt`.

## 19. API at a glance

```ts
// ── Layer 2 · framework/src/config.ts ──────────────────────────────────────
import { defineFramework, event } from "@basalt-js/core";
import { logService, envService } from "@basalt-js/std";

type Mode = "development" | "production";

const site = defineFramework("site", {
  config: { siteName: "Untitled", mode: "development" as Mode },
  events: {
    "page:render": event<{ path: string; html: string }>("A page finished rendering"),
    "page:head":   event.collect<{ path: string }, HeadTag[]>("Contribute <head> tags"),
  },
  shared: {
    initial: () => ({ locale: "en" }),
    actions: { setLocale: (s, locale: string) => { s.locale = locale; } },
  },
  services: [envService, logService],
});

/** Define a plugin for the `site` framework. Types are inferred from the spec. */
export const definePlugin = site.definePlugin;
export { event };
export { site };

// ── Layer 2 · framework/src/plugins/router/index.ts ─────────────────────────
export const routerPlugin = definePlugin("router", {
  config: { basePath: "/" },
  events: { "router:navigate": event<{ from: string; to: string }>("Route changed") },
  depends: [rendererPlugin],
  state: ({ config }) => ({ current: config.basePath }),
  api: ctx => ({
    navigate: (to: string) => {
      const from = ctx.state.current;
      ctx.state.current = to;
      ctx.emit("router:navigate", { from, to });
    },
    current: () => ctx.state.current,
  }),
  hooks: ctx => ({ "page:render": ({ path }) => ctx.log.debug("rendered", { path }) }),
  onInit:  async ctx => { /* load / validate; may await (§27) */ },
  onStart: async ctx => { /* acquire resources; ctx.signal for cancellation */ },
  onStop:  async ctx => { /* release; reverse order */ },
  helpers: { route: (path: string, view: string) => ({ path, view }) },
});

// ── Layer 2 · framework/src/index.ts ───────────────────────────────────────
const composed = site.compose({ plugins: [rendererPlugin, routerPlugin] });
/** Create a `site` app. Resolves when every plugin has initialised. */
export const createApp = composed.createApp;
/** Synchronous variant; rejects plugins whose `onInit` is async. */
export const createAppSync = composed.createAppSync;

// ── Layer 3 · app/main.ts ──────────────────────────────────────────────────
const app = await createApp({
  plugins: [blogPlugin],
  config: { siteName: "My Blog" },
  pluginConfigs: { router: { basePath: "/blog" } },
  tracer: devTracer(),
});
await app.start();
app.router.navigate("/about");
await app.settled();          // all in-flight event work finished
console.log(app.inspect());   // manifest: plugins, events, listeners, status
await app.stop();             // idempotent; also `await using app = ...`
```

### Moku → Basalt mapping

| Moku | Basalt | Why |
|---|---|---|
| `createCoreConfig<Config, Events>(id, { config, plugins, pluginConfigs })` | `defineFramework(id, { config, events, shared, services, serviceConfigs })` | Events are declared as **values** (runtime catalog, no generic). Config type is inferred. Adds shared state. |
| `createCore(coreConfig, opts)` | `framework.compose(opts)` | Drops the redundant `coreConfig` argument. Typed `pluginConfigs` (Q12). Validates defaults early (Q13). |
| `createApp()` (sync) | `await createApp()` / `createAppSync()` | Async init (§27). |
| `createPlugin` | `definePlugin` | `define*` = declaration, `create*` = instance. Consistent naming. |
| `createCorePlugin` (core plugin) | `defineService` (service) | "Core plugin" vs "plugin" confused readers. Services are infrastructure injected flat on `ctx`. |
| `createState` | `state` | Shorter, and reads like the value it produces. |
| `events: register => ({ "a:b": register<T>("d") })` | `events: { "a:b": event<T>("d") }` | Not context-sensitive, so the inference hazard (§12.11) disappears. Readable without calling anything (catalog). |
| `register.map<E>({…})` | `event.map<E>({…})` | Same idea. |
| `ctx.require(p)` (any plugin) | `ctx.get(p)` (declared deps only) + `ctx.find(p)` (optional deps) | Enforces explicit dependencies (§24). Avoids the CommonJS `require` association. |
| `ctx.has("name")` | `ctx.has(p \| "name")` | Typed when given an instance. |
| `ctx.emit` | `emit` / `dispatch` / `collect` / `pipe` | Awaitable and value-returning events (§25). |
| `ctx.global` (config) | `ctx.global` + `ctx.shared` | Shared state (§26). |
| `start` / `stop` | + `status`, `settled()`, `inspect()`, `[Symbol.asyncDispose]` | Robustness and introspection. |
| `PluginCtx<C, S, E>` | `PluginCtx<{ config; state; events; depends? }>` | A named-field generic: no positional mistakes, and it can carry deps. |

**Decided (O1):** these names are adopted. Packages publish as `@basalt-js/*` (O13).

## 20. `defineFramework` (Layer 2, step 1)

```ts
defineFramework(id: string, options: {
  config: GlobalConfig | StandardSchema;      // complete defaults or a schema (§21.1)
  events?: EventCatalog;                      // { "domain:action": event<P>("…") }
  shared?: { initial: () => S; actions: Record<string, (s: S, ...args) => void> };
  services?: readonly ServiceDefinition[];    // ordered; may depend on earlier services
  serviceConfigs?: { [service]?: Partial<ServiceConfig> };
}): Framework
```

Returns `{ id, definePlugin, compose, pack }`. **The returned object is frozen.**

- **Validation at call time:** id format, service names and order, and the event catalog (names, kinds, duplicates).
- **Widening config types.** Config types are inferred from the defaults. To widen a field, cast it in place (`"development" as Mode`) or annotate a `const` first.

**Decided (O2):** both forms are supported. Inference is the default. Writing the type explicitly uses a curried call, so the remaining types are still inferred:

```ts
defineFramework("site", { config: { mode: "development" as Mode } });       // inferred
defineFramework<SiteConfig>()("site", { config: { mode: "development" } }); // checked against SiteConfig
```

## 21. `definePlugin`

| Field | Receives | Change from Moku |
|---|---|---|
| `config` | — | A complete default object (as in Moku) **or a Standard Schema** such as `z.object({...})` (§21.1). |
| `events` | — | A plain object of `event*()` descriptors. **Keys must be `` `${pluginName}:${string}` ``**, enforced in types and at runtime (`E_EVENT_NAMESPACE`). Collisions become impossible by construction (fixes Q14). |
| `depends` | — | Required deps, validated **by identity** and order. |
| `optionalDepends` | — | **New.** If present they must come earlier, accessed with `ctx.find(p)`. They also add the dependency's events to the type surface. |
| `state` | `{ global, config, services… }` | Renamed from `createState`. Services are now visible, because they are fully initialised first. |
| `api` | `PluginContext` (wiring) | Must be sync. Emitting **throws** `E_EMIT_DURING_WIRING`. `get()` of a dependency that isn't built yet throws `E_NOT_READY` (fixes Q2). |
| `hooks` | `PluginContext` | Runs **after all APIs exist** (fixes Q1). Handler signatures depend on the event kind (§25). |
| `onInit` | `PluginContext` | **May be async** and is awaited sequentially (§27). For *loading and validating*, not for acquiring resources. |
| `onStart` | `PluginContext` + `signal` | Acquire resources. A failure triggers rollback (§27). |
| `onStop` | `TeardownContext` + `signal` | Release resources. Best-effort (§27). |
| `helpers` | — | Same as Moku: pure static functions merged onto the definition. |

**Definitions** are deep-frozen `{ kind: "plugin", framework, name, spec, catalog, _phantom, ...helpers }`. `catalog` is the normalised event list, so tooling can read it without building an app. `framework` is the id of the framework whose `definePlugin` created it; apps reject plugins from another framework (`E_FOREIGN_PLUGIN`).

**Name rule:** `^[a-z][A-Za-z0-9]*$`, which keeps every name a valid property for `app.name`. The name must not be reserved (§30).

### 21.1 Config: defaults or a schema (O10, decided)

`config` takes either a complete default object, as in Moku, or any **Standard Schema**. Standard Schema is a small shared interface (the `~standard` property) that Zod, Valibot, ArkType and other libraries implement. The kernel copies the interface's type definitions, so it still has zero runtime dependencies.

```ts
import { z } from "zod";

export const analyticsPlugin = definePlugin("analytics", {
  config: z.object({
    trackingId: z.string().min(1),                    // no default → the app must provide it
    sampleRate: z.number().min(0).max(1).default(1),
    endpoint:   z.string().url().default("https://collect.example.com"),
  }),
  api: ctx => ({ track: (name: string) => send(ctx.config.endpoint, ctx.config.trackingId, name) }),
});

// app
const app = await createApp({ pluginConfigs: { analytics: { trackingId: "G-123" } } });
```

**How a schema config is resolved:**

1. Shallow-merge the overrides, framework first, then the app: `{ ...composeOverride, ...appOverride }`.
2. Run `schema["~standard"].validate(merged)`. The schema fills in its own defaults and runs any transforms.
3. If there are issues, `createApp` rejects with `E_CONFIG_INVALID`, naming the plugin and listing each issue's path and message.
4. Freeze the output. That output is `ctx.config`.

**Types:** `ctx.config` is the schema's *output* type, and `pluginConfigs.analytics` is `Partial` of its *input* type.

**Decided (O15):** when a schema has fields without defaults, the plugin's key in `pluginConfigs` becomes **required** in the `createApp` types (unless the framework already supplies those fields in `compose`). A missing value is then a compile error, with `E_CONFIG_INVALID` as the runtime backstop. Prototype the error message in M1 and make sure it names the missing field.

**What this replaces:** Moku's "sentinel default plus a check in `onInit`" pattern. A field without a default is simply required.

**Other rules:**
- The same applies to the global config in `defineFramework` and to service configs.
- Validation can be async. `createApp` awaits it, and `createAppSync` throws `E_ASYNC_INIT` if `validate` returns a promise.
- Validation always runs, even with `checks: "minimal"`, because it produces the config.
- Merging is still shallow: an override of a nested object replaces it whole, and the schema then re-applies nested defaults.
- `inspect()` lists config keys, not schemas.

## 22. `defineService`

Services keep Moku's core-plugin model with three deliberate relaxations:

| | Moku core plugin | Basalt service |
|---|---|---|
| Context | `{ config, state }` | `{ global, config, state, …earlier services }` |
| Depends on other services | ✗ | ✓, via `depends: [envService]`. Must be listed earlier, validated by identity. |
| Events and hooks | ✗ | ✗ (unchanged; services stay below the event graph) |
| Visible in plugin `onStop` | ✗ | ✓, because services stop after plugins and are still alive |
| Config merge | 4 levels | 4 levels: spec → `defineFramework.serviceConfigs` → `compose.pluginConfigs` → `createApp.pluginConfigs`. The spec's config may be a schema (§21.1). |

## 23. `compose` and `createApp`

```ts
framework.compose({
  plugins: readonly (PluginDefinition | Pack)[];    // framework defaults (validated NOW)
  pluginConfigs?: TypedOverrides<Plugins | Services>; // typed (fixes Q12)
  tracer?: Tracer;
  lifecycle?: { initTimeoutMs?; startTimeoutMs?; stopTimeoutMs? };
  checks?: "full" | "minimal";                     // runtime guard level (default "full"; createApp can override)
  contextStore?: ContextStore;                      // async causality for tracing (§29)
  onReady? / onStart? / onStop?: (ctx: AppContext) => void | Promise<void>;  // full context (fixes Q15)
  onError?: (error: BasaltError, ctx: AppContext) => void;
}) => { createApp, createAppSync }

createApp(options?: {
  plugins?: readonly (PluginDefinition | Pack)[];    // appended after defaults
  config?: Partial<GlobalConfig>;
  pluginConfigs?: TypedOverrides<…>;
  tracer?: Tracer;                                   // fans out with the framework tracer
  lifecycle?: …; checks?: …;
  onReady? / onStart? / onStop? / onError?: …;
}) => Promise<App>
```

**The `App` object** (frozen):

| Member | What it is |
|---|---|
| `start()`, `stop()` | Lifecycle (§27). |
| `status` | Getter for the current state (§27). |
| `settled()` | Resolves when no event work is in flight (§25). |
| `emit`, `dispatch`, `collect`, `pipe` | Typed with **every** event in the app: global + all plugin events (fixes Q10). |
| `get(p)`, `find(p)`, `has(p \| name)` | Unrestricted for consumers. |
| `shared` | `{ state, actions }` (§26). |
| `inspect()` | The manifest (§28). |
| `[Symbol.asyncDispose]` | Stops the app if it is running. |
| `[pluginName]`, `[serviceName]` | Plugin and service APIs. |

**Safety checks (O12, decided).** `checks` is `"full"` by default. A framework can set it in `compose`, and an app can override it in `createApp`; the app's value wins. `"minimal"` skips only the runtime checks that cost speed: unknown-event and event-kind checks, and the shared-state write trap. Name, dependency and framework checks, plus config-schema validation, always run.

## 24. Context tiers

| Tier | Used by | Contents |
|---|---|---|
| `StateContext` | plugin `state` | `global`, `config`, services |
| `WiringContext` | `api` factory | `global`, `config`, `state`, `shared`, `get`/`find`/`has`, services; `emit*` present but throws until wiring ends |
| `PluginContext` | `hooks`, `onInit`, `onStart`, handlers, API method bodies | everything above plus working `emit`/`dispatch`/`collect`/`pipe`; `onStart` also gets `signal` |
| `TeardownContext` | `onStop` | `global`, `config`, `state`, services, `signal` |
| `ServiceContext` | service methods | `global`, `config`, `state`, earlier services |
| `AppContext` | framework and consumer callbacks | `global`, `shared`, `emit*`, `get`/`find`/`has`, all plugin and service APIs |

**`get` rules** (enforced in types and at runtime):

| Call | Result |
|---|---|
| `ctx.get(p)` where `p` is in `depends` | Its API. |
| `ctx.get(p)` where `p` is not declared | `E_UNDECLARED_DEPENDENCY`. |
| `ctx.find(p)` where `p` is in `optionalDepends` | Its API, or `undefined`. |
| A dependency whose API isn't built yet (only possible inside `api()`) | `E_NOT_READY`, with a hint to call `get` lazily. |

**Decided (O3):** `get` is restricted to declared deps. Moku's `require` reaches any plugin, which makes `depends` advisory and the dependency graph in tooling incomplete.

## 25. Events: four modes

Each event is declared once with a **kind**:

```ts
event<P>(description?)              // notify  — fire-and-forget or awaited broadcast
event.collect<P, R>(description?)   // collect — every handler returns R; caller gets R[]
event.pipe<T>(description?)         // pipe    — handlers transform T in order; caller gets final T
event.map<Map>(descriptions?)       // bulk notify declarations from a pre-declared type
```

| Call | Event kinds | Returns | Semantics |
|---|---|---|---|
| `emit(name, p)` | notify | `void` | Fire-and-forget. The dispatch is **queued as a microtask** (no handler runs inside `emit()`, which fixes the half-sync behaviour in Q9). It is tracked for `settled()`. Each failing handler is reported to `onError` as `E_HANDLER_FAILED` (with the plugin and `cause`), and the remaining handlers still run. |
| `await dispatch(name, p)` | notify | `DispatchResult` | Runs every handler sequentially in plugin order. If any handler fails, it still runs the rest, then **rejects** with `E_DISPATCH_FAILED` (an `AggregateError` with per-plugin causes). It does not call `onError`, because the caller owns the failure. |
| `await collect(name, p)` | collect | `R[]` | Handlers run sequentially. Results come back in plugin order. Errors behave as in `dispatch`. |
| `await pipe(name, v)` | pipe | `T` | Each handler receives the previous handler's output. If a handler throws, the pipe rejects. This replaces Moku's hand-rolled `api.use(fn)` middleware pattern. |

**Hook handler types** follow the kind:

| Kind | Handler type |
|---|---|
| notify | `(p) => void \| Promise<void>` |
| collect | `(p) => R \| Promise<R>` |
| pipe | `(v: T) => T \| Promise<T>` |

Calling a mode against the wrong kind is a compile error, and a runtime `E_EVENT_KIND` under full checks.

**Visibility** (unchanged from Moku): global + own + **direct** `depends`/`optionalDepends`. Not transitive.

**Runtime catalog checks.** Because the catalog exists at runtime:
- `emit` of an undeclared name throws `E_UNKNOWN_EVENT` (under `checks: "full"`), which covers JS consumers and `as any`;
- `hooks` keys that aren't in the plugin's visible catalog fail at `createApp`;
- duplicate declarations fail with `E_EVENT_CONFLICT`.

**Intrinsic events** use the reserved `basalt:` namespace, which plugins may hook:
- `basalt:shared` — `{ action, source }`
- `basalt:status` — `{ from, to }`

**Default error reporting.** If nobody passes `onError`, errors go to `console.error` and are never silently swallowed (fixes Q8).

**`settled()`.** The kernel keeps a `Set` of in-flight dispatch promises, and `settled()` loops `Promise.allSettled` until the set is empty. Tests use it, and so does `stop()`, as a bounded barrier.

**Decided (O4):** `collect` and `pipe` belong in the kernel. Every Moku framework re-implements "contribute X" and "transform X" through `api.use()` + state arrays. Making them event kinds gives typing, ordering, tracing, and catalog entries for free.

## 26. Shared state

```ts
defineFramework("site", {
  shared: {
    initial: () => ({ locale: "en", user: null as User | null }),
    actions: {
      setLocale: (s, locale: string) => { s.locale = locale; },
      signIn:    (s, user: User)     => { s.user = user; },
    },
  },
});

ctx.shared.state.locale;              // DeepReadonly<S> view
ctx.shared.actions.setLocale("de");   // the only way to write
```

**Rules:**

1. **Framework-owned.** Only `defineFramework` declares shared state, like global config. Consumer apps that need shared data write a plugin with an API, as in Moku.
2. **Per app instance.** It is created inside `createApp` and is never module-level, so multiple apps, tests, and worker isolates stay independent.
3. **Writes only through actions.**
   - Actions are **synchronous**; async work happens in plugin APIs before an action is called.
   - After each action the kernel emits `basalt:shared` `{ action, source }`, attributing the plugin that called it, and writes a trace record.
4. **Reads are type-readonly.** The view is typed `DeepReadonly<S>`. Under `checks: "full"` it is a write-trapping `Proxy` that throws `E_SHARED_READONLY`. Under `"minimal"` the raw object is returned at zero cost.
5. **Plugin state stays private.** Shared state is for genuinely app-wide facts (locale, auth identity, feature flags, theme). It does not replace plugin APIs.
6. **Not for request-scoped data.** A worker isolate serves concurrent requests, so request data belongs in call arguments or a scope (§O7).

**Decision:** actions over a free mutable object. Without that constraint shared state becomes a global-variable dumping ground, which is exactly what Moku's design avoids. Actions give a single write path, attribution, and change events.

## 27. Lifecycle

### 27.1 States

```
createApp() ──► initializing ──► ready ──start()──► starting ──► running ──stop()──► stopping ──► stopped
                     │                                 │
                     └─ init error: createApp rejects  └─ start error ──► rollingBack ──► failed
```

`app.status` is one of `"ready" | "starting" | "running" | "stopping" | "stopped" | "rollingBack" | "failed"`. The `initializing` state is never observable, because no app object exists until init succeeds.

### 27.2 Init (inside `createApp`)

1. Run services' `onInit`, then plugins' `onInit`, in forward order, **each awaited**.
2. Then the framework `onReady`, then the consumer `onReady`.

**Contract:** `onInit` is for loading, validating, and wiring. Anything that must be released belongs in `onStart`/`onStop`. If init fails, `createApp` rejects, there is nothing to roll back, and no app is returned.

`createAppSync()` runs the same steps but throws `E_ASYNC_INIT` if any `onInit` returns a thenable. It attaches a catch so the stray promise can't become an unhandled rejection. Use it where top-level `await` isn't available.

**Decided (O5):** `createApp` is async by default. Making it async means TypeScript *forces* `await` (properties don't exist on `Promise<App>`), whereas a sync `createApp` plus `app.ready` makes it easy to use APIs before init finishes.

### 27.3 `start()`

| State when called | Behaviour |
|---|---|
| `ready` | Proceeds. |
| `starting` | Returns the same in-flight promise. |
| anything else | Throws `E_INVALID_STATE`. |

**Order:** services `onStart` → plugins `onStart` → framework `onStart` → consumer `onStart`, all forward and awaited. Each call gets `ctx.signal`, and `startTimeoutMs` applies per target.

**On failure**, at any point including callbacks:

1. Status becomes `rollingBack`.
2. `onStop` runs **in reverse for every target before the failure point** (services included). Rollback continues past errors.
3. Status becomes `failed`.
4. `start()` rejects with `E_START_FAILED { cause, target, rollbackErrors }` (fixes Q4).

`failed` is terminal: only `inspect()` and `stop()` (a no-op) remain useful.

### 27.4 `stop()`

**Never throws `E_INVALID_STATE`:**

| State when called | Behaviour |
|---|---|
| `ready` | Moves to `stopped` (nothing had started). |
| `stopped`, `failed` | No-op. |
| `stopping` | Returns the in-flight promise. |
| `starting` | Waits for start to settle, then stops if the app is running. |

**From `running`:**

1. Status becomes `stopping`.
2. `await settled()`, bounded by `stopTimeoutMs`.
3. Consumer `onStop`, then framework `onStop`. They run **first**, while everything is still alive (fixes Q6).
4. For each plugin in reverse order: **detach its hooks**, then call `onStop`.
5. Services' `onStop` in reverse.
6. Status becomes `stopped`.

Teardown is **best-effort**: every target gets its `onStop` even if an earlier one failed. Errors are collected and thrown afterwards as `E_STOP_FAILED` (an `AggregateError`), which fixes Q5. `stopped` is terminal; to restart, create a new app.

Emits after `stopped` are dropped and reported as `E_EMIT_AFTER_STOP` through `onError`. That catches leaked timers without crashing.

### 27.5 Timeouts and cancellation

Timeouts are optional, set per target via `lifecycle.{init,start,stop}TimeoutMs`. When a timeout fires, the kernel aborts `ctx.signal` and rejects with `E_TIMEOUT` naming the plugin. The underlying promise cannot be cancelled. Cooperative code should watch `signal`.

### 27.6 Disposal

`await using app = await createApp(...)` calls `stop()` at scope exit through `Symbol.asyncDispose`. It falls back gracefully where the symbol is missing.

## 28. Introspection

### `app.inspect(options?) → AppManifest`

The manifest is frozen and JSON-serialisable:

```ts
type AppManifest = {
  framework: { id: string };
  status: AppStatus;
  services: Array<{ name: string; depends: string[]; api: string[]; config?: object }>;
  plugins: Array<{
    name: string; index: number; origin: "framework" | "app";
    depends: string[]; optionalDepends: string[];
    api: string[];                                  // method/namespace keys
    events: string[];                               // declared (owned)
    hooks: string[];                                // subscribed
    lifecycle: Array<"onInit" | "onStart" | "onStop">;
    config?: object;                                // only with { config: true }
  }>;
  events: Array<{ name: string; kind: "notify" | "collect" | "pipe";
                  description?: string; owner: string /* "framework" | plugin */;
                  listeners: string[] }>;
  shared: { keys: string[]; actions: string[] };
};
```

- **Config values are excluded by default**, because they may hold secrets. `inspect({ config: true, redact?: (path, value) => value })` includes them.
- **Static introspection** (no app needed): `inspectPlugin(def)` and `framework.inspect()`. Event catalogs are plain data on definitions, so docs generators, `llms.txt` builders, linters, and agents can read a framework without running it.

**Uses:**
- generated plugin READMEs and event tables;
- generated `llms.txt` sections;
- devtools panels;
- architecture validators (dependency graph, orphan events, events nobody listens to);
- "what can I hook?" autocomplete for agents.

## 29. Tracing

```ts
type Tracer = (record: TraceRecord) => void;

type TraceRecord =
  | { kind: "status";  at: number; from: AppStatus; to: AppStatus }
  | { kind: "phase";   at: number; phase: "init" | "start" | "stop" | "rollback";
      target: string; status: "begin" | "end" | "error"; durationMs?: number; error?: unknown }
  | { kind: "event";   at: number; id: number; parentId?: number;
      mode: "emit" | "dispatch" | "collect" | "pipe"; event: string; source: string }
  | { kind: "handler"; at: number; eventId: number; event: string; plugin: string;
      status: "end" | "error"; durationMs: number; error?: unknown }
  | { kind: "shared";  at: number; action: string; source: string };
```

**Sources.** Tracers can be set in `compose` (framework) and in `createApp` (consumer), and both receive every record.

**Attribution.** Each plugin's `emit*` is bound to its name, so `source` is always known (fixes Q9). For the app object, `source` is `"app"`.

**Cost.** With no tracer, the cost is a single boolean check per site.

**Isolation.** Tracers are **not** on the event bus, which avoids recursion. A throwing tracer is swallowed.

**Causality (O6, decided).** `parentId` links an emit to the handler that caused it. On its own, the kernel tracks this only for the synchronous part of a handler. A framework can pass `compose({ contextStore })`: any object with `run(value, fn)` and `get()`, which `AsyncLocalStorage` satisfies. Links then survive `await`. The kernel never imports it, so it stays runtime-agnostic.

**Ready-made tracers** ship in `@basalt-js/std`:
- `consoleTracer()` — pretty, filterable;
- `memoryTracer()` — for test assertions such as `expect(trace).toContainEvent("router:navigate")`;
- `otelTracer()` — later, optional, as a separate package.

## 30. Validation rules and errors

**Error type.** Every kernel error is a `BasaltError` with a `code`, a `frameworkId`, and an optional `plugin`. Errors that aggregate several failures extend `AggregateError`.

**Message format** (Moku's, plus the code):

```
[site] Plugin "seo" depends on "router", but "router" appears after "seo". [E_DEPENDENCY_ORDER]
  Move "router" before "seo" in your plugin list.
```

| Code | When |
|---|---|
| `E_INVALID_NAME` | The name breaks `^[a-z][A-Za-z0-9]*$`, is reserved, or is an `Object.prototype` key. **Reserved:** `start stop status settled emit dispatch collect pipe get find has shared inspect global config state signal services basalt`. |
| `E_INVALID_SPEC` | A spec field has the wrong type, or a helper key collides. |
| `E_CONFIG_INVALID` | A resolved config failed its schema. Lists each issue's path and message. |
| `E_FOREIGN_PLUGIN` | A plugin or pack defined by another framework was passed to this framework's `compose`/`createApp`, or added to its pack. |
| `E_DUPLICATE_NAME` | The same name appears twice across services and plugins. |
| `E_DEPENDENCY_MISSING` / `E_DEPENDENCY_ORDER` | A `depends`/`optionalDepends` entry is missing or comes later, checked **by identity** (fixes Q11). |
| `E_UNDECLARED_DEPENDENCY` | `ctx.get(p)` was called with `p` not in `depends`. |
| `E_NOT_READY` | `ctx.get(p)` was called inside `api()` before `p` was built. |
| `E_EVENT_NAMESPACE` | A plugin event isn't prefixed `name:`. |
| `E_EVENT_CONFLICT` | An event name is declared twice. |
| `E_UNKNOWN_EVENT` / `E_UNKNOWN_HOOK` | An emit or hook names an undeclared or invisible event. |
| `E_EVENT_KIND` | A mode was called against the wrong kind (`emit` on a collect event, etc.). |
| `E_EMIT_DURING_WIRING` | An emit happened inside `api()`. |
| `E_ASYNC_INIT` | `createAppSync` hit an async `onInit`. |
| `E_INVALID_STATE` | `start()` was called in the wrong state. |
| `E_START_FAILED` / `E_STOP_FAILED` | Lifecycle failure (with `cause` / `errors`). |
| `E_TIMEOUT` | A lifecycle target exceeded its timeout. |
| `E_DISPATCH_FAILED` | One or more handlers failed in `dispatch`/`collect`/`pipe`. |
| `E_HANDLER_FAILED` | A hook handler failed during an `emit`. Reported through `onError`, not thrown; `cause` holds the original error. |
| `E_SHARED_READONLY` | A write went through the shared-state view. |
| `E_EMIT_AFTER_STOP` | An emit happened after `stopped`. Reported, not thrown. |

**Definitions are deep-frozen.** `compose` validates the framework defaults immediately (fixes Q13), and `createApp` validates the merged list.

## 31. Type-system plan

**Reuse from Moku** (§12): items 1–3, 5–10, and 12.

**Change:**
- **`events` as plain data with `event<T>()` descriptors.** This removes the context-sensitivity hazard (§12.11). A generic function call inside an object literal is not context-sensitive, so it is inferred in TypeScript's first pass.
- **Event descriptors carry `kind`, payload, and result types** (`EventDescriptor<"collect", P, R>`). The mode signatures filter on `kind`.
- **The namespace rule as a type:**

  ```ts
  { [K in keyof E]: K extends `${N}:${string}` ? EventDescriptor<any, any, any> : never }
  ```

  It is checked against the inferred `const N`. *(Verify with a prototype that error messages stay readable.)*
- **`ctx.get`/`ctx.find` are constrained** to `Deps[number]` / `OptionalDeps[number]`.
- **`PluginCtx<{ config; state; events; depends?; optionalDepends? }>`** builds the extracted-domain-file context. `emit` uses Moku's overload technique (`EmitFn`), and so do `dispatch`, `collect`, and `pipe`.
- **`App` types every mode with the union of all events** visible in the app.
- **Config schemas:** when `config` is a schema, `ctx.config` is `InferOutput<S>` and overrides are `Partial<InferInput<S>>`. A conditional type on the `~standard` key picks between this and the plain-object path.
- **Packs:** `plugins` arrays accept packs, and a type-level flatten turns `[Pack<[A, B]>, C]` into `A | B | C` for the `App` surface.
- **Shared state:** `S` is inferred from `initial()`, and the action parameter `s` is contextually typed from it. `DeepReadonly<S>` is used for the view, and actions are exposed as `(…args) => void` with the state parameter dropped.

**Type tests are first-class** (`expectTypeOf`, `@ts-expect-error`). Every row of §16 and §30 that has a compile-time side gets a test. Run them in CI against TS 6.x and 7.x, as Moku does.

## 32. Kernel algorithm (Basalt)

```
compose(options):
  validate(defaults)                         // names, identity dupes, deps, catalogs, hooks targets
  freeze plan; return { createApp, createAppSync }

createApp(options):                          // async
  plugins = flattenPacks([...plan.defaults, ...options.plugins])
  validate(plugins)                                             // + every plugin from this framework
  global  = freeze(await resolveConfig(framework.config, options.config))   // defaults or schema
  shared  = createSharedStore(framework.shared)                 // per instance
  bus     = createBus(catalog(plugins), tracers, onError, checks)
  for s in services:   cfg(4-level merge → await schema) → state → api → await onInit
  for p in plugins:    cfg(3-level merge → await schema) → state(StateContext)
  phase = "wiring"                                              // emit* throws
  for p in plugins:    apis[p] = p.api(WiringContext(p))         // get(dep) OK if built, else E_NOT_READY
  for p in plugins:    bus.register(p, p.hooks(PluginContext(p))) // all APIs exist
  phase = "live"
  for p in plugins:    await p.onInit(PluginContext(p))          // createAppSync: thenable → E_ASYNC_INIT
  await framework.onReady(appCtx); await consumer.onReady(appCtx)
  status = "ready"; return freeze(app)
```

`start`/`stop`/rollback follow §27. Every phase boundary writes a trace record.

## 33. Invariants

Breaking any of these is a kernel bug.

- **B1.** Plugin order is array order. Init and start run forward, stop runs reverse, rollback runs reverse over targets that already started.
- **B2.** Names are unique across services and plugins, identifier-shaped, and not reserved.
- **B3.** Every `depends`/`optionalDepends` entry is present (if required) and earlier, compared by identity.
- **B4.** Configs, global config, definitions, and the app are frozen. Only plugin state is directly mutable. Shared state changes only through actions.
- **B5.** No handler runs synchronously inside `emit()`. `settled()` resolves only when no dispatch is in flight.
- **B6.** No error is silently swallowed. It goes to `onError`, to the default reporter, or to the awaiting caller.
- **B7.** `start()` either reaches `running` or leaves every started target stopped (`failed`).
- **B8.** `stop()` is idempotent, best-effort, and calls each `onStop` at most once.
- **B9.** A plugin receives no events after its `onStop` begins.
- **B10.** Each lifecycle method is called at most once per app instance.
- **B11.** `ctx.get` reaches only declared dependencies. Consumers (`app.get`) reach everything.
- **B12.** Every event that is emitted, hooked, or listed in `inspect()` exists in the catalog, under `checks: "full"`.
- **B13.** Tracers and `inspect()` never change behaviour.
- **B14.** No plugin or service code sees a config that hasn't passed its schema (when it has one).
- **B15.** An app contains only plugins defined by its own framework.

---

# Part III — Basalt frameworks (Layer 2)

## 34. The Moku family as reference

Taken from the moku plugin's synced docs. Versions are as published.

| Package | Kind | What it is |
|---|---|---|
| `@moku-labs/common` 0.2.1 | Shared infra | `logPlugin` / `envPlugin` core plugins (`ctx.log`, `ctx.env`) and a branded CLI kit (`@moku-labs/common/cli`: palette, box, spinner, `createBrandConsole`, styled prompts). Family rules: no raw `console.*`, no raw `process.env`, no hand-rolled ANSI. |
| `@moku-labs/web` 2.0.1 | Framework | SSG + SPA on Preact with islands. Bundles with `Bun.build` (no Vite). Two entry points: `.` (Node build) and `./browser` (node-free). Isomorphic defaults `site, i18n, router, head, spa`, plus `log`/`env` core plugins. Opt-in `content` (provider shell + `fileSystemContent`), `data` (JSON sidecars), and node-only `build`, `deploy`, `cli`. A route builder `route(pattern).load().render().head().generate()`, with `createUrls` for links. Global `config.mode = ssg \| spa \| hybrid`. Deploys to Cloudflare Pages. |
| `@moku-labs/worker` 0.11.0 | Framework | Cloudflare Workers backend. Defaults `log, env, stage, bindings, server`. Resource plugins `kv, d1, queues, storage (R2), durableObjects`, configured as **keyed maps of named instances** (`app.kv.use("cache")`). **`env` is threaded per call, never stored**, because one isolate serves concurrent requests. `endpoint(path).get(...)`, `defineDurableObject`. Node-only `deploy`/`cli` are tree-shaken. |
| `@moku-labs/room` 0.1.1 | **Plugin pack** | Couch multiplayer: a shared screen plus phones over WebRTC (trystero), with QR join. It never calls `createApp`. The app spreads `roomPlugins.stage` / `roomPlugins.controller` into its own web app. |
| `@moku-labs/ci` | Tooling | `moku-release` release automation. |
| `moku` Claude Code plugin | Tooling | Skills, plus validator, builder, and planner agents that enforce the spec (layers, tiers, JSDoc, tests, web patterns). |

**Family idioms worth keeping:**
- **Multiple `createApp` instances per project.** For example a web build app, a browser SPA app, and a worker server app.
- **One framework per `createApp`.** Frameworks integrate at the edges (HTTP, an `ASSETS` binding). They are never fused into one plugin list.
- **Exact-pinned lockstep versions across the family.** Visible in the docs, and a recurring source of upgrade churn.

## 35. The Basalt framework contract

Every Basalt framework package must:

1. Call `defineFramework` once and `compose` once, and export **documented consts**: `createApp`, `createAppSync`, `definePlugin`, `event`, plus plugin definitions and helpers. Never destructured exports.
2. Re-export everything a consumer needs, so **apps never depend on `@basalt-js/core`**. The guardrail is a lint rule (§38).
3. Publish separate **entry points per runtime** where needed (`.`, `./browser`, `./worker`). Each entry composes its own default plugins, and node-only plugins never leak into browser bundles.
4. Ship `llms.txt` generated from `framework.inspect()` plus hand-written guidance.
5. Use the kernel primitives instead of reinventing them:
   - **collect events** for contributions (routes, head tags, sitemap entries, CLI commands);
   - **pipe events** for transforms and middleware (request → response, markdown → HTML);
   - **shared state** for app-wide facts;
   - **services** for infrastructure.
6. Keep resource handles out of shared state. Anything request-scoped is passed as arguments (see O7).

## 36. Planned packages (outline; each gets its own spec)

| Package | Kind | Contents | Kernel features it leans on |
|---|---|---|---|
| `@basalt-js/core` | Kernel | Part II. | — |
| `@basalt-js/std` | Shared infra | Ported from `@moku-labs/common`. `logService`, `envService` (validated, provider-based), `clockService` (testable time); `consoleTracer`, `memoryTracer`; branded CLI kit; test utilities (`createTestApp`, mock contexts built from `PluginCtx`). | services, tracing |
| `@basalt-js/web` | Framework | Ported from `@moku-labs/web`: Moku-web's model (SSG/SPA/hybrid, islands, route builder, content providers, head/SEO, build/deploy/cli). | `collect` for `head` tags, sitemap and feed entries, and route contributions; `pipe` for the content transform chain (markdown → HTML → sanitize → directives); shared state for `locale`/`stage`; tracer drives the dev CLI's live build panel; `inspect()` produces the build report. |
| `@basalt-js/worker` | Framework | Ported from `@moku-labs/worker`: Moku-worker's model (server/endpoints, KV/D1/R2/Queues/DO keyed maps, deploy manifest). | `pipe` for request middleware (`server:request` → `Response`); `collect` for endpoint and binding manifests (deploy reads `inspect()`); lifecycle timeouts for cold start. |
| Plugin packs (`@basalt-js/room`, …) | Pack | Built with `framework.pack(...)` (below). `room` is ported from `@moku-labs/room`. | — |
| `@basalt-js/system`, `@basalt-js/native` | Framework | Ported from `@moku-labs/system` (isomorphic system API: store, notify, clipboard, tray, deep links) and `@moku-labs/native` (Node-only native packager, Tauri build). Not described in §34; each gets its spec when its port starts. | — |
| `@basalt-js/game`, `@basalt-js/editor`, `@basalt-js/ai` | Framework | Ported from `@moku-labs/game` (2D puzzle engine on PixiJS), `@moku-labs/editor` (editor, devtools and MCP layer for `game`) and `@moku-labs/ai` (build system for AI-generated assets). Same: a spec per port. | — |

**Ported, not rewritten (O17, decided).** Every package above that has a Moku counterpart (all but `core` and future packs with no Moku source) starts as a fork of it, and is then ported to the Basalt kernel. The kernel is the exception because Part II changes almost every public name and signature, so a fork would be rewritten anyway; the frameworks keep most of their domain code and change only where they touch the kernel. A port:

1. Swaps `@moku-labs/core` for `@basalt-js/core` and renames along the Moku → Basalt mapping (§19): `createCoreConfig` → `defineFramework`, core plugins → services, `ctx.require` → `ctx.get`/`ctx.find`, and so on.
2. Moves the hand-rolled patterns to kernel primitives (§35, item 5): `api.use()` middleware becomes `pipe` events, "contribute X" arrays become `collect` events, cross-plugin flags become shared state.
3. Switches tooling and release to `@basalt-js/ci`, and the dependency on core from an exact pin to a semver range (§37).
4. Keeps Moku's MIT `LICENSE` and its copyright line, and adds Basalt's beside it.

**Plugin packs (O8, decided).** A pack is a named, ordered group of plugins made for one framework:

```ts
// @basalt-js/room (built for @basalt-js/web)
export const stagePack = web.pack("roomStage", [peerPlugin, syncPlugin, stagePlugin]);

// app
const app = await createApp({ plugins: [stagePack, gamePlugin] });
app.stage.lobbyCode();   // pack plugins are typed like any other plugin
```

- **Flattened in place.** `compose` and `createApp` accept packs in `plugins` and flatten them where they appear, keeping order. Every rule (order, `depends`, names) applies to the flattened list.
- **Same framework only.** Every plugin in a pack must come from the pack's framework, and the pack must match the app's framework (`E_FOREIGN_PLUGIN`).
- **Flat and config-free (O16, decided).** Packs can't contain or depend on other packs, and they carry no default `pluginConfigs`. Their plugins are configured through `pluginConfigs` like any other plugin.
- **Visible.** `inspect()` shows `pack: "roomStage"` on each plugin that came from a pack.

**Request scope (O7, decided):** deferred to the `@basalt-js/worker` spec.

---

# Part IV — Repo, tooling, delivery

## 37. Repositories

**Decided (O9): one repository per package** under `github.com/basalt-js`, as Moku does. Each package versions and releases on its own.

| Repo | Publishes | Contains |
|---|---|---|
| `core` | `@basalt-js/core` | Kernel `src/`, `tests/{unit,integration,types}`, `spec/NN-*.md`, `llms.txt` |
| `std` | `@basalt-js/std` | Services, tracers, test utilities. Fork of `moku-labs/common` |
| `web` | `@basalt-js/web` | Web framework. Fork of `moku-labs/web` |
| `worker` | `@basalt-js/worker` | Workers framework. Fork of `moku-labs/worker` |
| `room` | `@basalt-js/room` | Multiplayer pack for `web`. Fork of `moku-labs/room` |
| `system`, `native`, `game`, `editor`, `ai` | `@basalt-js/<repo>` | Forks of the `moku-labs` repos of the same name |
| one repo per pack | `@basalt-js/<pack>` | Further packs with no Moku source |
| `ci` | `@basalt-js/ci` | Reusable CI workflows, shared Biome/ESLint config, the custom lint rules (§38), release script, `llms.txt` generator |
| `examples` | — | Sample frameworks and apps; the port of Moku's `tests/sandbox/demo` |

**Forks (O17).** Each fork is a new `basalt-js` repo carrying the Moku repo's full history, not a GitHub fork, so pull requests target our repo by default. Locally, `upstream` points at the Moku repo, fetch-only, for pulling later Moku fixes. GitHub Actions stays off on a fork until its workflows call `@basalt-js/ci`: Moku's `publish.yml` publishes `@moku-labs/*` on every push to `main`. Not forked: `moku-labs/core` and `moku-labs/claude` (Basalt has its own kernel and plugin), `moku-labs/ci` (so has Basalt), and `moku-labs/demos`, which has no license.

This document moves into the `core` repo and is split into `spec/NN-*.md` once it is stable.

**The cost, and how to contain it.** Separate repos drift. In the Moku family every framework exact-pins core, so each core release forces a release of every framework. Basalt avoids that:

- Frameworks depend on core through a **semver range** (`"@basalt-js/core": "^1.2.0"`), not an exact pin. That only works if core treats its *types* as public API: a type change that breaks a framework is a major version.
- Each framework's CI runs a nightly job against core's `main`, so breakage shows up before core releases.
- Dependabot or Renovate opens PRs for `@basalt-js/*` bumps, as in Moku.
- Every repo uses the same gates through the shared `ci` repo.

**Release tool (O14, decided):** a small custom script in the `ci` repo, as Moku does with `moku-release`. Every repo calls it from the shared release workflow.

## 38. Toolchain

**Same baseline as Moku:**
- Bun (exact pins);
- TypeScript strict (+ `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`);
- tsdown (ESM + CJS + d.ts);
- `publint`, `attw`;
- Biome + ESLint (`jsdoc` with mandatory `@example` in `src/`, `sonarjs`, `unicorn`);
- Vitest projects;
- Lefthook;
- a TS 6/7 CI matrix.

**Additions:**
- **Runtime matrix:** Bun, Node 24, a browser (Vitest browser mode or happy-dom), and Workers (Miniflare/workerd) for `@basalt-js/core`.
- **Bundle-size gate** for `@basalt-js/core` (≤ 12 KB gz).
- **Lint rules** (shipped from the `ci` repo):
  - `basalt/no-kernel-import-in-app`: apps must not import `@basalt-js/core`. This turns Moku's convention into enforcement.
  - `basalt/no-destructured-public-export`.
  - `basalt/plugin-index-is-wiring`: an `index.ts` over ~50 lines with logic gets a warning.
- **Generated docs:** `llms.txt` and plugin README tables built from `inspect()`.

## 39. Testing strategy (kernel)

| Suite | Covers |
|---|---|
| unit | Validation, config merge, catalog building, store, bus modes, state machine transitions |
| integration | Real frameworks: ordering, rollback, best-effort stop, `settled()`, timeouts, `createAppSync` |
| types | Inference and rejection cases (`@ts-expect-error`) for every compile-time rule |
| fault injection | Throw or reject at every lifecycle point, every handler mode, and inside `onError`/tracers. Assert B6–B10. |
| concurrency | `start`/`stop` races, `stop` during `start`, emits during `stopping` |
| Moku parity | Port Moku's sandbox scenarios (router, analytics, cms, counter, env, SPA demo) as acceptance tests |

Coverage gate: 90% (Moku's level), with `src/**/types.ts` excluded.

## 40. Milestones

| # | Deliverable | Exit criteria |
|---|---|---|
| M0 | `ci` repo (shared workflows, lint config, release script) and `core` repo scaffold | CI green on an empty package; lint, test, and size gates wired |
| M1 | Kernel parity: define/compose/createApp, plugins, services, config (defaults and Standard Schema), packs, `emit`, init/start/stop | Moku sandbox scenarios ported and passing; Q1, Q2, Q10–Q13, Q16 fixed |
| M2 | Lifecycle robustness: state machine, rollback, best-effort stop, timeouts, `signal`, dispose, `settled()` | B5–B10 fault-injection suite passing |
| M3 | Async init and event modes: async `createApp`, `createAppSync`, `dispatch`/`collect`/`pipe` | Type and runtime tests for every kind/mode pair |
| M4 | Shared state | Readonly view, actions, `basalt:shared`, per-instance isolation tests |
| M5 | Introspection and tracing: `inspect()`, static inspection, tracer fan-out, `contextStore` injection, std tracers | Manifest snapshot tests; zero-cost-when-off benchmark |
| M6 | Spec split into `spec/NN-*.md`, `llms.txt`, prompt fragment, README | Docs reviewed; prompt fragment ≤ ~1500 tokens |
| M7 | `@basalt-js/std`, ported from `moku-labs/common` | log/env/clock services, tracers, test utils |
| M8+ | Ports of `web`, `worker`, `room`, then `system`, `native`, `game`, `editor`, `ai` | Per-framework specs first; each port passes its Moku tests on `@basalt-js/core`; the worker spec settles O7 |

---

# Part V — Decisions and open questions

## Decided in review (2026-10-30)

| # | Question | Decision | Where |
|---|---|---|---|
| O1 | Names | `define*` names adopted: `defineFramework`, `compose`, `definePlugin`, `defineService`, `ctx.get`/`ctx.find`, `dispatch`/`collect`/`pipe`. | §19 |
| O2 | Explicit config type on `defineFramework`? | Both: inferred by default, or curried `defineFramework<SiteConfig>()(…)`. | §20 |
| O3 | Restrict `ctx.get` to declared deps? | Yes. Optional deps go in `optionalDepends` and use `ctx.find`. `app.get` stays unrestricted. | §24 |
| O4 | `collect`/`pipe` in the kernel? | Yes. | §25 |
| O5 | Async `createApp`? | Async by default, plus `createAppSync` (delegated to Claude). | §27.2 |
| O6 | Async causality in tracing? | Frameworks may inject a `contextStore`; the kernel works without one. | §29 |
| O7 | Request scope for servers? | Deferred to the `@basalt-js/worker` spec. | §36 |
| O8 | Formal plugin packs? | Yes: `framework.pack(name, plugins)`. | §36 |
| O9 | Monorepo or many repos? | One repo per package. | §37 |
| O10 | Config validation? | Standard Schema libraries (`config: z.object({…})`). Plain default objects still work. | §21.1 |
| O11 | Let apps replace a default plugin? | No. | §17 |
| O12 | Runtime safety checks? | On (`"full"`) by default. `compose` or `createApp` can set `"minimal"`. | §23 |
| O13 | npm scope and GitHub org? | `basalt-js` on both: packages are `@basalt-js/*`, repos are `github.com/basalt-js/*`. Both orgs created 2026-10-30. (`@basalt` belongs to another, unrelated org.) | §37 |
| O14 | Release tool? | A small custom script in the shared `ci` repo. | §37 |
| O15 | Required config in the `createApp` types? | Yes, for schema fields without defaults that the framework doesn't supply. | §21.1 |
| O16 | Packs with default config, or packs depending on packs? | No and no. | §36 |

## Decided 2026-11-01

| # | Question | Decision | Where |
|---|---|---|---|
| O17 | Rewrite the Moku family, or fork it? | Fork every Moku framework and pack, keeping history, and port each to the Basalt kernel. `common` becomes `std`. Not forked: `core`, `ci`, `demos` and the Claude plugin (§37 says why). | §36, §37 |

## Still open

None. New questions go here as they come up.

---

# Appendix A — Moku design decisions log (condensed, from spec 13 §1)

| # | Decision | Alternative rejected | Basalt |
|---|---|---|---|
| 1 | 3-step factory chain | One `createCore` with all generics | Kept as 2 framework steps + `createApp` |
| 2 | 2 generics on `createCoreConfig` | Adding `State` | Events are now values; shared state added |
| 3 | 0 generics on `createPlugin` | 4–7 explicit generics | Kept |
| 4 | 3 lifecycle phases | Pre/post hooks per phase | Kept (+ rollback, timeouts) |
| 5 | Structured `createApp` namespaces | Flat options with runtime key discrimination | Kept |
| 6 | Sequential execution | Parallel within phases | Kept |
| 7 | Shallow merge | Deep merge | Kept |
| 8 | Instance-based `depends` | Strings | Kept, now checked by identity |
| 9 | `ctx.global` = config; global state deferred | `{ config, state }` | **Shared state added** (§26) |
| 10 | No topological sort | Auto-sort | Kept |
| 11 | Configs frozen, state mutable | All mutable or all frozen | Kept, plus definitions frozen |
| 12 | No sub-plugins | Depth-first flattening | Mostly kept: named packs (`framework.pack`) flatten one level, in place |
| 13 | Minimal lifecycle contract | Transactional lifecycle | **Replaced** by the state machine + rollback (§27) |
| 14 | Stop propagates the first error | Best-effort | **Replaced** by best-effort + aggregate error |
| 15 | Helpers as an intersection type | 6th generic | Kept |

# Appendix B — Draft LLM prompt fragment for Basalt

```
You are writing code for a Basalt-based app.

LAYERS: @basalt-js/core (kernel; never import in apps) → framework package (defineFramework +
compose; exports createApp, definePlugin, event) → app (createApp + definePlugin from the framework).

PLUGIN:
  export const fooPlugin = definePlugin("foo", {            // name: camelCase identifier
    config:  z.object({ /* … */ }),                           // or a plain object of complete defaults
    events:  { "foo:changed": event<{ id: string }>("…") }, // keys MUST start with "foo:"
    depends: [barPlugin],                                   // listed earlier; ctx.get(barPlugin)
    optionalDepends: [bazPlugin],                           // ctx.find(bazPlugin) → api | undefined
    state:   ({ global, config }) => ({ /* private mutable state */ }),
    api:     ctx => ({ /* sync factory; no emit here; methods may emit */ }),
    hooks:   ctx => ({ "bar:ready": p => { … } }),         // only visible events
    onInit:  async ctx => { /* load/validate; no resources */ },
    onStart: async ctx => { /* acquire; honour ctx.signal */ },
    onStop:  async ctx => { /* release; own state + services only */ },
    helpers: { /* pure static functions */ },
  });

EVENTS: event<P>() notify → ctx.emit (fire-and-forget) | await ctx.dispatch (wait);
        event.collect<P,R>() → await ctx.collect → R[];  event.pipe<T>() → await ctx.pipe → T.
        Events are notifications/contributions; use ctx.get(plugin).method() for requests.

SHARED STATE: read ctx.shared.state.x (readonly); write ctx.shared.actions.setX(v).

PACKS: plugins: [somePack, fooPlugin]  // a pack is a named group of plugins, flattened in place

APP: const app = await createApp({ plugins, config, pluginConfigs });
     await app.start(); app.foo.method(); await app.settled(); await app.stop();

RULES: index.ts is wiring only (~30 lines); logic in api.ts/state.ts/handlers.ts.
       No classes, services, or managers outside definePlugin. No raw console/process.env
       (use ctx.log / ctx.env). Never import @basalt-js/core in app code.
```

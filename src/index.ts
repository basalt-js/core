// =============================================================================
// @basalt-js/core: package entry point
// =============================================================================
// This file is the ONLY authority on the public API surface. Everything exported
// here is public; everything else is internal.
//
// Frameworks import from here. Apps never do: they import from their framework.
// See docs/basalt-design.md, Part II.
// =============================================================================

export { BasaltError, type BasaltErrorCode, type BasaltErrorOptions } from "./errors";
export { type EventFactory, event } from "./event";
export { defineFramework } from "./framework";
export { defineService } from "./service";
export type {
  AnyPlugin,
  AnyPluginOf,
  AnyService,
  ApiOf,
  App,
  AppCallback,
  AppContext,
  AppEvents,
  AppOverrides,
  AppStatus,
  CatalogEntry,
  Composed,
  ComposeOptions,
  ConfigInput,
  ConfigOutput,
  ConfigSpec,
  CreateApp,
  CreateAppOptions,
  DefinedFramework,
  DefinedPlugin,
  DefinedService,
  DefineFrameworkWithConfig,
  DefinePlugin,
  EmitFunction,
  EmptyObject,
  ErrorCallback,
  EventDescriptor,
  EventKind,
  EventMap,
  EventsOf,
  Flatten,
  Framework,
  FrameworkOptions,
  FrameworkTypes,
  Helpers,
  HookHandler,
  HookHandlers,
  InputOf,
  NameOf,
  Pack,
  PartialOverrides,
  PayloadMap,
  PayloadOf,
  PluginApis,
  PluginContext,
  PluginCtx,
  PluginCtxTypes,
  PluginDefinition,
  PluginOrPack,
  PluginSpec,
  PluginTypes,
  ServiceApis,
  ServiceContext,
  ServiceDefinition,
  ServiceSpec,
  ServiceStateContext,
  ServiceTypes,
  StandardSchemaV1,
  StateContext,
  TeardownContext,
  UnionToIntersection,
  VisibleEvents
} from "./types";

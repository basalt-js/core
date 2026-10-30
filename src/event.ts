import { BasaltError } from "./errors";
import type { CatalogEntry, EventDescriptor, EventMap } from "./types";
import { isPlainObject, KERNEL_ID } from "./utilities";

/**
 * The `event` helper: declares events as values, so catalogs exist at runtime.
 *
 * @example
 * ```ts
 * const events = {
 *   "router:navigate": event<{ from: string; to: string }>("Route changed"),
 *   ...event.map<{ "router:ready": void }>({ "router:ready": "Router is ready" })
 * };
 * ```
 */
export interface EventFactory {
  /**
   * Declares a notify event with payload `P`.
   *
   * @param description - What the event means. Shown by tooling.
   * @returns A frozen event descriptor.
   */
  <P = void>(description?: string): EventDescriptor<NoInfer<P>>;
  /**
   * Declares notify events in bulk from a pre-declared name → payload map.
   * Every name needs a description, because the names must exist at runtime.
   *
   * @param descriptions - Event names mapped to descriptions.
   * @returns Event names mapped to frozen descriptors.
   */
  map<M extends object>(
    descriptions: { readonly [K in keyof M]-?: string }
  ): { readonly [K in keyof M]-?: EventDescriptor<M[K]> };
}

const descriptors = new WeakSet<object>();

/**
 * Creates one frozen notify descriptor.
 *
 * @param description - Optional description.
 * @returns The descriptor.
 * @example
 * ```ts
 * const navigate = createDescriptor("Route changed");
 * ```
 */
function createDescriptor(description: unknown): EventDescriptor {
  if (description !== undefined && typeof description !== "string") {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: KERNEL_ID,
      message: `An event description must be a string, got ${typeof description}.`,
      hint: 'Write event<Payload>("What happened").'
    });
  }
  const descriptor: EventDescriptor = Object.freeze({ kind: "notify", description });
  descriptors.add(descriptor);
  return descriptor;
}

/**
 * Declares one notify event. See {@link EventFactory}.
 *
 * @param description - Optional description.
 * @returns The descriptor.
 * @example
 * ```ts
 * const navigate = declareEvent("Route changed");
 * ```
 */
function declareEvent(description?: string): EventDescriptor {
  return createDescriptor(description);
}

/**
 * Declares notify events in bulk. See {@link EventFactory.map}.
 *
 * @param descriptions - Event names mapped to descriptions.
 * @returns Event names mapped to descriptors.
 * @example
 * ```ts
 * const events = declareEventMap({ "router:ready": "Router is ready" });
 * ```
 */
function declareEventMap(descriptions: unknown): EventMap {
  if (!isPlainObject(descriptions)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: KERNEL_ID,
      message: "event.map() needs an object of event names mapped to descriptions.",
      hint: 'Write event.map<Events>({ "router:navigate": "Route changed" }).'
    });
  }
  const events: Record<string, EventDescriptor> = {};
  for (const [name, description] of Object.entries(descriptions)) {
    events[name] = createDescriptor(description);
  }
  return Object.freeze(events);
}

/**
 * Declares events. `event<P>(description?)` makes one notify event;
 * `event.map<Map>(descriptions)` makes several from a name → payload type.
 *
 * @example
 * ```ts
 * const routerPlugin = definePlugin("router", {
 *   events: { "router:navigate": event<{ from: string; to: string }>("Route changed") }
 * });
 * ```
 */
export const event: EventFactory = Object.freeze(
  Object.assign(declareEvent, { map: declareEventMap })
) as EventFactory;

/**
 * Whether a value was created by `event()` or `event.map()`.
 *
 * @param value - The value to test.
 * @returns `true` for event descriptors.
 * @example
 * ```ts
 * isEventDescriptor(event("x")); // true
 * ```
 */
export function isEventDescriptor(value: unknown): value is EventDescriptor {
  return typeof value === "object" && value !== null && descriptors.has(value);
}

const GLOBAL_EVENT_PATTERN = /^[a-z][A-Za-z0-9]*:[\w.:-]+$/;
const ACTION_PATTERN = /^[\w.:-]+$/;

/**
 * Validates an `events` object and normalises it into a frozen catalog.
 *
 * @param frameworkId - Framework id for error messages.
 * @param events - The `events` field (may be undefined).
 * @param owner - The owning plugin's name; omit for framework events.
 * @returns The catalog entries, in declaration order.
 * @throws {BasaltError} `E_INVALID_SPEC` or `E_EVENT_NAMESPACE`.
 * @example
 * ```ts
 * buildCatalog("site", { "router:navigate": event("Route changed") }, "router");
 * ```
 */
export function buildCatalog(
  frameworkId: string,
  events: unknown,
  owner?: string
): readonly CatalogEntry[] {
  if (events === undefined) return Object.freeze([]);
  const where = owner === undefined ? "Framework events" : `Events of plugin "${owner}"`;
  if (!isPlainObject(events)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId,
      message: `${where} must be a plain object of event descriptors.`,
      hint: 'Write events: { "<domain>:<action>": event<Payload>("description") }.'
    });
  }
  const catalog: CatalogEntry[] = [];
  for (const [name, descriptor] of Object.entries(events)) {
    assertEventName(frameworkId, name, owner);
    if (!isEventDescriptor(descriptor)) {
      throw new BasaltError({
        code: "E_INVALID_SPEC",
        frameworkId,
        message: `${where}: "${name}" is not an event descriptor.`,
        hint: `Declare it with event<Payload>("description").`
      });
    }
    catalog.push(
      Object.freeze({ name, kind: descriptor.kind, description: descriptor.description })
    );
  }
  return Object.freeze(catalog);
}

/**
 * Checks an event name: plugin events must be `<plugin>:<action>`; framework events
 * must be `<domain>:<action>` outside the reserved `basalt:` namespace.
 *
 * @param frameworkId - Framework id for error messages.
 * @param name - The event name.
 * @param owner - The owning plugin's name, or `undefined` for framework events.
 * @throws {BasaltError} `E_EVENT_NAMESPACE`.
 * @example
 * ```ts
 * assertEventName("site", "router:navigate", "router"); // ok
 * ```
 */
function assertEventName(frameworkId: string, name: string, owner: string | undefined): void {
  if (owner !== undefined) {
    const prefix = `${owner}:`;
    if (name.startsWith(prefix) && ACTION_PATTERN.test(name.slice(prefix.length))) return;
    throw new BasaltError({
      code: "E_EVENT_NAMESPACE",
      frameworkId,
      plugin: owner,
      message: `Plugin "${owner}" declares event "${name}", which is outside its namespace.`,
      hint: `Name it "${owner}:<action>", for example "${owner}:changed".`
    });
  }
  if (GLOBAL_EVENT_PATTERN.test(name) && !name.startsWith("basalt:")) return;
  throw new BasaltError({
    code: "E_EVENT_NAMESPACE",
    frameworkId,
    message: `Framework event "${name}" is not a valid "<domain>:<action>" name.`,
    hint: 'Use a name such as "page:render". The "basalt:" namespace is reserved.'
  });
}

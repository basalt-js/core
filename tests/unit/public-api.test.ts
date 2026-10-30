import { describe, expect, it } from "vitest";
import * as publicApi from "../../src";

describe("public API surface", () => {
  it("is empty until M1 adds defineFramework and the event helpers", () => {
    // Update this list whenever src/index.ts gains or loses an export.
    expect(Object.keys(publicApi).toSorted()).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import * as publicApi from "../../src";

describe("public API surface", () => {
  it("exports exactly the M1 runtime values", () => {
    // Update this list whenever src/index.ts gains or loses a runtime export.
    expect(Object.keys(publicApi).toSorted()).toEqual([
      "BasaltError",
      "defineFramework",
      "defineService",
      "event"
    ]);
  });
});

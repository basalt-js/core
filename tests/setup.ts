import { expect } from "vitest";
import { BasaltError, type BasaltErrorCode } from "../src";

declare module "vitest" {
  interface Matchers<T> {
    /** Asserts that a function throws, or rejects with, a BasaltError with `code`. */
    toFailWith: (code: BasaltErrorCode) => Promise<T>;
  }
}

expect.extend({
  async toFailWith(received: () => unknown, code: BasaltErrorCode) {
    try {
      await received();
    } catch (error) {
      const actual = error instanceof BasaltError ? error.code : String(error);
      return {
        pass: actual === code,
        message: () => `expected a BasaltError with ${code}, got ${actual}`
      };
    }
    return { pass: false, message: () => `expected a BasaltError with ${code}, but nothing threw` };
  }
});

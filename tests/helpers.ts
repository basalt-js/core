import { vi } from "vitest";
import { BasaltError, type BasaltErrorCode } from "../src";

type Console = { error: (...data: unknown[]) => void };

/** Spies on console.error (the default reporter) without printing. */
export function spyConsoleError() {
  const host = globalThis as unknown as { console: Console };
  return vi.spyOn(host.console, "error").mockImplementation(() => {});
}

/** Runs `run` and returns the BasaltError it throws (sync or async). */
export async function catchError(run: () => unknown): Promise<BasaltError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof BasaltError) return error;
    throw error;
  }
  throw new Error("Expected a BasaltError, but nothing was thrown.");
}

/** Asserts that `run` throws (or rejects with) a BasaltError with `code`. */
export async function expectCode(run: () => unknown, code: BasaltErrorCode): Promise<BasaltError> {
  const error = await catchError(run);
  if (error.code !== code) {
    throw new Error(`Expected ${code}, got ${error.code}:\n${error.message}`);
  }
  return error;
}

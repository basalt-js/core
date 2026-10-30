import { defineService } from "../../../src";

/** Environment detection, as a service (Moku's env plugin). */
export const envService = defineService("env", {
  config: { nodeEnv: "development" as string, isCI: false },
  api: ({ config }) => ({
    isDev: () => config.nodeEnv === "development",
    isProd: () => config.nodeEnv === "production",
    isCI: () => config.isCI
  })
});

/** In-memory logger that depends on env. */
export const logService = defineService("log", {
  config: { level: "info" as "debug" | "info" },
  depends: [envService],
  state: () => ({ lines: [] as string[] }),
  api: ({ config, state, env }) => ({
    debug: (message: string) => {
      if (config.level === "debug" || env.isDev()) state.lines.push(`debug ${message}`);
    },
    info: (message: string) => {
      state.lines.push(`info ${message}`);
    },
    lines: (): readonly string[] => state.lines
  })
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Projects stay valid while they are still empty (integration and types fill up in M1+).
    passWithNoTests: true,
    setupFiles: ["./tests/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "types",
          include: ["tests/types/**/*.test.ts"],
          typecheck: {
            enabled: true,
            include: ["tests/types/**/*.test-d.ts"],
            tsconfig: "./tsconfig.json"
          }
        }
      }
    ],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/types.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90
      }
    }
  }
});

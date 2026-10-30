import { definePlugin } from "./config";

/** Micro tier: counter with configurable initial value and step. */
export type CounterConfig = { initial: number; step: number };

export const counterPlugin = definePlugin("counter", {
  config: { initial: 0, step: 1 } as CounterConfig,
  state: ctx => ({ count: ctx.config.initial }),
  api: ctx => ({
    increment: () => {
      ctx.state.count += ctx.config.step;
    },
    decrement: () => {
      ctx.state.count -= ctx.config.step;
    },
    value: () => ctx.state.count,
    reset: () => {
      ctx.state.count = ctx.config.initial;
    }
  })
});

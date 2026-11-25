/** The plan readings the gauge flies: whole-window percentages, null with no reading. */
export type Gauge = { five: number | null; week: number | null }

declare module 'claude-code' {
  interface PluginState {
    'orbit-usage': { gauge: Shaped<Gauge | null> }
  }
}

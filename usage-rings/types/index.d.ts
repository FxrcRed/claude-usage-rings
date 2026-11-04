export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-rings': { state: { limits: Limit[]; applied: number } }
  }
}

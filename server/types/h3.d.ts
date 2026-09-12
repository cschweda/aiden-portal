import type { Logger } from 'pino'

declare module 'h3' {
  interface H3EventContext {
    /** The Tailscale login stamped on requests that arrive through `tailscale serve`. */
    tailnetUser?: string
    requestId?: string
    logger?: Logger
  }
}

export {}

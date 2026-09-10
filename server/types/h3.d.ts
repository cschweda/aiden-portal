import type { Logger } from 'pino'

declare module 'h3' {
  interface H3EventContext {
    requestId?: string
    logger?: Logger
  }
}

export {}

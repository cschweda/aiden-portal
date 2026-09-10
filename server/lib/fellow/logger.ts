export type LogFn = (obj: Record<string, unknown>, msg: string) => void

/** Structurally compatible with a pino logger's (obj, msg) call form. */
export interface FellowLogger {
  trace: LogFn
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
}

const ignore: LogFn = () => {}

export const noopLogger: FellowLogger = { trace: ignore, debug: ignore, info: ignore, warn: ignore, error: ignore }

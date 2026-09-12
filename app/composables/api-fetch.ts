import type { NitroFetchOptions } from 'nitropack'

export type ApiFetch = <T>(path: string, options?: NitroFetchOptions<string>) => Promise<T>

let demo: ApiFetch | null = null

/** The demo plugin calls this once; every API read and write then goes to the sample world instead of the network. */
export function useDemoApi(handler: ApiFetch): void {
  demo = handler
}

/** The one place the app calls its own API, so a demo build can answer without a server. Auto-imported. */
export function apiFetch<T>(path: string, options: NitroFetchOptions<string> = {}): Promise<T> {
  return demo ? demo<T>(path, options) : $fetch<T>(path, options)
}

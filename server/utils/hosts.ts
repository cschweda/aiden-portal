/** Lower-cased hostname from a Host header value: the port is dropped, IPv6 brackets are kept. */
export function hostnameOf(host: string | undefined): string {
  if (!host) return ''
  const trimmed = host.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(0, end + 1)
  }
  const colon = trimmed.indexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/** Whether an Origin header names one of the allowed hosts. Anything unparseable, including `null`, is not allowed. */
export function isAllowedOrigin(origin: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  }
  catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return allowedHosts.includes(url.hostname.toLowerCase())
}

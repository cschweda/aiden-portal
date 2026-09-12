export function formatTemperature(celsius: number | undefined): string {
  return celsius === undefined ? '—' : `${celsius}°C`
}

export function formatLitres(litres: number | undefined): string {
  return litres === undefined ? '—' : `${litres.toFixed(1)} L`
}

/** Local clock time with seconds, for log lines. */
export function formatTime(value: string | number | undefined): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** Millilitres as the brewer reports them: "825 mL". */
export function formatMillilitres(ml: number | undefined): string {
  return ml === undefined ? '—' : `${Math.round(ml)} mL`
}

/** A millilitre total shown in litres: "63.6 L". Fellow's `totalWaterVolumeL` is millilitres despite its name. */
export function formatLitresFromMl(ml: number | undefined): string {
  return ml === undefined ? '—' : formatLitres(ml / 1000)
}

/** Epoch seconds or milliseconds (as a number or a numeric string) or a date string to a Date; undefined when unusable. */
export function toDate(value: string | number | undefined | null): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const numeric = typeof value === 'number' ? value : /^\d+$/.test(value.trim()) ? Number(value) : undefined
  const date = numeric === undefined ? new Date(value) : new Date(numeric < 1e11 ? numeric * 1000 : numeric)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Local date and time without seconds, e.g. "12 Sept, 11:45". */
export function formatDateTime(value: string | number | undefined | null): string {
  const date = toDate(value)
  return date ? date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
}

/** How long ago, coarsely: "just now", "5 min ago", "2 h ago", "3 d ago"; a future time reads "in 5 min". */
export function formatAgo(value: string | number | undefined | null, now: number = Date.now()): string {
  const date = toDate(value)
  if (!date) return '—'
  const seconds = Math.round((now - date.getTime()) / 1000)
  const magnitude = Math.abs(seconds)
  if (magnitude < 60) return 'just now'
  const text = magnitude < 3600 ? `${Math.round(magnitude / 60)} min` : magnitude < 86400 ? `${Math.round(magnitude / 3600)} h` : `${Math.round(magnitude / 86400)} d`
  return seconds > 0 ? `${text} ago` : `in ${text}`
}

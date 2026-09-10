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

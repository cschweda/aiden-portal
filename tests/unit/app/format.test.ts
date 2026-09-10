import { describe, expect, it } from 'vitest'
import { formatLitres, formatTemperature, formatTime } from '../../../app/utils/format'

describe('format helpers', () => {
  it('formats temperatures with half degrees', () => {
    expect(formatTemperature(94)).toBe('94°C')
    expect(formatTemperature(91.5)).toBe('91.5°C')
    expect(formatTemperature(undefined)).toBe('—')
  })
  it('formats litres to one decimal', () => {
    expect(formatLitres(12.345)).toBe('12.3 L')
    expect(formatLitres(0)).toBe('0.0 L')
    expect(formatLitres(undefined)).toBe('—')
  })
  it('formats a timestamp as a local clock time and tolerates junk', () => {
    expect(formatTime(Date.UTC(2026, 8, 10, 12, 34, 56))).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(formatTime('2026-09-10T12:34:56Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(formatTime(undefined)).toBe('—')
    expect(formatTime('garbage')).toBe('—')
  })
})

import { describe, expect, it } from 'vitest'
import { parseEnv } from '../../server/utils/config'
import { checkStartupSafety } from '../../server/utils/startup'

const base = { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2' }

describe('checkStartupSafety', () => {
  it('is quiet for a loopback bind', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(checkStartupSafety(parseEnv({ ...base, HOST: host }))).toEqual([])
    }
  })
  it('refuses when HOST is unset, naming the fix', () => {
    const problems = checkStartupSafety(parseEnv(base))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/HOST/)
    expect(problems[0]).toMatch(/127\.0\.0\.1/)
  })
  it.each(['0.0.0.0', '::', '192.168.1.20'])('refuses a non-loopback bind %s', (host) => {
    const problems = checkStartupSafety(parseEnv({ ...base, HOST: host }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(new RegExp(host.replace(/\./g, '\\.')))
  })
})

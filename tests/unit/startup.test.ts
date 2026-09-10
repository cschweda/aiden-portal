import { describe, expect, it } from 'vitest'
import { parseEnv } from '../../server/utils/config'
import { checkStartupSafety } from '../../server/utils/startup'
import { AIDEN } from '../helpers/aiden-fixture'

const base = { FELLOW_EMAIL: 'coffee@example.com', FELLOW_PASSWORD: 'hunter2' }

describe('checkStartupSafety', () => {
  it('is quiet for a loopback bind from the file or the environment', () => {
    expect(checkStartupSafety(parseEnv(base, AIDEN))).toEqual([])
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(checkStartupSafety(parseEnv({ ...base, HOST: host }, AIDEN))).toEqual([])
    }
  })
  it.each(['0.0.0.0', '::', '192.168.1.20'])('refuses a non-loopback bind %s from the environment', (host) => {
    const problems = checkStartupSafety(parseEnv({ ...base, HOST: host }, AIDEN))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(new RegExp(host.replace(/\./g, '\\.')))
  })
  it('refuses a non-loopback bind smuggled in through NITRO_HOST', () => {
    const problems = checkStartupSafety(parseEnv({ ...base, NITRO_HOST: '0.0.0.0', HOST: '127.0.0.1' }, AIDEN))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/0\.0\.0\.0/)
  })
  it('refuses a non-loopback bind written into the file', () => {
    const aiden = { ...AIDEN, server: { ...AIDEN.server, host: '0.0.0.0' } }
    expect(checkStartupSafety(parseEnv(base, aiden))).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'
import { hostnameOf, isAllowedOrigin } from '../../server/utils/hosts'

describe('hostnameOf', () => {
  it.each([
    ['localhost:3000', 'localhost'],
    ['LOCALHOST', 'localhost'],
    ['127.0.0.1:3000', '127.0.0.1'],
    ['[::1]:3000', '[::1]'],
    ['[::1]', '[::1]'],
    ['aiden.example.com', 'aiden.example.com'],
    ['', ''],
    [undefined, ''],
  ])('%j → %j', (host, expected) => {
    expect(hostnameOf(host)).toBe(expected)
  })
})

describe('isAllowedOrigin', () => {
  const allowed = ['localhost', '127.0.0.1', '[::1]']
  it.each([
    ['http://localhost:3000', true],
    ['http://LOCALHOST', true],
    ['http://127.0.0.1:3000', true],
    ['http://[::1]:3000', true],
    ['https://localhost', true],
    ['http://evil.example', false],
    ['http://localhost.evil.example', false],
    ['null', false],
    ['not a url', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (origin, expected) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(expected)
  })
})

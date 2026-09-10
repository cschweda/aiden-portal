import { describe, expect, it } from 'vitest'
import { SERVER_SIDE_PROFILE_FIELDS, stripServerFields } from '../../../server/utils/fellow/strip'
import { PROFILE_INPUT, PROFILE_P7 } from '../../helpers/fellow-fixtures'

describe('stripServerFields', () => {
  it('lists the ten fields from the reference library', () => {
    expect([...SERVER_SIDE_PROFILE_FIELDS]).toEqual([
      'id', 'createdAt', 'deletedAt', 'lastUsedTime', 'sharedFrom',
      'isDefaultProfile', 'instantBrew', 'folder', 'duration', 'lastGBQuantity',
    ])
  })
  it('removes every server-side field and keeps the rest', () => {
    expect(stripServerFields(PROFILE_P7)).toEqual(PROFILE_INPUT)
  })
  it('does not mutate its input', () => {
    const copy = { ...PROFILE_P7 }
    stripServerFields(copy)
    expect(copy).toEqual(PROFILE_P7)
  })
  it('leaves unknown fields alone', () => {
    expect(stripServerFields({ id: 'p1', title: 'x', mystery: 1 })).toEqual({ title: 'x', mystery: 1 })
  })
})

import { describe, expect, it } from 'vitest'

import { getDefaultTitle } from './constants'

describe('getDefaultTitle', () => {
  it('uses the previous month for an expense receipt title', () => {
    expect(getDefaultTitle(new Date(2026, 8, 4))).toBe('8월 경비 영수증')
  })

  it('wraps January back to December', () => {
    expect(getDefaultTitle(new Date(2027, 0, 1))).toBe('12월 경비 영수증')
  })
})

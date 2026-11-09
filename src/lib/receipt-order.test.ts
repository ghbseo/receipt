import { describe, expect, it } from 'vitest'
import { arrangeReceipts } from './receipt-order'

const DAY = 86_400_000
const OCTOBER_FIRST = Date.UTC(2026, 9, 1, 3)

function receipt(name: string, day: number) {
  return { id: name, file: { name, lastModified: OCTOBER_FIRST + (day - 1) * DAY } }
}

const ids = (receipts: { id: string }[]) => receipts.map((item) => item.id)

describe('arrangeReceipts', () => {
  it('orders by last-modified date, oldest first', () => {
    const newestFirst = [receipt('c.jpg', 31), receipt('a.jpg', 15), receipt('b.jpg', 1)]

    expect(ids(arrangeReceipts(newestFirst, 'date'))).toEqual(['b.jpg', 'a.jpg', 'c.jpg'])
  })

  it('breaks date ties by natural file-name order', () => {
    const sameDay = [receipt('영수증10.jpg', 3), receipt('영수증2.jpg', 3), receipt('영수증1.jpg', 3)]

    expect(ids(arrangeReceipts(sameDay, 'date'))).toEqual([
      '영수증1.jpg',
      '영수증2.jpg',
      '영수증10.jpg',
    ])
  })

  it('orders names naturally so numbers compare by value', () => {
    const shuffled = [
      receipt('10월31일.png', 1),
      receipt('10월2일.png', 2),
      receipt('10월10일.png', 3),
      receipt('10월1일.png', 4),
    ]

    expect(ids(arrangeReceipts(shuffled, 'name'))).toEqual([
      '10월1일.png',
      '10월2일.png',
      '10월10일.png',
      '10월31일.png',
    ])
  })

  it('ignores letter case when ordering names', () => {
    const mixedCase = [receipt('b.JPG', 1), receipt('A.jpg', 2)]

    expect(ids(arrangeReceipts(mixedCase, 'name'))).toEqual(['A.jpg', 'b.JPG'])
  })

  it('reverses the current order', () => {
    const current = [receipt('31.jpg', 31), receipt('30.jpg', 30), receipt('1.jpg', 1)]

    expect(ids(arrangeReceipts(current, 'reverse'))).toEqual(['1.jpg', '30.jpg', '31.jpg'])
  })

  it('returns a new array and leaves the input untouched', () => {
    const current = [receipt('b.jpg', 2), receipt('a.jpg', 1)]
    const snapshot = [...current]

    const arranged = arrangeReceipts(current, 'date')

    expect(arranged).not.toBe(current)
    expect(current).toEqual(snapshot)
  })
})

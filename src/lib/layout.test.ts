import { describe, expect, it } from 'vitest'

import type { LayoutReceiptInput, ReceiptPlacement } from '../domain/types'
import {
  calculateLayout,
  LAYOUT_CONSTANTS,
  mmToPt,
  ptToMm,
  wrapCaption,
} from './layout'

const makeReceipt = (
  id: string,
  overrides: Partial<LayoutReceiptInput> = {},
): LayoutReceiptInput => ({
  id,
  widthPx: 1_200,
  heightPx: 2_400,
  description: '',
  forceSinglePage: false,
  ...overrides,
})

const expectInside = (
  placement: ReceiptPlacement,
  body: { x: number; y: number; width: number; height: number },
): void => {
  const epsilon = 1e-7
  const boxes = [placement.frame, placement.image, placement.caption].filter(
    (box): box is NonNullable<typeof box> => box !== undefined,
  )

  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(body.x - epsilon)
    expect(box.y).toBeGreaterThanOrEqual(body.y - epsilon)
    expect(box.x + box.width).toBeLessThanOrEqual(
      body.x + body.width + epsilon,
    )
    expect(box.y + box.height).toBeLessThanOrEqual(
      body.y + body.height + epsilon,
    )
  }
}

const expectNoOverlap = (placements: ReceiptPlacement[]): void => {
  const epsilon = 1e-7
  const extentFor = (placement: ReceiptPlacement) => ({
    left: placement.frame.x,
    top: placement.frame.y,
    right: placement.frame.x + placement.frame.width,
    bottom: placement.frame.y + placement.frame.height,
  })

  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < placements.length;
      rightIndex += 1
    ) {
      const left = extentFor(placements[leftIndex])
      const right = extentFor(placements[rightIndex])
      const separated =
        left.right <= right.left + epsilon ||
        right.right <= left.left + epsilon ||
        left.bottom <= right.top + epsilon ||
        right.bottom <= left.top + epsilon
      expect(separated).toBe(true)
    }
  }
}

const expectContentInsideFrame = (placement: ReceiptPlacement): void => {
  const epsilon = 1e-7
  const boxes = [placement.image, placement.caption].filter(
    (box): box is NonNullable<typeof box> => box !== undefined,
  )

  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(placement.frame.x - epsilon)
    expect(box.y).toBeGreaterThanOrEqual(placement.frame.y - epsilon)
    expect(box.x + box.width).toBeLessThanOrEqual(
      placement.frame.x + placement.frame.width + epsilon,
    )
    expect(box.y + box.height).toBeLessThanOrEqual(
      placement.frame.y + placement.frame.height + epsilon,
    )
  }
}

const distinctCoordinates = (values: number[]): number =>
  new Set(values.map((value) => value.toFixed(5))).size

describe('layout dimensions', () => {
  it('uses exact A4 dimensions and the specified printable regions', () => {
    const manifest = calculateLayout([
      makeReceipt('one', { forceSinglePage: true }),
      makeReceipt('two', { forceSinglePage: true }),
    ])

    expect(manifest.pageWidth).toBe(595.28)
    expect(manifest.pageHeight).toBe(841.89)
    expect(manifest.pages).toHaveLength(2)

    const firstBody = manifest.pages[0].body
    expect(firstBody.x).toBeCloseTo(mmToPt(12), 8)
    expect(firstBody.y).toBeCloseTo(mmToPt(36), 8)
    // A4 is fixed to the requested rounded point size, so derived millimetres
    // differ from nominal ISO dimensions by less than 0.002 mm.
    expect(firstBody.width).toBeCloseTo(mmToPt(186), 2)
    expect(firstBody.height).toBeCloseTo(mmToPt(244), 2)
    expect(manifest.pages[0].headerMode).toBe('full')

    const secondBody = manifest.pages[1].body
    expect(secondBody.y).toBeCloseTo(mmToPt(22), 8)
    expect(secondBody.height).toBeCloseTo(mmToPt(258), 2)
    expect(manifest.pages[1].headerMode).toBe('compact')
  })

  it('returns an empty but valid manifest when there are no receipts', () => {
    expect(calculateLayout([])).toEqual({
      pageWidth: 595.28,
      pageHeight: 841.89,
      pages: [],
      warnings: [],
    })
  })

  it('keeps mm and point conversion reversible', () => {
    for (const value of [0, 1, 6, 12, 35, 58, 210, 297]) {
      expect(ptToMm(mmToPt(value))).toBeCloseTo(value, 12)
    }
  })
})

describe('calculateLayout', () => {
  it('places six typical portrait receipts in a three-column, two-row grid', () => {
    const manifest = calculateLayout(
      Array.from({ length: 6 }, (_, index) =>
        makeReceipt(`portrait-${index}`, {
          description: `점심 영수증 ${index + 1}`,
        }),
      ),
    )
    const page = manifest.pages[0]

    expect(manifest.pages).toHaveLength(1)
    expect(page.receipts.map(({ order }) => order)).toEqual([0, 1, 2, 3, 4, 5])
    expect(page.receipts.every(({ singlePage }) => !singlePage)).toBe(true)
    expect(
      distinctCoordinates(
        page.receipts.map(({ image }) => image.x + image.width / 2),
      ),
    ).toBe(3)
    expect(
      distinctCoordinates(
        page.receipts.map(({ image }) => image.y + image.height / 2),
      ),
    ).toBe(2)
    expect(
      Math.min(...page.receipts.map(({ printedWidthMm }) => printedWidthMm)),
    ).toBeGreaterThanOrEqual(35)
    expect(
      page.receipts.every(
        ({ caption }) => caption !== undefined && caption.lines.length === 1,
      ),
    ).toBe(true)
    page.receipts.forEach((placement) => {
      expectInside(placement, page.body)
      expectContentInsideFrame(placement)
      expect(ptToMm(placement.frame.width)).toBeCloseTo(58, 2)
      expect(ptToMm(placement.frame.height)).toBeCloseTo(119, 2)
    })
    expectNoOverlap(page.receipts)
  })

  it.each([
    [7, [4, 3]],
    [8, [4, 4]],
    [9, [5, 4]],
    [10, [5, 5]],
    [11, [6, 5]],
    [12, [6, 6]],
    [13, [5, 4, 4]],
  ])('balances %i receipts globally as %j', (receiptCount, expectedCounts) => {
    const manifest = calculateLayout(
      Array.from({ length: receiptCount }, (_, index) =>
        makeReceipt(`balanced-${index}`),
      ),
    )

    expect(manifest.pages.map((page) => page.receipts.length)).toEqual(
      expectedCounts,
    )
  })

  it('centres an incomplete final row instead of leaving it aligned to one side', () => {
    const manifest = calculateLayout([
      makeReceipt('one'),
      makeReceipt('two'),
      makeReceipt('three'),
      makeReceipt('four'),
      makeReceipt('five'),
    ])
    const page = manifest.pages[0]
    const lastRow = page.receipts.slice(3)
    const averageCentre =
      lastRow.reduce(
        (total, placement) =>
          total + placement.image.x + placement.image.width / 2,
        0,
      ) / lastRow.length

    expect(page.receipts).toHaveLength(5)
    expect(averageCentre).toBeCloseTo(page.body.x + page.body.width / 2, 8)
    page.receipts.forEach(expectContentInsideFrame)
    expectNoOverlap(page.receipts)
  })

  it('chooses grids from the receipt aspect ratios', () => {
    const fourTall = calculateLayout(
      Array.from({ length: 4 }, (_, index) =>
        makeReceipt(`tall-${index}`, { widthPx: 800, heightPx: 4_000 }),
      ),
    ).pages[0]
    expect(
      distinctCoordinates(
        fourTall.receipts.map(({ image }) => image.x + image.width / 2),
      ),
    ).toBe(4)
    expect(
      distinctCoordinates(
        fourTall.receipts.map(({ image }) => image.y + image.height / 2),
      ),
    ).toBe(1)

    const fourSquare = calculateLayout(
      Array.from({ length: 4 }, (_, index) =>
        makeReceipt(`square-${index}`, { widthPx: 2_000, heightPx: 2_000 }),
      ),
    ).pages[0]
    expect(
      distinctCoordinates(
        fourSquare.receipts.map(({ image }) => image.x + image.width / 2),
      ),
    ).toBe(2)
    expect(
      distinctCoordinates(
        fourSquare.receipts.map(({ image }) => image.y + image.height / 2),
      ),
    ).toBe(2)

    const sixWide = calculateLayout(
      Array.from({ length: 6 }, (_, index) =>
        makeReceipt(`wide-${index}`, { widthPx: 4_000, heightPx: 2_000 }),
      ),
    ).pages[0]
    expect(
      distinctCoordinates(
        sixWide.receipts.map(({ image }) => image.x + image.width / 2),
      ),
    ).toBe(2)
    expect(
      distinctCoordinates(
        sixWide.receipts.map(({ image }) => image.y + image.height / 2),
      ),
    ).toBe(3)
  })

  it('falls back to smaller groups when a dense grid would print below 35 mm', () => {
    const manifest = calculateLayout(
      Array.from({ length: 6 }, (_, index) =>
        makeReceipt(`slender-${index}`, { widthPx: 640, heightPx: 4_000 }),
      ),
    )

    expect(manifest.pages.map((page) => page.receipts.length)).toEqual([4, 2])
    expect(
      manifest.pages.flatMap((page) => page.receipts).every(
        ({ printedWidthMm }) => printedWidthMm >= 35,
      ),
    ).toBe(true)
  })

  it('isolates forced receipts and never groups across them', () => {
    const manifest = calculateLayout(
      Array.from({ length: 9 }, (_, index) =>
        makeReceipt(`forced-boundary-${index}`, {
          forceSinglePage: index === 4,
        }),
      ),
    )

    expect(manifest.pages.map((page) => page.receipts.length)).toEqual([4, 1, 4])
    expect(manifest.pages[1].receipts[0]).toEqual(
      expect.objectContaining({ id: 'forced-boundary-4', singlePage: true }),
    )
    expect(manifest.pages[1].receipts[0].frame).toEqual(
      manifest.pages[1].body,
    )
  })

  it('lays out the ten acceptance-set aspect ratios as two balanced pages', () => {
    const dimensions = [
      [428, 1_373],
      [648, 1_493],
      [648, 1_493],
      [428, 1_373],
      [648, 1_493],
      [648, 1_493],
      [648, 1_456],
      [671, 1_522],
      [648, 1_493],
      [648, 1_493],
    ] as const
    const manifest = calculateLayout(
      dimensions.map(([widthPx, heightPx], index) =>
        makeReceipt(`acceptance-${index}`, {
          widthPx,
          heightPx,
          description: index % 2 === 0 ? '점심 식대 영수증' : '',
        }),
      ),
    )

    expect(manifest.pages).toHaveLength(2)
    expect(manifest.pages.every((page) => page.receipts.length === 5)).toBe(
      true,
    )
    for (const placement of manifest.pages.flatMap((page) => page.receipts)) {
      expect(placement.printedWidthMm).toBeGreaterThanOrEqual(35)
    }
  })

  it('preserves aspect ratio and keeps captions below images without clipping', () => {
    const source = makeReceipt('captioned', {
      widthPx: 997,
      heightPx: 3_101,
      description:
        '팀 점심 식대 결제 영수증이며 이 설명은 두 줄 안에서 안전하게 표시되어야 합니다.',
      forceSinglePage: true,
    })
    const manifest = calculateLayout([source])
    const page = manifest.pages[0]
    const placement = page.receipts[0]

    expect(placement.image.width / placement.image.height).toBeCloseTo(
      source.widthPx / source.heightPx,
      12,
    )
    expect(placement.caption?.lines.length).toBeLessThanOrEqual(2)
    expect(placement.caption?.y).toBeGreaterThanOrEqual(
      placement.image.y + placement.image.height,
    )
    expectInside(placement, page.body)
  })

  it('emits narrow-print and low-DPI warnings independently', () => {
    const narrow = calculateLayout([
      makeReceipt('narrow', {
        widthPx: 10_000,
        heightPx: 80_000,
        forceSinglePage: true,
      }),
    ])
    expect(narrow.warnings.map(({ code }) => code)).toEqual(['NARROW_PRINT'])

    const lowDpi = calculateLayout([
      makeReceipt('low-a', { widthPx: 300, heightPx: 600 }),
      makeReceipt('low-b', { widthPx: 300, heightPx: 600 }),
    ])
    expect(lowDpi.warnings).toEqual([
      expect.objectContaining({ receiptId: 'low-a', code: 'LOW_DPI' }),
      expect.objectContaining({ receiptId: 'low-b', code: 'LOW_DPI' }),
    ])
  })

  it('uses one caption line on dense pages and up to two on smaller pages', () => {
    const description = '가'.repeat(60)
    const dense = calculateLayout(
      Array.from({ length: 4 }, (_, index) =>
        makeReceipt(`dense-caption-${index}`, {
          widthPx: 2_000,
          heightPx: 2_000,
          description,
        }),
      ),
    )
    expect(
      dense.pages[0].receipts.every(
        ({ caption }) =>
          caption?.lines.length === 1 && caption.lines[0].endsWith('…'),
      ),
    ).toBe(true)

    const sparse = calculateLayout(
      Array.from({ length: 3 }, (_, index) =>
        makeReceipt(`sparse-caption-${index}`, {
          widthPx: 2_000,
          heightPx: 2_000,
          description,
        }),
      ),
    )
    expect(
      sparse.pages[0].receipts.every(
        ({ caption }) => caption?.lines.length === 2,
      ),
    ).toBe(true)
  })

  it('rejects zero, negative, infinite, and NaN dimensions', () => {
    for (const invalid of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        calculateLayout([makeReceipt('invalid', { widthPx: invalid })]),
      ).toThrow(RangeError)
      expect(() =>
        calculateLayout([makeReceipt('invalid', { heightPx: invalid })]),
      ).toThrow(RangeError)
    }
  })

  it('maintains bounds, order, aspect ratio, and page grouping over varied inputs', () => {
    let state = 0x1a2b3c4d
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state / 0x1_0000_0000
    }

    const receipts = Array.from({ length: 121 }, (_, index) =>
      makeReceipt(`receipt-${index}`, {
        widthPx: 100 + Math.floor(random() * 7_900),
        heightPx: 100 + Math.floor(random() * 11_900),
        description:
          index % 3 === 0
            ? `영수증 ${index} 설명 ${'가나다라마바사'.repeat(index % 9)}`
            : '',
        forceSinglePage: index % 17 === 0,
      }),
    )
    const manifest = calculateLayout(receipts)
    const flattened = manifest.pages.flatMap((page) => page.receipts)

    expect(flattened.map(({ id }) => id)).toEqual(
      receipts.map(({ id }) => id),
    )
    expect(flattened.map(({ order }) => order)).toEqual(
      receipts.map((_, index) => index),
    )

    for (const page of manifest.pages) {
      expect(page.receipts.length).toBeGreaterThanOrEqual(1)
      expect(page.receipts.length).toBeLessThanOrEqual(6)
      expect(page.receipts.every(({ singlePage }) => singlePage)).toBe(
        page.receipts.length === 1,
      )
      expectNoOverlap(page.receipts)

      for (const placement of page.receipts) {
        const source = receipts[placement.order]
        expectInside(placement, page.body)
        expectContentInsideFrame(placement)
        expect(placement.image.width / placement.image.height).toBeCloseTo(
          source.widthPx / source.heightPx,
          10,
        )
        expect(placement.printedWidthMm).toBeCloseTo(
          ptToMm(placement.image.width),
          10,
        )
        expect(placement.effectiveDpi).toBeCloseTo(
          source.widthPx / (placement.printedWidthMm / 25.4),
          8,
        )
      }
    }
  })
})

describe('wrapCaption', () => {
  it('returns no lines for an empty caption and collapses horizontal spaces', () => {
    expect(wrapCaption('   ', 100)).toEqual([])
    expect(wrapCaption('점심    식대', 100)).toEqual(['점심 식대'])
  })

  it('wraps to at most two lines and marks truncated overflow', () => {
    const lines = wrapCaption('가'.repeat(80), 80, 8)

    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('honours an explicit line break', () => {
    expect(wrapCaption('첫 줄\n둘째 줄', 200)).toEqual(['첫 줄', '둘째 줄'])
  })

  it('validates width and font-size arguments', () => {
    expect(() => wrapCaption('설명', 0)).toThrow(RangeError)
    expect(() => wrapCaption('설명', 100, Number.NaN)).toThrow(RangeError)
  })

  it('fits a maximum-length Korean caption into two 89 mm lines', () => {
    const lines = wrapCaption('가'.repeat(60), mmToPt(89))

    expect(lines).toHaveLength(2)
    expect(lines.join('')).toBe('가'.repeat(60))
  })

  it('reserves enough width for Nanum Gothic wide ASCII glyphs', () => {
    const lines = wrapCaption('W'.repeat(60), mmToPt(89))

    expect(lines).toHaveLength(2)
    expect(lines.every((line) => line.length <= 30)).toBe(true)
    expect(lines.join('')).toBe('W'.repeat(60))
  })
})

describe('published layout constants', () => {
  it('defines the dense-layout threshold, gap, and page capacity', () => {
    expect(ptToMm(LAYOUT_CONSTANTS.minimumPrintedWidth)).toBeCloseTo(35, 12)
    expect(ptToMm(LAYOUT_CONSTANTS.gridGap)).toBeCloseTo(6, 12)
    expect(ptToMm(LAYOUT_CONSTANTS.columnGap)).toBeCloseTo(6, 12)
    expect(LAYOUT_CONSTANTS.maxReceiptsPerPage).toBe(6)
  })
})

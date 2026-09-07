import type {
  LayoutManifest,
  LayoutPage,
  LayoutReceiptInput,
  LayoutWarning,
  PointBox,
  ReceiptPlacement,
} from '../domain/types'

export const PT_PER_MM = 72 / 25.4

export const mmToPt = (millimetres: number): number => millimetres * PT_PER_MM
export const ptToMm = (points: number): number => points / PT_PER_MM

export const LAYOUT_CONSTANTS = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  margin: mmToPt(12),
  fullHeaderHeight: mmToPt(24),
  compactHeaderHeight: mmToPt(10),
  footerHeight: mmToPt(5),
  gridGap: mmToPt(6),
  // Kept as a backwards-compatible alias for consumers of the published
  // constants. Dense layouts use the same gap in both directions.
  columnGap: mmToPt(6),
  minimumPrintedWidth: mmToPt(35),
  maxReceiptsPerPage: 6,
  minimumEffectiveDpi: 150,
  captionGap: mmToPt(2),
  captionFontSize: 8,
  captionLineHeight: mmToPt(4.2),
} as const

const MAX_CAPTION_LINES = 2
const ELLIPSIS = '…'

/**
 * Estimates text width closely enough to reserve deterministic caption space.
 * The PDF renderer consumes the returned lines rather than wrapping independently.
 */
const estimateCaptionWidth = (value: string, fontSizePt: number): number => {
  let emWidth = 0

  for (const character of Array.from(value)) {
    if (/\p{Mark}/u.test(character)) {
      continue
    }

    if (/\s/u.test(character)) {
      emWidth += 0.35
    } else if (/^[\u0021-\u007e]$/u.test(character)) {
      // Nanum Gothic's widest ASCII glyphs (notably W) are slightly wider
      // than one em. A conservative bound keeps both the CSS preview and the
      // PDF inside the manifest box; the PDF renderer measures once more.
      emWidth += 1.05
    } else {
      // Hangul, CJK, and other full-width glyphs.
      emWidth += 1
    }
  }

  return emWidth * fontSizePt
}

const ellipsize = (
  value: string,
  maxWidthPt: number,
  fontSizePt: number,
): string => {
  const characters = Array.from(value.trimEnd())

  while (
    characters.length > 0 &&
    estimateCaptionWidth(`${characters.join('')}${ELLIPSIS}`, fontSizePt) >
      maxWidthPt
  ) {
    characters.pop()
  }

  return `${characters.join('').trimEnd()}${ELLIPSIS}`
}

/**
 * Wraps a receipt caption into at most two lines. Newlines are honoured, horizontal
 * whitespace is collapsed, and overflowing content is represented with an ellipsis.
 */
const wrapCaptionWithLimit = (
  text: string,
  maxWidthPt: number,
  fontSizePt: number,
  maxLines: number,
): string[] => {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .trim()

  if (normalized.length === 0) {
    return []
  }

  if (!Number.isFinite(maxWidthPt) || maxWidthPt <= 0) {
    throw new RangeError('Caption width must be a positive finite number.')
  }

  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
    throw new RangeError('Caption font size must be a positive finite number.')
  }

  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > MAX_CAPTION_LINES) {
    throw new RangeError(`Caption line limit must be between 1 and ${MAX_CAPTION_LINES}.`)
  }

  const lines: string[] = []
  let current = ''
  let truncated = false

  const commitLine = (): boolean => {
    const committed = current.trim()
    if (committed.length > 0) {
      lines.push(committed)
    }
    current = ''

    if (lines.length === maxLines) {
      truncated = true
      return false
    }

    return true
  }

  outer: for (const character of Array.from(normalized)) {
    if (character === '\n') {
      if (!commitLine()) {
        break
      }
      continue
    }

    const candidate = `${current}${character}`
    if (
      current.length === 0 ||
      estimateCaptionWidth(candidate, fontSizePt) <= maxWidthPt
    ) {
      current = candidate
      continue
    }

    const lastSpace = current.lastIndexOf(' ')
    if (lastSpace > 0) {
      const remainder = current.slice(lastSpace + 1)
      current = current.slice(0, lastSpace)
      if (!commitLine()) {
        break outer
      }
      current = `${remainder}${character}`.trimStart()
    } else {
      if (!commitLine()) {
        break outer
      }
      current = character.trimStart()
    }
  }

  if (!truncated && current.trim().length > 0) {
    lines.push(current.trim())
  }

  if (lines.length > maxLines) {
    truncated = true
    lines.length = maxLines
  }

  if (truncated && lines.length > 0) {
    const lastIndex = Math.min(lines.length, maxLines) - 1
    lines[lastIndex] = ellipsize(lines[lastIndex], maxWidthPt, fontSizePt)
  }

  return lines.slice(0, maxLines)
}

export const wrapCaption = (
  text: string,
  maxWidthPt: number,
  fontSizePt: number = LAYOUT_CONSTANTS.captionFontSize,
): string[] =>
  wrapCaptionWithLimit(text, maxWidthPt, fontSizePt, MAX_CAPTION_LINES)

const getBody = (pageIndex: number): PointBox => {
  const headerHeight =
    pageIndex === 0
      ? LAYOUT_CONSTANTS.fullHeaderHeight
      : LAYOUT_CONSTANTS.compactHeaderHeight

  return {
    x: LAYOUT_CONSTANTS.margin,
    y: LAYOUT_CONSTANTS.margin + headerHeight,
    width: LAYOUT_CONSTANTS.pageWidth - LAYOUT_CONSTANTS.margin * 2,
    height:
      LAYOUT_CONSTANTS.pageHeight -
      LAYOUT_CONSTANTS.margin * 2 -
      headerHeight -
      LAYOUT_CONSTANTS.footerHeight,
  }
}

const assertValidReceipt = (receipt: LayoutReceiptInput): void => {
  if (
    !Number.isFinite(receipt.widthPx) ||
    !Number.isFinite(receipt.heightPx) ||
    receipt.widthPx <= 0 ||
    receipt.heightPx <= 0
  ) {
    throw new RangeError(
      `Receipt "${receipt.id}" must have positive finite pixel dimensions.`,
    )
  }
}

const contain = (
  widthPx: number,
  heightPx: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } => {
  const aspectRatio = widthPx / heightPx
  const slotAspectRatio = maxWidth / maxHeight

  if (aspectRatio >= slotAspectRatio) {
    return { width: maxWidth, height: maxWidth / aspectRatio }
  }

  return { width: maxHeight * aspectRatio, height: maxHeight }
}

const createPlacement = (
  receipt: LayoutReceiptInput,
  order: number,
  slot: PointBox,
  singlePage: boolean,
  captionLineLimit: number,
): ReceiptPlacement => {
  const captionLines = wrapCaptionWithLimit(
    receipt.description,
    slot.width,
    LAYOUT_CONSTANTS.captionFontSize,
    captionLineLimit,
  )
  const captionHeight =
    captionLines.length * LAYOUT_CONSTANTS.captionLineHeight
  const captionSectionHeight =
    captionLines.length > 0
      ? LAYOUT_CONSTANTS.captionGap + captionHeight
      : 0
  const maximumImageHeight = slot.height - captionSectionHeight
  const contained = contain(
    receipt.widthPx,
    receipt.heightPx,
    slot.width,
    maximumImageHeight,
  )
  const contentHeight = contained.height + captionSectionHeight
  const imageX = slot.x + (slot.width - contained.width) / 2
  const imageY = slot.y + (slot.height - contentHeight) / 2
  const printedWidthMm = ptToMm(contained.width)
  const effectiveDpi = receipt.widthPx / (printedWidthMm / 25.4)

  return {
    id: receipt.id,
    order,
    frame: { ...slot },
    image: {
      x: imageX,
      y: imageY,
      width: contained.width,
      height: contained.height,
    },
    ...(captionLines.length > 0
      ? {
          caption: {
            x: slot.x,
            y:
              imageY +
              contained.height +
              LAYOUT_CONSTANTS.captionGap,
            width: slot.width,
            height: captionHeight,
            lines: captionLines,
          },
        }
      : {}),
    printedWidthMm,
    effectiveDpi,
    singlePage,
  }
}

const warningsFor = (placement: ReceiptPlacement): LayoutWarning[] => {
  const warnings: LayoutWarning[] = []

  if (placement.image.width < LAYOUT_CONSTANTS.minimumPrintedWidth) {
    warnings.push({
      receiptId: placement.id,
      code: 'NARROW_PRINT',
      message: '인쇄 시 글자가 작을 수 있습니다.',
    })
  }

  if (placement.effectiveDpi < LAYOUT_CONSTANTS.minimumEffectiveDpi) {
    warnings.push({
      receiptId: placement.id,
      code: 'LOW_DPI',
      message: '원본 해상도가 낮아 인쇄 품질이 떨어질 수 있습니다.',
    })
  }

  return warnings
}

interface GridShape {
  columns: number
  rows: number
}

interface GridCandidate {
  placements: ReceiptPlacement[]
  minimumPrintedWidth: number
  totalImageArea: number
}

interface PlannedPage {
  page: LayoutPage
  minimumPrintedWidth: number
  totalImageArea: number
}

interface PaginationScore {
  pageCount: number
  underfilledPageCount: number
  squaredReceiptCount: number
  minimumPrintedWidth: number
  totalImageArea: number
  receiptCounts: number[]
}

interface PaginationPlan {
  pages: PlannedPage[]
  score: PaginationScore
}

const GRID_CANDIDATES: Readonly<Record<number, readonly GridShape[]>> = {
  1: [{ columns: 1, rows: 1 }],
  2: [
    { columns: 2, rows: 1 },
    { columns: 1, rows: 2 },
  ],
  3: [
    { columns: 3, rows: 1 },
    { columns: 2, rows: 2 },
    { columns: 1, rows: 3 },
  ],
  4: [
    { columns: 2, rows: 2 },
    { columns: 4, rows: 1 },
    { columns: 1, rows: 4 },
  ],
  5: [
    { columns: 3, rows: 2 },
    { columns: 2, rows: 3 },
    { columns: 1, rows: 5 },
  ],
  6: [
    { columns: 3, rows: 2 },
    { columns: 2, rows: 3 },
    { columns: 1, rows: 6 },
  ],
}

const SCORE_EPSILON = 1e-7

const slotsForGrid = (
  body: PointBox,
  receiptCount: number,
  shape: GridShape,
): PointBox[] => {
  const gap = LAYOUT_CONSTANTS.gridGap
  const cellWidth = (body.width - gap * (shape.columns - 1)) / shape.columns
  const cellHeight = (body.height - gap * (shape.rows - 1)) / shape.rows

  return Array.from({ length: receiptCount }, (_, index) => {
    const row = Math.floor(index / shape.columns)
    const column = index % shape.columns
    const receiptsInRow = Math.min(
      shape.columns,
      receiptCount - row * shape.columns,
    )
    const occupiedWidth =
      receiptsInRow * cellWidth + (receiptsInRow - 1) * gap
    const rowOffset = (body.width - occupiedWidth) / 2

    return {
      x: body.x + rowOffset + column * (cellWidth + gap),
      y: body.y + row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight,
    }
  })
}

const isBetterGrid = (
  candidate: GridCandidate,
  current: GridCandidate | undefined,
): boolean => {
  if (!current) return true

  if (
    candidate.minimumPrintedWidth >
    current.minimumPrintedWidth + SCORE_EPSILON
  ) {
    return true
  }

  if (
    Math.abs(candidate.minimumPrintedWidth - current.minimumPrintedWidth) <=
      SCORE_EPSILON &&
    candidate.totalImageArea > current.totalImageArea + SCORE_EPSILON
  ) {
    return true
  }

  return false
}

const bestGridFor = (
  receipts: LayoutReceiptInput[],
  firstOrder: number,
  body: PointBox,
): GridCandidate => {
  const receiptCount = receipts.length
  const shapes = GRID_CANDIDATES[receiptCount]

  if (!shapes) {
    throw new RangeError(
      `A page must contain between 1 and ${LAYOUT_CONSTANTS.maxReceiptsPerPage} receipts.`,
    )
  }

  const captionLineLimit = receiptCount >= 4 ? 1 : MAX_CAPTION_LINES
  let best: GridCandidate | undefined

  for (const shape of shapes) {
    const slots = slotsForGrid(body, receiptCount, shape)
    const placements = receipts.map((receipt, index) =>
      createPlacement(
        receipt,
        firstOrder + index,
        slots[index],
        receiptCount === 1,
        captionLineLimit,
      ),
    )
    const candidate: GridCandidate = {
      placements,
      minimumPrintedWidth: Math.min(
        ...placements.map((placement) => placement.image.width),
      ),
      totalImageArea: placements.reduce(
        (total, placement) =>
          total + placement.image.width * placement.image.height,
        0,
      ),
    }

    if (isBetterGrid(candidate, best)) best = candidate
  }

  if (!best) {
    throw new Error('No grid candidates were available for the page.')
  }

  return best
}

const isBetterPagination = (
  candidate: PaginationPlan,
  current: PaginationPlan | undefined,
): boolean => {
  if (!current) return true

  const candidateScore = candidate.score
  const currentScore = current.score

  if (candidateScore.pageCount !== currentScore.pageCount) {
    return candidateScore.pageCount < currentScore.pageCount
  }

  if (
    candidateScore.underfilledPageCount !==
    currentScore.underfilledPageCount
  ) {
    return (
      candidateScore.underfilledPageCount <
      currentScore.underfilledPageCount
    )
  }

  if (
    candidateScore.squaredReceiptCount !==
    currentScore.squaredReceiptCount
  ) {
    return (
      candidateScore.squaredReceiptCount <
      currentScore.squaredReceiptCount
    )
  }

  // With an otherwise equally balanced plan, fill earlier pages first. This
  // keeps pagination stable (for example 7 -> 4 + 3 and 9 -> 5 + 4) even
  // though later pages have a slightly taller compact-header body.
  for (
    let index = 0;
    index < candidateScore.receiptCounts.length;
    index += 1
  ) {
    const candidateCount = candidateScore.receiptCounts[index]
    const currentCount = currentScore.receiptCounts[index]
    if (candidateCount !== currentCount) return candidateCount > currentCount
  }

  if (
    candidateScore.minimumPrintedWidth >
    currentScore.minimumPrintedWidth + SCORE_EPSILON
  ) {
    return true
  }
  if (
    candidateScore.minimumPrintedWidth + SCORE_EPSILON <
    currentScore.minimumPrintedWidth
  ) {
    return false
  }

  if (
    candidateScore.totalImageArea >
    currentScore.totalImageArea + SCORE_EPSILON
  ) {
    return true
  }
  if (
    candidateScore.totalImageArea + SCORE_EPSILON <
    currentScore.totalImageArea
  ) {
    return false
  }

  return false
}

const calculatePagination = (
  receipts: LayoutReceiptInput[],
): PaginationPlan => {
  const memo = new Map<string, PaginationPlan>()

  const solve = (
    receiptIndex: number,
    usesFullHeader: boolean,
  ): PaginationPlan => {
    if (receiptIndex === receipts.length) {
      return {
        pages: [],
        score: {
          pageCount: 0,
          underfilledPageCount: 0,
          squaredReceiptCount: 0,
          minimumPrintedWidth: Number.POSITIVE_INFINITY,
          totalImageArea: 0,
          receiptCounts: [],
        },
      }
    }

    // Every page after the first has the same compact-header body. Keeping
    // only that distinction in the memo key makes planning linear in the
    // receipt count rather than duplicating identical work for every possible
    // absolute page number.
    const memoKey = `${receiptIndex}:${usesFullHeader ? 'full' : 'compact'}`
    const memoized = memo.get(memoKey)
    if (memoized) return memoized

    const current = receipts[receiptIndex]
    const maximumCount = current.forceSinglePage
      ? 1
      : Math.min(
          LAYOUT_CONSTANTS.maxReceiptsPerPage,
          receipts.length - receiptIndex,
        )
    const body = getBody(usesFullHeader ? 0 : 1)
    let best: PaginationPlan | undefined

    for (let receiptCount = 1; receiptCount <= maximumCount; receiptCount += 1) {
      const group = receipts.slice(receiptIndex, receiptIndex + receiptCount)
      if (
        receiptCount > 1 &&
        group.some((receipt) => receipt.forceSinglePage)
      ) {
        break
      }

      const grid = bestGridFor(group, receiptIndex, body)
      if (
        receiptCount > 1 &&
        grid.minimumPrintedWidth + SCORE_EPSILON <
          LAYOUT_CONSTANTS.minimumPrintedWidth
      ) {
        continue
      }

      const tail = solve(receiptIndex + receiptCount, false)
      const plannedPage: PlannedPage = {
        page: {
          index: 0,
          headerMode: usesFullHeader ? 'full' : 'compact',
          body,
          receipts: grid.placements,
        },
        minimumPrintedWidth: grid.minimumPrintedWidth,
        totalImageArea: grid.totalImageArea,
      }
      const candidate: PaginationPlan = {
        pages: [plannedPage, ...tail.pages],
        score: {
          pageCount: tail.score.pageCount + 1,
          underfilledPageCount:
            tail.score.underfilledPageCount + (receiptCount < 4 ? 1 : 0),
          squaredReceiptCount:
            tail.score.squaredReceiptCount + receiptCount * receiptCount,
          minimumPrintedWidth: Math.min(
            grid.minimumPrintedWidth,
            tail.score.minimumPrintedWidth,
          ),
          totalImageArea: grid.totalImageArea + tail.score.totalImageArea,
          receiptCounts: [receiptCount, ...tail.score.receiptCounts],
        },
      }

      if (isBetterPagination(candidate, best)) best = candidate
    }

    if (!best) {
      throw new Error('Unable to create a valid receipt pagination plan.')
    }

    memo.set(memoKey, best)
    return best
  }

  return solve(0, true)
}

/**
 * Calculates an A4 portrait layout using top-left point coordinates. The returned
 * manifest is the single source of truth for both preview and PDF rendering.
 */
export const calculateLayout = (
  receipts: LayoutReceiptInput[],
): LayoutManifest => {
  receipts.forEach(assertValidReceipt)
  const pagination = calculatePagination(receipts)
  const pages = pagination.pages.map(({ page }, index) => ({
    ...page,
    index,
    headerMode: index === 0 ? ('full' as const) : ('compact' as const),
  }))
  const warnings = pages.flatMap((page) =>
    page.receipts.flatMap(warningsFor),
  )

  return {
    pageWidth: LAYOUT_CONSTANTS.pageWidth,
    pageHeight: LAYOUT_CONSTANTS.pageHeight,
    pages,
    warnings,
  }
}

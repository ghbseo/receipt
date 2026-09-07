import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from 'pdf-lib'

import { INPUT_LIMITS } from '../domain/constants'
import {
  inspectImage,
  validatePixelCount,
  type InspectedImage,
  type SupportedImageMime,
} from '../lib/image/inspector'
import type {
  DocumentFields,
  LayoutManifest,
  NormalizedImageResult,
  PdfReceiptPayload,
  PointBox,
  ReceiptPlacement,
  Rotation,
  WorkerRequest,
  WorkerResponse,
} from '../domain/types'

const PREVIEW_MAX_EDGE_PX = 1_200
const PDF_MAX_DPI = 300
const JPEG_QUALITY = 0.92
const CAPTION_FONT_SIZE = 8
const FULL_TITLE_FONT_SIZE = 16
const FULL_META_FONT_SIZE = 9
const FULL_META_VALUE_GAP = 4
const FULL_META_GROUP_GAP = 14
const COMPACT_TITLE_FONT_SIZE = 9
const COMPACT_META_FONT_SIZE = 8
const FOOTER_FONT_SIZE = 8
const BLACK = rgb(0.12, 0.12, 0.12)
const MUTED = rgb(0.35, 0.35, 0.35)
const RULE = rgb(0.78, 0.78, 0.78)
const RECEIPT_FRAME_WIDTH = 0.6
const CAPTION_SEPARATOR_WIDTH = 0.6

interface RenderedImage {
  blob: Blob
  width: number
  height: number
}

class CancelledError extends Error {
  constructor() {
    super('작업이 취소되었습니다.')
    this.name = 'AbortError'
  }
}

const scope = self as unknown as DedicatedWorkerGlobalScope
const queuedRequestIds = new Set<string>()
const cancelledRequestIds = new Set<string>()
const cancellationAcknowledged = new Set<string>()
let workQueue: Promise<void> = Promise.resolve()

let fontBytesPromise:
  | Promise<{ regular: Uint8Array; bold: Uint8Array }>
  | undefined

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data

  if (request.type === 'CANCEL') {
    if (queuedRequestIds.has(request.requestId)) {
      cancelledRequestIds.add(request.requestId)
      cancellationAcknowledged.add(request.requestId)
    }
    post({ type: 'CANCELLED', requestId: request.requestId })
    return
  }

  queuedRequestIds.add(request.requestId)
  workQueue = workQueue
    .then(() => handleRequest(request))
    .catch(() => {
      // handleRequest converts failures to protocol responses. Keeping this
      // catch on the queue ensures one unexpected failure cannot stall it.
    })
})

async function handleRequest(
  request: Exclude<WorkerRequest, { type: 'CANCEL' }>,
): Promise<void> {
  try {
    assertNotCancelled(request.requestId)

    if (request.type === 'NORMALIZE_IMAGE') {
      const result = await normalizeImage(request.file, request.id, request.requestId)
      assertNotCancelled(request.requestId)
      post({ type: 'NORMALIZED_IMAGE', requestId: request.requestId, result })
      return
    }

    const buffer = await generatePdf(
      request.fields,
      request.receipts,
      request.manifest,
      request.requestId,
    )
    assertNotCancelled(request.requestId)
    post({ type: 'PDF_READY', requestId: request.requestId, buffer }, [buffer])
  } catch (error) {
    if (error instanceof CancelledError) {
      if (!cancellationAcknowledged.has(request.requestId)) {
        post({ type: 'CANCELLED', requestId: request.requestId })
      }
      return
    }

    post({
      type: 'ERROR',
      requestId: request.requestId,
      message: errorMessage(error),
    })
  } finally {
    queuedRequestIds.delete(request.requestId)
    cancelledRequestIds.delete(request.requestId)
    cancellationAcknowledged.delete(request.requestId)
  }
}

async function normalizeImage(
  file: File,
  id: string,
  requestId: string,
): Promise<NormalizedImageResult> {
  const bytes = await readAndInspectFile(file, requestId)
  const bitmap = await decodeImage(bytes.buffer, bytes.info.mime, requestId)

  try {
    assertDecodedDimensions(bitmap, bytes.info)
    const scale = Math.min(
      1,
      PREVIEW_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height),
    )
    const rendered = await renderBitmap(
      bitmap,
      0,
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
      bytes.info.mime,
      requestId,
    )

    return {
      id,
      blob: rendered.blob,
      widthPx: bitmap.width,
      heightPx: bitmap.height,
    }
  } finally {
    bitmap.close()
  }
}

async function generatePdf(
  fields: DocumentFields,
  receipts: PdfReceiptPayload[],
  manifest: LayoutManifest,
  requestId: string,
): Promise<ArrayBuffer> {
  validateDocumentPayload(fields, receipts)
  validateManifest(manifest)
  validateReceiptMapping(receipts, manifest)
  assertNotCancelled(requestId)

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)

  const fontBytes = await getFontBytes()
  assertNotCancelled(requestId)
  const [regularFont, boldFont] = await Promise.all([
    // The pdf-lib/fontkit subset output for Nanum Gothic renders incomplete
    // Hangul text in Chromium/Edge PDF viewers. Embedding the complete font
    // keeps Korean document fields and captions intact across PDF viewers.
    pdf.embedFont(fontBytes.regular, { subset: false }),
    pdf.embedFont(fontBytes.bold, { subset: false }),
  ])

  validateDocumentCharacters(fields, manifest, regularFont, boldFont)
  pdf.setTitle(fields.title)
  pdf.setSubject('영수증 첨부 문서')
  pdf.setCreator('Receipt PDF Maker')
  pdf.setProducer('Receipt PDF Maker')

  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]))
  const total = manifest.pages.reduce(
    (count, page) => count + page.receipts.length,
    0,
  )
  let completed = 0
  post({ type: 'PDF_PROGRESS', requestId, current: completed, total })

  for (const layoutPage of manifest.pages) {
    assertNotCancelled(requestId)
    const page = pdf.addPage([manifest.pageWidth, manifest.pageHeight])
    drawHeader(
      page,
      fields,
      layoutPage.headerMode,
      layoutPage.body,
      regularFont,
      boldFont,
      manifest.pageHeight,
    )
    drawFooter(
      page,
      layoutPage.index + 1,
      manifest.pages.length,
      layoutPage.body,
      regularFont,
      manifest.pageHeight,
    )

    for (const placement of layoutPage.receipts) {
      assertNotCancelled(requestId)
      const receipt = receiptById.get(placement.id)
      if (!receipt) {
        throw new Error(`영수증 ${placement.id}의 원본 이미지를 찾을 수 없습니다.`)
      }

      const embedded = await preparePdfImage(
        pdf,
        receipt,
        placement,
        requestId,
      )
      assertNotCancelled(requestId)
      drawPlacedImage(page, embedded, placement.image, manifest.pageHeight)
      drawCaption(page, placement, regularFont, manifest.pageHeight)
      drawReceiptFrame(page, placement, manifest.pageHeight)

      completed += 1
      post({ type: 'PDF_PROGRESS', requestId, current: completed, total })
    }
  }

  assertNotCancelled(requestId)
  const saved = await pdf.save({ useObjectStreams: true })
  assertNotCancelled(requestId)
  return saved.slice().buffer as ArrayBuffer
}

async function preparePdfImage(
  pdf: PDFDocument,
  receipt: PdfReceiptPayload,
  placement: ReceiptPlacement,
  requestId: string,
): Promise<PDFImage> {
  const bytes = await readAndInspectFile(receipt.file, requestId)
  const bitmap = await decodeImage(bytes.buffer, bytes.info.mime, requestId)

  try {
    assertDecodedDimensions(bitmap, bytes.info)
    const rotatedWidth = swapsAxes(receipt.rotation) ? bitmap.height : bitmap.width
    const rotatedHeight = swapsAxes(receipt.rotation) ? bitmap.width : bitmap.height
    const targetWidth = Math.max(
      1,
      Math.ceil((placement.image.width / 72) * PDF_MAX_DPI),
    )
    const targetHeight = Math.max(
      1,
      Math.ceil((placement.image.height / 72) * PDF_MAX_DPI),
    )
    const scale = Math.min(
      1,
      targetWidth / rotatedWidth,
      targetHeight / rotatedHeight,
    )
    const outputWidth = Math.max(1, Math.round(rotatedWidth * scale))
    const outputHeight = Math.max(1, Math.round(rotatedHeight * scale))
    const rendered = await renderBitmap(
      bitmap,
      receipt.rotation,
      outputWidth,
      outputHeight,
      bytes.info.mime,
      requestId,
    )
    const encoded = new Uint8Array(await rendered.blob.arrayBuffer())
    assertNotCancelled(requestId)

    return rendered.blob.type === 'image/png'
      ? pdf.embedPng(encoded)
      : pdf.embedJpg(encoded)
  } finally {
    bitmap.close()
  }
}

async function readAndInspectFile(
  file: File,
  requestId: string,
): Promise<{ buffer: ArrayBuffer; info: InspectedImage }> {
  if (file.size === 0) {
    throw new Error('빈 파일은 이미지로 사용할 수 없습니다.')
  }
  if (file.size > INPUT_LIMITS.fileBytes) {
    throw new Error('이미지 한 장의 크기는 20MB 이하여야 합니다.')
  }

  const buffer = await file.arrayBuffer()
  assertNotCancelled(requestId)
  const info = inspectImage(new Uint8Array(buffer))
  validatePixelCount(info.width, info.height)
  return { buffer, info }
}

async function decodeImage(
  buffer: ArrayBuffer,
  mime: SupportedImageMime,
  requestId: string,
): Promise<ImageBitmap> {
  assertNotCancelled(requestId)
  if (typeof createImageBitmap !== 'function') {
    throw new Error('이 브라우저는 이미지 디코딩 기능을 지원하지 않습니다. 최신 브라우저를 사용해 주세요.')
  }
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], { type: mime }), {
      imageOrientation: 'from-image',
    })
    try {
      assertNotCancelled(requestId)
    } catch (error) {
      bitmap.close()
      throw error
    }
    return bitmap
  } catch (error) {
    if (error instanceof CancelledError) throw error
    throw new Error('이미지를 해석할 수 없습니다. 파일이 손상되었는지 확인해 주세요.', {
      cause: error,
    })
  }
}

function assertDecodedDimensions(bitmap: ImageBitmap, inspected: InspectedImage): void {
  validatePixelCount(bitmap.width, bitmap.height)
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    throw new Error('이미지 크기 정보를 읽을 수 없습니다.')
  }

  const inspectedPixels = inspected.width * inspected.height
  const decodedPixels = bitmap.width * bitmap.height
  if (inspectedPixels !== decodedPixels) {
    // Orientation may swap width and height, but must not increase total pixels.
    validatePixelCount(bitmap.width, bitmap.height)
  }
}

async function renderBitmap(
  bitmap: ImageBitmap,
  rotation: Rotation,
  outputWidth: number,
  outputHeight: number,
  sourceMime: SupportedImageMime,
  requestId: string,
): Promise<RenderedImage> {
  assertNotCancelled(requestId)
  if (
    typeof OffscreenCanvas === 'undefined' ||
    typeof OffscreenCanvas.prototype.convertToBlob !== 'function'
  ) {
    throw new Error('이 브라우저는 이미지 변환 기능을 지원하지 않습니다. 최신 브라우저를 사용해 주세요.')
  }
  const canvas = new OffscreenCanvas(outputWidth, outputHeight)
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('이미지 처리 화면을 만들 수 없습니다.')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, outputWidth, outputHeight)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const scaledSourceWidth = swapsAxes(rotation) ? outputHeight : outputWidth
  const scaledSourceHeight = swapsAxes(rotation) ? outputWidth : outputHeight
  context.save()
  if (rotation === 90) {
    context.translate(outputWidth, 0)
    context.rotate(Math.PI / 2)
  } else if (rotation === 180) {
    context.translate(outputWidth, outputHeight)
    context.rotate(Math.PI)
  } else if (rotation === 270) {
    context.translate(0, outputHeight)
    context.rotate(-Math.PI / 2)
  }
  context.drawImage(bitmap, 0, 0, scaledSourceWidth, scaledSourceHeight)
  context.restore()

  const outputMime = sourceMime === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob = await canvas.convertToBlob({
    type: outputMime,
    quality: outputMime === 'image/jpeg' ? JPEG_QUALITY : undefined,
  })
  assertNotCancelled(requestId)
  if (blob.size === 0) throw new Error('이미지를 변환하지 못했습니다.')
  return { blob, width: outputWidth, height: outputHeight }
}

function swapsAxes(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270
}

async function getFontBytes(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  if (!fontBytesPromise) {
    const loading = Promise.all([
      fetchFont('/fonts/NanumGothic-Regular.ttf'),
      fetchFont('/fonts/NanumGothic-Bold.ttf'),
    ]).then(([regular, bold]) => ({ regular, bold }))
    fontBytesPromise = loading.catch((error: unknown) => {
      fontBytesPromise = undefined
      throw error
    })
  }
  return fontBytesPromise
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('PDF용 한글 글꼴을 불러오지 못했습니다.')
  }
  return new Uint8Array(await response.arrayBuffer())
}

function validateDocumentCharacters(
  fields: DocumentFields,
  manifest: LayoutManifest,
  regularFont: PDFFont,
  boldFont: PDFFont,
): void {
  const regularCharacters = new Set(regularFont.getCharacterSet())
  const boldCharacters = new Set(boldFont.getCharacterSet())
  assertSupportedText(`${fields.title}…`, boldCharacters, '제목')
  assertSupportedText(fields.department, regularCharacters, '부서')
  assertSupportedText(fields.employeeName, regularCharacters, '이름')

  for (const page of manifest.pages) {
    for (const receipt of page.receipts) {
      if (!receipt.caption) continue
      assertSupportedText(
        receipt.caption.lines.join(''),
        regularCharacters,
        `${receipt.order + 1}번째 영수증 설명`,
      )
    }
  }

  const fixedText = `부서 이름 · … ${manifest.pages.length} / 0123456789`
  assertSupportedText(fixedText, regularCharacters, 'PDF 고정 문구')
}

function assertSupportedText(
  text: string,
  characters: Set<number>,
  label: string,
): void {
  const unsupported = [...new Set(unsupportedCharacters(text, characters))]
  if (unsupported.length === 0) return
  throw new Error(
    `${label}에 PDF 글꼴에서 지원하지 않는 문자가 포함되어 있습니다: ${unsupported.slice(0, 5).join(' ')}`,
  )
}

function unsupportedCharacters(text: string, characters: Set<number>): string[] {
  const unsupported: string[] = []
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && !characters.has(codePoint)) unsupported.push(character)
  }
  return unsupported
}

function drawHeader(
  page: PDFPage,
  fields: DocumentFields,
  mode: 'full' | 'compact',
  body: PointBox,
  regularFont: PDFFont,
  boldFont: PDFFont,
  pageHeight: number,
): void {
  const margin = body.x
  const contentWidth = page.getWidth() - margin * 2

  if (mode === 'full') {
    const titleLines = wrapText(
      fields.title,
      boldFont,
      FULL_TITLE_FONT_SIZE,
      contentWidth,
      2,
    )
    const titleLineHeight = 19
    titleLines.forEach((line, index) => {
      const lineWidth = boldFont.widthOfTextAtSize(line, FULL_TITLE_FONT_SIZE)
      drawTopLeftText(
        page,
        line,
        margin + (contentWidth - lineWidth) / 2,
        margin + index * titleLineHeight,
        FULL_TITLE_FONT_SIZE,
        boldFont,
        pageHeight,
        BLACK,
      )
    })

    const metaTop = body.y - FULL_META_FONT_SIZE - 5
    const metaSegments = [
      {
        text: '부서',
        font: regularFont,
        color: MUTED,
        gapAfter: FULL_META_VALUE_GAP,
      },
      {
        text: fields.department,
        font: boldFont,
        color: BLACK,
        gapAfter: FULL_META_GROUP_GAP,
      },
      {
        text: '이름',
        font: regularFont,
        color: MUTED,
        gapAfter: FULL_META_VALUE_GAP,
      },
      {
        text: fields.employeeName,
        font: boldFont,
        color: BLACK,
        gapAfter: 0,
      },
    ]
    const metaWidth = metaSegments.reduce(
      (width, segment) =>
        width +
        segment.font.widthOfTextAtSize(segment.text, FULL_META_FONT_SIZE) +
        segment.gapAfter,
      0,
    )
    let metaX = page.getWidth() - margin - metaWidth
    for (const segment of metaSegments) {
      drawTopLeftText(
        page,
        segment.text,
        metaX,
        metaTop,
        FULL_META_FONT_SIZE,
        segment.font,
        pageHeight,
        segment.color,
      )
      metaX +=
        segment.font.widthOfTextAtSize(segment.text, FULL_META_FONT_SIZE) +
        segment.gapAfter
    }
  } else {
    const meta = `부서 ${fields.department} · 이름 ${fields.employeeName}`
    drawTopLeftText(
      page,
      fitText(fields.title, boldFont, COMPACT_TITLE_FONT_SIZE, contentWidth),
      margin,
      margin,
      COMPACT_TITLE_FONT_SIZE,
      boldFont,
      pageHeight,
      BLACK,
    )
    const fittedMeta = fitText(
      meta,
      regularFont,
      COMPACT_META_FONT_SIZE,
      contentWidth,
    )
    const fittedMetaWidth = regularFont.widthOfTextAtSize(
      fittedMeta,
      COMPACT_META_FONT_SIZE,
    )
    drawTopLeftText(
      page,
      fittedMeta,
      page.getWidth() - margin - fittedMetaWidth,
      margin + 13,
      COMPACT_META_FONT_SIZE,
      regularFont,
      pageHeight,
      MUTED,
    )
  }

  page.drawLine({
    start: { x: margin, y: pageHeight - body.y + 1 },
    end: { x: page.getWidth() - margin, y: pageHeight - body.y + 1 },
    thickness: 0.5,
    color: RULE,
  })
}

function drawFooter(
  page: PDFPage,
  currentPage: number,
  totalPages: number,
  body: PointBox,
  font: PDFFont,
  pageHeight: number,
): void {
  const text = `${currentPage} / ${totalPages}`
  const textWidth = font.widthOfTextAtSize(text, FOOTER_FONT_SIZE)
  const bodyBottom = body.y + body.height
  const footerHeight = pageHeight - bodyBottom - body.x
  const top = bodyBottom + Math.max(0, (footerHeight - FOOTER_FONT_SIZE) / 2)
  drawTopLeftText(
    page,
    text,
    (page.getWidth() - textWidth) / 2,
    top,
    FOOTER_FONT_SIZE,
    font,
    pageHeight,
    MUTED,
  )
}

function drawPlacedImage(
  page: PDFPage,
  image: PDFImage,
  box: PointBox,
  pageHeight: number,
): void {
  page.drawImage(image, {
    x: box.x,
    y: pageHeight - box.y - box.height,
    width: box.width,
    height: box.height,
  })
}

function drawReceiptFrame(
  page: PDFPage,
  placement: ReceiptPlacement,
  pageHeight: number,
): void {
  const frame = placement.frame
  const halfStroke = RECEIPT_FRAME_WIDTH / 2

  page.drawRectangle({
    // CSS borders use border-box sizing in the preview, so keep the PDF
    // stroke fully inside the manifest frame as well.
    x: frame.x + halfStroke,
    y: pageHeight - frame.y - frame.height + halfStroke,
    width: frame.width - RECEIPT_FRAME_WIDTH,
    height: frame.height - RECEIPT_FRAME_WIDTH,
    borderWidth: RECEIPT_FRAME_WIDTH,
    borderColor: RULE,
  })

  if (!placement.caption) return

  const imageBottom = placement.image.y + placement.image.height
  const separatorTop = (imageBottom + placement.caption.y) / 2
  const separatorY = pageHeight - separatorTop
  page.drawLine({
    start: { x: frame.x, y: separatorY },
    end: { x: frame.x + frame.width, y: separatorY },
    thickness: CAPTION_SEPARATOR_WIDTH,
    color: RULE,
  })
}

function drawCaption(
  page: PDFPage,
  placement: ReceiptPlacement,
  font: PDFFont,
  pageHeight: number,
): void {
  const caption = placement.caption
  if (!caption || caption.lines.length === 0) return
  const lineHeight = caption.height / caption.lines.length

  caption.lines.forEach((line, index) => {
    drawTopLeftText(
      page,
      fitText(line, font, CAPTION_FONT_SIZE, caption.width),
      caption.x,
      caption.y + index * lineHeight,
      CAPTION_FONT_SIZE,
      font,
      pageHeight,
      BLACK,
    )
  })
}

function drawTopLeftText(
  page: PDFPage,
  text: string,
  x: number,
  top: number,
  size: number,
  font: PDFFont,
  pageHeight: number,
  color: ReturnType<typeof rgb>,
): void {
  page.drawText(text, {
    x,
    y: pageHeight - top - size,
    size,
    font,
    color,
  })
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (text.length === 0) return ['']
  const lines: string[] = []
  let current = ''

  for (const character of text) {
    const candidate = current + character
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current)
      current = character
      if (lines.length === maxLines - 1) break
    } else {
      current = candidate
    }
  }

  const consumedLength = lines.reduce((sum, line) => sum + line.length, 0)
  const remainder = text.slice(consumedLength)
  if (lines.length < maxLines) {
    lines.push(fitText(remainder, font, size, maxWidth))
  }
  return lines.slice(0, maxLines)
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text

  const ellipsis = '…'
  let fitted = ''
  for (const character of text) {
    if (font.widthOfTextAtSize(`${fitted}${character}${ellipsis}`, size) > maxWidth) {
      break
    }
    fitted += character
  }
  return fitted ? `${fitted}${ellipsis}` : ''
}

function validateManifest(manifest: LayoutManifest): void {
  if (
    !Number.isFinite(manifest.pageWidth) ||
    !Number.isFinite(manifest.pageHeight) ||
    manifest.pageWidth <= 0 ||
    manifest.pageHeight <= 0 ||
    manifest.pages.length === 0 ||
    Math.abs(manifest.pageWidth - 595.28) > 0.05 ||
    Math.abs(manifest.pageHeight - 841.89) > 0.05
  ) {
    throw new Error('PDF 레이아웃 정보가 올바르지 않습니다.')
  }

  manifest.pages.forEach((page, pageIndex) => {
    validateBox(page.body, manifest)
    if (
      page.index !== pageIndex ||
      page.headerMode !== (pageIndex === 0 ? 'full' : 'compact')
    ) {
      throw new Error('PDF 페이지 순서 또는 헤더 정보가 올바르지 않습니다.')
    }
    for (const placement of page.receipts) {
      validateBox(placement.frame, manifest)
      validateContainedBox(placement.frame, page.body)
      if (
        placement.frame.width <= RECEIPT_FRAME_WIDTH ||
        placement.frame.height <= RECEIPT_FRAME_WIDTH
      ) {
        throw new Error('PDF 영수증 프레임 크기가 올바르지 않습니다.')
      }
      validateBox(placement.image, manifest)
      validateContainedBox(placement.image, page.body)
      validateContainedBox(placement.image, placement.frame)
      if (placement.caption) {
        validateBox(placement.caption, manifest)
        validateContainedBox(placement.caption, page.body)
        validateContainedBox(placement.caption, placement.frame)
        if (
          placement.caption.y - (placement.image.y + placement.image.height) <
          CAPTION_SEPARATOR_WIDTH - 0.01
        ) {
          throw new Error('PDF 영수증 이미지와 설명 영역이 겹칩니다.')
        }
        if (placement.caption.lines.length < 1 || placement.caption.lines.length > 2) {
          throw new Error('영수증 설명은 최대 두 줄이어야 합니다.')
        }
      }
    }
    validateNonOverlappingFrames(page.receipts)
  })
}

function validateNonOverlappingFrames(placements: ReceiptPlacement[]): void {
  const tolerance = 0.01

  for (let index = 0; index < placements.length; index += 1) {
    const first = placements[index].frame
    for (let nextIndex = index + 1; nextIndex < placements.length; nextIndex += 1) {
      const second = placements[nextIndex].frame
      const separated =
        first.x + first.width <= second.x + tolerance ||
        second.x + second.width <= first.x + tolerance ||
        first.y + first.height <= second.y + tolerance ||
        second.y + second.height <= first.y + tolerance

      if (!separated) {
        throw new Error('PDF 영수증 프레임이 서로 겹칩니다.')
      }
    }
  }
}

function validateDocumentPayload(
  fields: DocumentFields,
  receipts: PdfReceiptPayload[],
): void {
  const fieldRules: Array<[string, string, number]> = [
    ['제목', fields.title, INPUT_LIMITS.title],
    ['부서', fields.department, INPUT_LIMITS.department],
    ['이름', fields.employeeName, INPUT_LIMITS.employeeName],
  ]
  for (const [label, value, maximumLength] of fieldRules) {
    if (value.trim().length === 0) throw new Error(`${label}을(를) 입력해 주세요.`)
    if (Array.from(value).length > maximumLength) {
      throw new Error(`${label}은(는) ${maximumLength}자 이하여야 합니다.`)
    }
  }
  if (receipts.length === 0) throw new Error('PDF에 넣을 영수증을 첨부해 주세요.')
  if (receipts.length > INPUT_LIMITS.desktopFiles) {
    throw new Error(`영수증은 최대 ${INPUT_LIMITS.desktopFiles}장까지 첨부할 수 있습니다.`)
  }
  for (const receipt of receipts) {
    if (![0, 90, 180, 270].includes(receipt.rotation)) {
      throw new Error('영수증 회전 정보가 올바르지 않습니다.')
    }
  }
}

function validateReceiptMapping(
  receipts: PdfReceiptPayload[],
  manifest: LayoutManifest,
): void {
  const receiptIds = receipts.map((receipt) => receipt.id)
  const placementIds = manifest.pages.flatMap((page) =>
    page.receipts.map((receipt) => receipt.id),
  )
  if (
    new Set(receiptIds).size !== receiptIds.length ||
    new Set(placementIds).size !== placementIds.length ||
    receiptIds.length !== placementIds.length ||
    receiptIds.some((id) => !placementIds.includes(id))
  ) {
    throw new Error('영수증과 PDF 레이아웃의 항목이 일치하지 않습니다.')
  }
}

function validateBox(box: PointBox, manifest: LayoutManifest): void {
  const values = [box.x, box.y, box.width, box.height]
  if (
    values.some((value) => !Number.isFinite(value)) ||
    box.width <= 0 ||
    box.height <= 0 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > manifest.pageWidth + 0.01 ||
    box.y + box.height > manifest.pageHeight + 0.01
  ) {
    throw new Error('PDF 요소가 페이지 영역을 벗어났습니다.')
  }
}

function validateContainedBox(box: PointBox, container: PointBox): void {
  const tolerance = 0.01
  if (
    box.x < container.x - tolerance ||
    box.y < container.y - tolerance ||
    box.x + box.width > container.x + container.width + tolerance ||
    box.y + box.height > container.y + container.height + tolerance
  ) {
    throw new Error('PDF 요소가 인쇄 안전 영역을 벗어났습니다.')
  }
}

function assertNotCancelled(requestId: string): void {
  if (cancelledRequestIds.has(requestId)) throw new CancelledError()
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '문서를 처리하는 중 알 수 없는 오류가 발생했습니다.'
}

function post(response: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer)
}

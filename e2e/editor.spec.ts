import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from 'pdf-lib'

test('shows the private local receipt editor', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/영수증 PDF 메이커/)
  await expect(page.getByLabel('제목')).toHaveValue(/^\d{1,2}월 경비 영수증$/)
  await expect(page.getByText(/서버에 전송되지/)).toBeVisible()
})

test('places six suitable receipts on one preview and PDF page', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('부서').fill('제품개발팀')
  await page.getByLabel('이름').fill('홍길동')
  const syntheticPng = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 640
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#111827'
    context.font = 'bold 30px sans-serif'
    context.fillText('RECEIPT', 32, 70)
    context.fillRect(32, 105, 336, 3)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG creation failed')), 'image/png')
    })
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `synthetic-receipt-${index + 1}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(syntheticPng),
    })),
  )

  await expect(page.locator('.receipt-card--ready')).toHaveCount(6, {
    timeout: 30_000,
  })
  const descriptionFields = page.getByRole('textbox', { name: /간단한 설명/ })
  await expect(descriptionFields).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) {
    await descriptionFields.nth(index).fill(`${index + 1}번째 합성 영수증`)
  }
  await expect(page.locator('.preview-page-count')).toHaveText('1페이지')
  await expect(page.locator('.paper-page')).toHaveCount(1)
  await expect(page.locator('.paper-receipt')).toHaveCount(6)
  await expect(page.locator('.paper-receipt-caption')).toHaveCount(6)
  const downloadPromise = page.waitForEvent('download')
  await page.locator('button:visible').filter({ hasText: 'PDF 다운로드' }).first().click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/^영수증_\d{8}\.pdf$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const bytes = await readFile(path!)
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getPageCount()).toBe(1)
  expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.28, 1)
  expect(pdf.getPage(0).getSize().height).toBeCloseTo(841.89, 1)
  const receiptPageOperators = pageOperators(pdf, 0)
  expect(receiptPageOperators.match(/(?:^|\s)0?\.6 w(?:\s|$)/g) ?? []).toHaveLength(12)
  const completeFontStreams = pdf.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFRawStream =>
        object instanceof PDFRawStream && object.contents.length > 500_000,
    )
  expect(completeFontStreams).toHaveLength(2)

  const maximumTitle = '가'.repeat(30)
  const maximumDepartment = '나'.repeat(20)
  const maximumName = '다'.repeat(20)
  await page.getByLabel('제목').fill(maximumTitle)
  await page.getByLabel('부서').fill(maximumDepartment)
  await page.getByLabel('이름').fill(maximumName)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-receipt-7.png',
    mimeType: 'image/png',
    buffer: Buffer.from(syntheticPng),
  })
  await expect(page.locator('.receipt-card--ready')).toHaveCount(7, {
    timeout: 30_000,
  })
  await expect(page.locator('.preview-page-count')).toHaveText('2페이지')

  const compactDownloadPromise = page.waitForEvent('download')
  await page.locator('button:visible').filter({ hasText: 'PDF 다운로드' }).first().click()
  const compactDownload = await compactDownloadPromise
  const compactPath = await compactDownload.path()
  expect(compactPath).not.toBeNull()
  const compactPdf = await PDFDocument.load(await readFile(compactPath!))
  expect(compactPdf.getPageCount()).toBe(2)

  const fullHeaderRuns = pageTextRuns(compactPdf, 0)
  expect(fullHeaderRuns.length).toBeGreaterThanOrEqual(5)
  const [
    fullTitle,
    departmentLabel,
    departmentValue,
    nameLabel,
    nameValue,
  ] = fullHeaderRuns
  expect(fullTitle.x).toBeCloseTo(72.04, 1)
  expect(fullTitle.encoded).toHaveLength(Array.from(maximumTitle).length * 4)
  expect(fullTitle.font).toContain('Bold')
  expect(departmentLabel.x).toBeCloseTo(167.02, 1)
  expect(departmentLabel.encoded).toHaveLength(Array.from('부서').length * 4)
  expect(departmentLabel.font).not.toContain('Bold')
  expect(departmentValue.encoded).toHaveLength(
    Array.from(maximumDepartment).length * 4,
  )
  expect(departmentValue.font).toContain('Bold')
  expect(nameLabel.encoded).toHaveLength(Array.from('이름').length * 4)
  expect(nameLabel.font).not.toContain('Bold')
  expect(nameValue.encoded).toHaveLength(Array.from(maximumName).length * 4)
  expect(nameValue.font).toContain('Bold')
  expect([
    departmentLabel.y,
    departmentValue.y,
    nameLabel.y,
    nameValue.y,
  ]).toEqual(Array(4).fill(departmentLabel.y))

  const compactHeaderRuns = pageTextRuns(compactPdf, 1)
  expect(compactHeaderRuns.length).toBeGreaterThanOrEqual(2)
  const [compactTitle, compactMeta] = compactHeaderRuns
  expect(compactTitle.y).toBeGreaterThan(compactMeta.y)
  expect(compactTitle.y - compactMeta.y).toBeGreaterThan(8)
  expect(compactTitle.encoded).toHaveLength(Array.from(maximumTitle).length * 4)
  const expectedMeta = `부서 ${maximumDepartment} · 이름 ${maximumName}`
  expect(compactMeta.encoded).toHaveLength(Array.from(expectedMeta).length * 4)
})

interface PdfTextRun {
  font: string
  size: number
  x: number
  y: number
  encoded: string
}

function pageTextRuns(pdf: PDFDocument, pageIndex: number): PdfTextRun[] {
  const operators = pageOperators(pdf, pageIndex)

  return [
    ...operators.matchAll(
      /\/(\S+) ([\d.]+) Tf[\s\S]*?1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*<([0-9A-F]+)> Tj/g,
    ),
  ].map(([, font, size, x, y, encoded]) => ({
    font,
    size: Number(size),
    x: Number(x),
    y: Number(y),
    encoded,
  }))
}

function pageOperators(pdf: PDFDocument, pageIndex: number): string {
  const contentReferences = pdf.context.lookup(
    pdf.getPage(pageIndex).node.Contents(),
    PDFArray,
  )
  const contentStream = pdf.context.lookup(
    contentReferences.get(0),
    PDFRawStream,
  )
  return new TextDecoder().decode(
    decodePDFRawStream(contentStream).decode(),
  )
}

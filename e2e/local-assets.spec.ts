import { expect, test } from '@playwright/test'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

test('locally validates all private samples without bundling them', async ({ page }) => {
  test.skip(process.env.LOCAL_RECEIPT_FIXTURES !== '1', 'Private local fixture check')

  const assetDirectory = path.resolve('assets')
  const imagePaths = (await readdir(assetDirectory))
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .sort((left, right) => left.localeCompare(right, 'ko'))
    .map((name) => path.join(assetDirectory, name))

  expect(imagePaths).toHaveLength(10)
  await page.goto('/')
  await page.getByLabel('부서').fill('제품개발팀')
  await page.getByLabel('이름').fill('홍길동')
  await page.locator('input[type="file"]').setInputFiles(imagePaths)
  await expect(page.locator('.receipt-card--ready')).toHaveCount(10, { timeout: 30_000 })
  await expect(page.locator('.preview-page-count')).toHaveText('2페이지')
  await expect(page.locator('.paper-page')).toHaveCount(2)
  await expect(page.locator('.paper-page').nth(0).locator('.paper-receipt')).toHaveCount(5)
  await expect(page.locator('.paper-page').nth(1).locator('.paper-receipt')).toHaveCount(5)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('button:visible').filter({ hasText: 'PDF 다운로드' }).first().click()
  const download = await downloadPromise
  const filePath = await download.path()
  const pdf = await PDFDocument.load(await readFile(filePath!))
  expect(pdf.getPageCount()).toBe(2)
})

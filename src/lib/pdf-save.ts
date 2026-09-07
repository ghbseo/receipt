import { isTauri } from '@tauri-apps/api/core'

export type PdfSaveOutcome = 'downloaded' | 'saved' | 'cancelled'

export function usesNativePdfSave(): boolean {
  return isTauri()
}

export async function savePdfBuffer(
  buffer: ArrayBuffer,
  filename: string,
): Promise<PdfSaveOutcome> {
  if (!usesNativePdfSave()) {
    downloadBuffer(buffer, filename)
    return 'downloaded'
  }

  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])

  const path = await save({
    title: 'PDF 저장',
    defaultPath: filename,
    filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
  })

  if (path === null) return 'cancelled'

  await writeFile(path, new Uint8Array(buffer))
  return 'saved'
}

function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  if (isAppleMobileDevice()) anchor.target = '_blank'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function isAppleMobileDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

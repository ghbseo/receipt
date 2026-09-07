import { beforeEach, describe, expect, it, vi } from 'vitest'

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  save: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: tauriMocks.isTauri,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: tauriMocks.save,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: tauriMocks.writeFile,
}))

import { savePdfBuffer } from './pdf-save'

describe('savePdfBuffer in Tauri', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tauriMocks.isTauri.mockReturnValue(true)
  })

  it('writes the PDF bytes to the exact path selected by the user', async () => {
    const buffer = Uint8Array.from([37, 80, 68, 70]).buffer
    tauriMocks.save.mockResolvedValue('C:\\Users\\tester\\receipt.pdf')
    tauriMocks.writeFile.mockResolvedValue(undefined)

    await expect(savePdfBuffer(buffer, '영수증_20260904.pdf')).resolves.toBe('saved')

    expect(tauriMocks.save).toHaveBeenCalledWith({
      title: 'PDF 저장',
      defaultPath: '영수증_20260904.pdf',
      filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
    })
    expect(tauriMocks.writeFile).toHaveBeenCalledOnce()
    expect(tauriMocks.writeFile.mock.calls[0][0]).toBe('C:\\Users\\tester\\receipt.pdf')
    expect(Array.from(tauriMocks.writeFile.mock.calls[0][1] as Uint8Array)).toEqual([37, 80, 68, 70])
  })

  it('treats closing the native dialog as a cancellation', async () => {
    tauriMocks.save.mockResolvedValue(null)

    await expect(savePdfBuffer(new ArrayBuffer(1), 'receipt.pdf')).resolves.toBe('cancelled')
    expect(tauriMocks.writeFile).not.toHaveBeenCalled()
  })

  it('propagates a native write failure', async () => {
    tauriMocks.save.mockResolvedValue('C:\\receipt.pdf')
    tauriMocks.writeFile.mockRejectedValue(new Error('disk full'))

    await expect(savePdfBuffer(new ArrayBuffer(1), 'receipt.pdf')).rejects.toThrow('disk full')
  })
})

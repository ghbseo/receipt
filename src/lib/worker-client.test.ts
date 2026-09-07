import { describe, expect, it, vi } from 'vitest'

import type { LayoutManifest, WorkerRequest, WorkerResponse } from '../domain/types'
import { DocumentWorkerClient } from './worker-client'

class FakeWorker extends EventTarget {
  readonly requests: WorkerRequest[] = []
  terminated = false

  postMessage(request: WorkerRequest): void {
    this.requests.push(request)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(response: WorkerResponse): void {
    this.dispatchEvent(new MessageEvent<WorkerResponse>('message', { data: response }))
  }
}

const emptyManifest: LayoutManifest = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  pages: [],
  warnings: [],
}

describe('DocumentWorkerClient', () => {
  it('correlates progress and the final PDF response to one request', async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker as unknown as Worker)
    const onProgress = vi.fn()
    const result = client.generatePdf(
      { title: '제목', department: '부서', employeeName: '이름' },
      [],
      emptyManifest,
      onProgress,
    )
    const request = worker.requests[0]
    expect(request.type).toBe('GENERATE_PDF')

    worker.respond({
      type: 'PDF_PROGRESS',
      requestId: request.requestId,
      current: 1,
      total: 2,
    })
    const buffer = new ArrayBuffer(4)
    worker.respond({ type: 'PDF_READY', requestId: request.requestId, buffer })

    expect(onProgress).toHaveBeenCalledWith(1, 2)
    await expect(result).resolves.toBe(buffer)
    client.dispose()
  })

  it('cancels pending work with its correlated request id', async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker as unknown as Worker)
    const result = client.normalizeImage(
      new File([new Uint8Array([1])], 'receipt.jpg', { type: 'image/jpeg' }),
      'receipt-1',
    )
    const request = worker.requests[0]

    client.cancel()
    expect(worker.requests[1]).toEqual({
      type: 'CANCEL',
      requestId: request.requestId,
    })
    worker.respond({ type: 'CANCELLED', requestId: request.requestId })

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    client.dispose()
    expect(worker.terminated).toBe(true)
  })
})

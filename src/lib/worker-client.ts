import type {
  DocumentFields,
  LayoutManifest,
  NormalizedImageResult,
  PdfReceiptPayload,
  WorkerRequest,
  WorkerResponse,
} from '../domain/types'

export type PdfProgressCallback = (current: number, total: number) => void

type PendingRequest =
  | {
      kind: 'normalize'
      resolve: (result: NormalizedImageResult) => void
      reject: (reason: Error) => void
    }
  | {
      kind: 'pdf'
      resolve: (buffer: ArrayBuffer) => void
      reject: (reason: Error) => void
      onProgress?: PdfProgressCallback
    }

let requestSequence = 0

export class DocumentWorkerClient {
  private worker: Worker
  private readonly workerFactory?: () => Worker
  private readonly pending = new Map<string, PendingRequest>()
  private disposed = false

  constructor(worker?: Worker) {
    if (worker) {
      this.worker = worker
    } else {
      this.workerFactory = createWorker
      this.worker = this.workerFactory()
    }
    this.attachWorkerListeners()
  }

  normalizeImage(file: File, id: string): Promise<NormalizedImageResult> {
    this.assertUsable()
    const requestId = createRequestId('image')
    const request: WorkerRequest = { type: 'NORMALIZE_IMAGE', requestId, id, file }

    return new Promise<NormalizedImageResult>((resolve, reject) => {
      this.pending.set(requestId, { kind: 'normalize', resolve, reject })
      this.send(request, requestId)
    })
  }

  generatePdf(
    fields: DocumentFields,
    receipts: PdfReceiptPayload[],
    manifest: LayoutManifest,
    onProgress?: PdfProgressCallback,
  ): Promise<ArrayBuffer> {
    this.assertUsable()
    const requestId = createRequestId('pdf')
    const request: WorkerRequest = {
      type: 'GENERATE_PDF',
      requestId,
      fields,
      receipts,
      manifest,
    }

    return new Promise<ArrayBuffer>((resolve, reject) => {
      this.pending.set(requestId, { kind: 'pdf', resolve, reject, onProgress })
      this.send(request, requestId)
    })
  }

  cancel(requestId?: string): void {
    if (this.disposed) return
    if (!requestId && this.pending.size > 0 && this.workerFactory) {
      this.detachWorkerListeners()
      this.worker.terminate()
      this.rejectAll(abortError('작업이 취소되었습니다.'))
      this.worker = this.workerFactory()
      this.attachWorkerListeners()
      return
    }

    const requestIds = requestId ? [requestId] : [...this.pending.keys()]
    for (const id of requestIds) {
      if (!this.pending.has(id)) continue
      const request: WorkerRequest = { type: 'CANCEL', requestId: id }
      this.worker.postMessage(request)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachWorkerListeners()
    this.worker.terminate()
    this.rejectAll(abortError('문서 처리기가 종료되었습니다.'))
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse>): void => {
    const response = event.data
    const pending = this.pending.get(response.requestId)
    if (!pending) return

    if (response.type === 'PDF_PROGRESS') {
      if (pending.kind === 'pdf') {
        try {
          pending.onProgress?.(response.current, response.total)
        } catch (error) {
          this.pending.delete(response.requestId)
          pending.reject(
            error instanceof Error
              ? error
              : new Error('PDF 진행률을 처리하지 못했습니다.'),
          )
          this.worker.postMessage({
            type: 'CANCEL',
            requestId: response.requestId,
          } satisfies WorkerRequest)
        }
      }
      return
    }

    this.pending.delete(response.requestId)
    if (response.type === 'ERROR') {
      pending.reject(new Error(response.message))
      return
    }
    if (response.type === 'CANCELLED') {
      pending.reject(abortError('작업이 취소되었습니다.'))
      return
    }
    if (response.type === 'NORMALIZED_IMAGE' && pending.kind === 'normalize') {
      pending.resolve(response.result)
      return
    }
    if (response.type === 'PDF_READY' && pending.kind === 'pdf') {
      pending.resolve(response.buffer)
      return
    }

    pending.reject(new Error('문서 처리기에서 예상하지 못한 응답을 받았습니다.'))
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    event.preventDefault()
    this.failWorker(new Error(event.message || '문서 처리기가 중단되었습니다.'))
  }

  private readonly handleMessageError = (): void => {
    this.rejectAll(new Error('문서 처리기와 데이터를 주고받지 못했습니다.'))
  }

  private send(request: WorkerRequest, requestId: string): void {
    try {
      this.worker.postMessage(request)
    } catch (error) {
      const pending = this.pending.get(requestId)
      this.pending.delete(requestId)
      pending?.reject(
        error instanceof Error
          ? error
          : new Error('문서 처리기에 작업을 전달하지 못했습니다.'),
      )
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private failWorker(error: Error): void {
    if (this.disposed) return
    this.disposed = true
    this.detachWorkerListeners()
    this.worker.terminate()
    this.rejectAll(error)
  }

  private attachWorkerListeners(): void {
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
    this.worker.addEventListener('messageerror', this.handleMessageError)
  }

  private detachWorkerListeners(): void {
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
    this.worker.removeEventListener('messageerror', this.handleMessageError)
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('종료된 문서 처리기는 다시 사용할 수 없습니다.')
  }
}

export function createDocumentWorkerClient(): DocumentWorkerClient {
  return new DocumentWorkerClient()
}

function createWorker(): Worker {
  return new Worker(new URL('../workers/document.worker.ts', import.meta.url), {
    type: 'module',
    name: 'receipt-document-worker',
  })
}

function createRequestId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  requestSequence += 1
  return `${prefix}-${Date.now()}-${requestSequence}`
}

function abortError(message: string): Error {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError')
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export default DocumentWorkerClient

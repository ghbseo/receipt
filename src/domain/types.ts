export type Rotation = 0 | 90 | 180 | 270

export type ReceiptStatus = 'processing' | 'ready' | 'error'

export interface ReceiptDraft {
  id: string
  file: File
  previewBlob?: Blob
  previewUrl?: string
  widthPx: number
  heightPx: number
  rotation: Rotation
  description: string
  forceSinglePage: boolean
  status: ReceiptStatus
  error?: string
}

export interface DocumentFields {
  title: string
  department: string
  employeeName: string
}

export interface DocumentDraft extends DocumentFields {
  receipts: ReceiptDraft[]
}

export interface LayoutReceiptInput {
  id: string
  widthPx: number
  heightPx: number
  description: string
  forceSinglePage: boolean
}

export interface PointBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ReceiptPlacement {
  id: string
  order: number
  frame: PointBox
  image: PointBox
  caption?: PointBox & { lines: string[] }
  printedWidthMm: number
  effectiveDpi: number
  singlePage: boolean
}

export interface LayoutPage {
  index: number
  headerMode: 'full' | 'compact'
  body: PointBox
  receipts: ReceiptPlacement[]
}

export type LayoutWarningCode = 'LOW_DPI' | 'NARROW_PRINT'

export interface LayoutWarning {
  receiptId: string
  code: LayoutWarningCode
  message: string
}

export interface LayoutManifest {
  pageWidth: number
  pageHeight: number
  pages: LayoutPage[]
  warnings: LayoutWarning[]
}

export interface NormalizedImageResult {
  id: string
  blob: Blob
  widthPx: number
  heightPx: number
}

export interface PdfReceiptPayload {
  id: string
  file: File
  rotation: Rotation
}

export type WorkerRequest =
  | { type: 'NORMALIZE_IMAGE'; requestId: string; id: string; file: File }
  | {
      type: 'GENERATE_PDF'
      requestId: string
      fields: DocumentFields
      receipts: PdfReceiptPayload[]
      manifest: LayoutManifest
    }
  | { type: 'CANCEL'; requestId: string }

export type WorkerResponse =
  | {
      type: 'NORMALIZED_IMAGE'
      requestId: string
      result: NormalizedImageResult
    }
  | {
      type: 'PDF_PROGRESS'
      requestId: string
      current: number
      total: number
    }
  | { type: 'PDF_READY'; requestId: string; buffer: ArrayBuffer }
  | { type: 'ERROR'; requestId: string; message: string }
  | { type: 'CANCELLED'; requestId: string }

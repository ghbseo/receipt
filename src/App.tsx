import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  LockKeyhole,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { A4Preview } from './components/A4Preview'
import {
  DocumentFieldsPanel,
  type FieldName,
} from './components/DocumentFieldsPanel'
import { ProgressBanner, type ProgressState } from './components/ProgressBanner'
import { ReceiptDropzone } from './components/ReceiptDropzone'
import { ReceiptList } from './components/ReceiptList'
import { DEFAULT_TITLE, INPUT_LIMITS } from './domain/constants'
import type {
  DocumentFields,
  LayoutManifest,
  ReceiptDraft,
  Rotation,
} from './domain/types'
import { calculateLayout } from './lib/layout'
import { savePdfBuffer, usesNativePdfSave } from './lib/pdf-save'
import { DocumentWorkerClient } from './lib/worker-client'
import './styles.css'

type NoticeTone = 'info' | 'warning' | 'success'

interface Notice {
  tone: NoticeTone
  message: string
}

interface ActiveOperation {
  kind: 'images' | 'pdf'
  token: number
}

const INITIAL_FIELDS: DocumentFields = {
  title: DEFAULT_TITLE,
  department: '',
  employeeName: '',
}

const FIELD_LIMITS: Record<FieldName, number> = {
  title: INPUT_LIMITS.title,
  department: INPUT_LIMITS.department,
  employeeName: INPUT_LIMITS.employeeName,
}

const EMPTY_MANIFEST: LayoutManifest = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  pages: [],
  warnings: [],
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u

export default function App() {
  const [fields, setFields] = useState<DocumentFields>(INITIAL_FIELDS)
  const [receipts, setReceipts] = useState<ReceiptDraft[]>([])
  const [touchedFields, setTouchedFields] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [previewZoom, setPreviewZoom] = useState(0.85)
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false)
  const isMobileViewport = useMediaQuery('(max-width: 767px)')
  const isMobile = isMobileViewport || isMobileDevice()
  const pdfActionLabel = usesNativePdfSave() ? 'PDF 저장' : 'PDF 다운로드'

  const receiptsRef = useRef<ReceiptDraft[]>([])
  const workerRef = useRef<DocumentWorkerClient | null>(null)
  const operationRef = useRef<ActiveOperation | null>(null)
  const operationSequenceRef = useRef(0)

  const maxFiles = isMobile ? INPUT_LIMITS.mobileFiles : INPUT_LIMITS.desktopFiles
  const maxTotalBytes = isMobile
    ? INPUT_LIMITS.mobileTotalBytes
    : INPUT_LIMITS.desktopTotalBytes

  const updateReceipts = useCallback(
    (updater: (current: ReceiptDraft[]) => ReceiptDraft[]) => {
      const next = updater(receiptsRef.current)
      receiptsRef.current = next
      setReceipts(next)
    },
    [],
  )

  const getWorker = useCallback(() => {
    if (!workerRef.current) workerRef.current = new DocumentWorkerClient()
    return workerRef.current
  }, [])

  const readyReceipts = useMemo(
    () => receipts.filter((receipt) => receipt.status === 'ready'),
    [receipts],
  )

  const manifest = useMemo(() => {
    try {
      return calculateLayout(
        readyReceipts.map((receipt) => {
          const isSideways = receipt.rotation === 90 || receipt.rotation === 270
          return {
            id: receipt.id,
            widthPx: isSideways ? receipt.heightPx : receipt.widthPx,
            heightPx: isSideways ? receipt.widthPx : receipt.heightPx,
            description: receipt.description.trim(),
            forceSinglePage: receipt.forceSinglePage,
          }
        }),
      )
    } catch {
      return EMPTY_MANIFEST
    }
  }, [readyReceipts])

  const densestPageCount = useMemo(
    () => manifest.pages.reduce(
      (largest, page) => Math.max(largest, page.receipts.length),
      0,
    ),
    [manifest],
  )

  const fieldErrors = useMemo(() => validateFields(fields), [fields])
  const hasDescriptionError = receipts.some(
    (receipt) => receipt.status === 'ready' && hasUnsupportedGlyph(receipt.description),
  )
  const hasProcessingReceipt = receipts.some((receipt) => receipt.status === 'processing')
  const hasFieldError = Object.values(fieldErrors).some(Boolean)
  const canDownload =
    readyReceipts.length > 0 &&
    !hasProcessingReceipt &&
    !hasFieldError &&
    !hasDescriptionError &&
    progress === null

  const isDirty =
    receipts.length > 0 ||
    fields.title !== INITIAL_FIELDS.title ||
    fields.department !== '' ||
    fields.employeeName !== ''

  const displayTouched = submitAttempted
    ? { title: true, department: true, employeeName: true }
    : touchedFields

  const addFiles = useCallback(async (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return
    if (operationRef.current) {
      setNotice({ tone: 'info', message: '현재 작업이 끝난 뒤 영수증을 추가해 주세요.' })
      return
    }

    const availableSlots = Math.max(0, maxFiles - receiptsRef.current.length)
    if (availableSlots === 0) {
      setNotice({ tone: 'warning', message: `이 기기에서는 영수증을 최대 ${maxFiles}장까지 첨부할 수 있어요.` })
      return
    }

    const candidateFiles = incomingFiles.slice(0, availableSlots)
    const rejectionMessages: string[] = []
    if (incomingFiles.length > availableSlots) {
      rejectionMessages.push(`첨부 한도를 넘은 ${incomingFiles.length - availableSlots}장은 제외했습니다.`)
    }

    let aggregateBytes = receiptsRef.current
      .filter((receipt) => receipt.status !== 'error')
      .reduce((total, receipt) => total + receipt.file.size, 0)
    const acceptedFiles: File[] = []

    candidateFiles.forEach((file) => {
      if (file.size === 0) {
        rejectionMessages.push(`${file.name}: 빈 파일은 첨부할 수 없습니다.`)
        return
      }
      if (file.size > INPUT_LIMITS.fileBytes) {
        rejectionMessages.push(`${file.name}: 파일당 20MB를 넘습니다.`)
        return
      }
      if (aggregateBytes + file.size > maxTotalBytes) {
        rejectionMessages.push(`${file.name}: 이미지 전체 용량 한도를 넘습니다.`)
        return
      }
      acceptedFiles.push(file)
      aggregateBytes += file.size
    })

    if (rejectionMessages.length > 0) {
      setNotice({ tone: 'warning', message: summarizeMessages(rejectionMessages) })
    } else {
      setNotice(null)
    }
    if (acceptedFiles.length === 0) return

    const drafts = acceptedFiles.map<ReceiptDraft>((file) => ({
      id: createId(),
      file,
      widthPx: 0,
      heightPx: 0,
      rotation: 0,
      description: '',
      forceSinglePage: false,
      status: 'processing',
    }))
    updateReceipts((current) => [...current, ...drafts])

    const token = ++operationSequenceRef.current
    operationRef.current = { kind: 'images', token }
    setProgress({ kind: 'images', current: 0, total: drafts.length })
    let failures = 0

    for (let index = 0; index < drafts.length; index += 1) {
      if (operationRef.current?.token !== token) break
      const draft = drafts[index]
      try {
        const result = await getWorker().normalizeImage(draft.file, draft.id)
        if (operationRef.current?.token !== token) break
        const previewUrl = URL.createObjectURL(result.blob)
        if (!receiptsRef.current.some((receipt) => receipt.id === draft.id)) {
          URL.revokeObjectURL(previewUrl)
        } else {
          updateReceipts((current) => current.map((receipt) => (
            receipt.id === draft.id
              ? {
                  ...receipt,
                  previewBlob: result.blob,
                  previewUrl,
                  widthPx: result.widthPx,
                  heightPx: result.heightPx,
                  status: 'ready',
                  error: undefined,
                }
              : receipt
          )))
        }
      } catch (error) {
        if (operationRef.current?.token !== token) break
        failures += 1
        updateReceipts((current) => current.map((receipt) => (
          receipt.id === draft.id
            ? { ...receipt, status: 'error', error: readableError(error) }
            : receipt
        )))
      }
      if (operationRef.current?.token === token) {
        setProgress({ kind: 'images', current: index + 1, total: drafts.length })
      }
    }

    if (operationRef.current?.token === token) {
      operationRef.current = null
      setProgress(null)
      if (failures > 0) {
        setNotice({
          tone: 'warning',
          message: `${failures}장의 이미지를 처리하지 못했습니다. 오류가 표시된 항목을 확인해 주세요.`,
        })
      }
    }
  }, [getWorker, maxFiles, maxTotalBytes, updateReceipts])

  const cancelOperation = useCallback(() => {
    const operation = operationRef.current
    if (!operation) return
    operationSequenceRef.current += 1
    operationRef.current = null
    workerRef.current?.cancel()
    if (operation.kind === 'images') {
      updateReceipts((current) => current.map((receipt) => (
        receipt.status === 'processing'
          ? { ...receipt, status: 'error', error: '이미지 처리가 취소되었습니다.' }
          : receipt
      )))
    }
    setProgress(null)
    setNotice({ tone: 'info', message: '진행 중이던 작업을 취소했습니다.' })
  }, [updateReceipts])

  const removeReceipt = useCallback((id: string) => {
    const target = receiptsRef.current.find((receipt) => receipt.id === id)
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    updateReceipts((current) => current.filter((receipt) => receipt.id !== id))
  }, [updateReceipts])

  const updateReceipt = useCallback((id: string, patch: Partial<ReceiptDraft>) => {
    updateReceipts((current) => current.map((receipt) => (
      receipt.id === id ? { ...receipt, ...patch } : receipt
    )))
  }, [updateReceipts])

  const moveReceipt = useCallback((id: string, direction: -1 | 1) => {
    updateReceipts((current) => {
      const from = current.findIndex((receipt) => receipt.id === id)
      const to = from + direction
      if (from < 0 || to < 0 || to >= current.length) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [updateReceipts])

  const reorderReceipts = useCallback((activeId: string, overId: string) => {
    updateReceipts((current) => {
      const from = current.findIndex((receipt) => receipt.id === activeId)
      const to = current.findIndex((receipt) => receipt.id === overId)
      if (from < 0 || to < 0 || from === to) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [updateReceipts])

  const resetDocument = useCallback(() => {
    if (isDirty && !window.confirm('작성 중인 내용을 모두 지우고 새 문서를 시작할까요?')) return
    if (operationRef.current) cancelOperation()
    receiptsRef.current.forEach((receipt) => {
      if (receipt.previewUrl) URL.revokeObjectURL(receipt.previewUrl)
    })
    receiptsRef.current = []
    setReceipts([])
    setFields(INITIAL_FIELDS)
    setTouchedFields({})
    setSubmitAttempted(false)
    setNotice(null)
    setMobilePreviewOpen(false)
  }, [cancelOperation, isDirty])

  const generatePdf = useCallback(async () => {
    setSubmitAttempted(true)
    setTouchedFields({ title: true, department: true, employeeName: true })

    if (Object.values(validateFields(fields)).some(Boolean)) {
      setNotice({ tone: 'warning', message: '문서 정보를 확인해 주세요.' })
      focusFirstInvalidField()
      return
    }
    if (hasDescriptionError) {
      setNotice({ tone: 'warning', message: '영수증 설명에서 PDF에 사용할 수 없는 이모지를 지워 주세요.' })
      focusFirstInvalidField()
      return
    }
    if (hasProcessingReceipt) {
      setNotice({ tone: 'info', message: '이미지 처리가 끝나면 PDF를 만들 수 있어요.' })
      return
    }
    if (readyReceipts.length === 0 || operationRef.current) {
      setNotice({ tone: 'warning', message: '정상 처리된 영수증을 한 장 이상 첨부해 주세요.' })
      return
    }

    const token = ++operationSequenceRef.current
    operationRef.current = { kind: 'pdf', token }
    setProgress({ kind: 'pdf', current: 0, total: readyReceipts.length })
    setNotice(null)

    try {
      const buffer = await getWorker().generatePdf(
        {
          title: fields.title.trim(),
          department: fields.department.trim(),
          employeeName: fields.employeeName.trim(),
        },
        readyReceipts.map((receipt) => ({
          id: receipt.id,
          file: receipt.file,
          rotation: receipt.rotation,
        })),
        manifest,
        (current, total) => {
          if (operationRef.current?.token === token) {
            setProgress({ kind: 'pdf', current, total })
          }
        },
      )
      if (operationRef.current?.token !== token) return
      const filename = `영수증_${formatDateForFilename(new Date())}.pdf`
      const outcome = await savePdfBuffer(buffer, filename)
      if (outcome === 'cancelled') {
        setNotice({ tone: 'info', message: 'PDF 저장을 취소했습니다.' })
        return
      }
      setNotice({
        tone: 'success',
        message: outcome === 'saved'
          ? `PDF ${manifest.pages.length}페이지를 저장했습니다.`
          : `PDF ${manifest.pages.length}페이지를 만들었습니다. 다운로드를 확인해 주세요.`,
      })
    } catch (error) {
      if (operationRef.current?.token === token) {
        setNotice({ tone: 'warning', message: readableError(error, 'PDF를 만들지 못했습니다. 다시 시도해 주세요.') })
      }
    } finally {
      if (operationRef.current?.token === token) {
        operationRef.current = null
        setProgress(null)
      }
    }
  }, [fields, getWorker, hasDescriptionError, hasProcessingReceipt, manifest, readyReceipts])

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      void addFiles(files)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addFiles])

  useEffect(() => {
    if (!isDirty) return undefined
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    if (!mobilePreviewOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobilePreviewOpen(false)
    }
    document.body.classList.add('preview-modal-open')
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.classList.remove('preview-modal-open')
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobilePreviewOpen])

  useEffect(() => () => {
    operationSequenceRef.current += 1
    operationRef.current = null
    workerRef.current?.dispose()
    workerRef.current = null
    receiptsRef.current.forEach((receipt) => {
      if (receipt.previewUrl) URL.revokeObjectURL(receipt.previewUrl)
    })
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><ReceiptText size={22} /></div>
          <div>
            <p className="brand-name">Receiptly</p>
            <p className="brand-tagline">영수증 PDF 메이커</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="header-privacy"><ShieldCheck size={15} aria-hidden="true" /> 현재 기기 안에서 안전하게</span>
          <button type="button" className="secondary-button reset-button" onClick={resetDocument}>
            <RotateCcw size={16} aria-hidden="true" /> 새 문서
          </button>
        </div>
      </header>

      {progress && <ProgressBanner progress={progress} onCancel={cancelOperation} />}

      {notice && (
        <div className={`notice notice--${notice.tone}`} role={notice.tone === 'warning' ? 'alert' : 'status'}>
          {notice.tone === 'success'
            ? <CheckCircle2 size={18} aria-hidden="true" />
            : <AlertCircle size={18} aria-hidden="true" />}
          <span>{notice.message}</span>
          <button type="button" className="notice-close" onClick={() => setNotice(null)} aria-label="알림 닫기">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <main className="app-workspace">
        <div className="editor-pane">
          <div className="editor-intro">
            <div className="intro-icon" aria-hidden="true"><Sparkles size={20} /></div>
            <div>
              <h1>흩어진 영수증, 한 번에 깔끔하게.</h1>
              <p>정보와 이미지만 넣으면 A4에 잘리지 않도록 자동 배치해 드려요.</p>
            </div>
          </div>

          <DocumentFieldsPanel
            fields={fields}
            errors={fieldErrors}
            touched={displayTouched}
            limits={FIELD_LIMITS}
            onChange={(field, value) => setFields((current) => ({ ...current, [field]: value }))}
            onBlur={(field) => setTouchedFields((current) => ({ ...current, [field]: true }))}
          />

          <ReceiptDropzone
            currentCount={receipts.length}
            maxCount={maxFiles}
            disabled={Boolean(progress)}
            onFiles={(files) => void addFiles(files)}
          />

          <section className="editor-section receipt-editor-section" aria-labelledby="receipt-editor-heading">
            <div className="section-heading-row receipt-list-heading">
              <div>
                <p className="section-kicker">STEP 3</p>
                <h2 id="receipt-editor-heading">배치와 설명</h2>
              </div>
              {receipts.length > 1 && <span className="reorder-help">끌어서 순서 변경</span>}
            </div>

            <div className="auto-layout-note">
              <Sparkles size={16} aria-hidden="true" />
              <p>
                <strong>페이지에 맞춰 자동 배치</strong>
                <span>영수증 크기와 비율을 계산해 한 페이지에 최대 6장까지 정리하고, 글자가 작을 때 알려드려요.</span>
              </p>
            </div>

            <ReceiptList
              receipts={receipts}
              warnings={manifest.warnings}
              onReorder={reorderReceipts}
              onMove={moveReceipt}
              onDelete={removeReceipt}
              onRotate={(id) => {
                const receipt = receiptsRef.current.find((item) => item.id === id)
                if (!receipt) return
                updateReceipt(id, { rotation: ((receipt.rotation + 90) % 360) as Rotation })
              }}
              onDescriptionChange={(id, value) => updateReceipt(id, { description: value })}
              onForceSinglePage={(id, checked) => updateReceipt(id, { forceSinglePage: checked })}
              isDescriptionInvalid={hasUnsupportedGlyph}
            />
          </section>

          <section className="privacy-card" aria-label="개인정보 보호 안내">
            <div className="privacy-icon" aria-hidden="true"><LockKeyhole size={20} /></div>
            <div>
              <strong>영수증은 어디에도 업로드되지 않아요.</strong>
              <p>모든 처리는 현재 기기 안에서만 이루어집니다. 창을 닫거나 새로고침하면 작성 내용은 사라집니다.</p>
              <p className="privacy-footnote">페이지 접속 시 호스팅 사업자에는 일반적인 접속 로그가 남을 수 있지만, 영수증과 입력 내용은 포함되지 않습니다.</p>
            </div>
          </section>
        </div>

        <aside className="desktop-preview-panel" aria-label="PDF 미리보기와 저장">
          <div className="desktop-preview-sticky">
            <A4Preview
              fields={fields}
              receipts={receipts}
              manifest={manifest}
              zoom={previewZoom}
              onZoomChange={setPreviewZoom}
            />
            <div className="preview-summary">
              <div>
                <FileCheck2 size={19} aria-hidden="true" />
                <span>
                  <strong>{readyReceipts.length}장</strong>
                  {' · '}
                  {densestPageCount > 0 ? `최대 ${densestPageCount}장/쪽` : '자동 배치'}
                  {' · '}A4 {Math.max(1, manifest.pages.length)}페이지
                </span>
              </div>
              {manifest.warnings.length > 0 && (
                <p><AlertCircle size={15} aria-hidden="true" /> 인쇄 품질 안내 {manifest.warnings.length}건</p>
              )}
            </div>
            <button type="button" className="primary-button download-button" disabled={!canDownload} onClick={() => void generatePdf()}>
              <Download size={19} aria-hidden="true" />
              {pdfActionLabel}
            </button>
            {!canDownload && (
              <p className="download-hint">문서 정보와 영수증을 준비하면 PDF로 저장할 수 있어요.</p>
            )}
          </div>
        </aside>
      </main>

      <div className="mobile-action-bar">
        <button type="button" className="secondary-button mobile-preview-button" onClick={() => setMobilePreviewOpen(true)}>
          <Eye size={18} aria-hidden="true" /> 미리보기
          <span>{Math.max(1, manifest.pages.length)}p</span>
        </button>
        <button type="button" className="primary-button" disabled={!canDownload} onClick={() => void generatePdf()}>
          <Download size={18} aria-hidden="true" /> {pdfActionLabel}
        </button>
      </div>

      {mobilePreviewOpen && (
        <div className="mobile-preview-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMobilePreviewOpen(false)
        }}>
          <section className="mobile-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="mobile-preview-title">
            <header>
              <div>
                <p className="section-kicker">PRINT PREVIEW</p>
                <h2 id="mobile-preview-title">A4 미리보기</h2>
              </div>
              <button type="button" className="icon-button" autoFocus onClick={() => setMobilePreviewOpen(false)} aria-label="미리보기 닫기">
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <A4Preview
              fields={fields}
              receipts={receipts}
              manifest={manifest}
              zoom={previewZoom}
              onZoomChange={setPreviewZoom}
              compact
            />
            <div className="mobile-preview-download">
              <button type="button" className="primary-button" disabled={!canDownload} onClick={() => void generatePdf()}>
                <Download size={18} aria-hidden="true" /> {pdfActionLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function validateFields(fields: DocumentFields): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {}
  if (!fields.title.trim()) errors.title = '문서 제목을 입력해 주세요.'
  else if (hasUnsupportedGlyph(fields.title)) errors.title = '이모지는 PDF 제목에 사용할 수 없습니다.'
  if (!fields.department.trim()) errors.department = '부서를 입력해 주세요.'
  else if (hasUnsupportedGlyph(fields.department)) errors.department = '이모지는 PDF에 사용할 수 없습니다.'
  if (!fields.employeeName.trim()) errors.employeeName = '이름을 입력해 주세요.'
  else if (hasUnsupportedGlyph(fields.employeeName)) errors.employeeName = '이모지는 PDF에 사용할 수 없습니다.'
  return errors
}

function hasUnsupportedGlyph(value: string) {
  return EMOJI_PATTERN.test(value)
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function summarizeMessages(messages: string[]) {
  if (messages.length <= 2) return messages.join(' ')
  return `${messages.slice(0, 2).join(' ')} 그 외 ${messages.length - 2}건이 제외되었습니다.`
}

function readableError(error: unknown, fallback = '지원하지 않거나 손상된 이미지입니다.') {
  if (error instanceof Error && error.message && error.message !== 'Cancelled') return error.message
  return fallback
}

function formatDateForFilename(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

function focusFirstInvalidField() {
  window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>('[aria-invalid="true"]')
    target?.focus()
  })
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [query])
  return matches
}

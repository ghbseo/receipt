import { FileImage, ZoomIn, ZoomOut } from 'lucide-react'
import type { CSSProperties } from 'react'
import type {
  DocumentFields,
  LayoutManifest,
  LayoutPage,
  ReceiptDraft,
  ReceiptPlacement,
} from '../domain/types'

interface A4PreviewProps {
  fields: DocumentFields
  receipts: ReceiptDraft[]
  manifest: LayoutManifest
  zoom: number
  onZoomChange: (zoom: number) => void
  compact?: boolean
}

const MIN_ZOOM = 0.65
const MAX_ZOOM = 1.6
const ZOOM_STEP = 0.1
const FIT_ZOOM = 0.85

export function A4Preview({
  fields,
  receipts,
  manifest,
  zoom,
  onZoomChange,
  compact = false,
}: A4PreviewProps) {
  const receiptsById = new Map(receipts.map((receipt) => [receipt.id, receipt]))
  const pageCount = Math.max(1, manifest.pages.length)

  return (
    <div className={`preview-view ${compact ? 'preview-view--compact' : ''}`}>
      <div className="preview-toolbar">
        <div>
          <span className="preview-toolbar-label">A4 미리보기</span>
          <span className="preview-page-count">{manifest.pages.length || 1}페이지</span>
        </div>
        <div className="zoom-controls" aria-label="미리보기 확대 및 축소">
          <button
            type="button"
            className="icon-button"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => onZoomChange(clampZoom(zoom - ZOOM_STEP))}
            aria-label="축소"
          >
            <ZoomOut size={17} aria-hidden="true" />
          </button>
          <output aria-label={`확대 비율 ${Math.round(zoom * 100)}퍼센트`}>
            {Math.round(zoom * 100)}%
          </output>
          <button
            type="button"
            className="icon-button"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => onZoomChange(clampZoom(zoom + ZOOM_STEP))}
            aria-label="확대"
          >
            <ZoomIn size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="preview-scroll-region">
        <div
          className="preview-paper-stack"
          style={{
            '--preview-pixel-width': `${Math.round(595 * zoom)}px`,
            '--preview-relative-width': `${(zoom / FIT_ZOOM) * 100}%`,
          } as CSSProperties}
          aria-label={`A4 문서 미리보기, 총 ${pageCount}페이지`}
        >
          {manifest.pages.length === 0 ? (
            <EmptyPaper fields={fields} width={manifest.pageWidth} height={manifest.pageHeight} />
          ) : (
            manifest.pages.map((page) => (
              <PaperPage
                key={page.index}
                page={page}
                pageCount={manifest.pages.length}
                fields={fields}
                receiptsById={receiptsById}
                pageWidth={manifest.pageWidth}
                pageHeight={manifest.pageHeight}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

interface PaperPageProps {
  page: LayoutPage
  pageCount: number
  fields: DocumentFields
  receiptsById: Map<string, ReceiptDraft>
  pageWidth: number
  pageHeight: number
}

function PaperPage({
  page,
  pageCount,
  fields,
  receiptsById,
  pageWidth,
  pageHeight,
}: PaperPageProps) {
  return (
    <section
      className="paper-page"
      aria-label={`${page.index + 1}페이지`}
      style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}
    >
      <PaperHeader fields={fields} compact={page.headerMode === 'compact'} />

      {page.receipts.map((placement) => {
        const receipt = receiptsById.get(placement.id)
        if (!receipt?.previewUrl) return null
        return (
          <PaperReceipt
            key={placement.id}
            placement={placement}
            receipt={receipt}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
          />
        )
      })}

      <div className="paper-footer">
        {page.index + 1} / {pageCount}
      </div>
    </section>
  )
}

function EmptyPaper({ fields, width, height }: { fields: DocumentFields; width: number; height: number }) {
  return (
    <section className="paper-page paper-page--empty" style={{ aspectRatio: `${width} / ${height}` }}>
      <PaperHeader fields={fields} compact={false} />
      <div className="paper-empty-message">
        <FileImage size={34} aria-hidden="true" />
        <p>영수증을 추가하면</p>
        <span>여기에 인쇄 모습을 미리 보여드려요.</span>
      </div>
      <div className="paper-footer">1 / 1</div>
    </section>
  )
}

function PaperHeader({ fields, compact }: { fields: DocumentFields; compact: boolean }) {
  if (compact) {
    const department = fields.department.trim() || '—'
    const employeeName = fields.employeeName.trim() || '—'

    return (
      <header className="paper-header paper-header--compact">
        <strong>{fields.title.trim() || '문서 제목'}</strong>
        <span>{`부서 ${department} · 이름 ${employeeName}`}</span>
      </header>
    )
  }

  return (
    <header className="paper-header paper-header--full">
      <h3>{fields.title.trim() || '문서 제목'}</h3>
      <dl>
        <div><dt>부서</dt><dd>{fields.department.trim() || '—'}</dd></div>
        <div><dt>이름</dt><dd>{fields.employeeName.trim() || '—'}</dd></div>
      </dl>
    </header>
  )
}

function PaperReceipt({
  placement,
  receipt,
  pageWidth,
  pageHeight,
}: {
  placement: ReceiptPlacement
  receipt: ReceiptDraft
  pageWidth: number
  pageHeight: number
}) {
  const imageStyle = toPercentBox(placement.image, pageWidth, pageHeight)
  const frameStyle = toPercentBox(placement.frame, pageWidth, pageHeight)
  const separatorStyle = placement.caption
    ? {
        left: `${(placement.frame.x / pageWidth) * 100}%`,
        top: `${(
          ((placement.image.y + placement.image.height + placement.caption.y) / 2)
          / pageHeight
        ) * 100}%`,
        width: `${(placement.frame.width / pageWidth) * 100}%`,
      }
    : undefined
  const rotated = receipt.rotation === 90 || receipt.rotation === 270
  const rotatedImageStyle = rotated
    ? {
        width: `${(placement.image.height / placement.image.width) * 100}%`,
        height: `${(placement.image.width / placement.image.height) * 100}%`,
        transform: `translate(-50%, -50%) rotate(${receipt.rotation}deg)`,
      }
    : {
        width: '100%',
        height: '100%',
        transform: `translate(-50%, -50%) rotate(${receipt.rotation}deg)`,
      }

  return (
    <div className="paper-receipt" aria-label={`${placement.order + 1}번째 영수증`}>
      <div className="paper-receipt-image" style={imageStyle}>
        <img src={receipt.previewUrl} alt="" draggable={false} style={rotatedImageStyle} />
      </div>
      {placement.caption && (
        <div
          className="paper-receipt-caption"
          style={toPercentBox(placement.caption, pageWidth, pageHeight)}
        >
          {placement.caption.lines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
        </div>
      )}
      <div className="paper-receipt-frame" style={frameStyle} aria-hidden="true" />
      {separatorStyle && (
        <div
          className="paper-receipt-separator"
          style={separatorStyle}
          aria-hidden="true"
        />
      )}
    </div>
  )
}

function toPercentBox(
  box: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
) {
  return {
    left: `${(box.x / pageWidth) * 100}%`,
    top: `${(box.y / pageHeight) * 100}%`,
    width: `${(box.width / pageWidth) * 100}%`,
    height: `${(box.height / pageHeight) * 100}%`,
  }
}

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(2))))
}

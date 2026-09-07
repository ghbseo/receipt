import { useSortable } from '@dnd-kit/sortable'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  LoaderCircle,
  Maximize2,
  RotateCw,
  Trash2,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ReceiptDraft } from '../domain/types'

interface ReceiptCardProps {
  receipt: ReceiptDraft
  index: number
  total: number
  warnings: string[]
  descriptionInvalid: boolean
  onDescriptionChange: (value: string) => void
  onRotate: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onForceSinglePage: (checked: boolean) => void
}

export function ReceiptCard({
  receipt,
  index,
  total,
  warnings,
  descriptionInvalid,
  onDescriptionChange,
  onRotate,
  onDelete,
  onMove,
  onForceSinglePage,
}: ReceiptCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: receipt.id })

  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition,
  }

  const descriptionErrorId = `receipt-description-error-${receipt.id}`

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`receipt-card ${isDragging ? 'receipt-card--dragging' : ''} receipt-card--${receipt.status}`}
      aria-label={`${index + 1}번째 영수증, ${receipt.file.name}`}
    >
      <div className="receipt-card-main">
        <button
          type="button"
          className="drag-handle"
          aria-label={`${receipt.file.name} 순서 끌어서 변경`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={19} aria-hidden="true" />
        </button>

        <div className="receipt-number" aria-hidden="true">{index + 1}</div>

        <div className="receipt-thumbnail">
          {receipt.previewUrl ? (
            <img
              src={receipt.previewUrl}
              alt=""
              draggable={false}
              style={{ transform: `rotate(${receipt.rotation}deg)` }}
            />
          ) : receipt.status === 'processing' ? (
            <LoaderCircle className="spin" size={24} aria-label="이미지 처리 중" />
          ) : (
            <AlertTriangle size={23} aria-hidden="true" />
          )}
        </div>

        <div className="receipt-card-content">
          <div className="receipt-file-row">
            <div className="receipt-file-copy">
              <p className="receipt-file-name" title={receipt.file.name}>{receipt.file.name}</p>
              <p className="receipt-file-meta">
                {formatFileSize(receipt.file.size)}
                {receipt.status === 'ready' && receipt.widthPx > 0
                  ? ` · ${receipt.widthPx.toLocaleString()} × ${receipt.heightPx.toLocaleString()}px`
                  : ''}
              </p>
            </div>
            <div className="receipt-card-actions" aria-label="영수증 작업">
              <button
                type="button"
                className="icon-button"
                onClick={() => onMove(-1)}
                disabled={index === 0}
                aria-label="한 칸 위로 이동"
                title="위로 이동"
              >
                <ArrowUp size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => onMove(1)}
                disabled={index === total - 1}
                aria-label="한 칸 아래로 이동"
                title="아래로 이동"
              >
                <ArrowDown size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={onRotate}
                disabled={receipt.status !== 'ready'}
                aria-label="오른쪽으로 90도 회전"
                title="90도 회전"
              >
                <RotateCw size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button icon-button--danger"
                onClick={onDelete}
                aria-label="영수증 삭제"
                title="삭제"
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          </div>

          {receipt.status === 'error' ? (
            <p className="receipt-error" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{receipt.error ?? '이미지를 처리하지 못했습니다.'}</span>
            </p>
          ) : (
            <>
              <div className={`description-field ${descriptionInvalid ? 'description-field--invalid' : ''}`}>
                <label htmlFor={`receipt-description-${receipt.id}`}>간단한 설명 <span>(선택)</span></label>
                <div className="description-input-wrap">
                  <input
                    id={`receipt-description-${receipt.id}`}
                    type="text"
                    value={receipt.description}
                    maxLength={60}
                    placeholder="예: 9월 3일 팀 점심"
                    disabled={receipt.status !== 'ready'}
                    aria-invalid={descriptionInvalid}
                    aria-describedby={descriptionInvalid ? descriptionErrorId : undefined}
                    onChange={(event) => onDescriptionChange(event.target.value)}
                  />
                  <span>{receipt.description.length}/60</span>
                </div>
                {descriptionInvalid && (
                  <p id={descriptionErrorId} className="field-error" role="alert">
                    이모지는 PDF 설명에 사용할 수 없습니다.
                  </p>
                )}
              </div>

              <label className="single-page-toggle">
                <input
                  type="checkbox"
                  checked={receipt.forceSinglePage}
                  disabled={receipt.status !== 'ready'}
                  onChange={(event) => onForceSinglePage(event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true"><span /></span>
                <Maximize2 size={15} aria-hidden="true" />
                <span>이 영수증만 한 페이지에 크게</span>
              </label>
            </>
          )}
        </div>
      </div>

      {warnings.length > 0 && receipt.status === 'ready' && (
        <div className="receipt-warning-list">
          {warnings.map((warning) => (
            <p key={warning}>
              <AlertTriangle size={14} aria-hidden="true" />
              {warning}
            </p>
          ))}
        </div>
      )}
    </article>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

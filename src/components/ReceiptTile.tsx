import { useSortable } from '@dnd-kit/sortable'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { CSSProperties, HTMLAttributes } from 'react'
import type { ReceiptDraft } from '../domain/types'

interface ReceiptTileProps {
  receipt: ReceiptDraft
  index: number
}

/** Compact, fully draggable thumbnail used while the list is in reorder mode. */
export function SortableReceiptTile({ receipt, index }: ReceiptTileProps) {
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
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`receipt-tile receipt-tile--${receipt.status} ${isDragging ? 'receipt-tile--placeholder' : ''}`}
    >
      <ReceiptTileBody
        receipt={receipt}
        index={index}
        {...attributes}
        {...listeners}
      />
    </li>
  )
}

/** Floating copy that follows the pointer while a tile is being dragged. */
export function ReceiptTileOverlay({ receipt, index }: ReceiptTileProps) {
  return (
    <div className={`receipt-tile receipt-tile--${receipt.status} receipt-tile--overlay`}>
      <ReceiptTileBody receipt={receipt} index={index} aria-hidden="true" />
    </div>
  )
}

function ReceiptTileBody({
  receipt,
  index,
  ...rest
}: ReceiptTileProps & HTMLAttributes<HTMLDivElement>) {
  const date = formatShortDate(receipt.file.lastModified)

  return (
    <div
      className="receipt-tile-body"
      title={receipt.file.name}
      aria-label={`${index + 1}번째 영수증, ${receipt.file.name}, ${date}`}
      {...rest}
    >
      <span className="receipt-tile-number" aria-hidden="true">{index + 1}</span>
      <span className="receipt-tile-thumb" aria-hidden="true">
        {receipt.previewUrl ? (
          <img
            src={receipt.previewUrl}
            alt=""
            draggable={false}
            style={{ transform: `rotate(${receipt.rotation}deg)` }}
          />
        ) : receipt.status === 'processing' ? (
          <LoaderCircle className="spin" size={20} />
        ) : (
          <AlertTriangle size={19} />
        )}
      </span>
      <span className="receipt-tile-date" aria-hidden="true">{date}</span>
    </div>
  )
}

function formatShortDate(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

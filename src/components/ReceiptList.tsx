import { useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  ArrowDownAZ,
  ArrowUpDown,
  CalendarArrowUp,
  Check,
  LayoutGrid,
  ReceiptText,
} from 'lucide-react'
import type { LayoutWarning, ReceiptDraft } from '../domain/types'
import type { ReceiptArrangement } from '../lib/receipt-order'
import { ReceiptCard } from './ReceiptCard'
import { ReceiptTileOverlay, SortableReceiptTile } from './ReceiptTile'

interface ReceiptListProps {
  receipts: ReceiptDraft[]
  warnings: LayoutWarning[]
  onReorder: (activeId: string, overId: string) => void
  onArrange: (arrangement: ReceiptArrangement) => void
  onMove: (id: string, direction: -1 | 1) => void
  onDelete: (id: string) => void
  onRotate: (id: string) => void
  onDescriptionChange: (id: string, value: string) => void
  onForceSinglePage: (id: string, checked: boolean) => void
  isDescriptionInvalid: (description: string) => boolean
}

type ListMode = 'cards' | 'reorder'

const ARRANGE_ACTIONS: {
  arrangement: ReceiptArrangement
  label: string
  title: string
  done: string
  Icon: typeof ArrowUpDown
}[] = [
  {
    arrangement: 'date',
    label: '날짜순',
    title: '파일 수정 날짜가 오래된 것부터 정렬',
    done: '파일 수정 날짜가 오래된 순서로 정렬했습니다.',
    Icon: CalendarArrowUp,
  },
  {
    arrangement: 'name',
    label: '이름순',
    title: '파일 이름 순서로 정렬',
    done: '파일 이름 순서로 정렬했습니다.',
    Icon: ArrowDownAZ,
  },
  {
    arrangement: 'reverse',
    label: '뒤집기',
    title: '지금 순서를 거꾸로 뒤집기',
    done: '순서를 거꾸로 뒤집었습니다.',
    Icon: ArrowUpDown,
  },
]

export function ReceiptList({
  receipts,
  warnings,
  onReorder,
  onArrange,
  onMove,
  onDelete,
  onRotate,
  onDescriptionChange,
  onForceSinglePage,
  isDescriptionInvalid,
}: ReceiptListProps) {
  const [mode, setMode] = useState<ListMode>('cards')
  const [announcement, setAnnouncement] = useState('')
  const canReorder = receipts.length > 1

  // Leave reorder mode once there is nothing left to reorder.
  if (mode === 'reorder' && !canReorder) setMode('cards')

  if (receipts.length === 0) {
    return (
      <div className="receipt-empty-state">
        <div aria-hidden="true"><ReceiptText size={25} /></div>
        <p>아직 첨부한 영수증이 없어요.</p>
        <span>위 영역에서 이미지를 추가하면 자동으로 정리됩니다.</span>
      </div>
    )
  }

  const isReordering = mode === 'reorder' && canReorder

  return (
    <>
      {canReorder && (
        <div className="receipt-order-toolbar">
          <div className="receipt-sort-group" role="group" aria-label="영수증 정렬">
            <span className="receipt-sort-label" aria-hidden="true">정렬</span>
            {ARRANGE_ACTIONS.map(({ arrangement, label, title, done, Icon }) => (
              <button
                key={arrangement}
                type="button"
                className="order-chip"
                title={title}
                onClick={() => {
                  onArrange(arrangement)
                  setAnnouncement(done)
                }}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`order-chip ${isReordering ? 'order-chip--primary' : 'order-chip--accent'}`}
            aria-pressed={isReordering}
            onClick={() => setMode(isReordering ? 'cards' : 'reorder')}
          >
            {isReordering
              ? <Check size={14} aria-hidden="true" />
              : <LayoutGrid size={14} aria-hidden="true" />}
            {isReordering ? '완료' : '순서 편집'}
          </button>
          {isReordering && (
            <p className="receipt-order-hint">
              <span className="receipt-order-hint--pointer">썸네일을 끌어서 원하는 자리에 놓으세요.</span>
              <span className="receipt-order-hint--touch">썸네일을 길게 누른 뒤 원하는 자리로 끌어 놓으세요.</span>
              {' '}A4 미리보기에 바로 반영돼요.
            </p>
          )}
          <p className="visually-hidden" role="status">{announcement}</p>
        </div>
      )}

      {isReordering ? (
        <ReceiptTileGrid receipts={receipts} onReorder={onReorder} />
      ) : (
        <ReceiptCardList
          receipts={receipts}
          warnings={warnings}
          onReorder={onReorder}
          onMove={onMove}
          onDelete={onDelete}
          onRotate={onRotate}
          onDescriptionChange={onDescriptionChange}
          onForceSinglePage={onForceSinglePage}
          isDescriptionInvalid={isDescriptionInvalid}
        />
      )}
    </>
  )
}

function ReceiptCardList({
  receipts,
  warnings,
  onReorder,
  onMove,
  onDelete,
  onRotate,
  onDescriptionChange,
  onForceSinglePage,
  isDescriptionInvalid,
}: Omit<ReceiptListProps, 'onArrange'>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id))
  }

  const warningsByReceipt = new Map<string, string[]>()
  warnings.forEach((warning) => {
    const current = warningsByReceipt.get(warning.receiptId) ?? []
    current.push(warning.message)
    warningsByReceipt.set(warning.receiptId, current)
  })

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={receipts.map((receipt) => receipt.id)} strategy={verticalListSortingStrategy}>
        <div className="receipt-list">
          {receipts.map((receipt, index) => (
            <ReceiptCard
              key={receipt.id}
              receipt={receipt}
              index={index}
              total={receipts.length}
              warnings={warningsByReceipt.get(receipt.id) ?? []}
              descriptionInvalid={isDescriptionInvalid(receipt.description)}
              onMove={(direction) => onMove(receipt.id, direction)}
              onDelete={() => onDelete(receipt.id)}
              onRotate={() => onRotate(receipt.id)}
              onDescriptionChange={(value) => onDescriptionChange(receipt.id, value)}
              onForceSinglePage={(checked) => onForceSinglePage(receipt.id, checked)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function ReceiptTileGrid({
  receipts,
  onReorder,
}: Pick<ReceiptListProps, 'receipts' | 'onReorder'>) {
  const [activeId, setActiveId] = useState<string | null>(null)
  // Whole tiles are draggable, so touch needs a long press to keep page scrolling usable.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeIndex = activeId === null
    ? -1
    : receipts.findIndex((receipt) => receipt.id === activeId)

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={receipts.map((receipt) => receipt.id)} strategy={rectSortingStrategy}>
        <ol className="receipt-tile-grid" aria-label="영수증 순서">
          {receipts.map((receipt, index) => (
            <SortableReceiptTile key={receipt.id} receipt={receipt} index={index} />
          ))}
        </ol>
      </SortableContext>
      <DragOverlay>
        {activeIndex >= 0 && (
          <ReceiptTileOverlay receipt={receipts[activeIndex]} index={activeIndex} />
        )}
      </DragOverlay>
    </DndContext>
  )
}

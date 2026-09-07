import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { ReceiptText } from 'lucide-react'
import type { LayoutWarning, ReceiptDraft } from '../domain/types'
import { ReceiptCard } from './ReceiptCard'

interface ReceiptListProps {
  receipts: ReceiptDraft[]
  warnings: LayoutWarning[]
  onReorder: (activeId: string, overId: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onDelete: (id: string) => void
  onRotate: (id: string) => void
  onDescriptionChange: (id: string, value: string) => void
  onForceSinglePage: (id: string, checked: boolean) => void
  isDescriptionInvalid: (description: string) => boolean
}

export function ReceiptList({
  receipts,
  warnings,
  onReorder,
  onMove,
  onDelete,
  onRotate,
  onDescriptionChange,
  onForceSinglePage,
  isDescriptionInvalid,
}: ReceiptListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id))
  }

  if (receipts.length === 0) {
    return (
      <div className="receipt-empty-state">
        <div aria-hidden="true"><ReceiptText size={25} /></div>
        <p>아직 첨부한 영수증이 없어요.</p>
        <span>위 영역에서 이미지를 추가하면 자동으로 정리됩니다.</span>
      </div>
    )
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

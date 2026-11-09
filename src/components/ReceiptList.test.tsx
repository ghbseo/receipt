import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReceiptDraft } from '../domain/types'
import { ReceiptList } from './ReceiptList'

afterEach(cleanup)

function draft(id: string, name: string, lastModified: number): ReceiptDraft {
  return {
    id,
    file: new File(['x'], name, { type: 'image/png', lastModified }),
    widthPx: 400,
    heightPx: 600,
    rotation: 0,
    description: '',
    forceSinglePage: false,
    status: 'ready',
  }
}

function renderList(receipts: ReceiptDraft[]) {
  const onArrange = vi.fn()
  const view = render(
    <ReceiptList
      receipts={receipts}
      warnings={[]}
      onReorder={vi.fn()}
      onArrange={onArrange}
      onMove={vi.fn()}
      onDelete={vi.fn()}
      onRotate={vi.fn()}
      onDescriptionChange={vi.fn()}
      onForceSinglePage={vi.fn()}
      isDescriptionInvalid={() => false}
    />,
  )
  return { ...view, onArrange }
}

const RECEIPTS = [
  draft('b', '10월2일.png', new Date(2026, 9, 2).getTime()),
  draft('a', '10월1일.png', new Date(2026, 9, 1).getTime()),
]

describe('ReceiptList ordering tools', () => {
  it('requests each arrangement from the toolbar', async () => {
    const user = userEvent.setup()
    const { onArrange } = renderList(RECEIPTS)
    const sortGroup = screen.getByRole('group', { name: '영수증 정렬' })

    await user.click(within(sortGroup).getByRole('button', { name: /날짜순/ }))
    await user.click(within(sortGroup).getByRole('button', { name: /이름순/ }))
    await user.click(within(sortGroup).getByRole('button', { name: /뒤집기/ }))

    expect(onArrange.mock.calls).toEqual([['date'], ['name'], ['reverse']])
    expect(screen.getByText('순서를 거꾸로 뒤집었습니다.')).toHaveAttribute('role', 'status')
  })

  it('switches between detailed cards and a thumbnail grid', async () => {
    const user = userEvent.setup()
    renderList(RECEIPTS)
    expect(screen.getAllByRole('textbox', { name: /간단한 설명/ })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '순서 편집' }))

    const grid = screen.getByRole('list', { name: '영수증 순서' })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
    expect(within(grid).getByLabelText('1번째 영수증, 10월2일.png, 10/2')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /간단한 설명/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '완료' }))

    expect(screen.queryByRole('list', { name: '영수증 순서' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: /간단한 설명/ })).toHaveLength(2)
  })

  it('hides ordering tools when there is only one receipt', () => {
    renderList([RECEIPTS[0]])

    expect(screen.queryByRole('group', { name: '영수증 정렬' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '순서 편집' })).not.toBeInTheDocument()
  })

  it('returns to cards when receipts drop below two while reordering', async () => {
    const user = userEvent.setup()
    const { rerender } = renderList(RECEIPTS)
    await user.click(screen.getByRole('button', { name: '순서 편집' }))

    rerender(
      <ReceiptList
        receipts={[RECEIPTS[0]]}
        warnings={[]}
        onReorder={vi.fn()}
        onArrange={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRotate={vi.fn()}
        onDescriptionChange={vi.fn()}
        onForceSinglePage={vi.fn()}
        isDescriptionInvalid={() => false}
      />,
    )

    expect(screen.queryByRole('list', { name: '영수증 순서' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /간단한 설명/ })).toBeInTheDocument()
  })
})

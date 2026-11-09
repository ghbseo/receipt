export type ReceiptArrangement = 'date' | 'name' | 'reverse'

interface OrderableReceipt {
  file: Pick<File, 'name' | 'lastModified'>
}

const fileNameCollator = new Intl.Collator('ko', {
  numeric: true,
  sensitivity: 'base',
})

/**
 * Returns a reordered copy. Dates use the file's last-modified time (oldest first)
 * and names use natural order so "2.jpg" comes before "10.jpg".
 */
export function arrangeReceipts<T extends OrderableReceipt>(
  receipts: readonly T[],
  arrangement: ReceiptArrangement,
): T[] {
  if (arrangement === 'reverse') return [...receipts].reverse()
  return [...receipts].sort(arrangement === 'date' ? compareByDate : compareByName)
}

function compareByDate(a: OrderableReceipt, b: OrderableReceipt): number {
  return (
    a.file.lastModified - b.file.lastModified ||
    fileNameCollator.compare(a.file.name, b.file.name)
  )
}

function compareByName(a: OrderableReceipt, b: OrderableReceipt): number {
  return (
    fileNameCollator.compare(a.file.name, b.file.name) ||
    a.file.lastModified - b.file.lastModified
  )
}

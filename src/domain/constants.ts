export const getDefaultTitle = (date: Date = new Date()): string => {
  const previousMonth = date.getMonth() === 0 ? 12 : date.getMonth()
  return `${previousMonth}월 경비 영수증`
}

export const DEFAULT_TITLE = getDefaultTitle()

export const INPUT_LIMITS = {
  title: 30,
  department: 20,
  employeeName: 20,
  description: 60,
  desktopFiles: 60,
  mobileFiles: 20,
  fileBytes: 20 * 1024 * 1024,
  desktopTotalBytes: 200 * 1024 * 1024,
  mobileTotalBytes: 80 * 1024 * 1024,
  pixels: 24_000_000,
} as const

export const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

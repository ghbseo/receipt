import { LoaderCircle, X } from 'lucide-react'

export interface ProgressState {
  kind: 'images' | 'pdf'
  current: number
  total: number
}

interface ProgressBannerProps {
  progress: ProgressState
  onCancel: () => void
}

export function ProgressBanner({ progress, onCancel }: ProgressBannerProps) {
  const percent = progress.total > 0
    ? Math.max(4, Math.round((progress.current / progress.total) * 100))
    : 4
  const isPdf = progress.kind === 'pdf'

  return (
    <div className="progress-banner" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={19} aria-hidden="true" />
      <div className="progress-copy">
        <div>
          <strong>{isPdf ? 'PDF를 만들고 있어요' : '이미지를 정리하고 있어요'}</strong>
          <span>{progress.current}/{progress.total}</span>
        </div>
        <div className="progress-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
      </div>
      <button type="button" className="icon-button" onClick={onCancel} aria-label="작업 취소" title="취소">
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  )
}

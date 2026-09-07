import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ImagePlus, LockKeyhole, UploadCloud } from 'lucide-react'

interface ReceiptDropzoneProps {
  disabled?: boolean
  currentCount: number
  maxCount: number
  onFiles: (files: File[]) => void
}

export function ReceiptDropzone({
  disabled = false,
  currentCount,
  maxCount,
  onFiles,
}: ReceiptDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const selectFiles = () => {
    if (!disabled) inputRef.current?.click()
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    onFiles(Array.from(event.dataTransfer.files))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectFiles()
    }
  }

  return (
    <section className="editor-section upload-section" aria-labelledby="receipt-upload-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">STEP 2</p>
          <h2 id="receipt-upload-heading">영수증 첨부</h2>
        </div>
        <span className="receipt-counter" aria-label={`${maxCount}장 중 ${currentCount}장 첨부됨`}>
          <strong>{currentCount}</strong> / {maxCount}장
        </span>
      </div>

      <div
        className={`dropzone ${isDragging ? 'dropzone--active' : ''} ${disabled ? 'dropzone--disabled' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="영수증 이미지 선택"
        onClick={selectFiles}
        onKeyDown={handleKeyDown}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDragging(false)
          }
        }}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          disabled={disabled}
          onChange={(event) => {
            onFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <div className="dropzone-icon" aria-hidden="true">
          {isDragging ? <ImagePlus size={27} /> : <UploadCloud size={27} />}
        </div>
        <p className="dropzone-title">
          {isDragging ? '여기에 놓아주세요' : '영수증 이미지를 끌어놓으세요'}
        </p>
        <p className="dropzone-help">
          <span className="dropzone-link">파일 선택</span> 또는 클립보드에서 붙여넣기
        </p>
        <p className="dropzone-spec">JPG · PNG · WebP / 파일당 최대 20MB</p>
      </div>

      <div className="local-processing-note">
        <LockKeyhole size={15} aria-hidden="true" />
        <span>이미지는 서버에 전송되지 않고 이 기기 안에서만 처리됩니다.</span>
      </div>
    </section>
  )
}

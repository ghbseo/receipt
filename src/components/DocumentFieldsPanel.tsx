import type { DocumentFields } from '../domain/types'

export type FieldName = keyof DocumentFields

interface DocumentFieldsPanelProps {
  fields: DocumentFields
  errors: Partial<Record<FieldName, string>>
  touched: Partial<Record<FieldName, boolean>>
  limits: Record<FieldName, number>
  onChange: (field: FieldName, value: string) => void
  onBlur: (field: FieldName) => void
}

const fieldMeta: Array<{
  name: FieldName
  label: string
  placeholder: string
  autoComplete: string
}> = [
  {
    name: 'title',
    label: '문서 제목',
    placeholder: '예: 9월 경비 영수증',
    autoComplete: 'off',
  },
  {
    name: 'department',
    label: '부서',
    placeholder: '예: 제품개발팀',
    autoComplete: 'organization-title',
  },
  {
    name: 'employeeName',
    label: '이름',
    placeholder: '예: 홍길동',
    autoComplete: 'name',
  },
]

export function DocumentFieldsPanel({
  fields,
  errors,
  touched,
  limits,
  onChange,
  onBlur,
}: DocumentFieldsPanelProps) {
  return (
    <section className="editor-section" aria-labelledby="document-fields-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">STEP 1</p>
          <h2 id="document-fields-heading">문서 정보</h2>
        </div>
        <span className="required-note"><span aria-hidden="true">*</span> 필수 입력</span>
      </div>

      <div className="field-grid">
        {fieldMeta.map(({ name, label, placeholder, autoComplete }) => {
          const id = `document-${name}`
          const errorId = `${id}-error`
          const countId = `${id}-count`
          const showError = touched[name] && errors[name]

          return (
            <div className={`field ${showError ? 'field--invalid' : ''}`} key={name}>
              <div className="field-label-row">
                <label htmlFor={id}>
                  {label}<span className="required-mark" aria-hidden="true">*</span>
                </label>
                <span id={countId} className="character-count">
                  {fields[name].length}/{limits[name]}
                </span>
              </div>
              <input
                id={id}
                type="text"
                value={fields[name]}
                placeholder={placeholder}
                maxLength={limits[name]}
                autoComplete={autoComplete}
                aria-invalid={Boolean(showError)}
                aria-describedby={showError ? `${countId} ${errorId}` : countId}
                onChange={(event) => onChange(name, event.target.value)}
                onBlur={() => onBlur(name)}
              />
              {showError && (
                <p className="field-error" id={errorId} role="alert">
                  {errors[name]}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

import { useState } from 'react'

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <line x1="5" y1="5" x2="19" y2="19" />
    <line x1="19" y1="5" x2="5" y2="19" />
  </svg>
)

// 密碼輸入框
// - 預設遮罩顯示，可切換明文／隱藏
// - 聚焦時自動全選：即使瀏覽器自動填入舊密碼，直接打字即可取代，不需先刪除
// - 有內容時顯示「清除」按鈕
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  onEnter,
  style,
  className = '',
  label = '密碼',
  selectOnFocus = true,
}) {
  const [show, setShow] = useState(false)
  const hasValue = value !== undefined && value !== null && value !== ''

  return (
    <span className="pw-wrap">
      <input
        className={className}
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete || 'current-password'}
        style={style}
        onFocus={(e) => {
          if (selectOnFocus && e.target.value) e.target.select()
        }}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.()
        }}
      />
      <span className="pw-btns">
        {hasValue && (
          <button
            type="button"
            className="pw-btn"
            onClick={() => {
              onChange?.('')
            }}
            title="清除"
            aria-label={`清除${label}`}
            tabIndex={-1}
          >
            <CloseIcon />
          </button>
        )}
        <button
          type="button"
          className="pw-btn"
          onClick={() => setShow((v) => !v)}
          title={show ? `隱藏${label}` : `顯示${label}`}
          aria-label={show ? `隱藏${label}` : `顯示${label}`}
          aria-pressed={show}
          tabIndex={-1}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
    </span>
  )
}

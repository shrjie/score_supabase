import { useEffect, useRef, useState } from 'react'

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
// - 預設遮罩顯示；眼睛按鈕為「按住顯示／鬆手自動隱藏」
//   （滑鼠、觸控、鍵盤 Space/Enter 皆支援）
// - 聚焦時自動全選：即使有殘留內容，直接打字即可取代
// - 有內容時顯示「清除」按鈕
// - clearOnMount：清掉瀏覽器自動填入的舊密碼（Chrome 自動填入不會觸發事件，
//   因此載入後幾個時間點各檢查一次；若使用者尚未輸入就發現有值就清掉）
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
  clearOnMount = true,
}) {
  const [show, setShow] = useState(false)
  const inputRef = useRef(null)
  const touched = useRef(false)
  const hasValue = value !== undefined && value !== null && value !== ''

  useEffect(() => {
    if (!clearOnMount) return undefined
    const timers = [0, 200, 600, 1200, 2000, 3000, 4000, 6000, 8000, 10000, 15000].map((ms) =>
      setTimeout(() => {
        const el = inputRef.current
        if (el && el.value && !touched.current) {
          el.value = ''
          onChange?.('')
        }
      }, ms),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span className="pw-wrap">
      <input
        ref={inputRef}
        className={className}
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete || 'current-password'}
        style={style}
        onFocus={(e) => {
          touched.current = true
          if (selectOnFocus && e.target.value) e.target.select()
        }}
        onClick={(e) => {
          if (selectOnFocus && e.target.value) e.target.select()
        }}
        onChange={(e) => {
          touched.current = true
          onChange?.(e.target.value)
        }}
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
              touched.current = true
              onChange?.('')
            }}
            title="清除"
            aria-label={`清除${label}`}
          >
            <CloseIcon />
          </button>
        )}
        <button
          type="button"
          className="pw-btn pw-eye"
          title={`按住顯示${label}，鬆開自動隱藏`}
          aria-label={`按住顯示${label}`}
          onPointerDown={(e) => {
            e.preventDefault()
            setShow(true)
          }}
          onPointerUp={() => setShow(false)}
          onPointerLeave={() => setShow(false)}
          onPointerCancel={() => setShow(false)}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              setShow(true)
            }
          }}
          onKeyUp={() => setShow(false)}
          onBlur={() => setShow(false)}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
    </span>
  )
}

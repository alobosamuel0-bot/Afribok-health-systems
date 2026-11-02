import { Link } from 'react-router-dom'

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size} height={size}>
        <defs>
          <linearGradient id="brand-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6cf91" />
            <stop offset="1" stopColor="#dc7a42" />
          </linearGradient>
          <linearGradient id="brand-land" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b7c60" />
            <stop offset="1" stopColor="#173d31" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="15" fill="currentColor" opacity="0.06" />
        <circle cx="32" cy="27" r="12.5" fill="url(#brand-sun)" />
        <path d="M7 46c7-7 15-7 23 0 8 7 16 7 27 0v12H7Z" fill="url(#brand-land)" />
        <path
          d="M7 46c7-7 15-7 23 0 8 7 16 7 27 0"
          fill="none"
          stroke="#efc183"
          strokeOpacity=".7"
          strokeWidth="1.4"
        />
      </svg>
    </span>
  )
}

export function Brand({
  to = '/',
  variant = 'dark',
  compact = false,
}: {
  to?: string
  variant?: 'dark' | 'light'
  compact?: boolean
}) {
  return (
    <Link to={to} className={`brand brand--${variant} ${compact ? 'brand--compact' : ''}`} aria-label="Afribok home">
      <BrandMark size={compact ? 30 : 36} />
      <span className="brand-word">AFRIBOK</span>
      {!compact && <span className="brand-sub">clinical workspace</span>}
    </Link>
  )
}

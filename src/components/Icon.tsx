import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'dashboard'
  | 'patients'
  | 'encounters'
  | 'sync'
  | 'audit'
  | 'team'
  | 'roadmap'
  | 'search'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'plus'
  | 'check'
  | 'alert'
  | 'wifi'
  | 'wifi-off'
  | 'cloud'
  | 'clock'
  | 'chevron-left'
  | 'chevron-right'
  | 'menu'
  | 'close'
  | 'mic'
  | 'document'
  | 'lock'
  | 'spark'
  | 'play'
  | 'pause'
  | 'restart'
  | 'mail'
  | 'eye'
  | 'eye-off'
  | 'logout'
  | 'shield'
  | 'arrow-left'
  | 'info'
  | 'stethoscope'
  | 'camera'
  | 'chart'
  | 'wave'

const paths: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="4" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  patients: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.4-3.5 2.6-5.5 5.5-5.5s5.1 2 5.5 5.5" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.8c1.8.6 3 2.3 3.2 5.2" />
    </>
  ),
  encounters: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M7 3v4M17 3v4M3 10h18" />
      <path d="M8 14h3M8 17.5h7" />
    </>
  ),
  sync: (
    <>
      <path d="M20 7h-5V2" />
      <path d="M20 7a8 8 0 0 0-14.7 2.6" />
      <path d="M4 17h5v5" />
      <path d="M4 17a8 8 0 0 0 14.7-2.6" />
    </>
  ),
  audit: (
    <>
      <path d="M12 3 4.5 6v5.4c0 4.5 3.1 8.1 7.5 9.6 4.4-1.5 7.5-5.1 7.5-9.6V6Z" />
      <path d="m8.8 12 2.1 2.2 4.5-4.6" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c.4-3.2 2.4-5 5.5-5s5.1 1.8 5.5 5" />
      <circle cx="17.2" cy="9" r="2.2" />
      <path d="M16 14.3c2.6.1 4.2 1.8 4.5 4.6" />
    </>
  ),
  roadmap: (
    <>
      <path d="M4 18.5 9 6l4 7 3-4 4 9.5" />
      <path d="M3 21h18" />
      <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6" />,
  'arrow-up-right': <path d="M7 17 17 7M9 7h8v8" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4Z" />
      <path d="M12 9v5M12 17.2v.1" />
    </>
  ),
  wifi: (
    <>
      <path d="M3 9a14 14 0 0 1 18 0M6 12.5a9.5 9.5 0 0 1 12 0M9.4 16a5 5 0 0 1 5.2 0" />
      <circle cx="12" cy="19.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'wifi-off': (
    <>
      <path d="M3 9a14 14 0 0 1 6-3.4M12 5a14 14 0 0 1 9 4M6 12.5a9.5 9.5 0 0 1 4-2.2M15.8 12.2a9.7 9.7 0 0 1 2.2 1.3M9.4 16a5 5 0 0 1 5.2 0" />
      <path d="m3 3 18 18" />
      <circle cx="12" cy="19.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 18.5h10.2a3.8 3.8 0 0 0 .5-7.6A5.7 5.7 0 0 0 6.8 9.4 4.6 4.6 0 0 0 7 18.5Z" />
      <path d="M9 14.5h6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7v5.4l3.4 2" />
    </>
  ),
  'chevron-left': <path d="m14.5 5-7 7 7 7" />,
  'chevron-right': <path d="m9.5 5 7 7-7 7" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="11" rx="2.4" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <circle cx="12" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2.8c.8 4.7 2.7 6.6 7.4 7.4-4.7.8-6.6 2.7-7.4 7.4-.8-4.7-2.7-6.6-7.4-7.4 4.7-.8 6.6-2.7 7.4-7.4Z" />
      <path d="M19 16.2c.3 1.8 1.1 2.6 2.9 2.9-1.8.3-2.6 1.1-2.9 2.9-.3-1.8-1.1-2.6-2.9-2.9 1.8-.3 2.6-1.1 2.9-2.9Z" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5Z" />,
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  restart: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4 9.3" />
      <path d="M4 4v5.3h5.3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4 20 20M9.9 5.9A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a16 16 0 0 1-3.3 3.9M6.4 7.1A16.2 16.2 0 0 0 2.5 12S6 18.2 12 18.2c1.4 0 2.6-.3 3.7-.8" />
      <path d="M10.3 10.3a2.5 2.5 0 0 0 3.4 3.4" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4H6v16h8" />
      <path d="M10 12h11m-4-4 4 4-4 4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.4c0 4.5 3.1 8.1 7.5 9.6 4.4-1.5 7.5-5.1 7.5-9.6V6Z" />
      <path d="M12 8v4" />
    </>
  ),
  'arrow-left': <path d="M20 12H4m6-6-6 6 6 6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.7v5.6M12 7.3v.1" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M6 3v5.5a4.5 4.5 0 0 0 9 0V3" />
      <path d="M4 3h4M13 3h4M10.5 13v2.8a4.2 4.2 0 0 0 8.4 0V14" />
      <circle cx="18.9" cy="12" r="2" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a2 2 0 0 0 1.7-1l.4-.7A1.7 1.7 0 0 1 10.2 3h3.6a1.7 1.7 0 0 1 1.4.8l.4.7a2 2 0 0 0 1.7 1h1.2A2.5 2.5 0 0 1 21 8v9.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-7M20 16v-3" />
    </>
  ),
  wave: (
    <>
      <path d="M3 12h2.5l2-6 3 12 3-9 2.5 6H21" />
    </>
  ),
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, className, ...props }: IconProps) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}

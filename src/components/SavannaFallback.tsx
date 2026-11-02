export function SavannaFallback({ login = false }: { login?: boolean }) {
  return (
    <div className={`savanna-fallback ${login ? 'savanna-fallback--login' : ''}`} aria-hidden="true">
      <div className="savanna-sky" />
      <div className="savanna-sun" />
      <div className="savanna-haze" />
      <svg className="savanna-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="fallback-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8e5140" />
            <stop offset="1" stopColor="#5b3027" />
          </linearGradient>
          <linearGradient id="fallback-mid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#502a21" />
            <stop offset="1" stopColor="#321a15" />
          </linearGradient>
          <linearGradient id="fallback-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b1612" />
            <stop offset="1" stopColor="#1a0e0a" />
          </linearGradient>
          <radialGradient id="fallback-sunglow">
            <stop offset="0" stopColor="#ffe3a6" stopOpacity=".85" />
            <stop offset=".5" stopColor="#f0a361" stopOpacity=".25" />
            <stop offset="1" stopColor="#e0804b" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="1170" cy="408" r="290" fill="url(#fallback-sunglow)" />
        <g className="fallback-birds" fill="none" stroke="#1a100c" strokeWidth="3" strokeLinecap="round">
          <path d="M875 245q13-13 26 0 13-13 26 0" />
          <path d="M960 205q10-10 20 0 10-10 20 0" />
          <path d="M927 300q8-8 16 0 8-8 16 0" />
          <path d="M1010 268q12-12 24 0 12-12 24 0" />
        </g>

        <path
          d="M0 585c112-8 208-54 329-43 124 11 194 71 312 46 119-25 200-84 330-62 130 22 217 94 353 78 92-11 177-43 276-46v342H0Z"
          fill="url(#fallback-far)"
          opacity=".82"
        />
        <path
          d="M0 658c142-12 234-62 366-44 130 18 194 88 343 66 149-22 226-72 359-50 133 22 225 75 359 60 65-7 118-22 173-28v238H0Z"
          fill="url(#fallback-mid)"
        />
        <path
          d="M0 740c125-6 218-46 341-28 123 18 200 65 337 40 137-25 224-54 355-31 131 23 226 60 348 44 81-10 147-24 219-25v160H0Z"
          fill="url(#fallback-near)"
        />

        <g className="fallback-tree fallback-tree--left" fill="#160d09">
          <path d="M322 780c6-65 4-112-9-156-4-14-12-30-4-32 8-2 15 23 20 52 3 20 4 42 8 60 6-31 26-77 44-95 6-7 10-1 5 9-13 27-25 63-28 93 23-28 53-46 73-53 9-3 10 4 3 9-28 17-56 45-65 66-5 12-8 30-8 47Z" />
          <ellipse cx="294" cy="612" rx="96" ry="17" />
          <ellipse cx="341" cy="592" rx="100" ry="19" />
          <ellipse cx="401" cy="611" rx="79" ry="14" />
          <ellipse cx="337" cy="625" rx="66" ry="11" />
          <ellipse cx="430" cy="633" rx="39" ry="8" />
        </g>

        <g className="fallback-tree" fill="#120b08">
          <path d="M1196 756c4-95-7-179-28-247-5-17-19-37-10-40 10-3 24 34 33 68 7 26 10 56 15 81 12-47 35-111 57-138 8-11 15-4 8 10-18 38-36 92-43 134 29-40 68-67 98-75 12-3 14 6 4 12-39 24-73 61-88 95-12 27-17 59-19 100Z" />
          <path d="M1192 553c-35-42-76-67-117-72" fill="none" stroke="#120b08" strokeWidth="9" strokeLinecap="round" />
          <path d="M1211 518c38-34 75-49 109-53" fill="none" stroke="#120b08" strokeWidth="8" strokeLinecap="round" />
          <path d="M1186 500c-17-35-38-60-65-77" fill="none" stroke="#120b08" strokeWidth="7" strokeLinecap="round" />
          <ellipse cx="1078" cy="548" rx="134" ry="23" />
          <ellipse cx="1217" cy="527" rx="162" ry="26" />
          <ellipse cx="1351" cy="547" rx="129" ry="21" />
          <ellipse cx="1221" cy="494" rx="104" ry="19" />
          <ellipse cx="1150" cy="472" rx="72" ry="16" />
          <ellipse cx="1315" cy="505" rx="56" ry="12" />
          <ellipse cx="1252" cy="570" rx="88" ry="14" />
          <ellipse cx="1372" cy="575" rx="49" ry="8" />
        </g>

        <path d="M0 858c180-26 345-13 520 3 212 19 392 3 594-17 194-19 330-13 486 7v49H0Z" fill="#0e0806" />
      </svg>
      <div className="savanna-vignette" />
    </div>
  )
}

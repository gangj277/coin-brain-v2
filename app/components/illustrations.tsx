// Large SVG illustrations for landing page sections.
// Each is designed at ~200-280px to be a prominent visual element.

export function IllustOnchain() {
  // Chain links with data flowing through them — represents on-chain verification
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background glow */}
      <circle cx="100" cy="80" r="60" fill="url(#glow-cyan)" opacity="0.08" />
      {/* Chain links */}
      <rect x="30" y="50" width="50" height="30" rx="15" stroke="#22d3ee" strokeWidth="2" opacity="0.6" />
      <rect x="70" y="50" width="50" height="30" rx="15" stroke="#22d3ee" strokeWidth="2" />
      <rect x="110" y="50" width="50" height="30" rx="15" stroke="#22d3ee" strokeWidth="2" opacity="0.6" />
      {/* Lock icon in center */}
      <rect x="88" y="85" width="24" height="18" rx="3" stroke="#22d3ee" strokeWidth="2" fill="rgba(34,211,238,0.08)" />
      <path d="M93 85v-5a7 7 0 0114 0v5" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
      <circle cx="100" cy="94" r="2" fill="#22d3ee" />
      {/* Data dots flowing */}
      <circle cx="45" cy="40" r="2" fill="#22d3ee" opacity="0.4" />
      <circle cx="65" cy="35" r="1.5" fill="#22d3ee" opacity="0.6" />
      <circle cx="100" cy="32" r="2" fill="#22d3ee" opacity="0.8" />
      <circle cx="135" cy="35" r="1.5" fill="#22d3ee" opacity="0.6" />
      <circle cx="155" cy="40" r="2" fill="#22d3ee" opacity="0.4" />
      {/* Checkmarks */}
      <path d="M40 120l3 3 6-6" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M95 120l3 3 6-6" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M150 120l3 3 6-6" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="35" y="140" fill="#5a5a66" fontSize="9" fontFamily="monospace">VERIFIED</text>
      <text x="90" y="140" fill="#5a5a66" fontSize="9" fontFamily="monospace">VERIFIED</text>
      <text x="145" y="140" fill="#5a5a66" fontSize="9" fontFamily="monospace">VERIFIED</text>
      <defs><radialGradient id="glow-cyan"><stop stopColor="#22d3ee" /><stop offset="1" stopColor="transparent" /></radialGradient></defs>
    </svg>
  );
}

export function IllustFunnel() {
  // Funnel filtering 32,828 down to 300 — pyramid narrowing with numbers
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="80" r="60" fill="url(#glow-green)" opacity="0.06" />
      {/* Funnel shape */}
      <path d="M30 20h140l-40 55h-60z" stroke="#34d399" strokeWidth="1.5" fill="rgba(52,211,153,0.03)" />
      <path d="M70 75h60l-15 45h-30z" stroke="#34d399" strokeWidth="1.5" fill="rgba(52,211,153,0.06)" />
      <path d="M85 120h30l-5 20h-20z" stroke="#34d399" strokeWidth="2" fill="rgba(52,211,153,0.1)" />
      {/* Dots representing traders being filtered */}
      {[35,50,65,80,95,110,125,140,155,165].map((x, i) => (
        <circle key={`top-${i}`} cx={x} cy={15} r="2" fill="#5a5a66" opacity={0.3 + i * 0.05} />
      ))}
      {[75,90,105,120].map((x, i) => (
        <circle key={`mid-${i}`} cx={x} cy={70} r="2.5" fill="#34d399" opacity={0.4 + i * 0.15} />
      ))}
      <circle cx="100" cy="130" r="4" fill="#34d399" />
      {/* Labels */}
      <text x="100" y="12" fill="#5a5a66" fontSize="10" fontFamily="monospace" textAnchor="middle">32,828</text>
      <text x="100" y="105" fill="#8b8b96" fontSize="10" fontFamily="monospace" textAnchor="middle">1,170</text>
      <text x="100" y="155" fill="#34d399" fontSize="11" fontFamily="monospace" textAnchor="middle" fontWeight="bold">300</text>
      <defs><radialGradient id="glow-green"><stop stopColor="#34d399" /><stop offset="1" stopColor="transparent" /></radialGradient></defs>
    </svg>
  );
}

export function IllustAI() {
  // Brain with neural connections + analysis output — AI interpretation
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="70" cy="70" r="50" fill="url(#glow-amber)" opacity="0.06" />
      {/* Brain outline */}
      <path d="M50 70c0-15 8-30 20-30s15 10 15 10 5-10 15-10 20 15 20 30c0 20-15 35-35 35S50 90 50 70z" stroke="#fbbf24" strokeWidth="1.5" fill="rgba(251,191,36,0.04)" />
      {/* Neural connections */}
      <line x1="65" y1="55" x2="75" y2="65" stroke="#fbbf24" strokeWidth="1" opacity="0.4" />
      <line x1="75" y1="65" x2="85" y2="55" stroke="#fbbf24" strokeWidth="1" opacity="0.4" />
      <line x1="75" y1="65" x2="75" y2="80" stroke="#fbbf24" strokeWidth="1" opacity="0.4" />
      <line x1="60" y1="75" x2="75" y2="65" stroke="#fbbf24" strokeWidth="1" opacity="0.4" />
      <line x1="90" y1="75" x2="75" y2="65" stroke="#fbbf24" strokeWidth="1" opacity="0.4" />
      <circle cx="65" cy="55" r="3" fill="#fbbf24" opacity="0.6" />
      <circle cx="85" cy="55" r="3" fill="#fbbf24" opacity="0.6" />
      <circle cx="75" cy="65" r="4" fill="#fbbf24" />
      <circle cx="60" cy="75" r="3" fill="#fbbf24" opacity="0.6" />
      <circle cx="90" cy="75" r="3" fill="#fbbf24" opacity="0.6" />
      <circle cx="75" cy="80" r="3" fill="#fbbf24" opacity="0.6" />
      {/* Arrow to output */}
      <path d="M110 70h25" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
      <path d="M133 70l-5-3v6z" fill="#fbbf24" opacity="0.5" />
      {/* Output cards */}
      <rect x="140" y="35" width="50" height="16" rx="3" stroke="#22d3ee" strokeWidth="1" fill="rgba(34,211,238,0.06)" />
      <text x="148" y="46" fill="#22d3ee" fontSize="8" fontFamily="monospace">Market</text>
      <rect x="140" y="58" width="50" height="16" rx="3" stroke="#60a5fa" strokeWidth="1" fill="rgba(96,165,250,0.06)" />
      <text x="146" y="69" fill="#60a5fa" fontSize="8" fontFamily="monospace">Position</text>
      <rect x="140" y="81" width="50" height="16" rx="3" stroke="#fbbf24" strokeWidth="1" fill="rgba(251,191,36,0.06)" />
      <text x="155" y="92" fill="#fbbf24" fontSize="8" fontFamily="monospace">Risk</text>
      <defs><radialGradient id="glow-amber"><stop stopColor="#fbbf24" /><stop offset="1" stopColor="transparent" /></radialGradient></defs>
    </svg>
  );
}

export function IllustPnlChart() {
  // Upward PnL chart with area fill — represents verified performance
  return (
    <svg width="180" height="80" viewBox="0 0 180 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Grid lines */}
      <line x1="0" y1="60" x2="180" y2="60" stroke="#1a1a24" strokeWidth="1" />
      <line x1="0" y1="40" x2="180" y2="40" stroke="#1a1a24" strokeWidth="1" strokeDasharray="2 4" />
      <line x1="0" y1="20" x2="180" y2="20" stroke="#1a1a24" strokeWidth="1" strokeDasharray="2 4" />
      {/* Area fill */}
      <path d="M0 65 L20 58 L40 55 L60 48 L80 42 L100 35 L120 25 L140 20 L160 15 L180 10 L180 70 L0 70Z"
        fill="url(#pnl-gradient)" opacity="0.3" />
      {/* Line */}
      <path d="M0 65 L20 58 L40 55 L60 48 L80 42 L100 35 L120 25 L140 20 L160 15 L180 10"
        stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle cx="180" cy="10" r="3" fill="#34d399" />
      <circle cx="180" cy="10" r="6" fill="#34d399" opacity="0.2" />
      <defs>
        <linearGradient id="pnl-gradient" x1="90" y1="10" x2="90" y2="70" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function IllustConsensus() {
  // Arrows converging — represents consensus signal
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="50" r="40" fill="rgba(52,211,153,0.04)" />
      {/* Converging arrows */}
      <path d="M15 20l30 25" stroke="#34d399" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <path d="M15 80l30-25" stroke="#34d399" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <path d="M5 50h40" stroke="#34d399" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      {/* Center convergence point */}
      <circle cx="60" cy="50" r="8" stroke="#34d399" strokeWidth="2" fill="rgba(52,211,153,0.1)" />
      <circle cx="60" cy="50" r="3" fill="#34d399" />
      {/* Output arrow */}
      <path d="M68 50h35" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M100 50l6-4v8z" fill="#34d399" />
      {/* Label */}
      <text x="60" y="90" fill="#34d399" fontSize="10" fontFamily="monospace" textAnchor="middle" fontWeight="bold">▲ CONSENSUS</text>
    </svg>
  );
}

export function IllustDivergence() {
  // Arrows splitting apart — represents divergence signal
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="50" r="40" fill="rgba(251,191,36,0.04)" />
      {/* Input arrow */}
      <path d="M10 50h30" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      {/* Center split point */}
      <circle cx="55" cy="50" r="6" stroke="#fbbf24" strokeWidth="2" fill="rgba(251,191,36,0.1)" />
      {/* Diverging arrows */}
      <path d="M61 47l30-20" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
      <path d="M88 25l6 1-1 6" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M61 53l30 20" stroke="#f87171" strokeWidth="2" strokeLinecap="round" />
      <path d="M88 75l6-1-1-6" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Labels */}
      <text x="100" y="24" fill="#34d399" fontSize="9" fontFamily="monospace">LONG</text>
      <text x="98" y="82" fill="#f87171" fontSize="9" fontFamily="monospace">SHORT</text>
      <text x="60" y="95" fill="#fbbf24" fontSize="10" fontFamily="monospace" textAnchor="middle" fontWeight="bold">◆ DIVERGENCE</text>
    </svg>
  );
}

export function IllustEmerging() {
  // Small dots growing — represents emerging signal
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="50" r="40" fill="rgba(34,211,238,0.04)" />
      {/* Growing dots */}
      <circle cx="25" cy="55" r="3" fill="#22d3ee" opacity="0.2" />
      <circle cx="40" cy="50" r="4" fill="#22d3ee" opacity="0.35" />
      <circle cx="58" cy="45" r="6" fill="#22d3ee" opacity="0.5" />
      <circle cx="80" cy="38" r="8" fill="#22d3ee" opacity="0.7" />
      {/* Pulse ring on latest */}
      <circle cx="80" cy="38" r="14" stroke="#22d3ee" strokeWidth="1" opacity="0.3" strokeDasharray="3 3" />
      {/* Trend line */}
      <path d="M25 55L40 50L58 45L80 38" stroke="#22d3ee" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
      <text x="60" y="95" fill="#22d3ee" fontSize="10" fontFamily="monospace" textAnchor="middle" fontWeight="bold">○ EMERGING</text>
    </svg>
  );
}

// WhyFree section — diamond with verification checkmark
export function IllustTrust() {
  return (
    <svg width="160" height="160" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer glow */}
      <circle cx="80" cy="80" r="70" fill="url(#trust-glow)" opacity="0.06" />
      {/* Diamond shape */}
      <path d="M80 15L145 80L80 145L15 80Z" stroke="#34d399" strokeWidth="1" fill="rgba(52,211,153,0.02)" />
      <path d="M80 30L130 80L80 130L30 80Z" stroke="#34d399" strokeWidth="0.5" opacity="0.3" fill="rgba(52,211,153,0.02)" />
      {/* Inner shield */}
      <path d="M80 45L60 55v15c0 12 8 22 20 26 12-4 20-14 20-26V55L80 45z" stroke="#34d399" strokeWidth="1.5" fill="rgba(52,211,153,0.06)" />
      {/* Checkmark */}
      <path d="M70 72l7 7 13-13" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Orbiting particles */}
      <circle cx="80" cy="15" r="2" fill="#34d399" opacity="0.4" />
      <circle cx="145" cy="80" r="2" fill="#34d399" opacity="0.3" />
      <circle cx="80" cy="145" r="2" fill="#34d399" opacity="0.4" />
      <circle cx="15" cy="80" r="2" fill="#34d399" opacity="0.3" />
      {/* Corner accents */}
      <path d="M80 15l5 5M80 15l-5 5" stroke="#34d399" strokeWidth="1" opacity="0.3" strokeLinecap="round" />
      {/* Label */}
      <text x="80" y="120" fill="#34d399" fontSize="9" fontFamily="monospace" textAnchor="middle" opacity="0.6">ON-CHAIN VERIFIED</text>
      <defs><radialGradient id="trust-glow"><stop stopColor="#34d399" /><stop offset="1" stopColor="transparent" /></radialGradient></defs>
    </svg>
  );
}

// Roadmap: Dashboard (live)
export function IllustDashboard() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="10" width="44" height="32" rx="4" stroke="#34d399" strokeWidth="1.5" fill="rgba(52,211,153,0.04)" />
      {/* Screen content: mini bars */}
      <rect x="12" y="24" width="4" height="12" rx="1" fill="#34d399" opacity="0.3" />
      <rect x="19" y="20" width="4" height="16" rx="1" fill="#34d399" opacity="0.5" />
      <rect x="26" y="16" width="4" height="20" rx="1" fill="#34d399" opacity="0.7" />
      <rect x="33" y="22" width="4" height="14" rx="1" fill="#34d399" opacity="0.4" />
      <rect x="40" y="18" width="4" height="18" rx="1" fill="#34d399" opacity="0.6" />
      {/* Live dot */}
      <circle cx="44" cy="15" r="2" fill="#34d399" />
      {/* Stand */}
      <path d="M22 42h12M28 42v4" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Roadmap: Indicator
export function IllustIndicator() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Chart line */}
      <path d="M8 40L18 28L28 32L38 18L48 24" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Signal dots */}
      <circle cx="18" cy="28" r="3" stroke="#22d3ee" strokeWidth="1.5" fill="rgba(34,211,238,0.15)" />
      <circle cx="38" cy="18" r="4" stroke="#22d3ee" strokeWidth="1.5" fill="rgba(34,211,238,0.15)" />
      {/* Arrow markers */}
      <path d="M36 14l2 4 4-2" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 32l2-4-4-2" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Grid */}
      <line x1="8" y1="46" x2="48" y2="46" stroke="#22d3ee" strokeWidth="0.5" opacity="0.2" />
      <line x1="8" y1="36" x2="48" y2="36" stroke="#22d3ee" strokeWidth="0.5" opacity="0.1" strokeDasharray="2 4" />
    </svg>
  );
}

// Roadmap: Auto-trade bot
export function IllustAutoTrade() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Robot head */}
      <rect x="14" y="16" width="28" height="22" rx="6" stroke="#5a5a66" strokeWidth="1.5" fill="rgba(255,255,255,0.02)" />
      {/* Eyes */}
      <circle cx="23" cy="27" r="3" stroke="#5a5a66" strokeWidth="1.5" fill="rgba(255,255,255,0.03)" />
      <circle cx="33" cy="27" r="3" stroke="#5a5a66" strokeWidth="1.5" fill="rgba(255,255,255,0.03)" />
      <circle cx="23" cy="27" r="1" fill="#5a5a66" opacity="0.5" />
      <circle cx="33" cy="27" r="1" fill="#5a5a66" opacity="0.5" />
      {/* Antenna */}
      <path d="M28 16v-6" stroke="#5a5a66" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="28" cy="8" r="2" stroke="#5a5a66" strokeWidth="1" fill="rgba(255,255,255,0.03)" />
      {/* Mouth / status */}
      <path d="M22 33h12" stroke="#5a5a66" strokeWidth="1" strokeLinecap="round" strokeDasharray="2 2" />
      {/* Base */}
      <path d="M18 38h20M22 38v6M34 38v6M18 44h20" stroke="#5a5a66" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// TrustNumbers background decoration — data grid pattern
export function IllustDataGrid() {
  return (
    <svg width="400" height="120" viewBox="0 0 400 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-[0.04]">
      {/* Vertical lines */}
      {[50,100,150,200,250,300,350].map(x => (
        <line key={`v${x}`} x1={x} y1="0" x2={x} y2="120" stroke="#34d399" strokeWidth="0.5" />
      ))}
      {/* Horizontal lines */}
      {[30,60,90].map(y => (
        <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} stroke="#34d399" strokeWidth="0.5" />
      ))}
      {/* Data points */}
      {[
        [50,30],[100,60],[150,20],[200,80],[250,40],[300,70],[350,25],
        [75,50],[125,85],[175,35],[225,65],[275,15],[325,55],
      ].map(([x,y], i) => (
        <circle key={`d${i}`} cx={x} cy={y} r="2" fill="#34d399" opacity={0.2 + (i % 4) * 0.1} />
      ))}
      {/* Connection lines */}
      <path d="M50 30L100 60L150 20L200 80L250 40L300 70L350 25" stroke="#34d399" strokeWidth="0.5" opacity="0.3" />
    </svg>
  );
}

// Prediction Market: large illustration (200x160) — candlestick branching into UP/DOWN with 87% gauge
export function IllustPrediction() {
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background glow */}
      <circle cx="100" cy="80" r="60" fill="url(#glow-pred)" opacity="0.06" />
      {/* Candlestick chart body */}
      <rect x="22" y="65" width="8" height="30" rx="1" stroke="#5a5a66" strokeWidth="1" fill="rgba(90,90,102,0.15)" />
      <line x1="26" y1="55" x2="26" y2="105" stroke="#5a5a66" strokeWidth="1" />
      <rect x="36" y="50" width="8" height="25" rx="1" stroke="#34d399" strokeWidth="1" fill="rgba(52,211,153,0.15)" />
      <line x1="40" y1="42" x2="40" y2="82" stroke="#34d399" strokeWidth="1" />
      <rect x="50" y="55" width="8" height="20" rx="1" stroke="#f87171" strokeWidth="1" fill="rgba(248,113,113,0.15)" />
      <line x1="54" y1="48" x2="54" y2="80" stroke="#f87171" strokeWidth="1" />
      <rect x="64" y="40" width="8" height="30" rx="1" stroke="#34d399" strokeWidth="1" fill="rgba(52,211,153,0.15)" />
      <line x1="68" y1="32" x2="68" y2="78" stroke="#34d399" strokeWidth="1" />
      {/* Current price line */}
      <line x1="78" y1="40" x2="95" y2="40" stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="3 3" />
      {/* Branch point */}
      <circle cx="95" cy="40" r="4" stroke="#60a5fa" strokeWidth="2" fill="rgba(96,165,250,0.15)" />
      {/* UP branch */}
      <path d="M99 38L130 18" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
      <path d="M126 14l4 4 4-6" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="140" y="20" fill="#34d399" fontSize="10" fontFamily="monospace" fontWeight="bold">UP</text>
      {/* DOWN branch */}
      <path d="M99 42L130 62" stroke="#f87171" strokeWidth="2" strokeLinecap="round" />
      <path d="M126 66l4-4 4 6" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="140" y="65" fill="#f87171" fontSize="10" fontFamily="monospace" fontWeight="bold">DOWN</text>
      {/* Confidence gauge */}
      <circle cx="100" cy="115" r="22" stroke="#60a5fa" strokeWidth="1" opacity="0.2" />
      <path d="M80 120 A22 22 0 1 1 118 108" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" />
      <text x="100" y="118" fill="#60a5fa" fontSize="14" fontFamily="monospace" textAnchor="middle" fontWeight="bold">87%</text>
      <text x="100" y="130" fill="#5a5a66" fontSize="8" fontFamily="monospace" textAnchor="middle">WIN RATE</text>
      {/* 5min label */}
      <rect x="145" y="90" width="40" height="18" rx="4" stroke="#60a5fa" strokeWidth="1" fill="rgba(96,165,250,0.06)" />
      <text x="165" y="103" fill="#60a5fa" fontSize="9" fontFamily="monospace" textAnchor="middle">5 min</text>
      {/* Data flow dots */}
      <circle cx="12" cy="70" r="1.5" fill="#60a5fa" opacity="0.3" />
      <circle cx="12" cy="80" r="1.5" fill="#60a5fa" opacity="0.4" />
      <circle cx="12" cy="90" r="1.5" fill="#60a5fa" opacity="0.3" />
      <defs><radialGradient id="glow-pred"><stop stopColor="#60a5fa" /><stop offset="1" stopColor="transparent" /></radialGradient></defs>
    </svg>
  );
}

// Prediction Market: small roadmap icon (56x56) — binary fork with percentage
export function IllustPredictionSmall() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Mini candlesticks */}
      <rect x="8" y="20" width="4" height="12" rx="1" fill="#60a5fa" opacity="0.3" />
      <rect x="15" y="16" width="4" height="14" rx="1" fill="#60a5fa" opacity="0.5" />
      <rect x="22" y="22" width="4" height="10" rx="1" fill="#60a5fa" opacity="0.4" />
      {/* Branch point */}
      <circle cx="32" cy="24" r="3" stroke="#60a5fa" strokeWidth="1.5" fill="rgba(96,165,250,0.12)" />
      {/* UP arrow */}
      <path d="M35 22l8-8" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M40 12l3 2 1-3" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* DOWN arrow */}
      <path d="M35 26l8 8" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M40 36l3-2 1 3" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Percentage */}
      <text x="28" y="48" fill="#60a5fa" fontSize="10" fontFamily="monospace" textAnchor="middle" fontWeight="bold">87%</text>
    </svg>
  );
}

export function IllustPipeline() {
  // Horizontal pipeline: data → filter → AI with flowing particles
  return (
    <svg width="600" height="80" viewBox="0 0 600 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Pipeline line */}
      <line x1="0" y1="40" x2="600" y2="40" stroke="#1a1a24" strokeWidth="2" />
      {/* Stage 1: Collect */}
      <circle cx="100" cy="40" r="20" stroke="#22d3ee" strokeWidth="2" fill="rgba(34,211,238,0.06)" />
      <path d="M92 35v10M100 35v10M108 35v10" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" />
      {/* Arrow */}
      <path d="M130 40h70" stroke="#22d3ee" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
      <circle cx="165" cy="40" r="2" fill="#22d3ee" opacity="0.6" />
      {/* Stage 2: Score */}
      <circle cx="300" cy="40" r="20" stroke="#34d399" strokeWidth="2" fill="rgba(52,211,153,0.06)" />
      <path d="M292 46l5-12h6l5 12" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M295 42h10" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" />
      {/* Arrow */}
      <path d="M330 40h70" stroke="#34d399" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
      <circle cx="365" cy="40" r="2" fill="#34d399" opacity="0.6" />
      {/* Stage 3: AI */}
      <circle cx="500" cy="40" r="20" stroke="#fbbf24" strokeWidth="2" fill="rgba(251,191,36,0.06)" />
      <circle cx="494" cy="37" r="2" fill="#fbbf24" opacity="0.6" />
      <circle cx="506" cy="37" r="2" fill="#fbbf24" opacity="0.6" />
      <path d="M494 44c0 3 3 5 6 5s6-2 6-5" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
      {/* Labels */}
      <text x="100" y="72" fill="#22d3ee" fontSize="10" fontFamily="monospace" textAnchor="middle">COLLECT</text>
      <text x="300" y="72" fill="#34d399" fontSize="10" fontFamily="monospace" textAnchor="middle">SCORE</text>
      <text x="500" y="72" fill="#fbbf24" fontSize="10" fontFamily="monospace" textAnchor="middle">ANALYZE</text>
    </svg>
  );
}

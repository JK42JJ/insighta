type Variant = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

interface GradientBackgroundProps {
  variant?: Variant;
}

/** Variant A: Mandalart grid pulse — dot grid + central glow */
function GridPulse() {
  return (
    <>
      {/* Dot grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04] dark:opacity-[0.15]"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      {/* Central glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.08] dark:opacity-[0.30]"
        style={{
          background: 'radial-gradient(circle, hsl(var(--primary)), transparent 70%)',
          filter: 'blur(100px)',
          animation: 'mandala-glow-pulse 6s ease-in-out infinite',
        }}
      />
    </>
  );
}

/** Variant B: Connected dot grid — SVG nodes with floating lines */
function ConnectedDots() {
  const nodes = [
    { cx: 80, cy: 60, delay: 0 },
    { cx: 200, cy: 40, delay: 1.2 },
    { cx: 320, cy: 80, delay: 0.6 },
    { cx: 440, cy: 50, delay: 1.8 },
    { cx: 140, cy: 160, delay: 0.4 },
    { cx: 260, cy: 140, delay: 1.0 },
    { cx: 380, cy: 170, delay: 1.5 },
    { cx: 100, cy: 260, delay: 0.8 },
    { cx: 220, cy: 240, delay: 2.0 },
    { cx: 340, cy: 270, delay: 0.3 },
  ];

  const connections = [
    [0, 1], [1, 2], [2, 3], [0, 4], [1, 5],
    [2, 6], [4, 5], [5, 6], [4, 7], [5, 8],
    [6, 9], [7, 8], [8, 9],
  ];

  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.06] dark:opacity-[0.20]"
      viewBox="0 0 500 320"
      preserveAspectRatio="xMidYMid slice"
    >
      {/* Connection lines */}
      {connections.map(([a, b], i) => (
        <line
          key={`l-${i}`}
          x1={nodes[a].cx}
          y1={nodes[a].cy}
          x2={nodes[b].cx}
          y2={nodes[b].cy}
          stroke="hsl(var(--primary))"
          strokeWidth="1"
          className="animate-[connected-line-fade_8s_ease-in-out_infinite]"
          style={{ animationDelay: `${(nodes[a].delay + nodes[b].delay) / 2}s` }}
        />
      ))}
      {/* Nodes */}
      {nodes.map((node, i) => (
        <circle
          key={`n-${i}`}
          cx={node.cx}
          cy={node.cy}
          r="3"
          fill="hsl(var(--primary))"
          className="animate-[connected-dot-float_6s_ease-in-out_infinite]"
          style={{ animationDelay: `${node.delay}s` }}
        />
      ))}
    </svg>
  );
}

/** Variant C: Soft color blobs — 3 gradient circles drifting slowly */
function SoftBlobs() {
  return (
    <>
      <div
        className="absolute -top-20 -left-20 w-[500px] h-[500px] rounded-full opacity-[0.12] dark:opacity-[0.30] animate-gradient-blob-1"
        style={{
          background: 'radial-gradient(circle, hsl(var(--primary)), transparent 70%)',
          filter: 'blur(100px)',
        }}
      />
      <div
        className="absolute -top-10 -right-20 w-[450px] h-[450px] rounded-full opacity-[0.10] dark:opacity-[0.25] animate-gradient-blob-2"
        style={{
          background: 'radial-gradient(circle, hsl(270 60% 60%), transparent 70%)',
          filter: 'blur(100px)',
        }}
      />
      <div
        className="absolute -bottom-20 left-1/3 w-[400px] h-[400px] rounded-full opacity-[0.10] dark:opacity-[0.25] animate-gradient-blob-3"
        style={{
          background: 'radial-gradient(circle, hsl(210 80% 60%), transparent 70%)',
          filter: 'blur(100px)',
        }}
      />
    </>
  );
}

/** Variant D: Blobs + Grid combo — blobs underneath, dots on top */
function BlobsWithGrid() {
  return (
    <>
      <SoftBlobs />
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.10]"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
    </>
  );
}

/** Variant E: frill.co inspired — SVG mesh blobs with feGaussianBlur for smooth edges */
function FrillMesh() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <filter id="blob-blur">
          <feGaussianBlur in="SourceGraphic" stdDeviation="80" />
        </filter>
      </defs>
      <g
        className="opacity-[0.04] dark:opacity-[0.07]"
        filter="url(#blob-blur)"
      >
        {/* Pink — top-left */}
        <circle cx="15%" cy="15%" r="18%" fill="hsl(340, 80%, 65%)"
          className="animate-gradient-blob-1" />
        {/* Purple — top-right */}
        <circle cx="80%" cy="20%" r="16%" fill="hsl(280, 70%, 65%)"
          className="animate-gradient-blob-2" />
        {/* Teal — center */}
        <circle cx="45%" cy="55%" r="14%" fill="hsl(185, 70%, 55%)"
          className="animate-gradient-blob-3" />
        {/* Peach — bottom-right */}
        <circle cx="75%" cy="80%" r="15%" fill="hsl(20, 90%, 70%)"
          className="animate-gradient-blob-1"
          style={{ animationDelay: '4s', animationDuration: '28s' }} />
      </g>
    </svg>
  );
}

/** Variant F: Mesh Gradient + Grain — Vercel/Raycast inspired, refined gradient with noise texture */
function MeshGrain() {
  return (
    <>
      {/* Mesh gradient layer — subtle color zones */}
      <div
        className="absolute inset-0 opacity-[0.07] dark:opacity-[0.12]"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 20% 30%, hsl(var(--primary)) 0%, transparent 60%),
            radial-gradient(ellipse 60% 80% at 75% 70%, hsl(270 50% 60%) 0%, transparent 60%),
            radial-gradient(ellipse 70% 50% at 50% 50%, hsl(210 60% 55%) 0%, transparent 50%)
          `,
        }}
      />
      {/* Grain noise overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.3] dark:opacity-[0.15] mix-blend-overlay">
        <filter id="grain-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain-noise)" />
      </svg>
      {/* Slow shimmer — single gradient shifting */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06] animate-mesh-shimmer"
        style={{
          background: 'radial-gradient(ellipse 50% 40% at 60% 40%, hsl(var(--primary)), transparent 70%)',
        }}
      />
    </>
  );
}

/** Variant G: Aurora / Northern Lights — Linear.app inspired, horizontal color bands flowing */
function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Aurora band 1 — primary */}
      <div
        className="absolute w-[200%] h-[40%] top-[10%] -left-[50%] opacity-[0.06] dark:opacity-[0.10] animate-aurora-1"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.8) 30%, hsl(270 60% 60% / 0.6) 50%, hsl(210 70% 55% / 0.8) 70%, transparent 100%)',
          filter: 'blur(60px)',
          borderRadius: '50%',
        }}
      />
      {/* Aurora band 2 — secondary */}
      <div
        className="absolute w-[180%] h-[30%] top-[35%] -left-[40%] opacity-[0.04] dark:opacity-[0.08] animate-aurora-2"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, hsl(185 60% 55% / 0.7) 25%, hsl(var(--primary) / 0.5) 50%, hsl(280 50% 60% / 0.7) 75%, transparent 100%)',
          filter: 'blur(80px)',
          borderRadius: '50%',
        }}
      />
      {/* Aurora band 3 — accent */}
      <div
        className="absolute w-[160%] h-[25%] top-[55%] -left-[30%] opacity-[0.03] dark:opacity-[0.06] animate-aurora-3"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, hsl(210 80% 60% / 0.6) 40%, hsl(340 60% 60% / 0.4) 60%, transparent 100%)',
          filter: 'blur(70px)',
          borderRadius: '50%',
        }}
      />
    </div>
  );
}

/** Variant H: Subtle Glow Pulse — minimal, single breathing point of light */
function GlowPulse() {
  return (
    <>
      {/* Primary glow — center-top */}
      <div
        className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full opacity-[0.05] dark:opacity-[0.08] animate-glow-breathe"
        style={{
          background: 'radial-gradient(ellipse, hsl(var(--primary)), transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      {/* Secondary glow — subtle accent */}
      <div
        className="absolute bottom-[15%] right-[20%] w-[400px] h-[300px] rounded-full opacity-[0.03] dark:opacity-[0.05] animate-glow-breathe-delayed"
        style={{
          background: 'radial-gradient(ellipse, hsl(270 50% 60%), transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
    </>
  );
}

/** Variant I: Dot Grid + Cursor Proximity — interactive dots responding to mouse position */
function InteractiveDotGrid() {
  return (
    <>
      {/* Static dot grid base */}
      <div
        className="absolute inset-0 opacity-[0.06] dark:opacity-[0.12]"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      {/* Central ambient glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.04] dark:opacity-[0.08] animate-glow-breathe"
        style={{
          background: 'radial-gradient(circle, hsl(var(--primary)), transparent 60%)',
          filter: 'blur(100px)',
        }}
      />
    </>
  );
}

const variants: Record<Variant, () => JSX.Element> = {
  A: GridPulse,
  B: ConnectedDots,
  C: SoftBlobs,
  D: BlobsWithGrid,
  E: FrillMesh,
  F: MeshGrain,
  G: Aurora,
  H: GlowPulse,
  I: InteractiveDotGrid,
};

export function GradientBackground({ variant = 'A' }: GradientBackgroundProps) {
  const Component = variants[variant];
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
    >
      <Component />
    </div>
  );
}

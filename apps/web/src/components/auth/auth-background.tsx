'use client';

export function AuthBackground() {
  return (
    <>
      {/* Base gradient */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-primary-600/35 via-slate-950 to-accent-700/30"
      />

      {/* Large floating orbs */}
      <div
        aria-hidden
        className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary-400/25 blur-3xl animate-[float1_14s_ease-in-out_infinite]"
      />
      <div
        aria-hidden
        className="absolute -bottom-24 -right-24 h-[22rem] w-[22rem] rounded-full bg-accent-500/20 blur-3xl animate-[float2_18s_ease-in-out_infinite_1s]"
      />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-primary-500/10 blur-3xl animate-[pulse-glow_6s_ease-in-out_infinite]"
      />

      {/* Extra accent orb */}
      <div
        aria-hidden
        className="absolute right-1/4 top-1/4 h-48 w-48 rounded-full bg-accent-400/15 blur-3xl animate-[float3_20s_ease-in-out_infinite_3s]"
      />

      {/* Animated grid overlay */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] animate-[grid-drift_30s_linear_infinite]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating particles */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute h-1 w-1 rounded-full bg-white/30 animate-[rise_var(--dur)_ease-in_infinite_var(--delay)]"
            style={
              {
                left: `${15 + i * 14}%`,
                bottom: '-4px',
                '--dur': `${8 + i * 2}s`,
                '--delay': `${i * 1.5}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Noise texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.2] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.15'/%3E%3C/svg%3E")`,
        }}
      />
    </>
  );
}

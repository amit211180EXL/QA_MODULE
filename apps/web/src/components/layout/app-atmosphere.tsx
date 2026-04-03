/**
 * Decorative background layer for the main app shell — subtle motion and depth
 * without hurting readability (pointer-events none, low opacity).
 */
export function AppAtmosphere() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute -left-24 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary-400/[0.12] blur-3xl motion-safe:animate-aurora" />
      <div className="absolute -right-20 top-1/4 h-[22rem] w-[22rem] rounded-full bg-accent-500/[0.10] blur-3xl motion-safe:animate-aurora-delayed" />
      <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-primary-600/[0.06] blur-3xl motion-safe:animate-float-slow" />
      <div
        className="absolute inset-0 opacity-[0.4] mix-blend-multiply"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.12'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}

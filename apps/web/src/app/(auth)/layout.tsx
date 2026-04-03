import { AuthChrome } from '@/components/auth/auth-chrome';
import { AuthBackground } from '@/components/auth/auth-background';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-slate-950 px-4 py-3 sm:py-4">
      <div className="pointer-events-none absolute inset-0 z-0">
        <AuthBackground />
      </div>
      <div className="relative z-20 flex min-h-0 w-full max-w-md flex-1 flex-col justify-center">
        <AuthChrome>{children}</AuthChrome>
      </div>
    </div>
  );
}

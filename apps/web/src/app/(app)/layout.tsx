import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/layout/sidebar';
import { AppAtmosphere } from '@/components/layout/app-atmosphere';

// Lazy load OnboardingWizard since most users dismiss it and don't need it loaded on every page
const DynamicOnboardingWizard = dynamic(
  async () => {
    const mod = await import('@/components/onboarding/onboarding-wizard');
    return { default: mod.OnboardingWizard };
  },
  { loading: () => null, ssr: false }
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-100/80">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="relative flex-1 overflow-y-auto overflow-x-hidden bg-gradient-to-b from-slate-50/90 via-white/40 to-slate-100/80">
          <AppAtmosphere />
          <div className="relative z-10">
            <DynamicOnboardingWizard />
            <div className="mx-auto max-w-7xl p-6">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

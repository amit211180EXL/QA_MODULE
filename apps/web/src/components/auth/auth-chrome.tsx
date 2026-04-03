'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { authEase } from '@/components/auth/auth-motion';

const SUBTITLE: Record<string, string> = {
  '/login': '',
  '/signup': 'Create your workspace',
  '/forgot-password': 'Recover your account',
  '/reset-password': 'Choose a new password',
  '/accept-invite': 'Accept your invitation',
};

function normalizeAuthPath(pathname: string) {
  const p = pathname.replace(/\/$/, '') || '/login';
  return p;
}

export function AuthChrome({ children }: { children: React.ReactNode }) {
  const pathname = normalizeAuthPath(usePathname() ?? '/login');
  const reduceMotion = useReducedMotion();
  const subtitle = SUBTITLE[pathname] ?? 'Secure access';
  const showSubtitle = subtitle.length > 0;
  /** Tighter chrome for main auth flows (fits in 100dvh without page scroll). */
  const dense =
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password';
  /** Long forms scroll inside the card only. */
  const scrollCard = pathname === '/signup';

  return (
    <div className="flex min-h-0 w-full flex-col">
      <motion.div
        className={dense ? 'mb-2 shrink-0 text-center sm:mb-3' : 'mb-8 shrink-0 text-center'}
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.55, ease: authEase }}
      >
        <motion.div
          className={
            dense
              ? 'mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 via-primary-600 to-accent-600 shadow-lg shadow-primary-500/30 ring-2 ring-white/20 sm:h-10 sm:w-10'
              : 'mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 via-primary-600 to-accent-600 shadow-lg shadow-primary-500/30 ring-2 ring-white/20'
          }
          whileHover={reduceMotion ? undefined : { scale: 1.05, rotate: -2 }}
          whileTap={reduceMotion ? undefined : { scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        >
          <span className={dense ? 'text-sm font-bold text-white' : 'text-lg font-bold text-white'}>QA</span>
        </motion.div>
        <motion.span
          className={
            dense
              ? 'block bg-gradient-to-r from-white to-slate-200 bg-clip-text text-base font-bold tracking-tight text-transparent sm:text-lg'
              : 'block bg-gradient-to-r from-white to-slate-200 bg-clip-text text-2xl font-bold tracking-tight text-transparent'
          }
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.12, duration: 0.4 }}
        >
          QA Platform
        </motion.span>
        {showSubtitle ? (
          <motion.p
            key={subtitle}
            className={
              dense
                ? 'mt-0.5 text-[11px] font-medium text-slate-400 sm:text-xs'
                : 'mt-2 text-sm font-medium text-slate-400'
            }
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.35, ease: authEase }}
          >
            {subtitle}
          </motion.p>
        ) : null}
      </motion.div>

      <motion.div
        className={
          dense
            ? `min-h-0 rounded-2xl border border-white/15 bg-white/[0.97] p-4 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-5${scrollCard ? ' max-h-[calc(100dvh-6.75rem)] overflow-y-auto overscroll-y-contain' : ''}`
            : 'rounded-2xl border border-white/15 bg-white/[0.97] p-8 shadow-2xl shadow-black/25 backdrop-blur-xl'
        }
        initial={false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: reduceMotion ? 0 : 0.5,
          ease: authEase,
          delay: reduceMotion ? 0 : 0.08,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

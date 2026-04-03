'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { authEase } from '@/components/auth/auth-motion';

export function AuthBackground() {
  const reduceMotion = useReducedMotion();

  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-primary-600/35 via-slate-950 to-accent-700/30"
      />
      <motion.div
        aria-hidden
        className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary-400/25 blur-3xl"
        animate={
          reduceMotion
            ? undefined
            : {
                x: [0, 24, 0],
                y: [0, 18, 0],
                scale: [1, 1.06, 1],
              }
        }
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="absolute -bottom-24 -right-24 h-[22rem] w-[22rem] rounded-full bg-accent-500/20 blur-3xl"
        animate={
          reduceMotion
            ? undefined
            : {
                x: [0, -20, 0],
                y: [0, -14, 0],
                scale: [1, 1.08, 1],
              }
        }
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-primary-500/10 blur-3xl"
        animate={reduceMotion ? undefined : { opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 6, repeat: Infinity, ease: authEase }}
      />
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

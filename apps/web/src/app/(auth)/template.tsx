'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { authPageEnter, authPageEnterReduced } from '@/components/auth/auth-motion';

export default function AuthTemplate({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const variants = reduceMotion ? authPageEnterReduced : authPageEnter;

  return (
    <motion.div
      initial={false}
      animate="visible"
      variants={variants}
      className="will-change-transform"
    >
      {children}
    </motion.div>
  );
}

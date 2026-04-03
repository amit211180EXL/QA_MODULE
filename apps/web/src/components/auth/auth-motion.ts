import type { Variants } from 'framer-motion';

/** Shared easing — smooth deceleration */
export const authEase = [0.22, 1, 0.36, 1] as const;

export function authStaggerContainer(reduceMotion: boolean | null): Variants {
  return {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduceMotion ? 0 : 0.07,
        delayChildren: reduceMotion ? 0 : 0.06,
      },
    },
  };
}

export function authFadeUpItem(reduceMotion: boolean | null): Variants {
  return {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 14 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.42, ease: authEase },
    },
  };
}

export const authPageEnter: Variants = {
  hidden: { opacity: 0, y: 18, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.48, ease: authEase },
  },
};

export const authPageEnterReduced: Variants = {
  hidden: { opacity: 1, y: 0, filter: 'blur(0px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
};

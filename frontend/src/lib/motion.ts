/**
 * Framer Motion animation tokens and presets.
 * Use MotionConfig reducedMotion="user" at app root to respect prefers-reduced-motion.
 */
import type { Variants, Transition } from 'framer-motion';

// Duration tokens (seconds)
export const duration = {
  fast: 0.15,
  normal: 0.2,
  layout: 0.3,
} as const;

// Easing tokens
export const easing = {
  enter: [0, 0, 0.2, 1] as const, // ease-out
  exit: [0.4, 0, 1, 1] as const, // ease-in
  move: [0.4, 0, 0.2, 1] as const, // ease-in-out
} as const;

// Shared transition presets
export const transition: Record<string, Transition> = {
  fast: { duration: duration.fast, ease: easing.enter },
  normal: { duration: duration.normal, ease: easing.enter },
  layout: { duration: duration.layout, ease: easing.move },
  spring: { type: 'spring', stiffness: 300, damping: 30 },
};

// View transition (fade + slight slide)
export const viewVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

// Card enter/exit
export const cardVariants: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

// List item stagger
export const listItemVariants: Variants = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 8 },
};

// Container for stagger children
export const staggerContainer: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.03,
    },
  },
};

// Feed container with wider stagger (40-80ms range, using 0.05s)
export const feedContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

// Feed item: fade in + slide up
export const feedItemVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
};

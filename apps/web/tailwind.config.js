/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ─── Color System ─────────────────────────────────────────────────────
      colors: {
        // Primary accent - Professional blue (trustworthy, conventional)
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9', // Primary
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c3d66',
          950: '#051e3e',
        },
        // Secondary accent - Sophisticated indigo
        accent: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#818cf8', // Secondary accent
          600: '#6366f1',
          700: '#4f46e5',
          800: '#4338ca',
          900: '#3730a3',
        },
        // Neutral - Sophisticated slate
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          150: '#ecf1f7',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // Semantic colors
        success: {
          50: '#f0fdf4',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        danger: {
          50: '#fef2f2',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
        },
        warning: {
          50: '#fffbeb',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        info: {
          50: '#f0f9ff',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
      },

      // ─── Typography ───────────────────────────────────────────────────────
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px', letterSpacing: '0.4px' }],
        'xs': ['12px', { lineHeight: '16px', letterSpacing: '0.3px' }],
        'sm': ['13px', { lineHeight: '18px', letterSpacing: '0.2px' }],
        'base': ['14px', { lineHeight: '20px', letterSpacing: '0.15px' }],
        'md': ['15px', { lineHeight: '22px' }],
        'lg': ['16px', { lineHeight: '24px' }],
        'xl': ['18px', { lineHeight: '28px', fontWeight: '600' }],
        '2xl': ['20px', { lineHeight: '30px', fontWeight: '600' }],
        '3xl': ['24px', { lineHeight: '32px', fontWeight: '700' }],
        '4xl': ['30px', { lineHeight: '38px', fontWeight: '700' }],
        '5xl': ['36px', { lineHeight: '44px', fontWeight: '700' }],
      },

      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },

      // ─── Spacing System ───────────────────────────────────────────────────
      spacing: {
        '0.5': '2px',
        '1': '4px',
        '1.5': '6px',
        '2': '8px',
        '2.5': '10px',
        '3': '12px',
        '3.5': '14px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '7': '28px',
        '8': '32px',
        '9': '36px',
        '10': '40px',
        '12': '48px',
        '14': '56px',
        '16': '64px',
        '18': '72px',
        '20': '80px',
        '24': '96px',
      },

      // ─── Border Radius ────────────────────────────────────────────────────
      borderRadius: {
        'none': '0',
        'sm': '4px',
        'base': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '20px',
        '3xl': '24px',
        'full': '9999px',
      },

      // ─── Shadows ──────────────────────────────────────────────────────────
      boxShadow: {
        'none': 'none',
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        'sm': '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        'base': '0 1px 4px 0 rgba(0, 0, 0, 0.08), 0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
        'inner': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.04)',
        'focus': '0 0 0 3px rgba(14, 165, 233, 0.1), 0 0 0 2px rgba(255, 255, 255, 0.8), 0 0 0 3px rgba(14, 165, 233, 0.5)',
      },

      // ─── Transitions & Animations ─────────────────────────────────────────
      transitionDuration: {
        'fast': '100ms',
        'base': '150ms',
        'slow': '200ms',
        'slower': '300ms',
      },

      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'smooth-out': 'cubic-bezier(0, 0, 0.2, 1)',
        'smooth-in': 'cubic-bezier(0.4, 0, 1, 1)',
      },

      // ─── Backdrop Blur ────────────────────────────────────────────────────
      backdropBlur: {
        'xs': '2px',
        'sm': '4px',
        'base': '8px',
        'md': '12px',
        'lg': '16px',
      },

      // ─── Opacity ──────────────────────────────────────────────────────────
      opacity: {
        '0': '0',
        '5': '0.05',
        '10': '0.1',
        '20': '0.2',
        '25': '0.25',
        '30': '0.3',
        '40': '0.4',
        '50': '0.5',
        '60': '0.6',
        '70': '0.7',
        '75': '0.75',
        '80': '0.8',
        '90': '0.9',
        '95': '0.95',
        '100': '1',
      },

      keyframes: {
        aurora: {
          '0%, 100%': { opacity: '0.45', transform: 'translate(0, 0) scale(1)' },
          '33%': { opacity: '0.7', transform: 'translate(8%, 6%) scale(1.06)' },
          '66%': { opacity: '0.55', transform: 'translate(-6%, 4%) scale(0.96)' },
        },
        'aurora-delayed': {
          '0%, 100%': { opacity: '0.35', transform: 'translate(0, 0) scale(1)' },
          '50%': { opacity: '0.65', transform: 'translate(-10%, -8%) scale(1.08)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'border-glow': {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float1: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(24px, 18px) scale(1.06)' },
        },
        float2: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(-20px, -14px) scale(1.08)' },
        },
        float3: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)', opacity: '0.15' },
          '50%': { transform: 'translate(30px, -20px) scale(1.1)', opacity: '0.25' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.7' },
        },
        'grid-drift': {
          '0%': { transform: 'translate(0, 0)' },
          '100%': { transform: 'translate(60px, 60px)' },
        },
        rise: {
          '0%': { transform: 'translateY(0) scale(1)', opacity: '0.3' },
          '50%': { opacity: '0.6' },
          '100%': { transform: 'translateY(-100vh) scale(0.5)', opacity: '0' },
        },
      },

      animation: {
        aurora: 'aurora 22s ease-in-out infinite',
        'aurora-delayed': 'aurora-delayed 28s ease-in-out infinite 2s',
        'float-slow': 'float-slow 14s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 10s ease infinite',
        'border-glow': 'border-glow 4s ease-in-out infinite',
        fadeIn: 'fadeIn 0.4s ease-out both',
        float1: 'float1 14s ease-in-out infinite',
        float2: 'float2 18s ease-in-out infinite 1s',
        float3: 'float3 20s ease-in-out infinite 3s',
        'pulse-glow': 'pulse-glow 6s ease-in-out infinite',
        'grid-drift': 'grid-drift 30s linear infinite',
        rise: 'rise 10s ease-in infinite',
      },

      backgroundSize: {
        'gradient-wide': '200% 200%',
      },
    },
  },

  plugins: [],
};

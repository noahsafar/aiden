/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // CSS variables for dynamic theming
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      backgroundColor: {
        background: 'rgb(var(--color-background))',
        foreground: 'rgb(var(--color-foreground))',
        surface: 'rgb(var(--color-surface))',
        muted: 'rgb(var(--color-muted))',
        border: 'rgb(var(--color-border))',
      },
      textColor: {
        foreground: 'rgb(var(--color-foreground))',
        muted: 'rgb(var(--color-muted))',
      },
      borderColor: {
        border: 'rgb(var(--color-border))',
      },
      // Apple-inspired color palette
      colors: {
        // Primary - sophisticated blue
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        // Sophisticated gray scale (Apple-style)
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          850: '#1a1f2e',
          900: '#111827',
          950: '#030712',
        },
        // Status colors with Apple refinement
        success: {
          50: '#ecfdf5',
          100: '#d1fae5',
          500: '#059669',
          600: '#047857',
          700: '#065f46',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          500: '#d97706',
          600: '#b45309',
          700: '#92400e',
        },
        error: {
          50: '#fef2f2',
          100: '#fee2e2',
          500: '#dc2626',
          600: '#b91c1c',
          700: '#991b1b',
        },
        // AI accent colors
        ai: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          500: '#22c55e',
          600: '#16a34a',
        },
        // Surface colors for depth
        surface: {
          50: '#ffffff',
          100: '#f8fafc',
          200: '#f1f5f9',
          900: '#0f172a',
          950: '#020617',
        }
      },

      // Typography system (Apple-style)
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Monaco', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xs': ['11px', { lineHeight: '16px', letterSpacing: '-0.01em' }],
        'sm': ['12px', { lineHeight: '16px', letterSpacing: '-0.01em' }],
        'base': ['14px', { lineHeight: '20px', letterSpacing: '-0.01em' }],
        'lg': ['16px', { lineHeight: '24px', letterSpacing: '-0.005em' }],
        'xl': ['18px', { lineHeight: '28px', letterSpacing: '-0.005em' }],
        '2xl': ['20px', { lineHeight: '28px', letterSpacing: '0em' }],
        '3xl': ['24px', { lineHeight: '32px', letterSpacing: '0em' }],
        '4xl': ['30px', { lineHeight: '36px', letterSpacing: '0em' }],
        '5xl': ['36px', { lineHeight: '40px', letterSpacing: '0em' }],
      },
      fontWeight: {
        'thin': '100',
        'extralight': '200',
        'light': '300',
        'normal': '400',
        'medium': '500',
        'semibold': '600',
        'bold': '700',
        'extrabold': '800',
        'black': '900',
      },

      // Spacing system (consistent 4px base)
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
        '144': '36rem',
      },

      // Border radius (Apple-style)
      borderRadius: {
        'none': '0',
        'sm': '2px',
        'DEFAULT': '6px',
        'md': '8px',
        'lg': '10px',
        'xl': '12px',
        '2xl': '16px',
        '3xl': '20px',
        'full': '9999px',
      },

      // Shadows (elegant and subtle)
      boxShadow: {
        'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'DEFAULT': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        'lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        'xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
        'inner': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
        // Apple-style elevated shadows
        'elevated-sm': '0 2px 8px rgba(0, 0, 0, 0.12)',
        'elevated-md': '0 4px 16px rgba(0, 0, 0, 0.12)',
        'elevated-lg': '0 8px 32px rgba(0, 0, 0, 0.12)',
        'elevated-xl': '0 16px 64px rgba(0, 0, 0, 0.12)',
      },

      // Animation durations and easing
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'apple-spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      },

      // Animation keyframes
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s apple',
        'slide-up': 'slide-up 0.3s apple',
        'scale-in': 'scale-in 0.2s apple-spring',
        'pulse-subtle': 'pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
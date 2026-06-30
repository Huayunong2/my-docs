/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#fafafa',
          dark: '#0f0f12',
        },
        sidebar: {
          DEFAULT: 'rgba(250, 250, 250, 0.78)',
          dark: 'rgba(15, 15, 18, 0.82)',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          light: 'rgba(99, 102, 241, 0.08)',
        },
        warm: {
          DEFAULT: '#f59e0b',
          light: 'rgba(245, 158, 11, 0.1)',
        },
      },
      boxShadow: {
        'card': '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
        'card-hover': '0 1px 2px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
        'card-dark': '0 1px 2px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)',
        'card-dark-hover': '0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
        'modal': '0 0 0 1px rgba(0,0,0,0.05), 0 8px 32px rgba(0,0,0,0.12)',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      fontSize: {
        '2xs': ['11px', '16px'],
      },
      letterSpacing: {
        'tight-heading': '-0.02em',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'scale-in': 'scaleIn 0.15s ease-out',
        'shimmer': 'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}

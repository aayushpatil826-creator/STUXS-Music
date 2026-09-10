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
        stuxs: {
          bg: '#0B0B0F',
          surface: '#15151B',
          'surface-secondary': '#1D1D24',
          'surface-tertiary': '#262630',
          'surface-hover': '#2C2C38',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-light': 'rgba(255, 255, 255, 0.14)',
          text: '#FFFFFF',
          'text-secondary': '#A6A6B0',
          'text-muted': '#6B6B78',
          accent: 'var(--stuxs-accent, #8B5CF6)',
          'accent-glow': 'var(--stuxs-accent-glow, rgba(139, 92, 246, 0.35))',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'stuxs-glow': '0 8px 32px -4px var(--stuxs-accent-glow, rgba(139, 92, 246, 0.35))',
        'stuxs-card': '0 10px 30px -10px rgba(0, 0, 0, 0.5)',
        'stuxs-player': '0 -10px 35px -5px rgba(0, 0, 0, 0.7)',
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 12s linear infinite',
      }
    },
  },
  plugins: [],
}

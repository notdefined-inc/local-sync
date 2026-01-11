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
        // Light theme
        cream: '#FAF9F6',
        surface: '#F0F0F0',
        // Dark theme
        navy: '#1A1B2E',
        navyLight: '#252742',
        // Accent colors
        primary: '#5B8DEF',
        primaryDark: '#6C9BCF',
        secondary: '#7CB69D',
        secondaryDark: '#5CAB7D',
        coral: '#FF7675',
        rose: '#E17055',
        amber: '#FDCB6E',
        gold: '#F9CA24',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        }
      }
    },
  },
  plugins: [],
}

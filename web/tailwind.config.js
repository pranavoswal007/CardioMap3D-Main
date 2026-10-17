/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#090d16',
        surface: '#0f172a',
        'surface-elevated': '#1e293b',
        border: '#334155',
        primary: {
          DEFAULT: '#0284c7',
          light: '#38bdf8',
          dark: '#0369a1',
        },
        risk: {
          low: '#10b981',       // Emerald green (<30% risk)
          moderate: '#f59e0b',  // Amber (30-70% risk)
          high: '#ef4444',      // Red (>70% risk)
        },
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Match web design system dark theme
        background:  '#0f172a',
        card:        '#1e293b',
        border:      '#334155',
        primary:     '#3b82f6',
        'primary-foreground': '#ffffff',
        muted:       '#94a3b8',
        foreground:  '#f1f5f9',
        destructive: '#ef4444',
        success:     '#22c55e',
        warning:     '#f59e0b',
      },
    },
  },
  plugins: [],
};

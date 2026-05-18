import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // CSS variable tokens — consumed by all components
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT:    'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          border:     'hsl(var(--sidebar-border))',
          active:     'hsl(var(--sidebar-active))',
          'active-foreground': 'hsl(var(--sidebar-active-foreground))',
          muted:      'hsl(var(--sidebar-muted))',
        },
        // Gold accent — executive premium highlight
        gold: {
          DEFAULT:    'hsl(var(--gold))',
          foreground: 'hsl(var(--gold-foreground))',
        },
        // Graphite semantic palette — deep dark surfaces
        // Note: kept as "navy" for backwards compat with existing component classes
        navy: {
          base:     '#0d1118',
          surface:  '#131c28',
          elevated: '#182030',
          border:   '#1e2d3e',
        },
        // Explicit graphite aliases (new components should use these)
        graphite: {
          900: '#0d1118',
          800: '#131c28',
          700: '#182030',
          600: '#1e2d3e',
          500: '#2a3b52',
        },
        // Legacy — kept for any external references
        'brand-light': 'hsl(var(--gold))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'spin': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;

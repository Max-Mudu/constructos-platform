import type { AppProps } from 'next/app';

// Minimal Pages Router _app — no styled-jsx StyleRegistry.
// This file only covers the /404 and /500 static error pages;
// all other routes use the App Router (app/layout.tsx).
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

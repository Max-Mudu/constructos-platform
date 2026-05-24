'use client';

// global-error.tsx catches errors thrown inside app/layout.tsx.
// It replaces the entire document, so <html> and <body> are required here.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#020817',
          color: '#e2e8f0',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '16px',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0, maxWidth: '360px' }}>
          An unexpected error occurred. Refreshing the page usually fixes it.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '8px 20px',
            borderRadius: '8px',
            background: '#1d4ed8',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

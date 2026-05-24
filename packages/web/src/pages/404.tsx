const pageStyle: React.CSSProperties = {
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
};

export default function Custom404() {
  return (
    <div style={pageStyle}>
      <p style={{ fontSize: '48px', fontWeight: 700, margin: 0, letterSpacing: '-1px' }}>404</p>
      <p style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Page not found</p>
      <p style={{ color: '#64748b', fontSize: '14px', margin: 0, maxWidth: '360px' }}>
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <a
        href="/dashboard"
        style={{
          padding: '8px 20px',
          borderRadius: '8px',
          background: '#1d4ed8',
          color: '#fff',
          textDecoration: 'none',
          fontSize: '14px',
          fontWeight: 600,
        }}
      >
        Go to dashboard
      </a>
    </div>
  );
}

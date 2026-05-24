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

export default function Custom500() {
  return (
    <div style={pageStyle}>
      <p style={{ fontSize: '48px', fontWeight: 700, margin: 0, letterSpacing: '-1px' }}>500</p>
      <p style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Server error</p>
      <p style={{ color: '#64748b', fontSize: '14px', margin: 0, maxWidth: '360px' }}>
        An unexpected error occurred. Please try refreshing the page.
      </p>
      <a
        href="/"
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
        Go home
      </a>
    </div>
  );
}

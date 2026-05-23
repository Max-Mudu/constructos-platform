// API base URL — set EXPO_PUBLIC_API_URL in your .env file or EAS build env.
// All three EAS build profiles (development, preview, production) set this
// explicitly via eas.json, so the fallback is only for bare local dev.
// Android emulator: 10.0.2.2 → host machine. Port 3001 = Fastify API.
export const API_BASE_URL =
  process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3001/api/v1';

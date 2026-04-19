function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  DATABASE_URL: requireEnv('DATABASE_URL'),
  JWT_SECRET: requireEnv('JWT_SECRET'),
  JWT_REFRESH_SECRET: requireEnv('JWT_REFRESH_SECRET'),
  JWT_EXPIRES_IN: process.env['JWT_EXPIRES_IN'] ?? '15m',
  JWT_REFRESH_EXPIRES_IN: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  PORT: parseInt(process.env['PORT'] ?? '3001', 10),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  CORS_ORIGIN: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  AWS_ACCESS_KEY_ID: process.env['AWS_ACCESS_KEY_ID'] ?? '',
  AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
  AWS_REGION: process.env['AWS_REGION'] ?? 'us-east-1',
  AWS_S3_BUCKET: process.env['AWS_S3_BUCKET'] ?? '',
  isProduction: process.env['NODE_ENV'] === 'production',
  isTest: process.env['NODE_ENV'] === 'test',
};

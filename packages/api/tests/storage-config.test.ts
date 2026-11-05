/**
 * getStorageDriver(): driver selection, memoisation and the production guards.
 * `env` fields are mutated in-test and always restored; the memoised driver is
 * reset around every test. All S3 values are obviously fake test fixtures.
 */
import { env } from '../src/utils/env';
import { getStorageDriver, resetStorageDriverForTests } from '../src/services/storage';
import { LocalStorageDriver } from '../src/services/storage/local';
import { S3StorageDriver } from '../src/services/storage/s3';

type MutableEnv = Record<string, unknown>;

const STORAGE_FIELDS = [
  'isProduction', 'STORAGE_DRIVER', 'ALLOW_LOCAL_STORAGE_IN_PRODUCTION', 'FILE_URL_SECRET',
  'S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE',
] as const;

// ── Test fixtures (not real credentials, endpoints or buckets) ──────────────
const FAKE_S3 = {
  S3_ENDPOINT: 'https://test-fixture.invalid',
  S3_BUCKET: 'test-fixture-bucket',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'TEST_FIXTURE_ACCESS_KEY_ID',
  S3_SECRET_ACCESS_KEY: 'test-fixture-secret-access-key-not-real',
  S3_FORCE_PATH_STYLE: true,
};

let saved: Record<string, unknown>;

beforeEach(() => {
  const mutable = env as unknown as MutableEnv;
  saved = Object.fromEntries(STORAGE_FIELDS.map((k) => [k, mutable[k]]));
  resetStorageDriverForTests();
});

afterEach(() => {
  Object.assign(env as unknown as MutableEnv, saved);
  resetStorageDriverForTests();
});

function setEnv(overrides: Record<string, unknown>) {
  Object.assign(env as unknown as MutableEnv, overrides);
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a throw');
}

describe('getStorageDriver', () => {
  it('defaults to the local driver in test and is memoised', () => {
    setEnv({ STORAGE_DRIVER: 'local', isProduction: false });
    const a = getStorageDriver();
    expect(a).toBeInstanceOf(LocalStorageDriver);
    expect(getStorageDriver()).toBe(a);
    resetStorageDriverForTests();
    expect(getStorageDriver()).not.toBe(a);
  });

  it('selects the S3 driver when STORAGE_DRIVER=s3 and settings are complete', () => {
    setEnv({ STORAGE_DRIVER: 's3', ...FAKE_S3 });
    const driver = getStorageDriver();
    expect(driver).toBeInstanceOf(S3StorageDriver);
    expect((driver as S3StorageDriver).bucket).toBe(FAKE_S3.S3_BUCKET);
  });

  it('S3_ENDPOINT is optional (AWS S3) but must be a URL when set', () => {
    setEnv({ STORAGE_DRIVER: 's3', ...FAKE_S3, S3_ENDPOINT: '' });
    expect(getStorageDriver()).toBeInstanceOf(S3StorageDriver);
    resetStorageDriverForTests();
    setEnv({ S3_ENDPOINT: 'not a url' });
    expect(() => getStorageDriver()).toThrow(/S3_ENDPOINT must be an absolute URL/);
  });
});

describe('production guard: local driver', () => {
  it('throws for local without ALLOW_LOCAL_STORAGE_IN_PRODUCTION', () => {
    setEnv({ isProduction: true, STORAGE_DRIVER: 'local', ALLOW_LOCAL_STORAGE_IN_PRODUCTION: false, FILE_URL_SECRET: 'f'.repeat(40) });
    const err = errorOf(() => getStorageDriver());
    expect(err.message).toMatch(/STORAGE_DRIVER=local is refused in production/);
    expect(err.message).toMatch(/ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true/);
  });

  it('a failed call is not memoised', () => {
    setEnv({ isProduction: true, STORAGE_DRIVER: 'local', ALLOW_LOCAL_STORAGE_IN_PRODUCTION: false });
    expect(() => getStorageDriver()).toThrow();
    setEnv({ isProduction: false });
    expect(getStorageDriver()).toBeInstanceOf(LocalStorageDriver);
  });

  it('with the allow flag still requires FILE_URL_SECRET of 32+ characters', () => {
    setEnv({ isProduction: true, STORAGE_DRIVER: 'local', ALLOW_LOCAL_STORAGE_IN_PRODUCTION: true, FILE_URL_SECRET: '' });
    expect(() => getStorageDriver()).toThrow(/FILE_URL_SECRET/);
    setEnv({ FILE_URL_SECRET: 'test-fixture-too-short' });
    const err = errorOf(() => getStorageDriver());
    expect(err.message).toMatch(/at least 32 characters/);
    expect(err.message).not.toContain('test-fixture-too-short');
    setEnv({ FILE_URL_SECRET: 'test-fixture-file-url-secret-at-least-32-chars' });
    expect(getStorageDriver()).toBeInstanceOf(LocalStorageDriver);
  });
});

describe('production guard: s3 driver', () => {
  const REQUIRED = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;

  it.each(REQUIRED)('throws naming %s when it is missing, without leaking values', (name) => {
    setEnv({ isProduction: true, STORAGE_DRIVER: 's3', ...FAKE_S3, [name]: '' });
    const err = errorOf(() => getStorageDriver());
    expect(err.message).toBe(`STORAGE_DRIVER=s3 requires these environment variables: ${name}`);
    for (const value of Object.values(FAKE_S3)) {
      if (typeof value === 'string' && value.length > 4) expect(err.message).not.toContain(value);
    }
  });

  it('names every missing variable at once', () => {
    setEnv({
      isProduction: true, STORAGE_DRIVER: 's3', S3_ENDPOINT: '',
      S3_BUCKET: '', S3_REGION: '  ', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '',
    });
    expect(() => getStorageDriver()).toThrow(
      'STORAGE_DRIVER=s3 requires these environment variables: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
    );
  });

  it('also throws outside production when settings are missing', () => {
    setEnv({ isProduction: false, STORAGE_DRIVER: 's3', ...FAKE_S3, S3_BUCKET: '' });
    expect(() => getStorageDriver()).toThrow(/S3_BUCKET/);
  });

  it('requires an https endpoint in production', () => {
    setEnv({ isProduction: true, STORAGE_DRIVER: 's3', ...FAKE_S3, S3_ENDPOINT: 'http://test-fixture.invalid' });
    expect(() => getStorageDriver()).toThrow(/S3_ENDPOINT must use https in production/);
  });

  it('accepts complete s3 settings in production without FILE_URL_SECRET', () => {
    setEnv({ isProduction: true, STORAGE_DRIVER: 's3', ...FAKE_S3, FILE_URL_SECRET: '' });
    expect(getStorageDriver()).toBeInstanceOf(S3StorageDriver);
  });
});

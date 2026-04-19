// Manual mock for next/navigation used in Jest (jsdom) tests.
// Components that call useRouter / usePathname / useSearchParams will receive
// these controllable stubs instead of the real Next.js implementations.

const mockPush    = jest.fn();
const mockReplace = jest.fn();
const mockBack    = jest.fn();

export const useRouter = jest.fn(() => ({
  push:    mockPush,
  replace: mockReplace,
  back:    mockBack,
  prefetch: jest.fn(),
  refresh:  jest.fn(),
}));

export const usePathname    = jest.fn(() => '/dashboard');
export const useSearchParams = jest.fn(() => new URLSearchParams());

// Allow tests to reset router spies between cases.
export function __resetRouterMocks() {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockBack.mockReset();
}

export { mockPush, mockReplace };

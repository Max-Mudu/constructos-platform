import { act } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { AuthUser } from '@/lib/types';

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'admin@test.com',
  firstName: 'Test',
  lastName: 'Admin',
  role: 'company_admin',
  companyId: 'company-1',
  canViewFinance: true,
};

beforeEach(() => {
  // Reset Zustand store state between tests
  useAuthStore.setState({
    user: null,
    accessToken: null,
    isBootstrapping: true,
  });
});

describe('useAuthStore — setAuth', () => {
  it('stores user and accessToken', () => {
    act(() => {
      useAuthStore.getState().setAuth(mockUser, 'token-abc');
    });

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.accessToken).toBe('token-abc');
  });

  it('sets isBootstrapping to false after setAuth', () => {
    act(() => {
      useAuthStore.getState().setAuth(mockUser, 'token-abc');
    });

    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });
});

describe('useAuthStore — clearAuth', () => {
  it('clears user and accessToken', () => {
    act(() => {
      useAuthStore.getState().setAuth(mockUser, 'token-abc');
    });
    act(() => {
      useAuthStore.getState().clearAuth();
    });

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it('sets isBootstrapping to false after clearAuth', () => {
    act(() => {
      useAuthStore.getState().clearAuth();
    });

    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });
});

describe('useAuthStore — setBootstrapping', () => {
  it('can set bootstrapping to false', () => {
    act(() => {
      useAuthStore.getState().setBootstrapping(false);
    });

    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });

  it('can set bootstrapping to true', () => {
    act(() => {
      useAuthStore.getState().setBootstrapping(false);
      useAuthStore.getState().setBootstrapping(true);
    });

    expect(useAuthStore.getState().isBootstrapping).toBe(true);
  });
});

describe('useAuthStore — initial state', () => {
  it('starts with no user', () => {
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('starts with no accessToken', () => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('starts bootstrapping', () => {
    expect(useAuthStore.getState().isBootstrapping).toBe(true);
  });
});

describe('useAuthStore — finance access', () => {
  it('stores canViewFinance=true correctly', () => {
    act(() => {
      useAuthStore.getState().setAuth(mockUser, 'token');
    });

    expect(useAuthStore.getState().user?.canViewFinance).toBe(true);
  });

  it('stores canViewFinance=false correctly', () => {
    const pmUser: AuthUser = { ...mockUser, role: 'project_manager', canViewFinance: false };
    act(() => {
      useAuthStore.getState().setAuth(pmUser, 'token');
    });

    expect(useAuthStore.getState().user?.canViewFinance).toBe(false);
  });
});

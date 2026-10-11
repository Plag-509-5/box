import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  errorLabel,
  type BoxUser,
  type CloudMatch,
  type Friendship,
  type PublicUser,
  type UserPreferences,
} from './api';

interface AuthContextValue {
  user: BoxUser | null;
  oauthResult: 'success' | 'error' | null;
  friendships: Friendship[];
  cloudMatches: CloudMatch[];
  loading: boolean;
  busy: boolean;
  error: string;
  clearError: () => void;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, username: string, password: string) => Promise<boolean>;
  setPassword: (password: string, currentPassword?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  updateProfile: (patch: {
    username?: string;
    displayName?: string;
    preferences?: Partial<UserPreferences>;
  }) => Promise<boolean>;
  uploadAvatar: (file: File) => Promise<boolean>;
  searchUsers: (query: string) => Promise<PublicUser[]>;
  addFriend: (userId: string) => Promise<boolean>;
  acceptFriend: (requestId: string) => Promise<boolean>;
  removeFriend: (friendshipId: string) => Promise<boolean>;
  refreshSocial: () => Promise<void>;
  saveMatch: (payload: {
    mode: 'local' | 'online';
    size: number;
    names: string[];
    scores: number[];
    myIndex: number;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<BoxUser | null>(null);
  const [oauthResult, setOauthResult] = useState<'success' | 'error' | null>(null);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [cloudMatches, setCloudMatches] = useState<CloudMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guard = useCallback(async <T,>(job: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError('');
    try {
      return await job();
    } catch (err) {
      setError(errorLabel(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshSocial = useCallback(async () => {
    const [friends, recent] = await Promise.all([
      api<{ friendships: Friendship[] }>('/friends'),
      api<{ matches: CloudMatch[] }>('/matches'),
    ]);
    setFriendships(friends.friendships);
    setCloudMatches(recent.matches);
  }, []);

  useEffect(() => {
    let live = true;
    const locationUrl = new URL(window.location.href);
    const result = locationUrl.searchParams.get('oauth');
    if (result === 'success' || result === 'error') {
      setOauthResult(result);
      if (result === 'error') setError('La connexion Google a échoué ou a été annulée. Réessaie.');
      locationUrl.searchParams.delete('oauth');
      window.history.replaceState(
        window.history.state,
        '',
        `${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`,
      );
    }
    api<{ user: BoxUser }>('/users/me').catch(() => null).then(async (session) => {
      if (!live) return;
      if (session?.user) {
        setUser(session.user);
        try {
          await refreshSocial();
        } catch {
          /* Session is still usable if social data temporarily fails. */
        }
      }
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [refreshSocial]);

  const consumeAuth = useCallback(
    async (request: Promise<{ user: BoxUser }>) => {
      const data = await guard(() => request);
      if (!data) return false;
      setUser(data.user);
      await refreshSocial().catch(() => {});
      return true;
    },
    [guard, refreshSocial],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      oauthResult,
      friendships,
      cloudMatches,
      loading,
      busy,
      error,
      clearError: () => setError(''),
      login: (email, password) =>
        consumeAuth(
          api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
        ),
      register: (email, username, password) =>
        consumeAuth(
          api('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, username, password }),
          }),
        ),
      setPassword: async (password, currentPassword = '') => {
        const saved = await guard(() =>
          api<{ ok: true }>('/auth/password', {
            method: 'POST',
            body: JSON.stringify({ password, currentPassword }),
          }),
        );
        if (!saved) return false;
        setUser((previous) => previous ? { ...previous, hasPassword: true } : previous);
        return true;
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        setUser(null);
        setFriendships([]);
        setCloudMatches([]);
      },
      updateProfile: async (patch) => {
        const data = await guard(() =>
          api<{ user: BoxUser }>('/users/me', { method: 'PATCH', body: JSON.stringify(patch) }),
        );
        if (!data) return false;
        setUser(data.user);
        return true;
      },
      uploadAvatar: async (file) => {
        const body = new FormData();
        body.append('avatar', file);
        const data = await guard(() =>
          api<{ user: BoxUser }>('/users/me/avatar', { method: 'POST', body }),
        );
        if (!data) return false;
        setUser(data.user);
        return true;
      },
      searchUsers: async (query) => {
        try {
          const data = await api<{ users: PublicUser[] }>(`/users/search?q=${encodeURIComponent(query)}`);
          return data.users;
        } catch (err) {
          setError(errorLabel(err));
          return [];
        }
      },
      addFriend: async (userId) => {
        const data = await guard(() =>
          api<{ friendships: Friendship[] }>(`/friends/requests/${userId}`, { method: 'POST' }),
        );
        if (!data) return false;
        setFriendships(data.friendships);
        return true;
      },
      acceptFriend: async (requestId) => {
        const data = await guard(() =>
          api<{ friendships: Friendship[] }>(`/friends/requests/${requestId}/accept`, {
            method: 'POST',
          }),
        );
        if (!data) return false;
        setFriendships(data.friendships);
        return true;
      },
      removeFriend: async (friendshipId) => {
        const data = await guard(() =>
          api<{ friendships: Friendship[] }>(`/friends/${friendshipId}`, { method: 'DELETE' }),
        );
        if (!data) return false;
        setFriendships(data.friendships);
        return true;
      },
      refreshSocial,
      saveMatch: async (payload) => {
        const data = await api<{ user: BoxUser }>('/matches', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setUser(data.user);
        const recent = await api<{ matches: CloudMatch[] }>('/matches');
        setCloudMatches(recent.matches);
      },
    }),
    [
      user,
      oauthResult,
      friendships,
      cloudMatches,
      loading,
      busy,
      error,
      consumeAuth,
      guard,
      refreshSocial,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
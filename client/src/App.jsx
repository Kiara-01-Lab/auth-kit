import React, { useState, useEffect, useCallback } from 'react';
import Auth from './components/Auth.jsx';
import Dashboard from './components/Dashboard.jsx';

// ── API client ──────────────────────────────────────────────────────────────

const TOKEN_KEY = 'authkit_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount: verify stored token
  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }

    apiFetch('/auth/me')
      .then(u => setUser(u))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const handleAuthSuccess = useCallback(({ user: u, token }) => {
    setToken(token);
    setUser(u);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // best-effort
    }
    setToken(null);
    setUser(null);
  }, []);

  if (loading) {
    return (
      <div className="app loading">
        <div className="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!user) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          {/* AuthKit logo — lock icon */}
          <svg width="28" height="28" viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
            <defs>
              <linearGradient id="akGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#3b82f6' }} />
                <stop offset="100%" style={{ stopColor: '#2563eb' }} />
              </linearGradient>
            </defs>
            <rect width="100" height="100" rx="20" fill="url(#akGrad)" />
            <rect x="30" y="48" width="40" height="32" rx="6" fill="white" />
            <path d="M 38 48 L 38 36 A 12 12 0 0 1 62 36 L 62 48" stroke="white" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="50" cy="62" r="4" fill="#3b82f6" />
          </svg>
          <h1>AuthKit</h1>
        </div>
        <div className="header-user">
          <span>Signed in as <strong>{user.email}</strong></span>
          {user.roles && user.roles.map(r => (
            <span key={r} className={`badge ${r === 'admin' ? 'badge-blue' : 'badge-gray'}`}>
              {r}
            </span>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main-content">
        <Dashboard user={user} apiFetch={apiFetch} />
      </main>
    </div>
  );
}

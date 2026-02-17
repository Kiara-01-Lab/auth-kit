import React, { useState } from 'react';
import './Auth.css';

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function Auth({ onAuthSuccess }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  function reset(nextMode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'forgot') {
        // AuthKit doesn't have email sending built-in — show informational message
        setMessage('If that email exists, a reset link would be sent. (Configure email in your server.)');
      } else if (mode === 'signup') {
        const data = await post('/auth/register', { email, password, username: username || undefined });
        onAuthSuccess(data);
      } else {
        const data = await post('/auth/login', { email, password });
        onAuthSuccess(data);
      }
    } catch (err) {
      if (err.message.toLowerCase().includes('rate limit')) {
        setError('Too many attempts. Please wait and try again.');
      } else if (err.message.toLowerCase().includes('invalid')) {
        setError('Invalid email or password.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <svg width="32" height="32" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="authLockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: '#3b82f6' }} />
                  <stop offset="100%" style={{ stopColor: '#2563eb' }} />
                </linearGradient>
              </defs>
              <rect width="100" height="100" rx="20" fill="url(#authLockGrad)" />
              <rect x="30" y="48" width="40" height="32" rx="6" fill="white" />
              <path d="M 38 48 L 38 36 A 12 12 0 0 1 62 36 L 62 48"
                stroke="white" strokeWidth="6" fill="none" strokeLinecap="round" />
              <circle cx="50" cy="62" r="4" fill="#3b82f6" />
            </svg>
            <h1>AuthKit</h1>
          </div>
          <p>
            {mode === 'forgot'
              ? 'Reset your password'
              : mode === 'signup'
              ? 'Create your account'
              : 'Sign in to your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-success">{message}</div>}

          <div className="form-group">
            <label htmlFor="ak-email">Email</label>
            <input
              id="ak-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={loading}
              autoComplete="email"
            />
          </div>

          {mode === 'signup' && (
            <div className="form-group">
              <label htmlFor="ak-username">Username <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
              <input
                id="ak-username"
                type="text"
                placeholder="johndoe"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
                autoComplete="username"
              />
            </div>
          )}

          {mode !== 'forgot' && (
            <div className="form-group">
              <label htmlFor="ak-password">Password</label>
              <input
                id="ak-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading
              ? 'Please wait...'
              : mode === 'forgot'
              ? 'Send Reset Link'
              : mode === 'signup'
              ? 'Create Account'
              : 'Sign In'}
          </button>
        </form>

        <div className="auth-footer">
          {mode === 'signin' && (
            <div className="auth-footer-forgot">
              <button
                type="button"
                className="auth-link-forgot"
                onClick={() => reset('forgot')}
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>
          )}

          {mode !== 'forgot' && <div className="auth-footer-divider" />}

          <div className="auth-footer-toggle">
            <button
              type="button"
              className="auth-toggle"
              onClick={() => reset(mode === 'forgot' ? 'signin' : mode === 'signup' ? 'signin' : 'signup')}
              disabled={loading}
            >
              {mode === 'forgot'
                ? 'Back to sign in'
                : mode === 'signup'
                ? 'Already have an account? Sign in'
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

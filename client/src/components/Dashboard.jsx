import React, { useState, useEffect, useCallback } from 'react';
import UserTable from './UserTable.jsx';
import APIKeys from './APIKeys.jsx';

export default function Dashboard({ user, apiFetch }) {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isAdmin = user.roles && user.roles.includes('admin');

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setError(null);
      const data = await apiFetch('/users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, isAdmin]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Stats
  const totalUsers = users.length;
  const adminCount = users.filter(u => u.roles && u.roles.includes('admin')).length;
  const activeCount = users.filter(u => u.is_active).length;

  return (
    <>
      {/* ── Stats ────────────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total Users</div>
            <div className="stat-value">{loading ? '—' : totalUsers}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active</div>
            <div className="stat-value">{loading ? '—' : activeCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Admins</div>
            <div className="stat-value">{loading ? '—' : adminCount}</div>
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="tabs">
        {isAdmin && (
          <button
            className={`tab-btn ${tab === 'users' ? 'active' : ''}`}
            onClick={() => setTab('users')}
          >
            Users
          </button>
        )}
        <button
          className={`tab-btn ${tab === 'apikeys' ? 'active' : ''}`}
          onClick={() => setTab('apikeys')}
        >
          API Keys
        </button>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {tab === 'users' && isAdmin && (
        <UserTable
          users={users}
          loading={loading}
          apiFetch={apiFetch}
          onRefresh={loadUsers}
          currentUser={user}
        />
      )}

      {tab === 'apikeys' && (
        <APIKeys
          userId={user.id}
          apiFetch={apiFetch}
        />
      )}

      {!isAdmin && tab === 'users' && (
        <div className="empty-state">
          <p>You don't have permission to view users.</p>
        </div>
      )}
    </>
  );
}

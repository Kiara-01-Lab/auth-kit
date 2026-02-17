import React, { useState } from 'react';
import UserModal from './UserModal.jsx';
import RoleManager from './RoleManager.jsx';

function roleBadge(role) {
  const cls = role === 'admin' ? 'badge-blue' : role === 'member' ? 'badge-green' : 'badge-gray';
  return <span key={role} className={`badge ${cls}`} style={{ marginRight: 4 }}>{role}</span>;
}

export default function UserTable({ users, loading, apiFetch, onRefresh, currentUser }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [roleTarget, setRoleTarget] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.email.toLowerCase().includes(q) ||
      (u.username && u.username.toLowerCase().includes(q));
  });

  async function handleDelete(user) {
    if (!confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
    setDeleting(user.id);
    try {
      await apiFetch(`/users/${user.id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleActive(user) {
    try {
      await apiFetch(`/users/${user.id}`, {
        method: 'PATCH',
        body: { is_active: !user.is_active },
      });
      onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>Users</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div className="search-bar">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setEditUser(null); setShowModal(true); }}
            >
              + Add User
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ margin: '0.75rem 1.25rem' }}>
            {error}
          </div>
        )}

        <div className="table-wrap">
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <p>{search ? 'No users match your search.' : 'No users yet.'}</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Username</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id}>
                    <td>
                      <span style={{ fontWeight: 500 }}>{u.email}</span>
                      {u.id === currentUser.id && (
                        <span className="badge badge-gray" style={{ marginLeft: 8 }}>you</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--color-text-muted)' }}>
                      {u.username || '—'}
                    </td>
                    <td>
                      {u.roles && u.roles.length > 0
                        ? u.roles.map(roleBadge)
                        : <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      }
                    </td>
                    <td>
                      <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                      {u.last_login_at
                        ? new Date(u.last_login_at).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setEditUser(u); setShowModal(true); }}
                          title="Edit user"
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setRoleTarget(u)}
                          title="Manage roles"
                        >
                          Roles
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleToggleActive(u)}
                          title={u.is_active ? 'Deactivate' : 'Activate'}
                          disabled={u.id === currentUser.id}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(u)}
                          disabled={deleting === u.id || u.id === currentUser.id}
                          title="Delete user"
                        >
                          {deleting === u.id ? '...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <UserModal
          user={editUser}
          apiFetch={apiFetch}
          onClose={() => { setShowModal(false); setEditUser(null); }}
          onSuccess={() => { setShowModal(false); setEditUser(null); onRefresh(); }}
        />
      )}

      {roleTarget && (
        <RoleManager
          user={roleTarget}
          apiFetch={apiFetch}
          onClose={() => setRoleTarget(null)}
          onSuccess={() => { setRoleTarget(null); onRefresh(); }}
        />
      )}
    </>
  );
}

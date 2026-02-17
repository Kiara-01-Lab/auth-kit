import React, { useState } from 'react';

const COMMON_ROLES = ['admin', 'member', 'viewer'];

export default function RoleManager({ user, apiFetch, onClose, onSuccess }) {
  const [roles, setRoles] = useState([...(user.roles || [])]);
  const [customRole, setCustomRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function addRole(role) {
    if (!role || roles.includes(role)) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/users/${user.id}/roles`, {
        method: 'POST',
        body: { role },
      });
      setRoles(prev => [...prev, role]);
      setCustomRole('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function removeRole(role) {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/users/${user.id}/roles/${role}`, { method: 'DELETE' });
      setRoles(prev => prev.filter(r => r !== role));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Manage Roles</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            User: <strong style={{ color: 'var(--color-text)' }}>{user.email}</strong>
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          {/* Current roles */}
          <div>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Current Roles</p>
            {roles.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No roles assigned.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {roles.map(role => (
                  <span key={role} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
                    <span className={`badge ${role === 'admin' ? 'badge-blue' : role === 'member' ? 'badge-green' : 'badge-gray'}`}>
                      {role}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeRole(role)}
                      disabled={loading}
                      style={{ padding: '0 0.25rem', fontSize: '0.75rem', color: 'var(--color-danger)' }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Quick-add common roles */}
          <div>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Add Role</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {COMMON_ROLES.filter(r => !roles.includes(r)).map(role => (
                <button
                  key={role}
                  className="btn btn-secondary btn-sm"
                  onClick={() => addRole(role)}
                  disabled={loading}
                >
                  + {role}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Custom role..."
                value={customRole}
                onChange={e => setCustomRole(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '0.4rem 0.625rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  fontSize: '0.875rem',
                }}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRole(customRole))}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => addRole(customRole)}
                disabled={loading || !customRole}
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onSuccess}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

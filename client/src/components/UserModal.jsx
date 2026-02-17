import React, { useState } from 'react';

export default function UserModal({ user, apiFetch, onClose, onSuccess }) {
  const isEdit = !!user;

  const [email, setEmail] = useState(user?.email || '');
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isEdit) {
        // Update user fields
        await apiFetch(`/users/${user.id}`, {
          method: 'PATCH',
          body: { email, username: username || undefined },
        });
        // If admin wants to reset password
        if (newPassword) {
          await apiFetch(`/users/${user.id}/reset-password`, {
            method: 'POST',
            body: { newPassword },
          });
        }
      } else {
        await apiFetch('/users', {
          method: 'POST',
          body: { email, username: username || undefined, password },
        });
      }
      onSuccess();
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
          <h2>{isEdit ? 'Edit User' : 'Add User'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="user@example.com"
              />
            </div>

            <div className="form-group">
              <label>
                Username <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
                placeholder="johndoe"
              />
            </div>

            {!isEdit && (
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  minLength={8}
                  placeholder="Min. 8 characters"
                />
              </div>
            )}

            {isEdit && (
              <div className="form-group">
                <label>
                  Reset Password{' '}
                  <span style={{ color: '#94a3b8', fontWeight: 400 }}>(leave blank to keep current)</span>
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  disabled={loading}
                  minLength={8}
                  placeholder="New password"
                />
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';

export default function APIKeys({ userId, apiFetch }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState(null); // plaintext key shown once
  const [error, setError] = useState(null);

  const loadKeys = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch(`/users/${userId}/api-keys`);
      setKeys(data.keys || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, userId]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const data = await apiFetch(`/users/${userId}/api-keys`, {
        method: 'POST',
        body: { name: newKeyName || undefined },
      });
      setNewKey(data.key);
      setNewKeyName('');
      loadKeys();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id, name) {
    if (!confirm(`Revoke API key "${name || id}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api-keys/${id}`, { method: 'DELETE' });
      loadKeys();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>API Keys</h2>
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {error && <div className="alert alert-error">{error}</div>}

        {/* New key revealed */}
        {newKey && (
          <div className="alert alert-success">
            <strong>API key created.</strong> Copy it now — it won't be shown again.
            <div style={{
              marginTop: '0.5rem',
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 6,
              padding: '0.5rem 0.75rem',
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              wordBreak: 'break-all',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}>
              <span>{newKey}</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { navigator.clipboard.writeText(newKey); }}
                style={{ flexShrink: 0 }}
              >
                Copy
              </button>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setNewKey(null)}
              style={{ marginTop: '0.5rem', color: 'var(--color-text-muted)' }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create form */}
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label>New API Key</label>
            <input
              type="text"
              placeholder="Key name (e.g. CI/CD pipeline)"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              disabled={creating}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>

        {/* Keys list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : keys.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem 0' }}>
            <p>No API keys yet. Create one above.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Last Used</th>
                  <th>Expires</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 500 }}>{k.name || <span style={{ color: 'var(--color-text-muted)' }}>Unnamed</span>}</td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                      {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : <span className="badge badge-green">No expiry</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleRevoke(k.id, k.name)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

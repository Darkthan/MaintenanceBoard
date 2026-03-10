/**
 * Client API centralisé
 */
const API_BASE = '/api';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('accessToken');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };

  // Ne pas envoyer Content-Type pour FormData
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });

    if (res.status === 401) {
      // Tentative de refresh
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        const newToken = localStorage.getItem('accessToken');
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
        return handleResponse(retryRes);
      } else {
        // Rediriger vers login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login.html';
        }
        throw new Error('Session expirée');
      }
    }

    return handleResponse(res);
  } catch (err) {
    if (err.message === 'Session expirée') throw err;
    throw new Error('Erreur réseau : ' + err.message);
  }
}

async function handleResponse(res) {
  const contentType = res.headers.get('content-type');
  const isJson = contentType?.includes('application/json');

  if (!res.ok) {
    const error = isJson ? await res.json() : { error: await res.text() };
    const msg = error.error || error.message || `Erreur ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, data: error });
  }

  if (res.status === 204) return null;
  return isJson ? res.json() : res.blob();
}

async function tryRefreshToken() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include'
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Raccourcis
const api = {
  get: (path, params) => {
    const url = params ? `${path}?${new URLSearchParams(params)}` : path;
    return apiFetch(url);
  },
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
  upload: (path, formData, method = 'POST') => apiFetch(path, { method, body: formData })
};

// Vérifier l'auth au chargement (pages protégées)
function requireLogin() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const token = localStorage.getItem('accessToken');
  if (!user || !token) {
    window.location.href = '/login.html';
    return null;
  }
  return user;
}

// Afficher le nom dans le header
function initUserNav() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (user) {
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role');
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.role;
  }
}

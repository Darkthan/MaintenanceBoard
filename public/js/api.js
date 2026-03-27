/**
 * Client API centralisé — auth par cookies httpOnly uniquement
 */
const API_BASE = '/api';

function ensureNativeMobileViewport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const isTouchDevice = navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)')?.matches;
  const isMobileWidth = window.matchMedia?.('(max-width: 767px)')?.matches;
  if (!isTouchDevice || !isMobileWidth) return;

  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }

  viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');

  document.addEventListener('gesturestart', event => {
    event.preventDefault();
  }, { passive: false });
}

ensureNativeMobileViewport();

// Cache en mémoire de l'utilisateur courant (pas de localStorage)
let _currentUser = null;

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Ne pas envoyer Content-Type pour FormData
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  try {
    // credentials: 'include' envoie automatiquement les cookies httpOnly
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });

    if (res.status === 401) {
      // Tentative de refresh via cookie refreshToken
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
        return handleResponse(retryRes);
      } else {
        _currentUser = null;
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
    return res.ok;
  } catch {
    return false;
  }
}

// Raccourcis
const api = {
  get: (path, params) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (item !== undefined && item !== null && item !== '') searchParams.append(key, item);
          });
          return;
        }
        searchParams.append(key, value);
      });
    }
    const query = searchParams.toString();
    const url = query ? `${path}?${query}` : path;
    return apiFetch(url);
  },
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
  upload: (path, formData, method = 'POST') => apiFetch(path, { method, body: formData })
};

// Vérifier l'auth — appel serveur, résultat mis en cache en mémoire
async function requireLogin() {
  if (_currentUser) return _currentUser;
  try {
    _currentUser = await apiFetch('/auth/me');
    return _currentUser;
  } catch {
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login.html';
    }
    // Suspendre l'exécution pendant la redirection
    await new Promise(() => {});
  }
}

// Mettre à jour l'affichage nav avec les infos user
function initUserNav(user) {
  if (!user) return;
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl) nameEl.textContent = user.name || 'Utilisateur';
  if (roleEl) roleEl.textContent = user.role || '';
  if (avatarEl && user.name) avatarEl.textContent = user.name[0].toUpperCase();
}

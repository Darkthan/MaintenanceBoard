/**
 * Authentification : mot de passe + Passkeys (WebAuthn)
 */

// Importer la bibliothèque SimpleWebAuthn browser (chargée via CDN dans login.html)
// @simplewebauthn/browser est chargé en tant que SimpleWebAuthnBrowser

async function loginWithPassword(email, password) {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (res.user && res.accessToken) {
    localStorage.setItem('user', JSON.stringify(res.user));
    localStorage.setItem('accessToken', res.accessToken);
  }
  return res;
}

async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {}
  localStorage.removeItem('user');
  localStorage.removeItem('accessToken');
  window.location.href = '/login.html';
}

// ── Passkeys ──────────────────────────────────────────────────────────────────

async function startPasskeyLogin(email) {
  const swab = window.SimpleWebAuthnBrowser;
  if (!swab) throw new Error('Bibliothèque WebAuthn non chargée');

  // 1. Obtenir les options du serveur
  const options = await apiFetch('/auth/webauthn/login/begin', {
    method: 'POST',
    body: JSON.stringify({ email: email || undefined })
  });

  // 2. Interagir avec l'authentificateur
  let assertionResponse;
  try {
    assertionResponse = await swab.startAuthentication({ optionsJSON: options });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Authentification annulée par l\'utilisateur');
    }
    throw err;
  }

  // 3. Vérification côté serveur
  const result = await apiFetch('/auth/webauthn/login/finish', {
    method: 'POST',
    body: JSON.stringify(assertionResponse)
  });

  if (result.user && result.accessToken) {
    localStorage.setItem('user', JSON.stringify(result.user));
    localStorage.setItem('accessToken', result.accessToken);
  }
  return result;
}

async function registerPasskey(name) {
  const swab = window.SimpleWebAuthnBrowser;
  if (!swab) throw new Error('Bibliothèque WebAuthn non chargée');

  // 1. Obtenir les options
  const options = await apiFetch('/auth/webauthn/register/begin', {
    method: 'POST',
    body: JSON.stringify({})
  });

  // 2. Créer la credential
  let attResp;
  try {
    attResp = await swab.startRegistration({ optionsJSON: options });
  } catch (err) {
    if (err.name === 'InvalidStateError') {
      throw new Error('Un authenticateur identique est déjà enregistré');
    }
    if (err.name === 'NotAllowedError') {
      throw new Error('Enregistrement annulé par l\'utilisateur');
    }
    throw err;
  }

  // 3. Finaliser
  attResp.name = name;
  const result = await apiFetch('/auth/webauthn/register/finish', {
    method: 'POST',
    body: JSON.stringify(attResp)
  });

  return result;
}

// ── Initialisation page login ─────────────────────────────────────────────────

function initLoginPage() {
  // Rediriger si déjà connecté
  const token = localStorage.getItem('accessToken');
  if (token) {
    window.location.href = '/index.html';
    return;
  }

  const form = document.getElementById('login-form');
  const passkeyBtn = document.getElementById('passkey-login-btn');
  const errorEl = document.getElementById('login-error');

  const showError = (msg) => {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  };

  const hideError = () => {
    if (errorEl) errorEl.classList.add('hidden');
  };

  // Login par mot de passe
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = form.querySelector('[type=submit]');

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Connexion...';
      await loginWithPassword(email, password);
      window.location.href = '/index.html';
    } catch (err) {
      showError(err.message || 'Identifiants incorrects');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Se connecter';
    }
  });

  // Login par Passkey
  passkeyBtn?.addEventListener('click', async () => {
    hideError();
    const email = document.getElementById('email')?.value;
    passkeyBtn.disabled = true;
    passkeyBtn.textContent = 'Authentification...';

    try {
      await startPasskeyLogin(email);
      window.location.href = '/index.html';
    } catch (err) {
      showError(err.message || 'Authentification passkey échouée');
      passkeyBtn.disabled = false;
      passkeyBtn.textContent = 'Se connecter avec une clé';
    }
  });

  // Vérifier support WebAuthn
  if (!window.PublicKeyCredential) {
    if (passkeyBtn) {
      passkeyBtn.disabled = true;
      passkeyBtn.title = 'WebAuthn non supporté par ce navigateur';
    }
  }
}

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement(initial = {}) {
  const listeners = {};
  return {
    disabled: false,
    textContent: '',
    value: '',
    checked: false,
    classList: { add: jest.fn(), remove: jest.fn() },
    addEventListener: jest.fn((event, handler) => { listeners[event] = handler; }),
    dispatch: (event, payload = {}) => listeners[event]?.(payload),
    ...initial,
  };
}

function loadAuthClient({ apiFetch, webauthn } = {}) {
  const email = createElement({ value: 'admin@example.com' });
  const password = createElement({ value: 'secret' });
  const remember = createElement({ checked: true });
  const submit = createElement({ textContent: 'Se connecter' });
  const form = createElement({ querySelector: jest.fn(() => submit) });
  const passkey = createElement({ textContent: 'Se connecter avec une clé (Passkey)' });
  const error = createElement();
  const elements = {
    'login-form': form,
    'passkey-login-btn': passkey,
    'remember-me': remember,
    'login-error': error,
    email,
    password,
  };
  const location = { search: '', origin: 'https://maintenance.example', href: '' };
  const context = {
    URL,
    URLSearchParams,
    apiFetch: apiFetch || jest.fn().mockRejectedValue(new Error('Non connecté')),
    api: { post: jest.fn() },
    document: { getElementById: jest.fn(id => elements[id] || null) },
    window: {
      location,
      PublicKeyCredential: function PublicKeyCredential() {},
      WebAuthnClient: webauthn || {
        supportsWebAuthn: jest.fn(() => true),
        startAuthentication: jest.fn(),
      },
    },
    console,
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(process.cwd(), 'public/js/auth.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'auth.js' });
  return { context, elements, form, passkey };
}

describe('client de connexion', () => {
  it('charge auth.js et branche les actions du formulaire et de la passkey', () => {
    const { context, form, passkey } = loadAuthClient();

    expect(typeof context.initLoginPage).toBe('function');
    context.initLoginPage();

    expect(form.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
    expect(passkey.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  it('transmet rester connecté lors de la connexion par mot de passe', async () => {
    const apiFetch = jest.fn()
      .mockRejectedValueOnce(new Error('Non connecté'))
      .mockResolvedValueOnce({ user: { id: 'user-1' } });
    const { context, form } = loadAuthClient({ apiFetch });
    context.initLoginPage();

    await form.dispatch('submit', { preventDefault: jest.fn() });

    expect(apiFetch).toHaveBeenLastCalledWith('/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'secret', rememberMe: true }),
    }));
    expect(context.window.location.href).toBe('/index.html');
  });

  it('exécute le parcours passkey et transmet rester connecté à la finalisation', async () => {
    const assertion = { id: 'credential-1', response: { signature: 'signature' } };
    const webauthn = {
      supportsWebAuthn: jest.fn(() => true),
      startAuthentication: jest.fn().mockResolvedValue(assertion),
    };
    const apiFetch = jest.fn()
      .mockRejectedValueOnce(new Error('Non connecté'))
      .mockResolvedValueOnce({ challenge: 'challenge-1', rpId: 'maintenance.example' })
      .mockResolvedValueOnce({ user: { id: 'user-1' } });
    const { context, passkey } = loadAuthClient({ apiFetch, webauthn });
    context.initLoginPage();

    await passkey.dispatch('click');

    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      challenge: 'challenge-1',
      rpId: 'maintenance.example',
    });
    expect(apiFetch).toHaveBeenLastCalledWith('/auth/webauthn/login/finish', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ...assertion, rememberMe: true }),
    }));
    expect(context.window.location.href).toBe('/index.html');
  });
});

describe('gestion des abonnements push du navigateur', () => {
  let BrowserPush;

  beforeAll(() => {
    global.window = {
      atob: value => Buffer.from(value, 'base64').toString('binary')
    };
    jest.isolateModules(() => {
      require('../public/js/push-notifications');
      BrowserPush = global.window.BrowserPush;
    });
  });

  afterAll(() => {
    delete global.window;
  });

  function publicKey(bytes) {
    return Buffer.from(bytes).toString('base64url');
  }

  it('conserve un abonnement qui utilise déjà la clé VAPID courante', async () => {
    const key = Uint8Array.from([1, 2, 3, 4]);
    const subscription = {
      options: { applicationServerKey: key.buffer },
      unsubscribe: jest.fn()
    };
    const registration = {
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue(subscription),
        subscribe: jest.fn()
      }
    };

    await expect(BrowserPush.ensureSubscription(registration, publicKey(key))).resolves.toBe(subscription);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('remplace un abonnement créé avec une ancienne clé VAPID', async () => {
    const oldSubscription = {
      options: { applicationServerKey: Uint8Array.from([9, 9, 9]).buffer },
      unsubscribe: jest.fn().mockResolvedValue(true)
    };
    const newSubscription = { endpoint: 'https://push.example/new' };
    const registration = {
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue(oldSubscription),
        subscribe: jest.fn().mockResolvedValue(newSubscription)
      }
    };
    const key = Uint8Array.from([1, 2, 3, 4]);

    await expect(BrowserPush.ensureSubscription(registration, publicKey(key))).resolves.toBe(newSubscription);
    expect(oldSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: key
    });
  });
});

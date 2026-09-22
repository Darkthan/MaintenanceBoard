(function exposeBrowserPush(global) {
  function keyToBytes(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = global.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }

  function subscriptionUsesKey(subscription, publicKey) {
    const subscribedKey = subscription?.options?.applicationServerKey;
    if (!subscribedKey || !publicKey) return false;
    const actual = new Uint8Array(subscribedKey);
    const expected = keyToBytes(publicKey);
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  }

  async function ensureSubscription(registration, publicKey) {
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !subscriptionUsesKey(subscription, publicKey)) {
      const removed = await subscription.unsubscribe();
      if (!removed) throw new Error('L’ancien abonnement aux notifications n’a pas pu être remplacé.');
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(publicKey)
      });
    }
    return subscription;
  }

  global.BrowserPush = { keyToBytes, subscriptionUsesKey, ensureSubscription };
})(window);

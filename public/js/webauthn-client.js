(function initWebAuthnClient(global) {
  function supportsWebAuthn() {
    return typeof window !== 'undefined'
      && typeof window.PublicKeyCredential !== 'undefined'
      && typeof navigator !== 'undefined'
      && !!navigator.credentials;
  }

  function base64UrlToUint8Array(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function uint8ArrayToBase64Url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function toArrayBuffer(value) {
    return base64UrlToUint8Array(value).buffer;
  }

  function parseCreationOptions(optionsJSON) {
    if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function') {
      return PublicKeyCredential.parseCreationOptionsFromJSON(optionsJSON);
    }

    return {
      ...optionsJSON,
      challenge: toArrayBuffer(optionsJSON.challenge),
      user: {
        ...optionsJSON.user,
        id: toArrayBuffer(optionsJSON.user.id),
      },
      excludeCredentials: (optionsJSON.excludeCredentials || []).map(credential => ({
        ...credential,
        id: toArrayBuffer(credential.id),
      })),
    };
  }

  function parseRequestOptions(optionsJSON) {
    if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function') {
      return PublicKeyCredential.parseRequestOptionsFromJSON(optionsJSON);
    }

    return {
      ...optionsJSON,
      challenge: toArrayBuffer(optionsJSON.challenge),
      allowCredentials: (optionsJSON.allowCredentials || []).map(credential => ({
        ...credential,
        id: toArrayBuffer(credential.id),
      })),
    };
  }

  function serializeRegistration(credential) {
    return {
      id: credential.id,
      rawId: uint8ArrayToBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults?.() || {},
      response: {
        clientDataJSON: uint8ArrayToBase64Url(credential.response.clientDataJSON),
        attestationObject: uint8ArrayToBase64Url(credential.response.attestationObject),
        transports: credential.response.getTransports?.() || [],
      },
    };
  }

  function serializeAuthentication(credential) {
    return {
      id: credential.id,
      rawId: uint8ArrayToBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults?.() || {},
      response: {
        clientDataJSON: uint8ArrayToBase64Url(credential.response.clientDataJSON),
        authenticatorData: uint8ArrayToBase64Url(credential.response.authenticatorData),
        signature: uint8ArrayToBase64Url(credential.response.signature),
        userHandle: credential.response.userHandle
          ? uint8ArrayToBase64Url(credential.response.userHandle)
          : null,
      },
    };
  }

  async function startRegistration(optionsJSON) {
    if (!supportsWebAuthn()) {
      throw new Error('WebAuthn non supporté par ce navigateur');
    }
    const publicKey = parseCreationOptions(optionsJSON);
    const credential = await navigator.credentials.create({ publicKey });
    if (!credential) {
      throw new Error('Aucune passkey n’a été créée');
    }
    return serializeRegistration(credential);
  }

  async function startAuthentication(optionsJSON) {
    if (!supportsWebAuthn()) {
      throw new Error('WebAuthn non supporté par ce navigateur');
    }
    const publicKey = parseRequestOptions(optionsJSON);
    const credential = await navigator.credentials.get({ publicKey });
    if (!credential) {
      throw new Error('Aucune passkey n’a été sélectionnée');
    }
    return serializeAuthentication(credential);
  }

  global.WebAuthnClient = {
    supportsWebAuthn,
    startRegistration,
    startAuthentication,
  };
})(window);

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  passkey: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
  },
}));

jest.mock('../src/utils/settings', () => ({
  readSettings: jest.fn(() => ({
    webauthn: {
      rpName: 'MaintenanceBoard',
      rpId: 'maintenanceboard.beaupeyrat.com',
      origin: 'https://maintenanceboard.beaupeyrat.com',
    },
  })),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed-jwt'),
}));

const config = require('../src/config');
const prisma = require('../src/lib/prisma');
const { readSettings } = require('../src/utils/settings');
const {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const authService = require('../src/services/authService');

function buildReverseProxyRequest() {
  return {
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'maintenanceboard.beaupeyrat.com',
    },
    protocol: 'http',
    get: jest.fn(() => 'localhost:3000'),
  };
}

describe('authService WebAuthn', () => {
  const originalDatabaseUrl = config.database.url;

  beforeEach(() => {
    jest.clearAllMocks();
    config.database.url = originalDatabaseUrl;
  });

  it('génère des options d’enregistrement avec un user.id en base64url', async () => {
    prisma.passkey.findMany.mockResolvedValue([]);
    generateRegistrationOptions.mockResolvedValue({ challenge: 'challenge-1' });

    await authService.beginPasskeyRegistration({
      id: 'user-1',
      email: 'admin@test.local',
      name: 'Admin',
    });

    expect(generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      userID: 'dXNlci0x',
      userName: 'admin@test.local',
      userDisplayName: 'Admin',
    }));
  });

  it('enregistre la passkey avec le credentialID renvoyé par verifyRegistrationResponse', async () => {
    const credentialID = Uint8Array.from([1, 2, 3, 4]);
    const credentialPublicKey = Uint8Array.from([5, 6, 7, 8]);

    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credentialID,
        credentialPublicKey,
        counter: 42,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    });

    prisma.passkey.create.mockResolvedValue({
      id: 'pk-1',
      name: 'Ma passkey',
      createdAt: new Date('2026-03-23T10:00:00.000Z'),
    });

    await authService.finishPasskeyRegistration(
      { id: 'user-1', email: 'admin@test.local', name: 'Admin' },
      { response: { transports: ['internal'] } },
      'challenge-1',
      'Ma passkey'
    );

    expect(prisma.passkey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        credentialId: 'AQIDBA',
        publicKey: Buffer.from([5, 6, 7, 8]),
        counter: BigInt(42),
        deviceType: 'singleDevice',
        backedUp: false,
        transports: JSON.stringify(['internal']),
        name: 'Ma passkey',
      }),
    });
  });

  it('stocke transports comme tableau avec PostgreSQL', async () => {
    config.database.url = 'postgresql://maintenance_user:maintenance_pass@db:5432/maintenance_db';

    const credentialID = Uint8Array.from([1, 2, 3, 4]);
    const credentialPublicKey = Uint8Array.from([5, 6, 7, 8]);

    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credentialID,
        credentialPublicKey,
        counter: 42,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });

    prisma.passkey.create.mockResolvedValue({
      id: 'pk-2',
      name: 'Bitwarden',
      createdAt: new Date('2026-03-27T10:00:00.000Z'),
    });

    await authService.finishPasskeyRegistration(
      { id: 'user-1', email: 'admin@test.local', name: 'Admin' },
      { response: { transports: ['internal', 'hybrid'] } },
      'challenge-1',
      'Bitwarden'
    );

    expect(prisma.passkey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transports: ['internal', 'hybrid'],
      }),
    });
  });

  it('normalise l’identifiant reçu du navigateur lors de l’authentification', async () => {
    prisma.passkey.findUnique.mockResolvedValue({
      id: 'pk-1',
      credentialId: 'AQIDBA',
      publicKey: Buffer.from([5, 6, 7, 8]),
      counter: BigInt(10),
      transports: JSON.stringify(['internal']),
      user: {
        id: 'user-1',
        email: 'admin@test.local',
        name: 'Admin',
        role: 'ADMIN',
        isActive: true,
      },
    });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.passkey.update.mockResolvedValue({});
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 11 },
    });

    await authService.finishPasskeyLogin(
      { id: 'AQIDBA==' },
      'challenge-1',
      'user-1'
    );

    expect(prisma.passkey.findUnique).toHaveBeenCalledWith({
      where: { credentialId: 'AQIDBA' },
      include: { user: true },
    });
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      authenticator: expect.objectContaining({
        credentialID: 'AQIDBA',
        credentialPublicKey: Buffer.from([5, 6, 7, 8]),
        counter: 10,
        transports: ['internal'],
      }),
    }));
  });

  it('préfère l’origine publique du reverse proxy quand la config par défaut pointe vers localhost', async () => {
    readSettings.mockReturnValue({});
    generateAuthenticationOptions.mockResolvedValue({ challenge: 'challenge-1' });
    prisma.passkey.findUnique.mockResolvedValue({
      id: 'pk-1',
      credentialId: 'AQIDBA',
      publicKey: Buffer.from([5, 6, 7, 8]),
      counter: BigInt(10),
      transports: JSON.stringify(['internal']),
      user: {
        id: 'user-1',
        email: 'admin@test.local',
        name: 'Admin',
        role: 'ADMIN',
        isActive: true,
      },
    });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.passkey.update.mockResolvedValue({});
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 11 },
    });

    const req = buildReverseProxyRequest();

    await authService.beginPasskeyLogin('', req);
    await authService.finishPasskeyLogin(
      { id: 'AQIDBA==' },
      'challenge-1',
      'user-1',
      req
    );

    expect(generateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'maintenanceboard.beaupeyrat.com',
    }));
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: 'https://maintenanceboard.beaupeyrat.com',
      expectedRPID: 'maintenanceboard.beaupeyrat.com',
    }));
  });
});

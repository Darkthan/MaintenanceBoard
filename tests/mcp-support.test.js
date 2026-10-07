jest.mock('../src/lib/prisma', () => ({
  room: { findUnique: jest.fn() },
  intervention: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  ticketMessage: { updateMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn() }
}));
jest.mock('../src/utils/ticketNotifications', () => ({ notifyAdminsOfNewTicket: jest.fn() }));
jest.mock('../src/utils/mail', () => ({ createSmtpTransporter: () => ({ transporter: null, from: null }) }));

const prisma = require('../src/lib/prisma');
const { createSupportRequest, listSupportRequests, getSupportRequest, listSupportMessages, sendSupportMessage } = require('../src/mcp/supportService');

const user = { id: 'u1', isActive: true, name: 'Alice', email: 'alice@example.org' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.intervention.create.mockImplementation(async ({ data }) => ({ id: 'ticket-1', status: data.status }));
});

test('crée une demande pour l’utilisateur connecté avec un accès de suivi', async () => {
  const result = await createSupportRequest({ title: 'Panne de poste' }, { user });
  expect(prisma.intervention.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    source: 'PUBLIC', reporterName: 'Alice', reporterEmail: 'alice@example.org',
    reporters: { create: expect.objectContaining({ name: 'Alice', email: 'alice@example.org', token: result.reporterToken }) }
  }) });
});

test('crée une demande pour une autre personne', async () => {
  await createSupportRequest({ title: 'Panne de poste', reporterName: 'Bob', reporterEmail: 'Bob@Example.org' }, { user });
  expect(prisma.intervention.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    reporterName: 'Bob', reporterEmail: 'bob@example.org'
  }) });
});

test('refuse un demandeur incomplet', async () => {
  await expect(createSupportRequest({ title: 'Panne', reporterName: 'Bob' }, { user })).rejects.toMatchObject({ status: 400 });
  expect(prisma.intervention.create).not.toHaveBeenCalled();
});

test('limite la liste aux demandes du demandeur ou du technicien', async () => {
  prisma.intervention.findMany.mockResolvedValue([]);
  await listSupportRequests({}, { user });
  expect(prisma.intervention.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { AND: expect.arrayContaining([expect.objectContaining({ source: 'PUBLIC' }),
      expect.objectContaining({ OR: expect.arrayContaining([{ reporterEmail: user.email }]) })]) }
  }));
});

test('lit et répond dans le chat du demandeur', async () => {
  prisma.intervention.findFirst.mockResolvedValue({ id: 'ticket-1', techId: null, reporterEmail: user.email });
  prisma.ticketMessage.findMany.mockResolvedValue([]);
  prisma.ticketMessage.findFirst.mockResolvedValue(null);
  prisma.ticketMessage.count.mockResolvedValue(0);
  prisma.ticketMessage.create.mockImplementation(async ({ data }) => ({ id: 'm1', ...data }));
  await getSupportRequest({ id: 'ticket-1' }, { user });
  await listSupportMessages({ id: 'ticket-1' }, { user });
  await sendSupportMessage({ id: 'ticket-1', content: 'Merci' }, { user });
  expect(prisma.ticketMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ authorType: 'TECH' })
  }));
  expect(prisma.ticketMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ authorType: 'REPORTER' }) });
});

test('répond côté support pour un administrateur', async () => {
  const admin = { ...user, role: 'ADMIN' };
  prisma.intervention.findFirst.mockResolvedValue({ id: 'ticket-1', techId: null });
  prisma.ticketMessage.create.mockImplementation(async ({ data }) => ({ id: 'm1', ...data }));
  await sendSupportMessage({ id: 'ticket-1', content: 'Nous intervenons' }, { user: admin });
  expect(prisma.ticketMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ authorType: 'TECH' }) });
});

test('refuse un ticket absent du périmètre accessible', async () => {
  prisma.intervention.findFirst.mockResolvedValue(null);
  await expect(listSupportMessages({ id: 'secret' }, { user })).rejects.toMatchObject({ status: 404 });
  expect(prisma.ticketMessage.findMany).not.toHaveBeenCalled();
  expect(prisma.intervention.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { AND: [{ id: 'secret', source: 'PUBLIC' }, expect.objectContaining({ OR: expect.any(Array) })] }
  }));
});

test.each([false, true])('retourne une pièce jointe accessible au bon côté du chat (support : %s)', async supportSide => {
  prisma.intervention.findFirst.mockResolvedValue({
    id: 'ticket-1', techId: null, reporterEmail: 'other@example.org', reporterToken: 'other-secret',
    reporters: [{ email: user.email, token: 'alice-token' }]
  });
  prisma.ticketMessage.findMany.mockResolvedValue([{ id: 'm1', attachmentPath: 'ticket-messages/photo.png' }]);
  const messages = await listSupportMessages({ id: 'ticket-1' }, { user: { ...user, role: supportSide ? 'ADMIN' : 'TECH' } });
  expect(messages[0].attachmentUrl).toBe(supportSide
    ? '/api/interventions/ticket-1/attachments/photo.png'
    : '/api/tickets/alice-token/attachments/photo.png');
  expect(JSON.stringify(messages)).not.toContain('other-secret');
  expect(JSON.stringify(messages)).not.toContain('ticket-messages');
});

test('refuse les messages vides et applique la limite du chat aux demandeurs', async () => {
  prisma.intervention.findFirst.mockResolvedValue({ id: 'ticket-1', techId: null });
  await expect(sendSupportMessage({ id: 'ticket-1', content: '   ' }, { user })).rejects.toMatchObject({ status: 400 });
  prisma.ticketMessage.findFirst.mockResolvedValue(null);
  prisma.ticketMessage.count.mockResolvedValue(5);
  await expect(sendSupportMessage({ id: 'ticket-1', content: 'Bonjour' }, { user })).rejects.toMatchObject({ status: 429 });
  expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
});

test('expose les outils de support et exige les scopes appropriés', async () => {
  const { buildMcpServer } = require('../src/mcp/server');
  const server = buildMcpServer({ scopes: [], createdBy: user });
  for (const [name, args] of [
    ['create_support_request', { title: 'Panne de poste' }],
    ['list_support_requests', {}], ['get_support_request', { id: 'ticket-1' }],
    ['list_support_messages', { id: 'ticket-1' }],
    ['send_support_message', { id: 'ticket-1', content: 'Bonjour' }]
  ]) {
    expect(server._registeredTools[name]).toBeDefined();
    const result = await server._registeredTools[name].handler(args);
    expect(result.isError).toBe(true);
  }
  expect(prisma.intervention.create).not.toHaveBeenCalled();
  expect(prisma.intervention.findFirst).not.toHaveBeenCalled();
  expect(prisma.intervention.findMany).not.toHaveBeenCalled();
  const reader = buildMcpServer({ scopes: ['interventions:read'], createdBy: user });
  const denied = await reader._registeredTools.send_support_message.handler({ id: 'ticket-1', content: 'Bonjour' });
  expect(denied.isError).toBe(true);
  const writer = buildMcpServer({ scopes: ['interventions:write'], createdBy: user });
  const result = await writer._registeredTools.create_support_request.handler({ title: 'Panne de poste' });
  expect(JSON.parse(result.content[0].text)).toMatchObject({ id: 'ticket-1', reporterEmail: user.email });
});

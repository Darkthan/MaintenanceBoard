const express = require('express');
const request = require('./helpers/in-process-request');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument, degrees } = require('pdf-lib');
const { prepareHandwrittenDocument, stampHandwrittenSignature } = require('../src/utils/handwrittenSignature');

jest.mock('../src/middleware/auth', () => ({ requireAuth: (req, _res, next) => {
  req.user = { id: req.headers['x-user-id'] || 'owner', role: 'TECH', name: 'Louis', email: 'louis@example.test' }; next();
} }));
jest.mock('../src/lib/prisma', () => ({ signatureRequest: {
  create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn()
} }));
jest.mock('../src/utils/settings', () => ({ readSettings: () => ({}) }));
jest.mock('../src/utils/mail', () => ({ createSmtpTransporter: jest.fn() }));
const prisma = require('../src/lib/prisma');
const { createSmtpTransporter } = require('../src/utils/mail');
const { signaturesRouter, signRouter } = require('../src/routes/signatures');
const app = express();
app.use(express.json({ limit: '3mb' }));
app.use('/api/signatures', signaturesRouter);
app.use('/api/sign', signRouter);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
let tmp, cwdSpy, source, ink, row;

beforeAll(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]).drawText('First page');
  pdf.addPage([400, 600]).drawText('Second page');
  source = Buffer.from(await pdf.save());
  ink = 'data:image/png;base64,' + (await sharp(Buffer.from('<svg width="300" height="100"><path d="M20 70 L100 20 L180 75 L260 30" fill="none" stroke="black" stroke-width="4"/></svg>')).png().toBuffer()).toString('base64');
});
beforeEach(() => {
  jest.clearAllMocks();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-handwritten-'));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
  row = null;
  prisma.signatureRequest.create.mockImplementation(async ({ data }) => (row = { ...data, id: 'signature-1', status: 'PENDING' }));
  prisma.signatureRequest.findUnique.mockImplementation(async () => row);
  prisma.signatureRequest.update.mockImplementation(async ({ data }) => Object.assign(row, data));
  prisma.signatureRequest.updateMany.mockImplementation(async ({ where, data }) => {
    if (row.status !== where.status) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
});
afterEach(() => {
  cwdSpy.mockRestore();
  // Only remove the dedicated, resolved test directory under the OS temp root.
  if (!path.resolve(tmp).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(tmp).startsWith('mb-handwritten-')) throw Error('Unsafe cleanup path');
  fs.rmSync(tmp, { recursive: true, force: true });
});
const create = () => request(app).post('/api/signatures/handwritten')
  .field('documentTitle', 'Devis reçu').field('signaturePage', '1')
  .field('posX', '0.2').field('posY', '0.3').field('sigWidth', '0.4').field('sigHeight', '0.15')
  .attach('file', source, { filename: 'devis.pdf', contentType: 'application/pdf' });

test('imports an attachment, returns a QR link, and never sends an email', async () => {
  const res = await create();
  expect(res.status).toBe(201);
  expect(res.body.qrCode).toMatch(/^data:image\/png;base64,/);
  expect(res.body.signUrl).toContain(row.token);
  expect(row.verificationMethod).toBe('HANDWRITTEN_LINK');
  expect(row.signaturePage).toBe(1);
  expect(new Date(row.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  expect(createSmtpTransporter).not.toHaveBeenCalled();
  const info = await request(app).get('/api/sign/' + row.token);
  expect(info.body).toMatchObject({ requiresOtp: false, handwritten: true });
});

test('signs once, preserves the page count, and provides the resulting PDF to its owner', async () => {
  await create();
  const original = await PDFDocument.load(source);
  const res = await request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData: ink, consent: true });
  expect(res.status).toBe(200);
  expect(row.status).toBe('SIGNED');
  const signed = fs.readFileSync(path.join(tmp, 'uploads/signatures/signed', row.id, row.signedFileStoredAs));
  const pdf = await PDFDocument.load(signed);
  expect(pdf.getPageCount()).toBe(original.getPageCount());
  expect(pdf.getPage(0).node.Resources().lookup(require('pdf-lib').PDFName.of('XObject')).keys()).toHaveLength(1);
  expect(pdf.getPage(1).getSize()).toEqual(original.getPage(1).getSize());
  expect((await request(app).get(`/api/signatures/${row.id}/download`)).status).toBe(200);
  expect((await request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData: ink, consent: true })).status).toBe(409);
});

test('protects phone links and downloads from another user', async () => {
  await create();
  for (const suffix of ['phone-link', 'download']) expect((await request(app).get(`/api/signatures/${row.id}/${suffix}`).set('x-user-id', 'other')).status).toBe(403);
});

test('allows only one of two simultaneous submissions to generate a signed PDF', async () => {
  await create();
  const results = await Promise.all([1, 2].map(() => request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData: ink, consent: true })));
  expect(results.filter(result => result.status === 200)).toHaveLength(1);
  expect(results.filter(result => [409, 410].includes(result.status))).toHaveLength(1);
  expect(fs.readdirSync(path.join(tmp, 'uploads/signatures/signed', row.id))).toHaveLength(1);
});

test('requires consent and rejects blank or invalid ink', async () => {
  await create();
  expect((await request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData: ink })).status).toBe(400);
  const blank = 'data:image/png;base64,' + (await sharp({ create: { width: 100, height: 50, channels: 4, background: '#ffffff00' } }).png().toBuffer()).toString('base64');
  for (const signatureData of ['invalid', blank]) expect((await request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData, consent: true })).status).toBe(400);
  expect(row.status).toBe('PENDING');
});

test('rejects expired, cancelled, or already claimed links', async () => {
  await create();
  row.expiresAt = new Date(0);
  expect((await request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData: ink, consent: true })).status).toBe(410);
  row.expiresAt = new Date(Date.now() + 60000);
  for (const status of ['CANCELLED', 'SIGNING']) {
    row.status = status;
    expect((await request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData: ink, consent: true })).status).toBe(410);
  }
});

test('releases the one-use claim if the original document becomes unavailable', async () => {
  await create();
  fs.unlinkSync(path.join(tmp, 'uploads/signatures/source', row.id, row.sourceFileStoredAs));
  expect((await request(app).post(`/api/sign/${row.token}/submit`).send({ signatureData: ink, consent: true })).status).toBe(404);
  expect(row.status).toBe('PENDING');
});

test.each([{ signaturePage: '0' }, { signaturePage: '3' }, { posX: 'NaN' }, { sigWidth: '0' }, { posX: '0.9', sigWidth: '0.4' }])('rejects invalid placement %j', async body => {
  await expect(prepareHandwrittenDocument({ buffer: source, mimetype: 'application/pdf' }, body)).rejects.toMatchObject({ status: 400 });
});

test('rejects missing, unreadable and office files before creating a request', async () => {
  expect((await request(app).post('/api/signatures/handwritten')).status).toBe(400);
  for (const mimetype of ['application/pdf', 'application/msword']) await expect(prepareHandwrittenDocument({ buffer: Buffer.from('invalid'), mimetype }, {})).rejects.toMatchObject({ status: 400 });
  expect(prisma.signatureRequest.create).not.toHaveBeenCalled();
});

test.each([0, 90, 180, 270])('preserves rotated original pages (%s degrees)', async angle => {
  const original = await PDFDocument.create();
  original.addPage([400, 600]).setRotation(degrees(angle));
  const bytes = await stampHandwrittenSignature(await original.save(), ink, { signaturePage: 1, posX: .2, posY: .3, sigWidth: .4, sigHeight: .15 });
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getRotation().angle).toBe(angle);
});

test('converts a photo into a PDF and stamps it without a certificate page', async () => {
  const prepared = await prepareHandwrittenDocument({ buffer: Buffer.from(ink.split(',')[1], 'base64'), mimetype: 'image/png' }, {});
  const signed = await stampHandwrittenSignature(prepared.buffer, ink, prepared.placement);
  expect((await PDFDocument.load(signed)).getPageCount()).toBe(1);
});

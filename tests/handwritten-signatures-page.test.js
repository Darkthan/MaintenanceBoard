const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../public/signatures.html'), 'utf8');
function harness() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const classes = new Set(['hidden']);
      nodes.set(id, { value: '', textContent: '', innerHTML: '', disabled: false, required: true, reset() {},
        classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n),
          toggle(n, force) { if (force) classes.add(n); else classes.delete(n); } } });
    }
    return nodes.get(id);
  };
  const c = { document: { getElementById: get, querySelector: get }, handwrittenMode: false,
    selectedFile: null, placementReady: true, SigPlacement: { DEFAULT_POS: {}, getPos: () => ({ x: .2, y: .3, w: .4, h: .15 }) },
    clearFile: jest.fn(), FormData, fetch: jest.fn(), loadSignatures: jest.fn(), showPhoneSignature: jest.fn(), showToast: jest.fn() };
  for (const name of ['openNewSigModal', 'submitNewSig']) {
    const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?(?=\\n(?:async )?function )'));
    vm.runInNewContext(match[0], c);
  }
  return { c, get };
}

test('offers a personal handwritten flow without required recipient email', () => {
  const { c, get } = harness();
  c.openNewSigModal(true);
  expect(get('form-recipient-email').required).toBe(false);
  expect(get('signature-recipient-fields').classList.contains('hidden')).toBe(true);
  c.openNewSigModal();
  expect(get('form-recipient-email').required).toBe(true);
  expect(get('signature-recipient-fields').classList.contains('hidden')).toBe(false);
});

test('sends the chosen PDF page and rectangle to the phone route, then opens the QR', async () => {
  const { c, get } = harness();
  c.handwrittenMode = true;
  c.selectedFile = new Blob(['PDF'], { type: 'application/pdf' });
  get('signature-page').value = '2';
  get('form-title').value = 'Document reçu';
  const result = { signUrl: 'https://example.test/sign.html?token=test' };
  c.fetch.mockResolvedValue({ ok: true, json: async () => result });
  await c.submitNewSig({ preventDefault() {} });
  expect(c.fetch.mock.calls[0][0]).toBe('/api/signatures/handwritten');
  const data = c.fetch.mock.calls[0][1].body;
  expect(data.get('signaturePage')).toBe('2');
  expect(data.get('posX')).toBe('0.2');
  expect(c.showPhoneSignature).toHaveBeenCalledWith(result);
});

test('blocks submission while a document preview is unavailable', async () => {
  const { c, get } = harness();
  c.handwrittenMode = true;
  c.selectedFile = new Blob(['PDF'], { type: 'application/pdf' });
  c.placementReady = false;
  await c.submitNewSig({ preventDefault() {} });
  expect(c.fetch).not.toHaveBeenCalled();
  expect(get('form-error').classList.contains('hidden')).toBe(false);
});

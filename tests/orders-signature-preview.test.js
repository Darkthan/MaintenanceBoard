const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PDFDocument } = require('pdf-lib');

const source = fs.readFileSync(path.join(__dirname, '../public/orders.html'), 'utf8');

function harness(blob, mime) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', innerHTML: '', clientWidth: 500,
      parentElement: { clientWidth: 800 }, appendChild: jest.fn(),
      classList: { add() {}, remove() {} }
    });
    return nodes.get(id);
  };
  const page = {
    getViewport: ({ scale }) => ({ width: 400 * scale, height: 600 * scale }),
    render: jest.fn(() => ({ promise: Promise.resolve() }))
  };
  const pdf = { numPages: 2, getPage: jest.fn().mockResolvedValue(page) };
  const context = {
    document: { getElementById: get, createElement: () => ({ style: {}, getContext: () => ({}) }) },
    detailOrderId: 'order-1', attachSigAttachId: 'attachment-1',
    attachSigMime: mime, attachSigFilename: 'document.pdf', attachSigBlobUrl: null,
    fetch: jest.fn().mockResolvedValue({ ok: true, blob: async () => blob }),
    URL: { createObjectURL: jest.fn(() => 'blob:image-preview'), revokeObjectURL: jest.fn() },
    Uint8Array, requestAnimationFrame: callback => callback(), setTimeout: callback => callback(),
    SigPlacement: { destroy: jest.fn(), init: jest.fn(), getPos: () => ({ x: .2, y: .3, w: .4, h: .1 }) },
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: jest.fn(options => {
      // Simulate the application's CSP: blob URL fetches cannot load PDFs.
      if (!options.data) throw Error('Blocked by connect-src');
      return { promise: Promise.resolve(pdf) };
    }) }
  };
  context.Image = function () {
    this.style = {};
    Object.defineProperty(this, 'src', { set() { this.onload(); } });
  };
  vm.createContext(context);
  for (const name of ['openAttachSigModal', 'loadAttachPreview', 'openSigEditorWindow', 'loadAttachPreviewForEditor']) {
    const match = source.match(new RegExp('async function ' + name + '\\([^]*?(?=\\n(?:async )?function )'));
    vm.runInContext(match[0], context);
  }
  return { context, get, pdf, page };
}

test.each(['dialog', 'editor'])('renders the last PDF page in the %s without a blob fetch', async view => {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  document.addPage([400, 600]);
  const bytes = await document.save();
  const { context, get, pdf, page } = harness(new Blob([bytes], { type: 'application/pdf' }), 'application/pdf');
  if (view === 'dialog') {
    await context.openAttachSigModal({ dataset: { attachId: 'attachment-1', attachMime: 'application/pdf', attachName: 'document.pdf' } });
  } else await context.openSigEditorWindow();

  expect(context.fetch).toHaveBeenCalledWith('/api/orders/order-1/attachments/attachment-1', { credentials: 'include' });
  expect(context.pdfjsLib.getDocument).toHaveBeenCalledWith({ data: bytes });
  expect(context.URL.createObjectURL).not.toHaveBeenCalled();
  expect(pdf.getPage).toHaveBeenCalledWith(2);
  expect(page.render).toHaveBeenCalled();
  const container = get(view === 'dialog' ? 'attach-placement-container' : 'sig-editor-container');
  expect(container.appendChild).toHaveBeenCalled();
  expect(context.SigPlacement.init).toHaveBeenCalledWith(container, expect.any(Object));
});

test.each(['dialog', 'editor'])('still renders image attachments in the %s', async view => {
  const { context, get } = harness(new Blob(['image'], { type: 'image/png' }), 'image/png');
  if (view === 'dialog') {
    await context.openAttachSigModal({ dataset: { attachId: 'attachment-1', attachMime: 'image/png', attachName: 'document.png' } });
  } else await context.openSigEditorWindow();
  expect(context.URL.createObjectURL).toHaveBeenCalled();
  expect(context.pdfjsLib.getDocument).not.toHaveBeenCalled();
  expect(get(view === 'dialog' ? 'attach-placement-container' : 'sig-editor-container').appendChild).toHaveBeenCalled();
});

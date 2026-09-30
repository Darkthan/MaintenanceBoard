const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup(count) {
  const html = fs.readFileSync(path.join(__dirname, '../public/printer-logs.html'), 'utf8');
  const elements = {};
  let submit;
  const element = id => elements[id] ||= {
    disabled: false, children: [], textContent: '',
    files: Array.from({ length: count }, (_, i) => ({ name: `${i}.csv` })),
    addEventListener: (_event, callback) => { submit = callback; },
    replaceChildren() { this.children = []; },
    appendChild(item) { this.children.push(item); }
  };
  const upload = jest.fn().mockResolvedValue({ printer: { name: 'C2' }, imported: 2, updated: 1, unchanged: 3 });
  const load = jest.fn();
  const context = {
    $: element, api: { upload }, page: 1, number: String,
    FormData: class { append(key, value) { this[key] = value; } },
    document: { createElement: () => ({ textContent: '' }) },
    loadFilters: jest.fn(), load, showToast: jest.fn()
  };
  vm.runInNewContext(html.slice(html.indexOf("$('import-form').addEventListener"), html.indexOf('\n\nrequireLogin()')), context);
  return { submit: () => submit({ preventDefault() {} }), element, upload, load };
}

test('importe les 42 fichiers sélectionnés et additionne leurs résultats', async () => {
  const page = setup(42);
  await page.submit();
  expect(page.upload).toHaveBeenCalledTimes(42);
  expect(page.upload.mock.calls.map(([, data]) => data.file.name)).toEqual(Array.from({ length: 42 }, (_, i) => `${i}.csv`));
  expect(page.element('import-result').textContent).toContain('42/42 fichiers traités, 0 en échec. 84 nouvelles opérations');
  expect(page.element('import-details').children).toHaveLength(42);
  expect(page.load).toHaveBeenCalledTimes(1);
  expect(page.element('csv-file').disabled).toBe(false);
});

test('signale un fichier invalide et poursuit les autres imports', async () => {
  const page = setup(3);
  page.upload.mockRejectedValueOnce(new Error('CSV invalide'));
  await page.submit();
  expect(page.upload).toHaveBeenCalledTimes(3);
  expect(page.element('import-result').textContent).toContain('2/3 fichiers traités, 1 en échec');
  expect(page.element('import-details').children[0].textContent).toContain('0.csv — Échec : CSV invalide');
  expect(page.element('import-button').disabled).toBe(false);
});

test('empêche un deuxième import pendant le traitement', async () => {
  const page = setup(1);
  page.element('import-button').disabled = true;
  await page.submit();
  expect(page.upload).not.toHaveBeenCalled();
});

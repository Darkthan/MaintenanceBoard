const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');

test.each(['/printer-logs.html', '/printer-import.html', '/printer-settings.html', '/printer-charts.html'])('le gestionnaire peut ouvrir %s sans redirection', async pathname => {
  const user = { role: 'PRINT_MANAGER' };
  const context = { _currentUser: user, window: { location: { pathname, href: '' } } };
  const source = read('js/api.js');
  vm.runInNewContext(source.slice(source.indexOf('async function requireLogin()'), source.indexOf('function initUserNav')), context);
  expect(await context.requireLogin()).toBe(user);
  expect(context.window.location.href).toBe('');
});

test('le bouton + ouvre les actions et Échap les ferme en restaurant le focus', () => {
  const elements = {};
  const documentEvents = {};
  const element = id => elements[id] ||= {
    attributes: { 'aria-expanded': 'false' }, style: {}, events: {},
    classList: { toggle: jest.fn() }, focus: jest.fn(),
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    addEventListener(event, handler) { this.events[event] = handler; },
    contains: () => false
  };
  const context = { $: element, document: { addEventListener: (event, handler) => { documentEvents[event] = handler; } } };
  const html = read('printer-logs.html');
  vm.runInNewContext(html.slice(html.indexOf('function setPrinterActionsOpen'), html.indexOf('requireLogin().then')), context);
  element('printer-actions-button').events.click();
  expect(element('printer-actions-button').attributes['aria-expanded']).toBe('true');
  expect(element('printer-actions-menu').classList.toggle).toHaveBeenLastCalledWith('hidden', false);
  documentEvents.keydown({ key: 'Escape' });
  expect(element('printer-actions-button').attributes['aria-expanded']).toBe('false');
  expect(element('printer-actions-button').focus).toHaveBeenCalledTimes(1);
  element('printer-actions-button').events.click();
  documentEvents.click({ target: {} });
  expect(element('printer-actions-menu').classList.toggle).toHaveBeenLastCalledWith('hidden', true);
});

test.each(['printer-import.html', 'printer-settings.html'])('un technicien est redirigé depuis %s sans charger la gestion', async file => {
  const context = {
    requireLogin: async () => ({ role: 'TECH' }),
    window: { location: { href: '' } },
    renderNav: jest.fn(), loadFilters: jest.fn(), showToast: jest.fn()
  };
  const html = read(file);
  await vm.runInNewContext(html.slice(html.indexOf('requireLogin().then'), html.indexOf('</script>', html.indexOf('requireLogin().then'))), context);
  expect(context.window.location.href).toBe('/printer-logs.html');
  expect(context.loadFilters).not.toHaveBeenCalled();
  expect(context.renderNav).not.toHaveBeenCalled();
});

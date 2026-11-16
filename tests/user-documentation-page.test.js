const fs = require('fs');
const path = require('path');
const vm = require('vm');

it('initialise la navigation et charge les guides utilisateurs', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/user-documentation.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim());
  expect(scripts.length).toBeGreaterThan(0);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '',
      classList: { toggle: jest.fn(), add: jest.fn() },
      querySelector: jest.fn(() => ({})),
      addEventListener: jest.fn(),
      replaceChildren: jest.fn()
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    requireLogin: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
    renderNav: jest.fn(),
    api: { get: jest.fn().mockResolvedValue({ items: [] }) }
  });

  const layout = fs.readFileSync(path.join(__dirname, '../public/js/layout.js'), 'utf8');
  const sharedEscapeHtml = layout.match(/function escapeHtml\([^]*?\n\}/)[0];
  new vm.Script(sharedEscapeHtml).runInContext(context);

  for (const script of scripts) await new vm.Script(script).runInContext(context);

  expect(context.renderNav).toHaveBeenCalledWith('user-documentation');
  expect(context.api.get).toHaveBeenCalledWith('/user-documentation', { q: '' });
  expect(element('articles').replaceChildren).toHaveBeenCalled();
});

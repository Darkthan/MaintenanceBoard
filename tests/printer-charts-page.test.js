const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const element = () => ({
    children: [], attributes: {}, textContent: '', clientWidth: 720, scrollWidth: 720, scrollLeft: 0,
    scrollBy: jest.fn(),
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    setAttribute(key, value) { this.attributes[key] = value; }
  });
  const elements = {};
  const context = {
    $: id => elements[id] ||= element(),
    number: value => String(value),
    document: { createElement: element, createElementNS: element }
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/printer-charts.js'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('function periodLabel'), source.indexOf('async function load()')), context);
  return { context, elements };
}

test('affiche les trois compteurs empilés et leurs valeurs dans le tableau', () => {
  const { context, elements } = setup();
  context.renderChart({ interval: 'month', totals: { printCount: 100 }, rows: [
    { period: '2025-01', blackCount: 60, colorCount: 30, otherCount: 10, printCount: 100 }
  ] });
  expect(elements['chart-total'].textContent).toBe('100');
  const svg = elements.chart.children[0];
  const group = svg.children.find(child => child.children.some(item => item.attributes.fill === '#334155'));
  expect(group.children.slice(1).map(child => child.attributes.height)).toEqual([147, 73.5, 24.5]);
  expect(elements['period-rows'].children[0].children.slice(1).map(td => td.textContent)).toEqual(['60', '30', '10', '100']);
});

test('efface le graphique précédent si la sélection ne contient aucune impression', () => {
  const { context, elements } = setup();
  context.renderChart({ interval: 'day', totals: { printCount: 0 }, rows: [] });
  expect(elements.chart.children).toEqual([]);
  expect(elements['period-rows'].children).toEqual([]);
  expect(elements['chart-status'].textContent).toContain('Aucune impression');
  expect(elements['chart-title'].textContent).toBe('Faces imprimées par jour');
});

test('l’ordonnée suit le maximum visible lors du défilement et conserve toutes les périodes', () => {
  const { context, elements } = setup();
  context.$('chart').clientWidth = 72;
  context.$('chart').scrollWidth = 216;
  context.renderChart({ interval: 'month', totals: { printCount: 1600 }, rows: [
    { period: '2025-01', blackCount: 100, colorCount: 0, otherCount: 0, printCount: 100 },
    { period: '2025-02', blackCount: 1000, colorCount: 0, otherCount: 0, printCount: 1000 },
    { period: '2025-03', blackCount: 500, colorCount: 0, otherCount: 0, printCount: 500 }
  ] });
  expect(elements['chart-axis'].children[0].children.at(-1).textContent).toBe('100');
  expect(elements['chart-left'].disabled).toBe(true);
  expect(elements['chart-right'].disabled).toBe(false);
  elements.chart.scrollLeft = 144;
  context.updateChartViewport();
  expect(elements['chart-axis'].children[0].children.at(-1).textContent).toBe('500');
  expect(elements['chart-left'].disabled).toBe(false);
  expect(elements['chart-right'].disabled).toBe(true);
  expect(elements['period-rows'].children).toHaveLength(3);
  expect(elements['chart-total'].textContent).toBe('1600');
});

test('les flèches font défiler le graphique dans les deux directions', () => {
  const { context, elements } = setup();
  context.navigateChart(1);
  context.navigateChart(-1);
  expect(elements.chart.scrollBy.mock.calls).toEqual([
    [{ left: 576, behavior: 'smooth' }], [{ left: -576, behavior: 'smooth' }]
  ]);
});

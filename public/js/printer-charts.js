const $ = id => document.getElementById(id);
const selectedPrinters = new Set();
const selectedOwners = new Set();
const number = value => Number(value || 0).toLocaleString('fr-FR');
let requestVersion = 0;
function renderMultipleFilter(prefix, options, selected, allLabel, selectedLabel) {
  const available = new Set(options.map(option => option.value));
  for (const value of selected) if (!available.has(value)) selected.delete(value);
  const updateLabel = () => {
    $(prefix + '-selection').textContent = selected.size === 0 ? allLabel
      : selected.size === 1 ? options.find(option => selected.has(option.value)).label
      : `${selected.size} ${selectedLabel}`;
  };
  $(prefix + '-options').replaceChildren();
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'flex cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-slate-50';
    label.dataset.search = option.label.toLocaleLowerCase('fr');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = option.value;
    input.checked = selected.has(option.value);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(option.value); else selected.delete(option.value);
      updateLabel();
      load();
    });
    label.append(input, option.label);
    $(prefix + '-options').appendChild(label);
  }
  updateLabel();
  $(prefix + '-search').dispatchEvent(new Event('input'));
}

for (const [prefix, selected, clearId, allLabel] of [
  ['printer', selectedPrinters, 'clear-printers', 'Toutes'],
  ['owner', selectedOwners, 'clear-owners', 'Tous']
]) {
  $(prefix + '-search').addEventListener('input', event => {
    const text = event.target.value.toLocaleLowerCase('fr');
    for (const label of $(prefix + '-options').children) label.style.display = label.dataset.search.includes(text) ? '' : 'none';
  });
  $(clearId).addEventListener('click', () => {
    selected.clear();
    for (const input of $(prefix + '-options').querySelectorAll('input')) input.checked = false;
    $(prefix + '-selection').textContent = allLabel;
    load();
  });
}
document.addEventListener('click', event => {
  for (const id of ['printer-filter', 'owner-filter']) if (!$(id).contains(event.target)) $(id).open = false;
});


function periodLabel(period) {
  return new Date(period + (period.length === 7 ? '-01' : '') + 'T00:00:00Z').toLocaleDateString('fr-FR', {
    timeZone: 'UTC', year: 'numeric', month: period.length === 7 ? 'short' : '2-digit',
    ...(period.length === 10 ? { day: '2-digit' } : {})
  });
}
function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
let chartView = null;
function updateChartViewport() {
  const chart = $('chart');
  $('chart-left').disabled = !chartView || chart.scrollLeft <= 1;
  $('chart-right').disabled = !chartView || chart.scrollLeft + chart.clientWidth >= chart.scrollWidth - 1;
  if (!chartView) { $('chart-range').textContent = ''; return; }
  const { rows, step, bars, ticks } = chartView;
  const left = chart.scrollLeft;
  const right = left + (chart.clientWidth || 720);
  const visible = rows.map((row, index) => ({ row, index })).filter(({ index }) =>
    index * step + step * 0.82 > left && index * step + step * 0.18 < right);
  const max = visible.reduce((maximum, { row }) => Math.max(maximum, row.printCount), 1);
  ticks.forEach((tick, index) => { tick.textContent = number(Math.round(max * index / 4)); });
  bars.forEach((segments, index) => {
    let y = 275;
    segments.forEach(({ rect, key }) => {
      const height = rows[index][key] / max * 245;
      y -= height;
      rect.setAttribute('y', y);
      rect.setAttribute('height', height);
    });
  });
  $('chart-range').textContent = visible.length
    ? periodLabel(visible[0].row.period) + ' – ' + periodLabel(visible.at(-1).row.period) : '';
}
function navigateChart(direction) {
  const chart = $('chart');
  chart.scrollBy({ left: direction * Math.max(72, chart.clientWidth * 0.8), behavior: 'smooth' });
}
function renderChart(data) {
  chartView = null;
  $('chart').replaceChildren();
  $('chart-axis').replaceChildren();
  $('chart').scrollLeft = 0;
  $('period-rows').replaceChildren();
  $('chart-total').textContent = number(data.totals.printCount);
  $('chart-title').textContent = data.interval === 'month' ? 'Faces imprimées par mois' : 'Faces imprimées par jour';
  $('chart-status').textContent = data.rows.length ? 'L’échelle suit le maximum des périodes visibles. Utilisez les flèches ou faites défiler le graphique. Survolez une barre pour voir les compteurs.' : 'Aucune impression pour ces filtres.';
  if (!data.rows.length) { updateChartViewport(); return; }
  const width = Math.max($('chart').clientWidth || 720, data.rows.length * 72);
  const svg = svgElement('svg', { width, height: 340, viewBox: '0 0 ' + width + ' 340', role: 'img', 'aria-label': $('chart-title').textContent });
  svg.appendChild(svgElement('title', {}, 'Noir et blanc, couleur et auto / autre. Valeurs détaillées dans le tableau suivant.'));
  const axis = svgElement('svg', { width: 64, height: 340, viewBox: '0 0 64 340' });
  const ticks = [];
  const bars = [];
  const plotHeight = 245;
  for (let tick = 0; tick <= 4; tick++) {
    const y = 275 - tick * plotHeight / 4;
    svg.appendChild(svgElement('line', { x1: 0, y1: y, x2: width, y2: y, stroke: '#e2e8f0' }));
    const label = svgElement('text', { x: 58, y: y + 4, 'text-anchor': 'end', fill: '#64748b', 'font-size': 11 });
    ticks.push(label);
    axis.appendChild(label);
  }
  const step = width / data.rows.length;
  data.rows.forEach((row, index) => {
    const x = index * step + step * 0.18;
    const barWidth = step * 0.64;
    const segments = [];
    const group = svgElement('g');
    group.appendChild(svgElement('title', {}, periodLabel(row.period) + ' : ' + number(row.printCount) + ' faces — Noir et blanc : ' + number(row.blackCount) + ', couleur : ' + number(row.colorCount) + ', auto / autre : ' + number(row.otherCount)));
    for (const [key, color] of [['blackCount', '#334155'], ['colorCount', '#2563eb'], ['otherCount', '#d97706']]) {
      const rect = svgElement('rect', { x, width: barWidth, fill: color });
      segments.push({ rect, key });
      group.appendChild(rect);
    }
    bars.push(segments);
    svg.appendChild(group);
    svg.appendChild(svgElement('text', { x: x + barWidth / 2, y: 294, transform: 'rotate(35 ' + (x + barWidth / 2) + ' 294)', fill: '#475569', 'font-size': 11 }, periodLabel(row.period)));
    const tr = document.createElement('tr');
    for (const [i, value] of [periodLabel(row.period), row.blackCount, row.colorCount, row.otherCount, row.printCount].entries()) {
      const td = document.createElement('td');
      td.className = 'p-3' + (i === 0 ? ' text-left' : '');
      td.textContent = i === 0 ? value : number(value);
      tr.appendChild(td);
    }
    $('period-rows').appendChild(tr);
  });
  $('chart').appendChild(svg);
  $('chart-axis').appendChild(axis);
  chartView = { rows: data.rows, step, bars, ticks };
  updateChartViewport();
}
async function load() {
  const version = ++requestVersion;
  const params = new URLSearchParams({ interval: $('interval-filter').value });
  for (const id of selectedPrinters) params.append('printerId', id);
  for (const owner of selectedOwners) params.append('ownerName', owner);
  for (const [id, key] of [['kind-filter', 'jobKind'], ['from-filter', 'from'], ['to-filter', 'to']]) if ($(id).value) params.set(key, $(id).value);
  $('chart-status').textContent = 'Chargement…';
  try {
    const data = await api.get('/printer-logs/timeline?' + params);
    if (version === requestVersion) renderChart(data);
  } catch (error) {
    if (version !== requestVersion) return;
    $('chart').replaceChildren();
    $('chart-axis').replaceChildren();
    chartView = null;
    updateChartViewport();
    $('period-rows').replaceChildren();
    $('chart-total').textContent = '—';
    $('chart-status').textContent = error.message;
    showToast(error.message, 'error');
  }
}
$('chart-left').addEventListener('click', () => navigateChart(-1));
$('chart-right').addEventListener('click', () => navigateChart(1));
$('chart').addEventListener('scroll', updateChartViewport, { passive: true });
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateChartViewport).observe($('chart'));
else window.addEventListener('resize', updateChartViewport);
for (const id of ['interval-filter', 'kind-filter', 'from-filter', 'to-filter']) $(id).addEventListener('change', load);
requireLogin().then(async () => {
  renderNav('printer-charts');
  $('interval-filter').value = 'month';
  for (const id of ['kind-filter', 'from-filter', 'to-filter']) $(id).value = '';
  const data = await api.get('/printer-logs/filters');
  renderMultipleFilter('printer', data.printers.map(item => ({ value: item.id, label: item.name + ' (' + item.serial + ')' })), selectedPrinters, 'Toutes', 'imprimantes sélectionnées');
  renderMultipleFilter('owner', data.owners.map(name => ({ value: name, label: name })), selectedOwners, 'Tous', 'utilisateurs sélectionnés');
  await load();
}).catch(error => showToast(error.message, 'error'));

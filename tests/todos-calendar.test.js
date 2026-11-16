const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../public/todos.html'), 'utf8');
const calendarFunctions = html.slice(
  html.indexOf('function getTodoDayKey('),
  html.indexOf('function changeTodoCalendarMonth(')
);

function todosForDay(todos, dayKey) {
  const context = vm.createContext({ allTodos: todos, dayKey });
  vm.runInContext(calendarFunctions, context);
  return vm.runInContext('getTodosForDay(dayKey)', context).map(todo => todo.id);
}

describe('calendrier des tâches : périodes inclusives', () => {
  const period = { id: 'period', startAt: '2026-11-30T12:00:00Z', dueAt: '2026-12-02T12:00:00Z' };

  it.each(['2026-11-30', '2026-12-01', '2026-12-02'])(
    'affiche la tâche le %s, même entre deux mois', day => {
      expect(todosForDay([period], day)).toEqual(['period']);
    }
  );

  it.each(['2026-11-29', '2026-12-03'])(
    'exclut les jours hors période : %s', day => {
      expect(todosForDay([period], day)).toEqual([]);
    }
  );

  it('affiche une seule fois une tâche qui commence et finit le même jour', () => {
    const todo = { id: 'single', startAt: '2026-11-16', dueAt: '2026-11-16' };
    expect(todosForDay([todo], '2026-11-16')).toEqual(['single']);
  });

  it('conserve les tâches avec une seule date sur ce jour uniquement', () => {
    const todos = [
      { id: 'start', startAt: '2026-11-16' },
      { id: 'due', dueAt: '2026-11-16' },
      { id: 'undated' }
    ];
    expect(todosForDay(todos, '2026-11-16')).toEqual(['start', 'due']);
    expect(todosForDay(todos, '2026-11-17')).toEqual([]);
  });

  it('couvre les jours du changement d’heure', () => {
    const todo = { id: 'dst', startAt: '2026-10-24T12:00:00Z', dueAt: '2026-10-26T12:00:00Z' };
    expect(todosForDay([todo], '2026-10-25')).toEqual(['dst']);
  });
});

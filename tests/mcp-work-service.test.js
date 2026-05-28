jest.mock('../src/lib/prisma', () => ({
  intervention: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  equipment: { updateMany: jest.fn() },
  todo: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  project: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  kanbanColumn: { findFirst: jest.fn(), create: jest.fn() },
  kanbanCard: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() }
}));

const prisma = require('../src/lib/prisma');
const { parseScopes, serializeScopes } = require('../src/utils/mcpTokens');
const work = require('../src/mcp/workService');

describe('MCP work service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepte les nouveaux scopes MCP', () => {
    expect(parseScopes(serializeScopes([
      'interventions:read',
      'interventions:write',
      'todos:read',
      'todos:write',
      'projects:read',
      'projects:write',
      'bogus'
    ]))).toEqual([
      'interventions:read',
      'interventions:write',
      'todos:read',
      'todos:write',
      'projects:read',
      'projects:write'
    ]);
  });

  it('crée une intervention standard et met l’équipement en réparation', async () => {
    prisma.intervention.create.mockImplementation(async ({ data }) => ({
      id: 'int-1',
      ...data,
      kind: data.kind || 'STANDARD',
      source: 'INTERNAL',
      room: null,
      equipment: { id: data.equipmentId, name: 'PC 01', type: 'PC' },
      tech: { id: data.techId, name: 'Tech' },
      _count: { todos: 0, messages: 0, orders: 0 },
      createdAt: new Date('2030-01-01T08:00:00Z'),
      updatedAt: new Date('2030-01-01T08:00:00Z')
    }));
    prisma.equipment.updateMany.mockResolvedValue({ count: 1 });

    const out = await work.createIntervention({
      title: 'Remplacer alimentation',
      equipmentId: 'eq-1',
      priority: 'HIGH'
    }, { userId: 'u1' });

    expect(prisma.intervention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'Remplacer alimentation',
        kind: 'STANDARD',
        status: 'OPEN',
        priority: 'HIGH',
        equipmentId: 'eq-1',
        techId: 'u1'
      })
    }));
    expect(prisma.equipment.updateMany).toHaveBeenCalledWith({
      where: { id: 'eq-1', status: 'ACTIVE' },
      data: { status: 'REPAIR' }
    });
    expect(out.id).toBe('int-1');
  });

  it('crée une tâche liée à une intervention', async () => {
    prisma.intervention.findUnique.mockResolvedValue({ id: 'int-1' });
    prisma.todo.create.mockImplementation(async ({ data }) => ({
      id: 'todo-1',
      ...data,
      done: false,
      doneAt: null,
      intervention: { id: data.interventionId, title: 'Intervention', status: 'OPEN', priority: 'NORMAL' },
      createdAt: new Date('2030-01-01T08:00:00Z')
    }));

    const out = await work.createTodo({
      title: 'Commander pièce',
      interventionId: 'int-1',
      dueAt: '2030-01-02T08:00:00Z'
    });

    expect(prisma.intervention.findUnique).toHaveBeenCalledWith({
      where: { id: 'int-1' },
      select: { id: true }
    });
    expect(prisma.todo.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'Commander pièce',
        interventionId: 'int-1'
      })
    }));
    expect(out.interventionId).toBe('int-1');
  });

  it('crée une carte dans une colonne de projet', async () => {
    prisma.kanbanColumn.findFirst.mockResolvedValue({ id: 'col-1', projectId: 'proj-1', position: 0 });
    prisma.kanbanCard.findFirst.mockResolvedValue({ position: 4 });
    prisma.kanbanCard.create.mockImplementation(async ({ data }) => ({
      id: 'card-1',
      ...data,
      assignee: null,
      column: { id: data.columnId, title: 'À faire' },
      createdAt: new Date('2030-01-01T08:00:00Z'),
      updatedAt: new Date('2030-01-01T08:00:00Z')
    }));

    const out = await work.createProjectCard({
      projectId: 'proj-1',
      columnId: 'col-1',
      title: 'Préparer déploiement',
      priority: 'CRITICAL'
    });

    expect(prisma.kanbanCard.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 'proj-1',
        columnId: 'col-1',
        title: 'Préparer déploiement',
        priority: 'CRITICAL',
        position: 5
      })
    }));
    expect(out.id).toBe('card-1');
  });
});

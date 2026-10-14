const permissions = require('../public/js/mcp-permissions');

describe('Droits MCP par page', () => {
  it('regroupe les anciens et nouveaux droits des emprunts dans une seule page', () => {
    const scopes = ['reservations:read', 'equipment_bookings:read', 'reservations:write', 'equipment_bookings:write'];
    const groups = permissions.groups(scopes);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Emprunts');
    expect(permissions.scopesFor(groups[0], 'read')).toEqual(['reservations:read', 'equipment_bookings:read']);
    expect(new Set(permissions.scopesFor(groups[0], 'write'))).toEqual(new Set(scopes));
  });

  it('associe le niveau complet aux deux droits et permet de tout refuser', () => {
    const [group] = permissions.groups(['equipment:read', 'equipment:write']);
    expect(permissions.scopesFor(group, 'write')).toEqual(['equipment:read', 'equipment:write']);
    expect(permissions.scopesFor(group, 'read')).toEqual(['equipment:read']);
    expect(permissions.scopesFor(group, 'none')).toEqual([]);
  });

  it('ne crée aucun droit supplémentaire si seule la lecture a été demandée', () => {
    const [group] = permissions.groups(['equipment:read', 'offline_access']);
    expect(group.write).toEqual([]);
    expect(permissions.scopesFor(group, 'write')).toEqual(['equipment:read']);
    expect(permissions.summary(['equipment:read'])).toEqual(['Équipements : Lecture']);
    expect(permissions.groups(['offline_access'])).toEqual([]);
  });

  it('décrit les droits historiques en écriture seule sans annoncer la lecture', () => {
    expect(permissions.summary(['stock:write'])).toEqual(['Stock : Écriture et modification']);
  });
});

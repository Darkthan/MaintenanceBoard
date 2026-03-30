const { validateEquipmentRow } = require('../src/services/importService');

describe('validateEquipmentRow agent enhanced import', () => {
  it('accepte une ligne enrichie agent et construit agentInfo', () => {
    const result = validateEquipmentRow({
      hostname: 'pc-cdi-01',
      discoverySource: 'AGENT',
      discoveryStatus: 'PENDING',
      roomNumber: '101',
      suggestedRoomNumber: '202',
      serialNumber: 'SN-AGENT-01',
      brand: 'Dell',
      model: 'OptiPlex 7090',
      agentCpu: 'Intel Core i5',
      agentRamGb: '16',
      agentOs: 'Windows 11',
      agentOsVersion: '23H2',
      agentUser: 'prof.cdi',
      agentIps: '10.0.0.15|192.168.1.15',
      agentMacs: '00:11:22:33:44:55|66:77:88:99:AA:BB',
      agentPeripherals: 'Webcam|Casque',
      agentDisks: '[{"mount":"C:","totalGb":512,"freeGb":120}]',
      lastSeenAt: '2026-03-30T08:15:00Z'
    }, 0);

    expect(result.valid).toBe(true);
    expect(result.data.name).toBe('pc-cdi-01');
    expect(result.data.type).toBe('PC');
    expect(result.data.discoverySource).toBe('AGENT');
    expect(result.data.discoveryStatus).toBe('PENDING');
    expect(result.data.roomNumber).toBe('101');
    expect(result.data.suggestedRoomNumber).toBe('202');
    expect(result.data.agentHostname).toBe('pc-cdi-01');
    expect(result.data.lastSeenAt).toBeInstanceOf(Date);

    const agentInfo = JSON.parse(result.data.agentInfo);
    expect(agentInfo.cpu).toBe('Intel Core i5');
    expect(agentInfo.ramGb).toBe(16);
    expect(agentInfo.os).toBe('Windows 11');
    expect(agentInfo.osVersion).toBe('23H2');
    expect(agentInfo.user).toBe('prof.cdi');
    expect(agentInfo.ips).toEqual(['10.0.0.15', '192.168.1.15']);
    expect(agentInfo.macs).toEqual(['00:11:22:33:44:55', '66:77:88:99:AA:BB']);
    expect(agentInfo.peripherals).toEqual(['Webcam', 'Casque']);
    expect(agentInfo.disks[0]).toMatchObject({ mount: 'C:', totalGb: 512, freeGb: 120 });
  });

  it('rejette un agentDisks invalide', () => {
    const result = validateEquipmentRow({
      name: 'PC-01',
      type: 'PC',
      agentDisks: '{not-json}'
    }, 0);

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('agentDisks'))).toBe(true);
  });
});

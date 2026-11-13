'use strict';

const { randomUUID } = require('crypto');
const prisma = require('../lib/prisma');

// Compare-and-swap also guards against an overlapping review or another check-in.
// The first old hostname is kept until review; every real rename gets a new version.
async function updateAgentEquipment(equipment, hostname, data) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const hostnameData = {};
    if (hostname) {
      hostnameData.agentHostname = hostname;
      if (equipment.agentHostname && equipment.agentHostname.toLowerCase() !== hostname.toLowerCase()) {
        Object.assign(hostnameData, {
          hostnameChangeId: randomUUID(),
          hostnameChangeOld: equipment.hostnameChangeOld || equipment.agentHostname,
          hostnameChangeNew: hostname,
          hostnameChangedAt: new Date()
        });
      }
    }
    try {
      return await prisma.equipment.update({
        where: {
          id: equipment.id,
          agentHostname: equipment.agentHostname || null,
          hostnameChangeId: equipment.hostnameChangeId || null
        },
        data: { ...data, ...hostnameData }
      });
    } catch (err) {
      if (err.code !== 'P2025') throw err;
      equipment = await prisma.equipment.findUnique({ where: { id: equipment.id } });
      if (!equipment) throw err;
    }
  }
  throw Object.assign(new Error('Check-in concurrent : veuillez réessayer.'), { status: 409 });
}

module.exports = { updateAgentEquipment };

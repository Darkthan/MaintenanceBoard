const prisma = require('../lib/prisma');

function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const hex = value.replace(/[-:.]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex) || hex === '000000000000') return null;
  return hex.match(/.{2}/g).join(':');
}

function sanitizeAgentNetworkInterfaces(networkInterfaces, macs) {
  const supplied = Array.isArray(networkInterfaces) && networkInterfaces.length
    ? networkInterfaces
    : Array.isArray(macs) ? macs.map((macAddress, index) => ({ name: `Agent ${index + 1}`, macAddress })) : [];
  const seen = new Set();
  return supplied.slice(0, 20).flatMap((item, index) => {
    const macAddress = normalizeMac(item?.macAddress);
    if (!macAddress || seen.has(macAddress)) return [];
    seen.add(macAddress);
    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim().slice(0, 100)
      : `Agent ${index + 1}`;
    return [{ name, macAddress }];
  });
}

async function syncAgentNetworkInterfaces(equipmentId, interfaces) {
  if (!interfaces.length) return;
  const existing = await prisma.equipmentNetworkInterface.findMany({ where: { equipmentId } });
  for (const item of interfaces) {
    const row = existing.find(current => normalizeMac(current.macAddress) === item.macAddress)
      || existing.find(current => current.name.toLowerCase() === item.name.toLowerCase());
    if (row) {
      if (row.macAddress !== item.macAddress) {
        await prisma.equipmentNetworkInterface.update({
          where: { id: row.id }, data: { macAddress: item.macAddress }
        });
        row.macAddress = item.macAddress;
      }
    } else {
      const created = await prisma.equipmentNetworkInterface.create({ data: { equipmentId, ...item } });
      existing.push(created);
    }
  }
}

module.exports = { sanitizeAgentNetworkInterfaces, syncAgentNetworkInterfaces };

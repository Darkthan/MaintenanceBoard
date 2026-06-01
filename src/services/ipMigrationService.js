const prisma = require('../lib/prisma');

async function applyMigration(migration, appliedById) {
  const { id, networkId, ipAddressId, newIp, newHostname, newType, todoId } = migration;

  await prisma.$transaction(async (tx) => {
    if (ipAddressId) {
      const conflict = await tx.ipAddress.findUnique({
        where: { networkId_ip: { networkId, ip: newIp } }
      });
      if (conflict && conflict.id !== ipAddressId) {
        await tx.ipAddress.delete({ where: { id: conflict.id } });
      }
      await tx.ipAddress.update({
        where: { id: ipAddressId },
        data: {
          ip: newIp,
          ...(newHostname != null ? { hostname: newHostname } : {}),
          ...(newType != null ? { equipmentType: newType } : {}),
        }
      });
    } else {
      await tx.ipAddress.upsert({
        where: { networkId_ip: { networkId, ip: newIp } },
        create: { networkId, ip: newIp, hostname: newHostname || null, equipmentType: newType || null },
        update: {
          ...(newHostname !== undefined ? { hostname: newHostname } : {}),
          ...(newType !== undefined ? { equipmentType: newType } : {}),
        }
      });
    }

    await tx.ipMigration.update({
      where: { id },
      data: { status: 'APPLIED', appliedAt: new Date(), appliedById: appliedById || null }
    });

    if (todoId) {
      const todo = await tx.todo.findUnique({ where: { id: todoId } });
      if (todo && !todo.done) {
        await tx.todo.update({ where: { id: todoId }, data: { done: true, doneAt: new Date() } });
      }
    }
  });
}

module.exports = { applyMigration };

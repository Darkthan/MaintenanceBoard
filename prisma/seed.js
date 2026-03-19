require('dotenv').config();
const bcrypt = require('bcrypt');

const prisma = require('../src/lib/prisma');

// ── Credentials configurables via variables d'environnement ───────────────────
const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    || 'admin@maintenance.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
const ADMIN_NAME     = process.env.SEED_ADMIN_NAME     || 'Administrateur';
const TECH_EMAIL     = process.env.SEED_TECH_EMAIL     || 'tech@maintenance.local';
const TECH_PASSWORD  = process.env.SEED_TECH_PASSWORD  || 'Tech@1234';
const TECH_NAME      = process.env.SEED_TECH_NAME      || 'Technicien Démo';
// Mettre à false pour ne créer que les comptes (pas les données de démo)
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA !== 'false';

async function main() {
  console.log('🌱 Démarrage du seed...');

  // Vérifier si l'admin existe déjà
  const existingAdmin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL }
  });

  if (existingAdmin) {
    console.log('✅ Admin déjà présent, seed ignoré.');
    return;
  }

  // Créer l'admin par défaut
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });
  console.log(`✅ Admin créé : ${admin.email}`);

  // Créer un technicien de démo
  const techHash = await bcrypt.hash(TECH_PASSWORD, 12);
  const tech = await prisma.user.create({
    data: {
      email: TECH_EMAIL,
      name: TECH_NAME,
      passwordHash: techHash,
      role: 'TECH',
      isActive: true
    }
  });
  console.log(`✅ Technicien créé : ${tech.email}`);

  if (!SEED_DEMO_DATA) {
    console.log('\n🎉 Seed terminé (sans données de démo).');
    console.log(`\n   Admin : ${ADMIN_EMAIL}`);
    console.log(`   Tech  : ${TECH_EMAIL}`);
    return;
  }

  // Créer des salles de démo
  const rooms = await Promise.all([
    prisma.room.create({
      data: {
        name: 'Salle Informatique 101',
        building: 'Bâtiment A',
        floor: 1,
        number: '101',
        description: 'Laboratoire informatique - 30 postes'
      }
    }),
    prisma.room.create({
      data: {
        name: 'Salle Informatique 102',
        building: 'Bâtiment A',
        floor: 1,
        number: '102',
        description: 'Salle de formation - 20 postes'
      }
    }),
    prisma.room.create({
      data: {
        name: 'Salle Serveurs',
        building: 'Bâtiment B',
        floor: 0,
        number: 'SS01',
        description: 'Salle des serveurs et réseau'
      }
    })
  ]);
  console.log(`✅ ${rooms.length} salles créées`);

  // Créer des équipements de démo
  const equipments = await Promise.all([
    prisma.equipment.create({
      data: {
        name: 'PC-101-01',
        type: 'PC',
        brand: 'Dell',
        model: 'OptiPlex 7090',
        serialNumber: 'SN-DELL-001',
        status: 'ACTIVE',
        roomId: rooms[0].id
      }
    }),
    prisma.equipment.create({
      data: {
        name: 'PC-101-02',
        type: 'PC',
        brand: 'Dell',
        model: 'OptiPlex 7090',
        serialNumber: 'SN-DELL-002',
        status: 'ACTIVE',
        roomId: rooms[0].id
      }
    }),
    prisma.equipment.create({
      data: {
        name: 'PC-101-03',
        type: 'PC',
        brand: 'HP',
        model: 'EliteDesk 800',
        serialNumber: 'SN-HP-001',
        status: 'REPAIR',
        roomId: rooms[0].id
      }
    }),
    prisma.equipment.create({
      data: {
        name: 'SWITCH-A1',
        type: 'Réseau',
        brand: 'Cisco',
        model: 'Catalyst 2960',
        serialNumber: 'SN-CISCO-001',
        status: 'ACTIVE',
        roomId: rooms[2].id
      }
    }),
    prisma.equipment.create({
      data: {
        name: 'PROJ-101',
        type: 'Projecteur',
        brand: 'Epson',
        model: 'EB-X51',
        serialNumber: 'SN-EPSON-001',
        status: 'ACTIVE',
        roomId: rooms[0].id
      }
    })
  ]);
  console.log(`✅ ${equipments.length} équipements créés`);

  // Créer quelques interventions de démo
  const interventions = await Promise.all([
    prisma.intervention.create({
      data: {
        title: 'PC-101-03 ne démarre plus',
        description: 'Le PC ne s\'allume plus depuis ce matin. Alimentation suspecte.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        roomId: rooms[0].id,
        equipmentId: equipments[2].id,
        techId: tech.id
      }
    }),
    prisma.intervention.create({
      data: {
        title: 'Remplacement clavier salle 102',
        description: 'Clavier défectueux sur poste n°5. Remplacement effectué.',
        status: 'RESOLVED',
        priority: 'LOW',
        roomId: rooms[1].id,
        techId: tech.id,
        resolution: 'Clavier remplacé par un modèle identique du stock.',
        closedAt: new Date()
      }
    })
  ]);
  console.log(`✅ ${interventions.length} interventions créées`);

  // Créer une commande de démo
  const order = await prisma.order.create({
    data: {
      title: 'Renouvellement souris et claviers',
      description: 'Commande annuelle de périphériques pour les salles informatiques',
      status: 'PENDING',
      supplier: 'Dell Technologies',
      requestedBy: admin.id,
      items: {
        create: [
          {
            name: 'Souris Dell MS116',
            quantity: 20,
            unitPrice: 12.50,
            reference: 'DELL-MS116'
          },
          {
            name: 'Clavier Dell KB216',
            quantity: 15,
            unitPrice: 18.90,
            reference: 'DELL-KB216'
          }
        ]
      }
    }
  });
  console.log(`✅ Commande de démo créée : ${order.title}`);

  console.log('\n🎉 Seed terminé avec succès !');
  console.log('\n📋 Comptes créés :');
  console.log(`   Admin : ${ADMIN_EMAIL}`);
  console.log(`   Tech  : ${TECH_EMAIL}`);
  if (ADMIN_PASSWORD === 'Admin@1234' || TECH_PASSWORD === 'Tech@1234') {
    console.log('\n⚠️  Mots de passe par défaut détectés — définissez SEED_ADMIN_PASSWORD et SEED_TECH_PASSWORD en production !');
  }
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

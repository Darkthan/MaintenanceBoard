require('dotenv').config();
const app = require('./app');
const config = require('./config');

const prisma = require('./lib/prisma');

async function start() {
  try {
    // Tester la connexion DB
    await prisma.$connect();
    console.log('✅ Connexion DB établie');

    app.listen(config.port, '0.0.0.0', () => {
      console.log(`\n🚀 MaintenanceBoard démarré !`);
      console.log(`   URL       : http://localhost:${config.port}`);
      console.log(`   API Docs  : http://localhost:${config.port}/api-docs`);
      console.log(`   Env       : ${config.env}`);
      console.log(`   DB        : ${config.database.url?.replace(/:[^:@]+@/, ':***@')}\n`);
    });
  } catch (err) {
    console.error('❌ Erreur de démarrage :', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM reçu, arrêt propre...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT reçu, arrêt propre...');
  await prisma.$disconnect();
  process.exit(0);
});

start();

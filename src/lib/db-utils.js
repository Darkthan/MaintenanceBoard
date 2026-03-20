const supportsInsensitiveMode = /^(postgres|postgresql|mongodb(\+srv)?):/i.test(
  String(process.env.DATABASE_URL || '')
);

const isSQLite = process.env.DATABASE_URL?.startsWith('file:');

function containsFilter(value) {
  return supportsInsensitiveMode
    ? { contains: value, mode: 'insensitive' }
    : { contains: value };
}

module.exports = { supportsInsensitiveMode, isSQLite, containsFilter };

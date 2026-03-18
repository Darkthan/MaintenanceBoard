process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./prisma/test.db';
process.env.JWT_SECRET = 'test-secret-key-for-ci';
process.env.SESSION_SECRET = 'test-session-secret';

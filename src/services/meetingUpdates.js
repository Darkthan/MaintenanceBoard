const prisma = require('../lib/prisma');

// Database-backed long polling also works when clients reach different server processes.
async function waitForMeetingChange(id, version, signal) {
  const deadline = Date.now() + 20000;
  while (!signal.aborted) {
    const current = await prisma.meeting.findUnique({ where: { id }, select: { version: true } });
    if (signal.aborted) return { cancelled: true };
    if (!current) return { missing: true };
    if (current.version !== version) return { changed: true };
    if (Date.now() >= deadline) return { changed: false };
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 1000);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
  return { cancelled: true };
}
module.exports = { waitForMeetingChange };

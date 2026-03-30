const express = require('express');
const prisma = require('../lib/prisma');
const config = require('../config');
const {
  fetchGlobalCalendarEntries,
  buildGlobalCalendarIcs,
  getGlobalCalendarFeedToken
} = require('../utils/globalCalendar');

const router = express.Router();

router.get('/global.ics', async (req, res, next) => {
  try {
    if (req.query.token !== getGlobalCalendarFeedToken()) {
      return res.status(403).send('Flux iCal non autorisé');
    }

    const startAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const entries = await fetchGlobalCalendarEntries(prisma, { startAt, endAt });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(buildGlobalCalendarIcs(entries));
  } catch (err) {
    next(err);
  }
});

router.get('/global-feed', (req, res) => {
  const token = getGlobalCalendarFeedToken();
  res.json({
    token,
    url: `${config.appUrl}/api/calendar/global.ics?token=${encodeURIComponent(token)}`
  });
});

module.exports = router;

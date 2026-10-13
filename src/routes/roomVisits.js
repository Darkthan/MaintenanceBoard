const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { requireTechOrAdmin } = require('../middleware/roles');
const service = require('../services/roomVisitService');
const { roomVisitMedia } = require('../middleware/upload');
router.use(requireAuth, requireTechOrAdmin);
const run = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
};
router.get('/', run(async (req, res) => {
  const args = { ...req.query };
  for (const key of ['page', 'limit']) if (args[key] !== undefined) args[key] = Number(args[key]);
  if (args.damageFound !== undefined) {
    if (!['true', 'false'].includes(args.damageFound)) return res.status(400).json({ error: 'damageFound doit être true ou false' });
    args.damageFound = args.damageFound === 'true';
  }
  res.json(await service.listRoomVisits(args));
}));
router.post('/', run(async (req, res) => res.status(201).json(await service.createRoomVisit(req.body, req.user))));
router.post('/:id/media', roomVisitMedia.single('media'), run(async (req, res) => res.status(201).json(await service.addRoomVisitMedia(req.params.id, req.file, req.user))));
router.get('/:id/media/:mediaId', run(async (req, res) => { const result = await service.getRoomVisitMedia(req.params.id, req.params.mediaId, req.user); res.type(result.media.mimetype).sendFile(require('path').resolve(result.filePath), { headers: { 'Content-Disposition': `inline; filename="${result.media.filename.replace(/"/g, '')}"` } }); }));
router.delete('/:id/media/:mediaId', run(async (req, res) => res.json(await service.deleteRoomVisitMedia(req.params.id, req.params.mediaId, req.user))));
router.patch('/:id', run(async (req, res) => res.json(await service.updateRoomVisit(req.params.id, req.body, req.user))));
router.delete('/:id', run(async (req, res) => res.json(await service.deleteRoomVisit(req.params.id, req.user))));
module.exports = router;

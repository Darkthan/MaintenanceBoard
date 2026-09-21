const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

const execFileAsync = promisify(execFile);
const TICKET_ATTACHMENT_INPUT_MAX_BYTES = 25 * 1024 * 1024;
const TICKET_ATTACHMENT_FINAL_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_TICKET_ATTACHMENT_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4', 'video/webm', 'video/quicktime'
];

const COMPRESSIBLE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const ticketAttachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'ticket-messages');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const uploadTicketAttachment = multer({
  storage: ticketAttachmentStorage,
  limits: { fileSize: TICKET_ATTACHMENT_INPUT_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    ALLOWED_TICKET_ATTACHMENT_MIMES.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Type de fichier non autorisé. Utilisez une image, un PDF, un document Word ou une vidéo MP4, WebM ou MOV.'));
  }
}).single('attachment');

function formatTicketUploadError(error) {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return 'Le fichier dépasse 25 Mo. Réduisez-le avant de réessayer.';
  }
  return error?.message || 'La pièce jointe ne peut pas être envoyée.';
}

function ticketAttachmentUpload(req, res, next) {
  uploadTicketAttachment(req, res, error => {
    if (error) return res.status(400).json({ error: formatTicketUploadError(error) });
    next();
  });
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try { await fs.promises.unlink(filePath); } catch {}
}

function compressedName(originalName, extension) {
  const baseName = path.parse(originalName || 'piece-jointe').name.slice(0, 180) || 'piece-jointe';
  return `${baseName}-compresse${extension}`;
}

async function useCompressedFile(file, outputPath, mimetype, extension) {
  const [sourceStat, outputStat] = await Promise.all([
    fs.promises.stat(file.path),
    fs.promises.stat(outputPath)
  ]);
  if (outputStat.size >= sourceStat.size) {
    await safeUnlink(outputPath);
    return false;
  }

  await safeUnlink(file.path);
  file.path = outputPath;
  file.filename = path.basename(outputPath);
  file.size = outputStat.size;
  file.mimetype = mimetype;
  file.originalname = compressedName(file.originalname, extension);
  return true;
}

async function compressImage(file) {
  const outputPath = `${file.path}-compressed.jpg`;
  try {
    await sharp(file.path)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(outputPath);
    await useCompressedFile(file, outputPath, 'image/jpeg', '.jpg');
  } catch (error) {
    await safeUnlink(outputPath);
    throw error;
  }
}

async function compressPdf(file) {
  const outputPath = `${file.path}-compressed.pdf`;
  try {
    await execFileAsync('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/ebook',
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${outputPath}`,
      file.path
    ], { timeout: 120000, windowsHide: true });
    await useCompressedFile(file, outputPath, 'application/pdf', '.pdf');
  } catch (error) {
    await safeUnlink(outputPath);
    throw error;
  }
}

async function compressVideo(file) {
  const outputPath = `${file.path}-compressed.mp4`;
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', file.path,
      '-vf', 'scale=min(1280\\,iw):-2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',
      outputPath
    ], { timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 });
    await useCompressedFile(file, outputPath, 'video/mp4', '.mp4');
  } catch (error) {
    await safeUnlink(outputPath);
    throw error;
  }
}

async function prepareTicketAttachment(req, res, next) {
  const file = req.file;
  if (!file) return next();

  try {
    if (COMPRESSIBLE_IMAGE_MIMES.has(file.mimetype)) {
      await compressImage(file);
    } else if (file.mimetype === 'application/pdf' && file.size > TICKET_ATTACHMENT_FINAL_MAX_BYTES) {
      await compressPdf(file);
    } else if (VIDEO_MIMES.has(file.mimetype) && file.size > TICKET_ATTACHMENT_FINAL_MAX_BYTES) {
      await compressVideo(file);
    }

    if (file.size > TICKET_ATTACHMENT_FINAL_MAX_BYTES) {
      await safeUnlink(file.path);
      return res.status(400).json({
        error: 'Le fichier reste supérieur à 5 Mo après compression. Réduisez sa durée, sa résolution ou la qualité du PDF, puis réessayez.'
      });
    }
    next();
  } catch (error) {
    await safeUnlink(file.path);
    const kind = file.mimetype === 'application/pdf' ? 'PDF' : (VIDEO_MIMES.has(file.mimetype) ? 'vidéo' : 'image');
    return res.status(400).json({
      error: `La compression du fichier ${kind} a échoué. Compressez-le manuellement sous 5 Mo, puis réessayez.`
    });
  }
}

module.exports = {
  ALLOWED_TICKET_ATTACHMENT_MIMES,
  TICKET_ATTACHMENT_INPUT_MAX_BYTES,
  TICKET_ATTACHMENT_FINAL_MAX_BYTES,
  formatTicketUploadError,
  ticketAttachmentUpload,
  prepareTicketAttachment
};

const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');

// Répertoire de cache pour les données de langue Tesseract
const TESS_CACHE = path.join(process.cwd(), 'data', 'tessdata');

/**
 * Lance l'OCR de façon asynchrone sur une pièce jointe.
 * Ne bloque pas la réponse HTTP — à appeler avec setImmediate().
 */
async function runOcr(attachId, mimetype, filePath) {
  try {
    await prisma.orderAttachment.update({
      where: { id: attachId },
      data: { ocrStatus: 'PROCESSING' }
    });

    let text = '';

    if (mimetype === 'application/pdf') {
      text = await extractPdfText(filePath);
      // PDF scanné sans couche texte : on abandonne gracieusement
      if (!text || text.trim().length < 20) {
        await prisma.orderAttachment.update({
          where: { id: attachId },
          data: { ocrStatus: 'SKIPPED', ocrText: null }
        });
        return;
      }
    } else if (mimetype.startsWith('image/')) {
      text = await ocrImage(filePath);
    } else {
      // Word, Excel, etc. : non supporté
      await prisma.orderAttachment.update({
        where: { id: attachId },
        data: { ocrStatus: 'SKIPPED' }
      });
      return;
    }

    const cleanText = (text || '')
      .trim()
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 10000);

    await prisma.orderAttachment.update({
      where: { id: attachId },
      data: { ocrStatus: 'DONE', ocrText: cleanText || null }
    });
  } catch (err) {
    console.error(`[OCR] Erreur attachment ${attachId}:`, err.message);
    try {
      await prisma.orderAttachment.update({
        where: { id: attachId },
        data: { ocrStatus: 'FAILED' }
      });
    } catch { /* ignore */ }
  }
}

async function extractPdfText(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = await fs.promises.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text || '';
}

async function ocrImage(filePath) {
  const { createWorker } = require('tesseract.js');
  if (!fs.existsSync(TESS_CACHE)) fs.mkdirSync(TESS_CACHE, { recursive: true });

  const worker = await createWorker('fra+eng', 1, {
    cachePath: TESS_CACHE,
    logger: () => {}
  });
  try {
    const { data: { text } } = await worker.recognize(filePath);
    return text || '';
  } finally {
    await worker.terminate();
  }
}

module.exports = { runOcr };

'use strict';
const { PDFDocument, degrees } = require('pdf-lib');
const sharp = require('sharp');

function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }

async function prepareHandwrittenDocument(file, body) {
  if (!file) throw invalid('Importez le document reçu par email (PDF ou image).');
  let pdf;
  try {
    if (file.mimetype === 'application/pdf') {
      pdf = await PDFDocument.load(file.buffer);
    } else if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) {
      const png = await sharp(file.buffer, { limitInputPixels: 25000000 }).rotate().png().toBuffer();
      pdf = await PDFDocument.create();
      const image = await pdf.embedPng(png);
      const page = pdf.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    } else throw Error('Unsupported document');
  } catch (_) { throw invalid('Document illisible, protégé ou non pris en charge. Utilisez un PDF non protégé ou une image.'); }
  const signaturePage = body.signaturePage === undefined ? pdf.getPageCount() : Number(body.signaturePage);
  if (!Number.isInteger(signaturePage) || signaturePage < 1 || signaturePage > pdf.getPageCount()) throw invalid('Page de signature invalide.');
  const placement = {};
  for (const [key, fallback] of Object.entries({ posX: 0.54, posY: 0.78, sigWidth: 0.4, sigHeight: 0.15 })) {
    const value = body[key] === undefined ? fallback : Number(body[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1 || (key.startsWith('sig') && value === 0)) throw invalid('Zone de signature invalide.');
    placement[key] = value;
  }
  if (placement.posX + placement.sigWidth > 1.000001 || placement.posY + placement.sigHeight > 1.000001) throw invalid('La signature doit rester dans la page.');
  return { buffer: Buffer.from(await pdf.save()), placement: { ...placement, signaturePage } };
}

async function stampHandwrittenSignature(source, dataUrl, request) {
  const pdf = await PDFDocument.load(source);
  const page = pdf.getPage((request.signaturePage || pdf.getPageCount()) - 1);
  // Trim the empty canvas margins, preserving transparency and ink proportions.
  const png = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64'), { limitInputPixels: 5000000 }).trim().png().toBuffer();
  const image = await pdf.embedPng(png);
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const box = page.getCropBox();
  const visualW = angle % 180 ? box.height : box.width;
  const visualH = angle % 180 ? box.width : box.height;
  const rectW = request.sigWidth * visualW;
  const rectH = request.sigHeight * visualH;
  const scale = Math.min(rectW / image.width, rectH / image.height);
  const width = image.width * scale, height = image.height * scale;
  const x = request.posX * visualW + (rectW - width) / 2;
  const y = (1 - request.posY) * visualH - rectH + (rectH - height) / 2;
  const anchors = { 0: [x, y], 90: [box.width - y, x], 180: [box.width - x, box.height - y], 270: [y, box.height - x] };
  const [ax, ay] = anchors[angle];
  page.drawImage(image, { x: box.x + ax, y: box.y + ay, width, height, rotate: degrees(angle) });
  return Buffer.from(await pdf.save());
}

module.exports = { prepareHandwrittenDocument, stampHandwrittenSignature };

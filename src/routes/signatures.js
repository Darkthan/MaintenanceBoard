const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { readSettings } = require('../utils/settings');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require('pdf-lib');
const multer = require('multer');
const { createSmtpTransporter } = require('../utils/mail');

const prisma = require('../lib/prisma');

// ── Multer (memory, standalone signature upload) ──────────────────────────────

const ACCEPTED_MIME = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    if (ACCEPTED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Type de fichier non accepté : ${file.mimetype}`));
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  const masked = local.slice(0, 2) + '***';
  return `${masked}@${domain}`;
}

function generateSignatureId() {
  const year = new Date().getFullYear();
  const hex = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `SIG-${year}-${hex}`;
}

function fmtCurrency(n, currency) {
  if (n == null) return '—';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency || 'EUR' }).format(n);
  } catch {
    return `${Number(n).toFixed(2)} ${currency || 'EUR'}`;
  }
}

function createTransporter() {
  const smtpConfig = createSmtpTransporter();
  if (!smtpConfig.transporter) throw new Error('SMTP non configuré (voir Paramètres → Emails)');
  return smtpConfig;
}

function orderNum(order) {
  const year = new Date(order.createdAt).getFullYear();
  return `BC-${year}-${order.id.slice(-6).toUpperCase()}`;
}

function isImageMime(mime) {
  return mime && mime.startsWith('image/');
}

// ── Router pour /api/orders/:id/signature-requests ───────────────────────────

const ordersRouter = express.Router();

// POST /api/orders/:id/signature-requests — Créer une demande de signature
ordersRouter.post('/:id/signature-requests', requireAuth, async (req, res, next) => {
  try {
    const { recipientEmail, recipientName, message } = req.body;
    if (!recipientEmail || !recipientName) {
      return res.status(400).json({ error: 'Email et nom du destinataire requis' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ error: 'Adresse email invalide' });
    }

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { requester: { select: { name: true } } }
    });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const sigReq = await prisma.signatureRequest.create({
      data: {
        orderId: req.params.id,
        token,
        recipientEmail,
        recipientName,
        message: message || null,
        expiresAt,
        createdBy: req.user.id
      }
    });

    // Envoyer l'email avec le lien de signature
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const signLink = `${appUrl}/sign.html?token=${token}`;
    const num = orderNum(order);

    const { transporter, from, orgName } = createTransporter();
    await transporter.sendMail({
      from,
      to: recipientEmail,
      subject: `[Signature requise] ${num} — ${orgName}`,
      html: `
<div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
  <div style="background:linear-gradient(135deg,#4f46e5,#2563eb);padding:28px 32px">
    <p style="color:rgba(255,255,255,.85);font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">${orgName}</p>
    <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700">Demande de signature électronique</h1>
  </div>
  <div style="padding:32px">
    <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Bonjour <strong>${recipientName}</strong>,</p>
    <p style="font-size:14px;color:#475569;margin:0 0 20px">
      Vous êtes invité(e) à signer électroniquement le bon de commande suivant :
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:24px">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Bon de commande</p>
      <p style="margin:0 0 4px;font-size:17px;font-weight:700;color:#0f172a">${order.title}</p>
      <p style="margin:0;font-size:12px;color:#64748b">
        N° ${num}${order.supplier ? ` &nbsp;·&nbsp; ${order.supplier}` : ''}
        &nbsp;·&nbsp; Demandé par ${order.requester?.name || '—'}
      </p>
      ${message ? `<p style="margin:12px 0 0;padding:10px 12px;background:#eef2ff;border-radius:6px;font-size:13px;color:#4f46e5;font-style:italic">"${message}"</p>` : ''}
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="${signLink}"
         style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:.3px">
        ✍️ &nbsp; Signer le document
      </a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0 0 6px">
      Ce lien est valable 7 jours. Votre identité sera vérifiée par un code envoyé à cette adresse email.
    </p>
    <p style="font-size:11px;color:#cbd5e1;text-align:center;margin:0">
      Si vous n'étiez pas attendu(e), ignorez ce message.
    </p>
  </div>
</div>`
    });

    res.status(201).json(sigReq);
  } catch (err) {
    if (err.message?.includes('SMTP') || err.message?.includes('configuré')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/orders/:orderId/attachments/:attachId/request-signature — Signer un document joint
ordersRouter.post('/:orderId/attachments/:attachId/request-signature', requireAuth, async (req, res, next) => {
  try {
    const { recipientName, recipientEmail, message, posX, posY, sigWidth, sigHeight } = req.body;
    if (!recipientName || !recipientEmail) {
      return res.status(400).json({ error: 'Nom et email du destinataire requis' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ error: 'Adresse email invalide' });
    }

    const attachment = await prisma.orderAttachment.findUnique({
      where: { id: req.params.attachId }
    });
    if (!attachment || attachment.orderId !== req.params.orderId) {
      return res.status(404).json({ error: 'Pièce jointe introuvable' });
    }

    const ATTACH_DIR = path.join(process.cwd(), 'uploads', 'attachments');
    const srcPath = path.join(ATTACH_DIR, attachment.orderId, attachment.storedAs);
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ error: 'Fichier introuvable sur le serveur' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const documentTitle = attachment.filename.replace(/\.[^.]+$/, '');

    const sigReq = await prisma.signatureRequest.create({
      data: {
        orderId: null,
        token,
        documentTitle,
        recipientEmail,
        recipientName,
        message: message || null,
        expiresAt,
        createdBy: req.user.id,
        posX: posX != null ? parseFloat(posX) : null,
        posY: posY != null ? parseFloat(posY) : null,
        sigWidth: sigWidth != null ? parseFloat(sigWidth) : null,
        sigHeight: sigHeight != null ? parseFloat(sigHeight) : null
      }
    });

    // Copier le fichier vers uploads/signatures/source/
    const destDir = path.join(process.cwd(), 'uploads', 'signatures', 'source', sigReq.id);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(attachment.storedAs) || path.extname(attachment.filename) || '';
    const destName = uuidv4() + ext;
    fs.copyFileSync(srcPath, path.join(destDir, destName));

    await prisma.signatureRequest.update({
      where: { id: sigReq.id },
      data: { sourceFileStoredAs: destName, sourceFilename: attachment.filename, sourceFileMimetype: attachment.mimetype }
    });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const signLink = `${appUrl}/sign.html?token=${token}`;
    const { transporter, from, orgName } = createTransporter();
    await transporter.sendMail({
      from,
      to: recipientEmail,
      subject: `[Signature requise] ${documentTitle} — ${orgName}`,
      html: `
<div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
  <div style="background:linear-gradient(135deg,#4f46e5,#2563eb);padding:28px 32px">
    <p style="color:rgba(255,255,255,.85);font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">${orgName}</p>
    <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700">Demande de signature électronique</h1>
  </div>
  <div style="padding:32px">
    <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Bonjour <strong>${recipientName}</strong>,</p>
    <p style="font-size:14px;color:#475569;margin:0 0 20px">Vous êtes invité(e) à signer électroniquement le document suivant :</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:24px">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Document à signer</p>
      <p style="margin:0 0 4px;font-size:17px;font-weight:700;color:#0f172a">${documentTitle}</p>
      ${message ? `<p style="margin:12px 0 0;padding:10px 12px;background:#eef2ff;border-radius:6px;font-size:13px;color:#4f46e5;font-style:italic">"${message}"</p>` : ''}
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="${signLink}" style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:.3px">✍️ &nbsp; Signer le document</a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0 0 6px">Ce lien est valable 7 jours. Votre identité sera vérifiée par un code envoyé à cette adresse email.</p>
    <p style="font-size:11px;color:#cbd5e1;text-align:center;margin:0">Si vous n'étiez pas attendu(e), ignorez ce message.</p>
  </div>
</div>`
    });

    res.status(201).json(sigReq);
  } catch (err) {
    if (err.message?.includes('SMTP') || err.message?.includes('configuré')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/orders/:id/signature-requests — Lister les demandes
ordersRouter.get('/:id/signature-requests', requireAuth, async (req, res, next) => {
  try {
    const requests = await prisma.signatureRequest.findMany({
      where: { orderId: req.params.id },
      select: {
        id: true,
        recipientEmail: true,
        recipientName: true,
        status: true,
        signatureId: true,
        signedAt: true,
        expiresAt: true,
        message: true,
        createdAt: true,
        attachmentId: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(requests);
  } catch (err) { next(err); }
});

// DELETE /api/orders/:id/signature-requests/:reqId — Annuler
ordersRouter.delete('/:id/signature-requests/:reqId', requireAuth, async (req, res, next) => {
  try {
    const sigReq = await prisma.signatureRequest.findUnique({ where: { id: req.params.reqId } });
    if (!sigReq || sigReq.orderId !== req.params.id) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }
    if (sigReq.status !== 'PENDING') {
      return res.status(400).json({ error: 'Impossible d\'annuler une demande déjà traitée' });
    }
    await prisma.signatureRequest.update({
      where: { id: req.params.reqId },
      data: { status: 'CANCELLED' }
    });
    res.json({ message: 'Demande annulée' });
  } catch (err) { next(err); }
});

// ── Router public pour /api/sign/:token ───────────────────────────────────────

const signRouter = express.Router();

// GET /api/sign/:token — Infos de la demande (pour la page de signature)
signRouter.get('/:token', async (req, res, next) => {
  try {
    const sigReq = await prisma.signatureRequest.findUnique({
      where: { token: req.params.token },
      include: {
        order: {
          include: {
            items: true,
            requester: { select: { name: true } }
          }
        }
      }
    });

    if (!sigReq) return res.status(404).json({ error: 'Lien de signature invalide ou inexistant' });

    if (sigReq.status === 'CANCELLED') {
      return res.status(410).json({ error: 'Cette demande de signature a été annulée' });
    }

    // ── Document signé ─────────────────────────────────────────────────────────
    if (sigReq.status === 'SIGNED') {
      const response = {
        status: 'SIGNED',
        signatureId: sigReq.signatureId,
        signedAt: sigReq.signedAt,
        recipientName: sigReq.recipientName
      };
      if (sigReq.orderId && sigReq.order) {
        response.order = { title: sigReq.order.title, num: orderNum(sigReq.order) };
      } else {
        response.document = { title: sigReq.documentTitle || 'Document' };
      }
      return res.json(response);
    }

    if (new Date() > sigReq.expiresAt) {
      await prisma.signatureRequest.update({ where: { id: sigReq.id }, data: { status: 'EXPIRED' } });
      return res.status(410).json({ error: 'Ce lien de signature a expiré (validité : 7 jours)' });
    }

    // ── Document lié à une commande ────────────────────────────────────────────
    if (sigReq.orderId && sigReq.order) {
      const tpl = readSettings().poTemplate || {};
      const num = orderNum(sigReq.order);
      return res.json({
        status: 'PENDING',
        recipientName: sigReq.recipientName,
        maskedEmail: maskEmail(sigReq.recipientEmail),
        expiresAt: sigReq.expiresAt,
        message: sigReq.message,
        order: {
          title: sigReq.order.title,
          num,
          supplier: sigReq.order.supplier,
          requesterName: sigReq.order.requester?.name,
          createdAt: sigReq.order.createdAt,
          items: sigReq.order.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            priceType: item.priceType,
            reference: item.reference
          })),
          orgName: tpl.orgName || 'MaintenanceBoard',
          currency: tpl.currency || 'EUR',
          tvaRate: tpl.tvaRate || 20
        }
      });
    }

    // ── Document standalone (orderId null) ─────────────────────────────────────
    return res.json({
      status: 'PENDING',
      recipientName: sigReq.recipientName,
      maskedEmail: maskEmail(sigReq.recipientEmail),
      expiresAt: sigReq.expiresAt,
      message: sigReq.message,
      document: {
        title: sigReq.documentTitle || 'Document',
        notes: sigReq.documentNotes || null,
        hasFile: !!sigReq.sourceFileStoredAs,
        filename: sigReq.sourceFilename || null,
        mimetype: sigReq.sourceFileMimetype || null
      }
    });
  } catch (err) { next(err); }
});

// GET /api/sign/:token/source — Servir le fichier source (public, token valide requis)
signRouter.get('/:token/source', async (req, res, next) => {
  try {
    const sigReq = await prisma.signatureRequest.findUnique({
      where: { token: req.params.token }
    });
    if (!sigReq) return res.status(404).json({ error: 'Lien de signature invalide' });
    if (sigReq.status === 'CANCELLED' || sigReq.status === 'EXPIRED') {
      return res.status(410).json({ error: 'Ce lien n\'est plus actif' });
    }
    if (new Date() > sigReq.expiresAt) {
      return res.status(410).json({ error: 'Ce lien a expiré' });
    }
    if (!sigReq.sourceFileStoredAs) {
      return res.status(404).json({ error: 'Aucun fichier source attaché à cette demande' });
    }

    const srcDir = path.join(process.cwd(), 'uploads', 'signatures', 'source', sigReq.id);
    const filePath = path.join(srcDir, sigReq.sourceFileStoredAs);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier source introuvable' });
    }

    res.setHeader('Content-Type', sigReq.sourceFileMimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(sigReq.sourceFilename || 'document')}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

// POST /api/sign/:token/send-otp — Envoyer un code OTP
signRouter.post('/:token/send-otp', async (req, res, next) => {
  try {
    const sigReq = await prisma.signatureRequest.findUnique({ where: { token: req.params.token } });
    if (!sigReq) return res.status(404).json({ error: 'Lien de signature invalide' });
    if (sigReq.status !== 'PENDING') {
      return res.status(410).json({ error: 'Cette demande n\'est plus active' });
    }
    if (new Date() > sigReq.expiresAt) {
      return res.status(410).json({ error: 'Ce lien a expiré' });
    }

    // Anti-spam : refuser si un OTP valide a été envoyé il y a moins de 2 minutes
    if (sigReq.otpExpiresAt && new Date() < sigReq.otpExpiresAt) {
      const remainingMs = sigReq.otpExpiresAt.getTime() - Date.now();
      if (remainingMs > 13 * 60 * 1000) { // OTP envoyé depuis moins de 2 min
        return res.status(429).json({ error: 'Un code a déjà été envoyé. Attendez 2 minutes avant de réessayer.' });
      }
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.signatureRequest.update({
      where: { id: sigReq.id },
      data: { otpHash, otpExpiresAt, otpAttempts: 0 }
    });

    const s = readSettings();
    const orgName = s.poTemplate?.orgName || 'MaintenanceBoard';
    const { transporter, from } = createTransporter();

    await transporter.sendMail({
      from,
      to: sigReq.recipientEmail,
      subject: `[${otp}] Votre code de signature — ${orgName}`,
      html: `
<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto">
  <div style="background:#4f46e5;padding:24px 28px;border-radius:10px 10px 0 0;text-align:center">
    <h2 style="color:#fff;margin:0;font-size:18px;font-weight:700">Code de vérification</h2>
    <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:12px">${orgName}</p>
  </div>
  <div style="padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
    <p style="font-size:14px;color:#475569;margin:0 0 20px;text-align:center">
      Saisissez ce code pour confirmer votre identité et signer le document :
    </p>
    <div style="background:#f0f0ff;border:2px solid #4f46e5;border-radius:14px;padding:22px;text-align:center;margin-bottom:20px">
      <span style="font-size:42px;font-weight:800;color:#4f46e5;letter-spacing:10px">${otp}</span>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">
      Valable <strong>15 minutes</strong>. Ne partagez pas ce code.
    </p>
  </div>
</div>`
    });

    res.json({ sent: true, maskedEmail: maskEmail(sigReq.recipientEmail) });
  } catch (err) {
    if (err.message?.includes('SMTP') || err.message?.includes('configuré')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/sign/:token/submit — Soumettre la signature
signRouter.post('/:token/submit', async (req, res, next) => {
  try {
    const { otpCode, signatureData, signerTitle, signerPlace } = req.body;
    if (!otpCode || !signatureData) {
      return res.status(400).json({ error: 'Code de vérification et signature requis' });
    }

    const sigReq = await prisma.signatureRequest.findUnique({
      where: { token: req.params.token },
      include: {
        order: {
          include: {
            items: true,
            requester: { select: { name: true } }
          }
        }
      }
    });

    if (!sigReq) return res.status(404).json({ error: 'Lien de signature invalide' });
    if (sigReq.status === 'SIGNED') return res.status(409).json({ error: 'Ce document a déjà été signé' });
    if (sigReq.status !== 'PENDING') return res.status(410).json({ error: 'Cette demande n\'est plus active' });
    if (new Date() > sigReq.expiresAt) return res.status(410).json({ error: 'Ce lien a expiré' });

    if (!sigReq.otpHash || !sigReq.otpExpiresAt) {
      return res.status(400).json({ error: 'Veuillez d\'abord demander un code de vérification' });
    }
    if (new Date() > sigReq.otpExpiresAt) {
      return res.status(400).json({ error: 'Le code de vérification a expiré. Demandez un nouveau code.' });
    }
    if (sigReq.otpAttempts >= 5) {
      return res.status(429).json({ error: 'Trop de tentatives incorrectes. Demandez un nouveau code.' });
    }

    const valid = await bcrypt.compare(otpCode.trim(), sigReq.otpHash);
    if (!valid) {
      await prisma.signatureRequest.update({
        where: { id: sigReq.id },
        data: { otpAttempts: sigReq.otpAttempts + 1 }
      });
      const remaining = 5 - (sigReq.otpAttempts + 1);
      return res.status(400).json({
        error: `Code incorrect. ${remaining > 0 ? `${remaining} tentative(s) restante(s).` : 'Demandez un nouveau code.'}`
      });
    }

    const signatureId = generateSignatureId();
    const signedAt = new Date();
    const ipAddress = (req.headers['x-forwarded-for'] || req.ip || 'inconnue').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';

    const tpl = readSettings().poTemplate || {};

    // ── Cas 1 : commande liée ─────────────────────────────────────────────────
    if (sigReq.orderId && sigReq.order) {
      const pdfBuffer = await generateSignedPDF(sigReq.order, sigReq, signatureId, signedAt, signatureData, tpl, ipAddress);

      const ATTACH_DIR = path.join(process.cwd(), 'uploads', 'attachments');
      const orderDir = path.join(ATTACH_DIR, sigReq.orderId);
      if (!fs.existsSync(orderDir)) fs.mkdirSync(orderDir, { recursive: true });

      const storedAs = uuidv4() + '.pdf';
      fs.writeFileSync(path.join(orderDir, storedAs), pdfBuffer);

      const num = orderNum(sigReq.order);
      const filename = `${num}_signé_${signatureId}.pdf`;

      const attachment = await prisma.orderAttachment.create({
        data: {
          orderId: sigReq.orderId,
          filename,
          storedAs,
          mimetype: 'application/pdf',
          size: pdfBuffer.length,
          category: 'SIGNED_PO',
          uploadedBy: sigReq.createdBy
        }
      });

      await prisma.signatureRequest.update({
        where: { id: sigReq.id },
        data: { status: 'SIGNED', signatureId, signedAt, ipAddress, userAgent, attachmentId: attachment.id }
      });

      return res.json({ success: true, signatureId, signedAt, filename, message: 'Document signé avec succès' });
    }

    // ── Cas 2 : document standalone ───────────────────────────────────────────
    // Lire le fichier source si présent
    let sourceBuffer = null;
    let sourceMime = sigReq.sourceFileMimetype || null;
    if (sigReq.sourceFileStoredAs) {
      const srcPath = path.join(process.cwd(), 'uploads', 'signatures', 'source', sigReq.id, sigReq.sourceFileStoredAs);
      if (fs.existsSync(srcPath)) {
        sourceBuffer = fs.readFileSync(srcPath);
      }
    }

    // Utiliser la position définie par le demandeur (stockée en DB), avec fallback bas-droite
    const px = sigReq.posX ?? 0.7;
    const py = sigReq.posY ?? 0.85;
    const pdfBuffer = await generateStandaloneSignedPDF(sigReq, signatureId, signedAt, signatureData, tpl, ipAddress, sourceBuffer, sourceMime, signerTitle, signerPlace, px, py);

    const signedDir = path.join(process.cwd(), 'uploads', 'signatures', 'signed', sigReq.id);
    if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir, { recursive: true });

    const signedStoredAs = uuidv4() + '.pdf';
    fs.writeFileSync(path.join(signedDir, signedStoredAs), pdfBuffer);
    const signedFilename = `${sigReq.documentTitle || 'document'}_signé_${signatureId}.pdf`;

    await prisma.signatureRequest.update({
      where: { id: sigReq.id },
      data: {
        status: 'SIGNED', signatureId, signedAt, ipAddress, userAgent,
        signedFileStoredAs: signedStoredAs,
        signedFilename,
        signerTitle: signerTitle || null,
        signerPlace: signerPlace || null
      }
    });

    return res.json({ success: true, signatureId, signedAt, filename: signedFilename, message: 'Document signé avec succès' });
  } catch (err) { next(err); }
});

// ── Router authentifié pour /api/signatures ───────────────────────────────────

const signaturesRouter = express.Router();

// GET /api/signatures — Lister toutes les demandes standalone
signaturesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = { orderId: null };
    if (req.user.role !== 'ADMIN') {
      where.createdBy = req.user.id;
    }
    const requests = await prisma.signatureRequest.findMany({
      where,
      include: {
        creator: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(requests);
  } catch (err) { next(err); }
});

// POST /api/signatures — Créer une demande standalone
signaturesRouter.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const { documentTitle, documentNotes, recipientName, recipientEmail, message, posX, posY, sigWidth, sigHeight } = req.body;

    if (!documentTitle || !recipientName || !recipientEmail) {
      return res.status(400).json({ error: 'Titre du document, nom et email du destinataire requis' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ error: 'Adresse email invalide' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Créer d'abord l'enregistrement pour obtenir l'ID
    const sigReq = await prisma.signatureRequest.create({
      data: {
        orderId: null,
        token,
        documentTitle,
        documentNotes: documentNotes || null,
        recipientEmail,
        recipientName,
        message: message || null,
        expiresAt,
        createdBy: req.user.id,
        posX: posX != null ? parseFloat(posX) : null,
        posY: posY != null ? parseFloat(posY) : null,
        sigWidth: sigWidth != null ? parseFloat(sigWidth) : null,
        sigHeight: sigHeight != null ? parseFloat(sigHeight) : null
      }
    });

    // Sauvegarder le fichier si fourni
    let sourceFileStoredAs = null;
    let sourceFilename = null;
    let sourceFileMimetype = null;

    if (req.file) {
      const srcDir = path.join(process.cwd(), 'uploads', 'signatures', 'source', sigReq.id);
      if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

      const ext = path.extname(req.file.originalname) || '';
      sourceFileStoredAs = uuidv4() + ext;
      sourceFilename = req.file.originalname;
      sourceFileMimetype = req.file.mimetype;

      fs.writeFileSync(path.join(srcDir, sourceFileStoredAs), req.file.buffer);

      await prisma.signatureRequest.update({
        where: { id: sigReq.id },
        data: { sourceFileStoredAs, sourceFilename, sourceFileMimetype }
      });
    }

    // Envoyer l'email
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const signLink = `${appUrl}/sign.html?token=${token}`;
    const { transporter, from, orgName } = createTransporter();

    await transporter.sendMail({
      from,
      to: recipientEmail,
      subject: `[Signature requise] ${documentTitle} — ${orgName}`,
      html: `
<div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
  <div style="background:linear-gradient(135deg,#4f46e5,#2563eb);padding:28px 32px">
    <p style="color:rgba(255,255,255,.85);font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">${orgName}</p>
    <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700">Demande de signature électronique</h1>
  </div>
  <div style="padding:32px">
    <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Bonjour <strong>${recipientName}</strong>,</p>
    <p style="font-size:14px;color:#475569;margin:0 0 20px">
      Vous êtes invité(e) à signer électroniquement le document suivant :
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:24px">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Document à signer</p>
      <p style="margin:0 0 4px;font-size:17px;font-weight:700;color:#0f172a">${documentTitle}</p>
      ${documentNotes ? `<p style="margin:8px 0 0;font-size:13px;color:#475569">${documentNotes}</p>` : ''}
      ${message ? `<p style="margin:12px 0 0;padding:10px 12px;background:#eef2ff;border-radius:6px;font-size:13px;color:#4f46e5;font-style:italic">"${message}"</p>` : ''}
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="${signLink}"
         style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:.3px">
        ✍️ &nbsp; Signer le document
      </a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0 0 6px">
      Ce lien est valable 7 jours. Votre identité sera vérifiée par un code envoyé à cette adresse email.
    </p>
    <p style="font-size:11px;color:#cbd5e1;text-align:center;margin:0">
      Si vous n'étiez pas attendu(e), ignorez ce message.
    </p>
  </div>
</div>`
    });

    res.status(201).json({ ...sigReq, sourceFileStoredAs, sourceFilename, sourceFileMimetype });
  } catch (err) {
    if (err.message?.includes('SMTP') || err.message?.includes('configuré')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message?.includes('accepté')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /api/signatures/:id — Annuler (PENDING) ou supprimer définitivement (autres statuts)
signaturesRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const sigReq = await prisma.signatureRequest.findUnique({ where: { id: req.params.id } });
    if (!sigReq || sigReq.orderId !== null) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }
    if (req.user.role !== 'ADMIN' && sigReq.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    if (sigReq.status === 'PENDING') {
      // Annulation douce
      await prisma.signatureRequest.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED' }
      });
      return res.json({ message: 'Demande annulée' });
    }

    // Suppression définitive pour SIGNED / EXPIRED / CANCELLED
    // Supprimer les fichiers associés
    const srcDir = path.join(process.cwd(), 'uploads', 'signatures', 'source', sigReq.id);
    const signedDir = path.join(process.cwd(), 'uploads', 'signatures', 'signed', sigReq.id);
    if (fs.existsSync(srcDir)) fs.rmSync(srcDir, { recursive: true, force: true });
    if (fs.existsSync(signedDir)) fs.rmSync(signedDir, { recursive: true, force: true });

    await prisma.signatureRequest.delete({ where: { id: req.params.id } });
    res.json({ message: 'Demande supprimée' });
  } catch (err) { next(err); }
});

// GET /api/signatures/:id/download — Télécharger le PDF signé
signaturesRouter.get('/:id/download', requireAuth, async (req, res, next) => {
  try {
    const sigReq = await prisma.signatureRequest.findUnique({ where: { id: req.params.id } });
    if (!sigReq || sigReq.orderId !== null) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }
    if (req.user.role !== 'ADMIN' && sigReq.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    if (sigReq.status !== 'SIGNED') {
      return res.status(400).json({ error: 'Le document n\'a pas encore été signé' });
    }
    if (!sigReq.signedFileStoredAs) {
      return res.status(404).json({ error: 'Fichier signé introuvable' });
    }

    const filePath = path.join(process.cwd(), 'uploads', 'signatures', 'signed', sigReq.id, sigReq.signedFileStoredAs);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier signé introuvable sur le serveur' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sigReq.signedFilename || 'document_signe.pdf')}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

// ── Génération du PDF signé (commande) ───────────────────────────────────────

async function generateSignedPDF(order, sigReq, signatureId, signedAt, signatureDataUrl, tpl, ipAddress) {
  return new Promise((resolve, reject) => {
    const num = orderNum(order);
    const currency = tpl.currency || 'EUR';
    const tvaRate = parseFloat(tpl.tvaRate) || 20;
    const orgName = tpl.orgName || 'MaintenanceBoard';

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Bon de commande signé — ${order.title}`,
        Author: sigReq.recipientName,
        Subject: `Signature électronique ${signatureId}`,
        Creator: 'MaintenanceBoard'
      }
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const INDIGO = '#4f46e5';
    const DARK = '#0f172a';
    const GRAY = '#64748b';
    const LIGHT = '#e2e8f0';

    // ── Bandeau titre ──────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 78).fill(INDIGO);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text(orgName, 50, 22, { width: W - 200 });
    doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,.8)')
       .text('Bon de commande — Document signé électroniquement', 50, 46);
    // Badge "SIGNÉ" en haut à droite
    doc.rect(W - 120, 18, 80, 22).fill('#16a34a');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text('SIGNE', W - 115, 24, { width: 70, align: 'center' });

    doc.y = 98;

    // ── En-tête de la commande ─────────────────────────────────────────────────
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text(order.title, 50, doc.y);
    doc.y += 20;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text(
         `N° ${num}  ·  Demandeur : ${order.requester?.name || '—'}${order.supplier ? `  ·  Fournisseur : ${order.supplier}` : ''}`,
         50, doc.y
       );
    doc.y += 20;
    doc.moveTo(50, doc.y).lineTo(W - 50, doc.y).strokeColor(LIGHT).lineWidth(0.5).stroke();
    doc.y += 14;

    // ── Tableau des articles ───────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY);
    const tY = doc.y;
    doc.rect(50, tY, W - 100, 20).fill('#f8fafc');
    doc.fillColor(GRAY)
       .text('#',          56, tY + 6, { width: 16 })
       .text('Désignation',74, tY + 6, { width: 200 })
       .text('Référence',  278, tY + 6, { width: 100 })
       .text('Qté',        382, tY + 6, { width: 35, align: 'right' })
       .text('P.U. TTC',   422, tY + 6, { width: 72, align: 'right' })
       .text('Total TTC',  498, tY + 6, { width: 64, align: 'right' });
    doc.y = tY + 22;

    let totalTTC = 0;
    for (let i = 0; i < (order.items || []).length; i++) {
      const item = order.items[i];
      if (doc.y > doc.page.height - 240) { doc.addPage(); doc.y = 50; }
      const rY = doc.y;
      if (i % 2 === 0) doc.rect(50, rY, W - 100, 20).fill('#fafafa');

      doc.fillColor(DARK).font('Helvetica').fontSize(8);
      doc.text(String(i + 1), 56, rY + 6, { width: 16 });
      doc.text((item.name || '').slice(0, 50), 74, rY + 6, { width: 200 });
      doc.fillColor(GRAY).text(item.reference || '—', 278, rY + 6, { width: 100 });
      doc.fillColor(DARK).text(String(item.quantity), 382, rY + 6, { width: 35, align: 'right' });

      if (item.unitPrice != null) {
        const price = parseFloat(item.unitPrice);
        const ttc = item.priceType === 'HT' ? price * (1 + tvaRate / 100) : price;
        const lineTotal = ttc * item.quantity;
        totalTTC += lineTotal;
        doc.text(fmtCurrency(ttc, currency), 422, rY + 6, { width: 72, align: 'right' });
        doc.font('Helvetica-Bold').text(fmtCurrency(lineTotal, currency), 498, rY + 6, { width: 64, align: 'right' });
        doc.font('Helvetica');
      } else {
        doc.fillColor(GRAY).text('—', 422, rY + 6, { width: 72, align: 'right' });
        doc.text('—', 498, rY + 6, { width: 64, align: 'right' });
      }

      doc.y = rY + 22;
      doc.moveTo(50, doc.y - 2).lineTo(W - 50, doc.y - 2).strokeColor(LIGHT).lineWidth(0.3).stroke();
    }

    // ── Total ──────────────────────────────────────────────────────────────────
    if (totalTTC > 0) {
      doc.y += 6;
      const totX = W - 195;
      doc.rect(totX, doc.y, 145, 26).fill(DARK);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9)
         .text('Total TTC', totX + 8, doc.y + 9, { width: 60 })
         .text(fmtCurrency(totalTTC, currency), totX + 70, doc.y + 9, { width: 68, align: 'right' });
      doc.y += 36;
    } else {
      doc.y += 14;
    }

    renderSignatureBlock(doc, sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, INDIGO, DARK, GRAY, LIGHT, W, null, null);
    doc.end();
  });
}

// ── Génération du PDF signé (document standalone) ────────────────────────────

async function generateStandaloneSignedPDF(sigReq, signatureId, signedAt, signatureDataUrl, tpl, ipAddress, sourceBuffer, sourceMime, signerTitle, signerPlace, posX, posY) {
  const orgName = (tpl && tpl.orgName) || 'MaintenanceBoard';

  // For PDF sources: use pdf-lib to embed signature into the original PDF
  if (sourceBuffer && sourceMime === 'application/pdf') {
    return generatePdfWithEmbeddedSignature(sourceBuffer, sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, tpl, signerTitle || null, signerPlace || null, posX ?? 0.7, posY ?? 0.85, sigReq.sigWidth ?? null, sigReq.sigHeight ?? null);
  }

  // For images / others: use existing PDFKit logic
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Document signé — ${sigReq.documentTitle || 'Document'}`,
        Author: sigReq.recipientName,
        Subject: `Signature électronique ${signatureId}`,
        Creator: 'MaintenanceBoard'
      }
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const INDIGO = '#4f46e5';
    const DARK = '#0f172a';
    const GRAY = '#64748b';
    const LIGHT = '#e2e8f0';

    // ── Bandeau titre ──────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 78).fill(INDIGO);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text(orgName, 50, 22, { width: W - 200 });
    doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,.8)')
       .text('Document — Signé électroniquement', 50, 46);
    doc.rect(W - 120, 18, 80, 22).fill('#16a34a');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text('SIGNE', W - 115, 24, { width: 70, align: 'center' });

    doc.y = 98;

    // ── Section document ───────────────────────────────────────────────────────
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text(sigReq.documentTitle || 'Document', 50, doc.y);
    doc.y += 20;

    if (sigReq.documentNotes) {
      doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(sigReq.documentNotes, 50, doc.y, { width: W - 100 });
      doc.y += doc.heightOfString(sigReq.documentNotes, { width: W - 100 }) + 12;
    }

    doc.moveTo(50, doc.y).lineTo(W - 50, doc.y).strokeColor(LIGHT).lineWidth(0.5).stroke();
    doc.y += 14;

    // ── Aperçu du fichier source (image uniquement) ────────────────────────────
    if (sourceBuffer && sourceMime && isImageMime(sourceMime)) {
      try {
        const maxImgH = 300;
        doc.image(sourceBuffer, 50, doc.y, { fit: [W - 100, maxImgH], align: 'center' });
        doc.y += maxImgH + 20;
      } catch {
        doc.font('Helvetica').fontSize(9).fillColor(GRAY)
           .text(`[Image non affichable : ${sigReq.sourceFilename || 'fichier'}]`, 50, doc.y);
        doc.y += 20;
      }
    } else if (sigReq.sourceFilename) {
      // Fichier non-image : mentionner le nom
      doc.rect(50, doc.y, W - 100, 36).fill('#f8fafc');
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text('Fichier joint :', 58, doc.y + 6, { width: 80 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK)
         .text(sigReq.sourceFilename, 140, doc.y + 6, { width: W - 200 });
      doc.font('Helvetica').fontSize(8).fillColor(GRAY)
         .text('(Le fichier original accompagne cette demande de signature)', 58, doc.y + 20, { width: W - 116 });
      doc.y += 48;
    }

    renderSignatureBlock(doc, sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, INDIGO, DARK, GRAY, LIGHT, W, signerTitle || null, signerPlace || null);
    doc.end();
  });
}

// ── pdf-lib : embed signature directly into original PDF ──────────────────────

async function generatePdfWithEmbeddedSignature(sourceBuffer, sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, tpl, signerTitle, signerPlace, posX, posY, sigWidth, sigHeight) {
  // 1. Load original PDF
  const pdfDoc = await PDFLibDocument.load(sourceBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const targetPage = pages[pages.length - 1]; // last page by default
  const { width: pageW, height: pageH } = targetPage.getSize();

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Si sigWidth/sigHeight fournis (zone rectangle précise), les utiliser.
  // Sinon, fallback sur une zone fixe centrée sur posX/posY.
  let rectX, rectY, rectW, rectH;
  if (sigWidth != null && sigHeight != null) {
    rectW = sigWidth * pageW;
    rectH = sigHeight * pageH;
    // posX, posY = top-left corner en fraction → convertir en coordonnées PDF (origine bas-gauche)
    rectX = posX * pageW;
    rectY = (1 - posY - sigHeight) * pageH;
  } else {
    const SIG_W = 160, SIG_H = 50;
    rectW = SIG_W;
    rectH = SIG_H + 48;
    rectX = Math.max(8, Math.min(pageW - SIG_W - 8, posX * pageW - SIG_W / 2));
    rectY = Math.max(8, Math.min(pageH - rectH - 8, (1 - posY) * pageH));
  }

  // Clamp pour rester dans la page
  rectX = Math.max(4, Math.min(pageW - rectW - 4, rectX));
  rectY = Math.max(4, Math.min(pageH - rectH - 4, rectY));

  // Dimensions internes : zone signature occupe ~55% de la hauteur, infos en dessous
  const sigImgH = rectH * 0.55;
  const sigImgW = rectW - 8;
  const sigImgX = rectX + 4;
  const sigImgY = rectY + rectH - sigImgH - 4; // top of image (PDF Y = bottom)

  const separatorY = rectY + rectH - sigImgH - 8;
  const textStartY = separatorY - 10;
  const fontSize = Math.max(5, Math.min(8, rectH * 0.09));

  // Background box
  targetPage.drawRectangle({
    x: rectX, y: rectY, width: rectW, height: rectH,
    color: rgb(0.97, 0.97, 1),
    borderColor: rgb(0.31, 0.27, 0.9),
    borderWidth: 1,
    opacity: 0.95,
  });

  // Embed drawn signature image
  if (signatureDataUrl?.startsWith('data:image/png;base64,')) {
    try {
      const pngBuf = Buffer.from(signatureDataUrl.split(',')[1], 'base64');
      const pngImage = await pdfDoc.embedPng(pngBuf);
      targetPage.drawImage(pngImage, { x: sigImgX, y: sigImgY, width: sigImgW, height: sigImgH });
    } catch { /* skip if image can't be embedded */ }
  }

  // Separator line
  targetPage.drawLine({ start: { x: rectX + 4, y: separatorY }, end: { x: rectX + rectW - 4, y: separatorY }, thickness: 0.5, color: rgb(0.2, 0.2, 0.2) });

  // Signer name
  targetPage.drawText(sigReq.recipientName, { x: rectX + 4, y: textStartY, size: fontSize, font: helveticaBold, color: rgb(0.05, 0.05, 0.1), maxWidth: rectW - 8 });

  // Title (optional)
  let textY = textStartY - (fontSize + 2);
  if (signerTitle) {
    targetPage.drawText(signerTitle, { x: rectX + 4, y: textY, size: Math.max(5, fontSize - 1), font: helvetica, color: rgb(0.4, 0.4, 0.4), maxWidth: rectW - 8 });
    textY -= (fontSize + 1);
  }

  // Place + date
  const dateStr = new Date(signedAt).toLocaleDateString('fr-FR');
  const locStr = signerPlace ? `${signerPlace}, le ${dateStr}` : `Le ${dateStr}`;
  targetPage.drawText(locStr, { x: rectX + 4, y: textY, size: Math.max(5, fontSize - 1), font: helvetica, color: rgb(0.4, 0.4, 0.4), maxWidth: rectW - 8 });

  // Signature ID
  targetPage.drawText(signatureId, { x: rectX + 4, y: textY - (fontSize + 1), size: Math.max(4, fontSize - 2), font: helvetica, color: rgb(0.31, 0.27, 0.9), maxWidth: rectW - 8 });

  // 2. Generate certificate page and append it
  const certBuffer = await generateStandaloneCertPage(sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, tpl, signerTitle, signerPlace);
  const certDoc = await PDFLibDocument.load(certBuffer);
  const [certPage] = await pdfDoc.copyPages(certDoc, [0]);
  pdfDoc.addPage(certPage);

  const finalBytes = await pdfDoc.save();
  return Buffer.from(finalBytes);
}

// ── PDFKit helper: single-page certificate (for pdf-lib merge) ────────────────

function generateStandaloneCertPage(sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, tpl, signerTitle, signerPlace) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const INDIGO = '#4f46e5';
    const DARK = '#0f172a';
    const GRAY = '#64748b';
    const LIGHT = '#e2e8f0';
    const orgName = (tpl && tpl.orgName) || 'MaintenanceBoard';

    // Header banner
    doc.rect(0, 0, W, 72).fill(INDIGO);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text(orgName, 50, 18, { width: W - 200 });
    doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,.75)').text('Certificat de signature électronique', 50, 42);
    doc.rect(W - 120, 16, 80, 22).fill('#16a34a');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text('SIGNÉ', W - 115, 22, { width: 70, align: 'center' });

    doc.y = 92;
    renderSignatureBlock(doc, sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, INDIGO, DARK, GRAY, LIGHT, W, signerTitle, signerPlace);
    doc.end();
  });
}

// ── Bloc de signature réutilisable ────────────────────────────────────────────

function renderSignatureBlock(doc, sigReq, signatureId, signedAt, signatureDataUrl, ipAddress, INDIGO, DARK, GRAY, LIGHT, W, signerTitle, signerPlace) {
  // Count extra lines to size the cert box properly
  const extraLines = (signerTitle ? 1 : 0) + (signerPlace ? 1 : 0);
  const boxHeight = 180 + extraLines * 14;

  if (doc.y > doc.page.height - (boxHeight + 70)) { doc.addPage(); doc.y = 50; }
  doc.y += 18;

  const certY = doc.y;
  doc.rect(50, certY, W - 100, boxHeight).strokeColor(INDIGO).lineWidth(1.5).stroke();

  doc.rect(50, certY, W - 100, 28).fill(INDIGO);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11)
     .text('SIGNATURE ELECTRONIQUE CERTIFIEE', 66, certY + 9);

  const blockY = certY + 36;

  let sigImageOk = false;
  if (signatureDataUrl?.startsWith('data:image/png;base64,')) {
    try {
      const b64 = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
      const imgBuf = Buffer.from(b64, 'base64');
      doc.image(imgBuf, 60, blockY, { fit: [180, 72] });
      sigImageOk = true;
    } catch { /* image malformée */ }
  }
  if (!sigImageOk) {
    doc.rect(60, blockY, 180, 72).strokeColor(LIGHT).lineWidth(0.5).stroke();
    doc.fillColor(GRAY).font('Helvetica').fontSize(8)
       .text('[Signature]', 60, blockY + 30, { width: 180, align: 'center' });
  }

  doc.moveTo(60, blockY + 80).lineTo(240, blockY + 80).strokeColor(DARK).lineWidth(0.5).stroke();
  doc.fillColor(GRAY).font('Helvetica').fontSize(8)
     .text(sigReq.recipientName, 60, blockY + 84, { width: 180 });

  const cx = 270;
  doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
     .text('IDENTIFIANT DE SIGNATURE', cx, blockY, { width: W - cx - 60 });
  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(12)
     .text(signatureId, cx, blockY + 10, { width: W - cx - 60 });

  doc.fillColor(DARK).font('Helvetica').fontSize(8.5);
  const lineH = 14;
  const infoY = blockY + 32;

  // Build label/value rows dynamically to accommodate optional fields
  const labels = ['Signataire :', 'Email :'];
  const values = [sigReq.recipientName, sigReq.recipientEmail];

  if (signerTitle) {
    labels.push('Qualité :');
    values.push(signerTitle);
  }

  labels.push('Date :');
  values.push(signedAt.toLocaleString('fr-FR'));

  if (signerPlace) {
    labels.push('Lieu :');
    values.push(signerPlace);
  }

  labels.push('Adresse IP :', 'Lien signe le :');
  values.push(ipAddress || 'inconnue', new Date().toLocaleString('fr-FR'));

  const valX = cx + 96;

  for (let i = 0; i < labels.length; i++) {
    doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
       .text(labels[i], cx, infoY + lineH * i, { width: 90 });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5)
       .text(values[i], valX, infoY + lineH * i, { width: W - valX - 55 });
  }

  const fY = doc.page.height - 38;
  doc.moveTo(50, fY - 8).lineTo(W - 50, fY - 8).strokeColor(LIGHT).lineWidth(0.5).stroke();
  doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
     .text(
       `Document généré par MaintenanceBoard  ·  ${signatureId}  ·  ${signedAt.toLocaleString('fr-FR')}`,
       50, fY, { align: 'center', width: W - 100 }
     );
}

module.exports = { ordersRouter, signRouter, signaturesRouter };

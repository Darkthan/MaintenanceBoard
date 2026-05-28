const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { randomUUID } = require('crypto');
const { body, query, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { createSmtpTransporter } = require('../utils/mail');
const {
  ACTIVE_LOAN_STATUSES,
  getBundleInfo,
  computeReservedSlots,
  overlaps,
  ensureLoanAvailability,
  getCalendarFeedToken,
  escapeIcsText,
  toIcsDate
} = require('../utils/loans');

const loansRouter = express.Router();
const loanPublicRouter = express.Router();
const loanAccessLinkLimiter = process.env.NODE_ENV !== 'test'
  ? rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      keyGenerator: req => (req.body?.requesterEmail || '').trim().toLowerCase() || req.ip,
      message: { error: 'Trop de demandes de lien pour cet email, réessayez dans une heure.' },
      skip: req => !req.body?.requesterEmail
    })
  : (_req, _res, next) => next();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

function mapResource(resource) {
  const bundle = getBundleInfo(resource);
  const equipments = (resource.equipments || []).map(e => ({
    ...(e.equipment || e),
    lotNumber: e.lotNumber ?? 1
  })).filter(e => e.id);
  const hasRepairEquipment = equipments.length > 0 && equipments.some(e => e.status === 'REPAIR');
  return { ...resource, ...bundle, equipments, hasRepairEquipment };
}

// Normalise un tableau [{id, lotNumber}] ou [string] → [{id, lotNumber}]
function normalizeEquipmentList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => typeof item === 'string'
      ? { id: item, lotNumber: 1 }
      : { id: item.id || item.equipmentId, lotNumber: parseInt(item.lotNumber) || 1 })
    .filter(e => e.id);
}

const EQUIPMENT_SELECT = {
  equipments: {
    include: {
      equipment: {
        select: {
          id: true,
          name: true,
          serialNumber: true,
          status: true,
          type: true,
          brand: true,
          model: true
        }
      }
    }
  }
};

const CONTRACT_SIGNATURE_SELECT = {
  select: {
    id: true,
    status: true,
    signatureId: true,
    signedAt: true,
    expiresAt: true,
    documentTitle: true,
    signedFilename: true
  }
};

const RESERVATION_INCLUDE = {
  resource: { include: { ...EQUIPMENT_SELECT } },
  requestLink: { select: { id: true, title: true, token: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  contractSignatureRequest: CONTRACT_SIGNATURE_SELECT,
  selectedEquipments: {
    include: {
      equipment: {
        select: {
          id: true,
          name: true,
          serialNumber: true,
          type: true,
          brand: true,
          model: true
        }
      }
    },
    orderBy: [{ lotNumber: 'asc' }, { equipmentName: 'asc' }]
  }
};

function normalizeSelectedEquipmentIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(item => String(item || '').trim()).filter(Boolean))];
}

function mapSelectedEquipment(item) {
  return {
    id: item.id,
    equipmentId: item.equipmentId || item.equipment?.id || null,
    name: item.equipmentName || item.equipment?.name || 'Équipement',
    type: item.equipmentType || item.equipment?.type || null,
    brand: item.equipmentBrand || item.equipment?.brand || null,
    model: item.equipmentModel || item.equipment?.model || null,
    serialNumber: item.equipmentSerialNumber || item.equipment?.serialNumber || null,
    lotNumber: item.lotNumber ?? null
  };
}

function mapContractSignatureRequest(item) {
  if (!item) return null;
  return {
    id: item.id,
    status: item.status,
    signatureId: item.signatureId,
    signedAt: item.signedAt,
    expiresAt: item.expiresAt,
    documentTitle: item.documentTitle,
    signedFilename: item.signedFilename
  };
}

function mapReservation(item) {
  return {
    ...item,
    resource: item.resource ? mapResource(item.resource) : null,
    selectedEquipments: Array.isArray(item.selectedEquipments)
      ? item.selectedEquipments.map(mapSelectedEquipment)
      : [],
    contractSignatureRequest: mapContractSignatureRequest(item.contractSignatureRequest)
  };
}

function getResourceEquipmentEntries(resource) {
  return (resource?.equipments || [])
    .map(link => {
      const equipment = link.equipment || link;
      if (!equipment?.id) return null;
      return {
        id: equipment.id,
        name: equipment.name,
        type: equipment.type || null,
        brand: equipment.brand || null,
        model: equipment.model || null,
        serialNumber: equipment.serialNumber || null,
        status: equipment.status || null,
        lotNumber: link.lotNumber ?? 1
      };
    })
    .filter(Boolean);
}

function buildSelectedEquipmentSnapshots(resource, selectedEquipmentIds) {
  const selectedIds = normalizeSelectedEquipmentIds(selectedEquipmentIds);
  if (!selectedIds.length) return [];

  const equipmentMap = new Map(getResourceEquipmentEntries(resource).map(item => [item.id, item]));
  const snapshots = selectedIds.map(id => {
    const equipment = equipmentMap.get(id);
    if (!equipment) {
      throw Object.assign(new Error('Un appareil sélectionné ne fait pas partie de cette ressource de prêt.'), { status: 400 });
    }
    return {
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      equipmentType: equipment.type,
      equipmentBrand: equipment.brand,
      equipmentModel: equipment.model,
      equipmentSerialNumber: equipment.serialNumber,
      lotNumber: equipment.lotNumber
    };
  });

  return snapshots.sort((a, b) => {
    const lotA = a.lotNumber ?? 9999;
    const lotB = b.lotNumber ?? 9999;
    if (lotA !== lotB) return lotA - lotB;
    return a.equipmentName.localeCompare(b.equipmentName, 'fr');
  });
}

function sameEquipmentSelection(current = [], next = []) {
  const currentIds = current.map(item => item.equipmentId).filter(Boolean).sort();
  const nextIds = normalizeSelectedEquipmentIds(next).sort();
  if (currentIds.length !== nextIds.length) return false;
  return currentIds.every((id, index) => id === nextIds[index]);
}

function buildDefaultLoanContractBody(reservation, resource) {
  const orgPart = reservation.requesterOrganization ? ` pour ${reservation.requesterOrganization}` : '';
  return `Je soussigné(e) ${reservation.requesterName}${orgPart}, reconnais recevoir en prêt le matériel décrit ci-dessous pour la période du ${fmtLoanDate(reservation.startAt)} au ${fmtLoanDate(reservation.endAt)}. Je m'engage à en prendre soin, à respecter les consignes de prêt et à restituer l'ensemble du matériel complet et en bon état à la date prévue.`;
}

function getEffectiveContractBody(reservation, resource) {
  const contractBody = String(reservation.contractBody || '').trim();
  return contractBody || buildDefaultLoanContractBody(reservation, resource);
}

function hasContractRelevantChange(existing, nextData, options = {}) {
  const startChanged = new Date(nextData.startAt).getTime() !== new Date(existing.startAt).getTime();
  const endChanged = new Date(nextData.endAt).getTime() !== new Date(existing.endAt).getTime();
  const contractBodyChanged = options.contractBodyProvided
    ? (String(nextData.contractBody || '').trim() || null) !== (String(existing.contractBody || '').trim() || null)
    : false;
  const equipmentSelectionChanged = options.selectedEquipmentProvided
    ? !sameEquipmentSelection(existing.selectedEquipments, options.selectedEquipmentIds)
    : false;

  return (
    nextData.resourceId !== existing.resourceId ||
    nextData.requesterName !== existing.requesterName ||
    nextData.requesterEmail !== existing.requesterEmail ||
    (nextData.requesterOrganization || null) !== (existing.requesterOrganization || null) ||
    Number(nextData.requestedUnits) !== Number(existing.requestedUnits) ||
    startChanged ||
    endChanged ||
    contractBodyChanged ||
    equipmentSelectionChanged
  );
}

function getLoanContractDocumentTitle(reservation, resource) {
  return `Fiche de prêt - ${resource.name} - ${reservation.requesterName}`;
}

function getLoanContractDocumentNotes(reservation, resource) {
  return [
    `Période : ${fmtLoanDate(reservation.startAt)} → ${fmtLoanDate(reservation.endAt)}`,
    reservation.requesterOrganization ? `Organisation : ${reservation.requesterOrganization}` : null,
    `Ressource : ${resource.name}`
  ].filter(Boolean).join(' · ');
}

function getLoanSignatureLink(token) {
  return `${config.appUrl.replace(/\/$/, '')}/sign.html?token=${encodeURIComponent(token)}`;
}

async function sendLoanContractSignatureEmail(signatureRequest, reservation, documentTitle, documentNotes) {
  const { transporter, from, orgName } = createSmtpTransporter();
  if (!transporter) {
    throw new Error('SMTP non configuré (voir Paramètres → Emails)');
  }

  const signLink = getLoanSignatureLink(signatureRequest.token);
  await transporter.sendMail({
    from,
    to: signatureRequest.recipientEmail,
    subject: `[Signature requise] ${documentTitle} — ${orgName || 'MaintenanceBoard'}`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
        <div style="background:linear-gradient(135deg,#0f766e,#0f172a);padding:28px 32px">
          <p style="color:rgba(255,255,255,.85);font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">${orgName || 'MaintenanceBoard'}</p>
          <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700">Fiche de prêt à signer</h1>
        </div>
        <div style="padding:32px">
          <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Bonjour <strong>${signatureRequest.recipientName}</strong>,</p>
          <p style="font-size:14px;color:#475569;margin:0 0 20px">Merci de signer électroniquement votre fiche de prêt avant le retrait du matériel.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:24px">
            <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Document à signer</p>
            <p style="margin:0 0 4px;font-size:17px;font-weight:700;color:#0f172a">${documentTitle}</p>
            <p style="margin:0;font-size:13px;color:#475569">${documentNotes}</p>
            <p style="margin:12px 0 0;font-size:12px;color:#64748b">Demandeur : ${reservation.requesterName}${reservation.requesterOrganization ? ` · ${reservation.requesterOrganization}` : ''}</p>
          </div>
          <div style="text-align:center;margin:28px 0">
            <a href="${signLink}" style="display:inline-block;background:#0f766e;color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:.3px">
              Signer la fiche de prêt
            </a>
          </div>
          <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0 0 6px">Ce lien est valable 7 jours. Votre identité sera vérifiée par un code envoyé à cette adresse email.</p>
          <p style="font-size:11px;color:#cbd5e1;text-align:center;margin:0">Si vous n'étiez pas attendu(e), ignorez ce message.</p>
        </div>
      </div>`
  });
}

function buildLoanContractPdf({ reservation, resource, contractBody, selectedEquipments }) {
  return new Promise((resolve, reject) => {
    let signaturePlacement = null;
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: getLoanContractDocumentTitle(reservation, resource),
        Author: 'MaintenanceBoard',
        Subject: 'Fiche de prêt à signer',
        Creator: 'MaintenanceBoard'
      }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve({
      buffer: Buffer.concat(chunks),
      signaturePlacement
    }));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const DARK = '#0f172a';
    const TEAL = '#0f766e';
    const SLATE = '#475569';
    const LIGHT = '#cbd5e1';

    doc.rect(0, 0, pageWidth, 88).fill(TEAL);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Fiche de prêt', 50, 22);
    doc.font('Helvetica').fontSize(10).fillColor('#d1fae5').text('Document préparé pour signature électronique', 50, 48);

    doc.y = 110;
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(16).text(resource.name, 50, doc.y);
    doc.y += 18;
    doc.font('Helvetica').fontSize(10).fillColor(SLATE)
      .text(`Emprunteur : ${reservation.requesterName}`, 50, doc.y);
    doc.y += 14;
    doc.text(`Email : ${reservation.requesterEmail}`, 50, doc.y);
    doc.y += 14;
    if (reservation.requesterOrganization) {
      doc.text(`Organisation : ${reservation.requesterOrganization}`, 50, doc.y);
      doc.y += 14;
    }
    doc.text(`Période : ${fmtLoanDate(reservation.startAt)} → ${fmtLoanDate(reservation.endAt)}`, 50, doc.y);
    doc.y += 14;
    doc.text(`Quantité demandée : ${reservation.requestedUnits} unité(s)`, 50, doc.y);
    doc.y += 20;

    doc.moveTo(50, doc.y).lineTo(pageWidth - 50, doc.y).strokeColor(LIGHT).lineWidth(0.7).stroke();
    doc.y += 18;

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text('Engagement', 50, doc.y);
    doc.y += 18;
    doc.font('Helvetica').fontSize(10).fillColor(SLATE)
      .text(contractBody, 50, doc.y, { width: pageWidth - 100, align: 'justify' });
    doc.y += doc.heightOfString(contractBody, { width: pageWidth - 100, align: 'justify' }) + 18;

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text('Appareils concernés', 50, doc.y);
    doc.y += 14;

    if (!selectedEquipments.length) {
      const note = 'Aucun appareil nominatif n’a été sélectionné pour ce prêt au moment de la génération du document.';
      doc.font('Helvetica').fontSize(10).fillColor(SLATE).text(note, 50, doc.y, { width: pageWidth - 100 });
      doc.y += doc.heightOfString(note, { width: pageWidth - 100 }) + 14;
    } else {
      const headers = ['Appareil', 'Type', 'N° de série', 'Lot'];
      const columns = [50, 245, 355, 515];
      doc.rect(50, doc.y, pageWidth - 100, 22).fill('#f1f5f9');
      doc.fillColor(SLATE).font('Helvetica-Bold').fontSize(8)
        .text(headers[0], columns[0] + 6, doc.y + 7)
        .text(headers[1], columns[1] + 6, doc.y + 7)
        .text(headers[2], columns[2] + 6, doc.y + 7)
        .text(headers[3], columns[3] + 6, doc.y + 7, { width: 24, align: 'center' });
      doc.y += 24;

      selectedEquipments.forEach((equipment, index) => {
        if (doc.y > pageHeight - 170) {
          doc.addPage();
          doc.y = 60;
        }
        if (index % 2 === 0) {
          doc.rect(50, doc.y, pageWidth - 100, 22).fill('#fafafa');
        }
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
          .text(equipment.name || 'Équipement', columns[0] + 6, doc.y + 7, { width: 180, ellipsis: true })
          .text(equipment.type || '—', columns[1] + 6, doc.y + 7, { width: 95, ellipsis: true })
          .text(equipment.serialNumber || '—', columns[2] + 6, doc.y + 7, { width: 145, ellipsis: true })
          .text(equipment.lotNumber != null ? String(equipment.lotNumber) : '—', columns[3] + 6, doc.y + 7, { width: 24, align: 'center' });
        doc.y += 22;
        doc.moveTo(50, doc.y).lineTo(pageWidth - 50, doc.y).strokeColor(LIGHT).lineWidth(0.35).stroke();
      });

      doc.y += 12;
    }

    if (resource.instructions) {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text('Consignes', 50, doc.y);
      doc.y += 16;
      doc.font('Helvetica').fontSize(10).fillColor(SLATE)
        .text(resource.instructions, 50, doc.y, { width: pageWidth - 100, align: 'justify' });
      doc.y += doc.heightOfString(resource.instructions, { width: pageWidth - 100, align: 'justify' }) + 14;
    }

    let signatureTop = Math.max(doc.y + 12, 560);
    if (signatureTop > pageHeight - 160) {
      doc.addPage();
      signatureTop = 540;
    }

    const sigX = 315;
    const sigY = signatureTop;
    const sigW = 230;
    const sigH = 92;

    doc.roundedRect(50, sigY, 235, sigH, 10).strokeColor(LIGHT).lineWidth(1).stroke();
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text('Cadre établissement', 66, sigY + 12);
    doc.font('Helvetica').fontSize(9).fillColor(SLATE)
      .text('Nom, cachet, préparation du matériel et remise au bénéficiaire.', 66, sigY + 34, { width: 200 });

    doc.roundedRect(sigX, sigY, sigW, sigH, 10).strokeColor(TEAL).lineWidth(1.2).stroke();
    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(11).text('Signature de l’emprunteur', sigX + 14, sigY + 12);
    doc.font('Helvetica').fontSize(9).fillColor(SLATE)
      .text('La signature électronique sera apposée dans cet encadré.', sigX + 14, sigY + 34, { width: sigW - 28 });
    doc.moveTo(sigX + 14, sigY + sigH - 18).lineTo(sigX + sigW - 14, sigY + sigH - 18).strokeColor(LIGHT).lineWidth(0.7).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(SLATE)
      .text(`${reservation.requesterName} · ${new Date(reservation.startAt).toLocaleDateString('fr-FR')}`, sigX + 14, sigY + sigH - 14, { width: sigW - 28 });

    signaturePlacement = {
      posX: sigX / pageWidth,
      posY: sigY / pageHeight,
      sigWidth: sigW / pageWidth,
      sigHeight: sigH / pageHeight
    };

    doc.end();
  });
}

function computeOccurrences(startAt, endAt, recurrence) {
  const occurrences = [{ startAt: new Date(startAt), endAt: new Date(endAt) }];
  if (!recurrence?.type || recurrence.type === 'none') return occurrences;
  const duration = new Date(endAt) - new Date(startAt);
  const until = new Date(recurrence.until);
  let cur = new Date(startAt);
  for (let i = 0; i < 365; i++) {
    if (recurrence.type === 'daily')     cur.setDate(cur.getDate() + 1);
    else if (recurrence.type === 'weekly')    cur.setDate(cur.getDate() + 7);
    else if (recurrence.type === 'biweekly')  cur.setDate(cur.getDate() + 14);
    else if (recurrence.type === 'monthly')   cur.setMonth(cur.getMonth() + 1);
    else break;
    if (cur > until) break;
    occurrences.push({ startAt: new Date(cur), endAt: new Date(cur.getTime() + duration) });
  }
  return occurrences;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function fmtLoanDate(d) {
  return new Date(d).toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function getResourceSchedule(resourceId, start, end) {
  const resource = await prisma.loanResource.findUnique({ where: { id: resourceId } });
  if (!resource) return null;
  const bundle = getBundleInfo(resource);
  const reservations = await prisma.loanReservation.findMany({
    where: {
      resourceId,
      status: { in: ACTIVE_LOAN_STATUSES },
      startAt: { lt: end },
      endAt: { gt: start }
    },
    select: { id: true, startAt: true, endAt: true, reservedSlots: true, status: true },
    orderBy: { startAt: 'asc' }
  });
  return { totalSlots: bundle.totalSlots, reservations };
}

async function sendLoanConfirmationEmail(reservation) {
  try {
    const { transporter, from } = createSmtpTransporter();
    if (!transporter) return;
    const r = reservation.resource;
    await transporter.sendMail({
      from,
      to: reservation.requesterEmail,
      subject: `Demande de prêt enregistrée – ${r.name}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#0f172a;">Demande de prêt enregistrée</h2>
        <p>Bonjour ${reservation.requesterName},</p>
        <p>Votre demande a bien été reçue. Elle est en attente de validation.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Ressource</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #e2e8f0;">${r.name}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Début</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.startAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Fin</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.endAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;">Quantité</td><td style="padding:8px 0;">${reservation.requestedUnits} unité(s)</td></tr>
        </table>
        <p style="color:#64748b;font-size:13px;">Vous recevrez un email dès que votre demande sera traitée.</p>
      </div>`
    });
  } catch (err) {
    console.error('[loans] sendLoanConfirmationEmail:', err.message);
  }
}

async function sendLoanStatusEmail(reservation, newStatus) {
  if (!['APPROVED', 'REJECTED'].includes(newStatus)) return;
  try {
    const { transporter, from } = createSmtpTransporter();
    if (!transporter) return;
    const r = reservation.resource;
    const ok = newStatus === 'APPROVED';
    await transporter.sendMail({
      from,
      to: reservation.requesterEmail,
      subject: `${ok ? 'Prêt confirmé' : 'Demande non retenue'} – ${r.name}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:${ok ? '#f0fdf4' : '#fff1f2'};border-radius:12px;padding:18px 22px;margin-bottom:20px;">
          <h2 style="color:${ok ? '#166534' : '#9f1239'};margin:0 0 6px;">
            ${ok ? '&#10003; Prêt confirmé' : '&#10007; Demande non retenue'}
          </h2>
          <p style="color:${ok ? '#166534' : '#9f1239'};margin:0;font-size:14px;">
            ${ok ? 'Votre demande de prêt a été approuvée.' : "Votre demande de prêt n'a pas pu être accordée."}
          </p>
        </div>
        <p>Bonjour ${reservation.requesterName},</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Ressource</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #e2e8f0;">${r.name}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Début</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.startAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Fin</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.endAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;">Quantité</td><td style="padding:8px 0;">${reservation.requestedUnits} unité(s)</td></tr>
        </table>
        ${!ok && reservation.internalNotes ? `<p style="background:#f8fafc;border-left:3px solid #cbd5e1;padding:10px 14px;border-radius:6px;color:#475569;font-size:13px;">${reservation.internalNotes}</p>` : ''}
        <p style="color:#64748b;font-size:13px;">${ok ? 'Merci de vous présenter au lieu de retrait à la date convenue.' : "N'hésitez pas à reformuler votre demande à une autre date."}</p>
      </div>`
    });
  } catch (err) {
    console.error('[loans] sendLoanStatusEmail:', err.message);
  }
}

function getLoanRequestUrl(requestToken, accessToken) {
  const url = new URL('/loan-request.html', config.appUrl);
  url.searchParams.set('token', requestToken);
  url.searchParams.set('access', accessToken);
  return url.toString();
}

async function findValidRequestLink(token) {
  const link = await prisma.loanMagicLink.findUnique({
    where: { token },
    include: { resource: true }
  });

  if (!link || !link.isActive || (link.expiresAt && link.expiresAt < new Date())) {
    throw Object.assign(new Error('Lien de demande de prêt invalide ou expiré'), { status: 404 });
  }

  return link;
}

async function findValidAccessLink(requestToken, accessToken) {
  if (!accessToken) return null;

  const accessLink = await prisma.loanRequestAccessLink.findUnique({
    where: { token: accessToken },
    include: {
      requestLink: {
        include: { resource: true }
      }
    }
  });

  if (!accessLink) return null;
  if (accessLink.expiresAt < new Date()) return null;
  if (!accessLink.requestLink || accessLink.requestLink.token !== requestToken) return null;
  if (!accessLink.requestLink.isActive || (accessLink.requestLink.expiresAt && accessLink.requestLink.expiresAt < new Date())) return null;

  return accessLink;
}

async function getRequestResources(link) {
  const resources = await prisma.loanResource.findMany({
    where: {
      isActive: true,
      ...(link.resourceId ? { id: link.resourceId } : {})
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }]
  });
  return resources.map(mapResource);
}

function ensureValidDates(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw Object.assign(new Error('Les dates de prêt sont invalides'), { status: 400 });
  }
  if (end <= start) {
    throw Object.assign(new Error('La date de fin doit être après la date de début'), { status: 400 });
  }
  return { start, end };
}

function hasReservationScheduleChange(existing, nextData) {
  if (nextData.resourceId && nextData.resourceId !== existing.resourceId) return true;
  if (nextData.requestedUnits !== undefined && Number(nextData.requestedUnits) !== Number(existing.requestedUnits)) return true;
  if (nextData.startAt && new Date(nextData.startAt).getTime() !== new Date(existing.startAt).getTime()) return true;
  if (nextData.endAt && new Date(nextData.endAt).getTime() !== new Date(existing.endAt).getTime()) return true;
  return false;
}

function ensureAvailable(resourceId, startAt, endAt, requestedUnits, excludeReservationId = null) {
  return ensureLoanAvailability(prisma, { resourceId, startAt, endAt, requestedUnits, excludeReservationId });
}

function buildIcs(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MaintenanceBoard//Loans//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  events.forEach(event => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@maintenanceboard`,
      `DTSTAMP:${toIcsDate(new Date())}`,
      `DTSTART:${toIcsDate(event.startAt)}`,
      `DTEND:${toIcsDate(event.endAt)}`,
      `SUMMARY:${escapeIcsText(`${event.resource.name} - ${event.requesterName}`)}`,
      `DESCRIPTION:${escapeIcsText([
        `Demandeur : ${event.requesterName}`,
        `Email : ${event.requesterEmail}`,
        `Quantité : ${event.requestedUnits}`,
        event.requesterOrganization ? `Organisation : ${event.requesterOrganization}` : null,
        event.additionalNeeds ? `Besoins : ${event.additionalNeeds}` : null
      ].filter(Boolean).join('\n'))}`,
      `LOCATION:${escapeIcsText(event.resource.location || 'MaintenanceBoard')}`,
      `STATUS:${event.status === 'APPROVED' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function getCalendarEvents(startAt, endAt) {
  return prisma.loanReservation.findMany({
    where: {
      status: { in: ACTIVE_LOAN_STATUSES },
      startAt: { lt: endAt },
      endAt: { gt: startAt }
    },
    orderBy: { startAt: 'asc' },
    include: {
      resource: true,
      requestLink: { select: { id: true, title: true } }
    }
  });
}

loanPublicRouter.get('/:token', async (req, res, next) => {
  try {
    const link = await findValidRequestLink(req.params.token);
    const accessLink = await findValidAccessLink(req.params.token, req.query.access);

    res.json({
      token: link.token,
      title: link.title || 'Demande de prêt de matériel',
      resourceId: link.resourceId || null,
      expiresAt: link.expiresAt,
      authenticated: !!accessLink,
      requesterEmail: accessLink?.email || null,
      requesterName: accessLink?.requesterName || null,
      accessToken: accessLink?.token || null,
      resources: accessLink ? await getRequestResources(link) : []
    });
  } catch (err) {
    next(err);
  }
});

loanPublicRouter.post('/:token/access-link',
  loanAccessLinkLimiter,
  [
    body('requesterEmail').isEmail().normalizeEmail(),
    body('requesterName').optional({ values: 'falsy' }).trim().isLength({ max: 200 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const link = await findValidRequestLink(req.params.token);
      const requesterEmail = normalizeEmail(req.body.requesterEmail);
      const requesterName = (req.body.requesterName || '').trim() || null;

      const accessLink = await prisma.loanRequestAccessLink.create({
        data: {
          requestLinkId: link.id,
          email: requesterEmail,
          requesterName,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const { transporter, from } = createSmtpTransporter();
      if (!transporter) {
        return res.status(503).json({ error: 'La configuration SMTP est requise pour envoyer un lien de connexion.' });
      }

      const accessUrl = getLoanRequestUrl(link.token, accessLink.token);

      await transporter.sendMail({
        from,
        to: requesterEmail,
        subject: `Accès à votre demande de prêt${link.title ? ` – ${link.title}` : ''}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
            <h2 style="color:#0f172a;">Connexion à votre demande de prêt</h2>
            <p>Bonjour${requesterName ? ` ${requesterName}` : ''},</p>
            <p>Cliquez sur le lien ci-dessous pour ouvrir le formulaire de prêt sécurisé :</p>
            <p style="margin:24px 0;">
              <a href="${accessUrl}" style="background:#0284c7;color:white;padding:12px 24px;text-decoration:none;border-radius:10px;font-weight:600;display:inline-block;">Ouvrir le formulaire</a>
            </p>
            <p style="color:#475569;font-size:14px;">Ce lien est valable 24 heures et est lié à cette adresse email.</p>
            <p style="color:#94a3b8;font-size:12px;word-break:break-all;">Lien direct : <a href="${accessUrl}">${accessUrl}</a></p>
          </div>
        `
      });

      res.json({
        success: true,
        message: 'Un lien de connexion a été envoyé à cette adresse email.'
      });
    } catch (err) {
      next(err);
    }
  }
);

loanPublicRouter.post('/:token/requests',
  [
    body('accessToken').isString().isLength({ min: 10, max: 200 }),
    body('resourceId').isString(),
    body('requesterName').trim().isLength({ min: 2, max: 200 }),
    body('requesterPhone').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
    body('requesterOrganization').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('startAt').isISO8601(),
    body('endAt').isISO8601(),
    body('requestedUnits').isInt({ min: 1, max: 500 }),
    body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('additionalNeeds').optional({ values: 'falsy' }).trim().isLength({ max: 2000 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const link = await findValidRequestLink(req.params.token);
      const accessLink = await findValidAccessLink(req.params.token, req.body.accessToken);
      if (!accessLink) {
        return res.status(403).json({ error: 'Lien de connexion invalide ou expiré. Demandez un nouveau lien.' });
      }

      if (link.resourceId && link.resourceId !== req.body.resourceId) {
        return res.status(400).json({ error: 'Ce lien est limité à une ressource précise.' });
      }

      const { start, end } = ensureValidDates(req.body.startAt, req.body.endAt);
      const availability = await ensureAvailable(req.body.resourceId, start, end, req.body.requestedUnits);

      const reservation = await prisma.loanReservation.create({
        data: {
          resourceId: availability.resource.id,
          requestLinkId: link.id,
          requesterName: req.body.requesterName,
          requesterEmail: accessLink.email,
          requesterPhone: req.body.requesterPhone || null,
          requesterOrganization: req.body.requesterOrganization || null,
          startAt: start,
          endAt: end,
          requestedUnits: availability.requestedUnits,
          reservedSlots: availability.reservedSlots,
          notes: req.body.notes || null,
          additionalNeeds: req.body.additionalNeeds || null
        },
        include: {
          resource: true
        }
      });

      // Email de confirmation en arrière-plan (ne bloque pas la réponse)
      sendLoanConfirmationEmail(reservation).catch(() => {});

      res.status(201).json({
        message: 'Demande de prêt enregistrée',
        reservation: {
          id: reservation.id,
          status: reservation.status,
          resource: mapResource(reservation.resource)
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

loanPublicRouter.get('/resources/:id/schedule', async (req, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start) : new Date();
    const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const result = await getResourceSchedule(req.params.id, start, end);
    if (!result) return res.status(404).json({ error: 'Ressource introuvable' });
    res.json(result);
  } catch (err) { next(err); }
});

loansRouter.get('/calendar.ics', async (req, res, next) => {
  try {
    if (req.query.token !== getCalendarFeedToken()) {
      return res.status(403).send('Flux iCal non autorisé');
    }

    const startAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const events = await getCalendarEvents(startAt, endAt);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(buildIcs(events));
  } catch (err) {
    next(err);
  }
});

loansRouter.use(requireAuth);

loansRouter.get('/calendar-feed', (req, res) => {
  const token = getCalendarFeedToken();
  res.json({
    token,
    url: `${config.appUrl}/api/loans/calendar.ics?token=${encodeURIComponent(token)}`
  });
});

loansRouter.get('/resources/:id/schedule', async (req, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start) : new Date();
    const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const result = await getResourceSchedule(req.params.id, start, end);
    if (!result) return res.status(404).json({ error: 'Ressource introuvable' });
    res.json(result);
  } catch (err) { next(err); }
});

loansRouter.get('/resources', async (_req, res, next) => {
  try {
    const resources = await prisma.loanResource.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { reservations: true, magicLinks: true } },
        ...EQUIPMENT_SELECT
      }
    });
    res.json(resources.map(resource => ({ ...mapResource(resource) })));
  } catch (err) {
    next(err);
  }
});

loansRouter.post('/resources',
  [
    body('name').trim().isLength({ min: 2, max: 200 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('totalUnits').isInt({ min: 1, max: 500 }),
    body('bundleSize').optional().isInt({ min: 1, max: 500 }),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('instructions').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('color').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
    body('usesBundles').optional().isBoolean(),
    body('equipments').optional().isArray()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const totalUnits = Number(req.body.totalUnits) || 1;
      const usesBundles = req.body.usesBundles !== false;

      // Calculer bundleSize selon le mode
      let bundleSize;
      if (usesBundles) {
        // Mode avec lots : utiliser bundleSize fourni ou par défaut
        bundleSize = Math.max(1, Math.min(totalUnits, Number(req.body.bundleSize) || 1));
      } else {
        // Mode sans lots : bundleSize = totalUnits (1 seul lot)
        bundleSize = totalUnits;
      }

      const equipmentList = normalizeEquipmentList(req.body.equipments || req.body.equipmentIds);

      const resource = await prisma.loanResource.create({
        data: {
          name: req.body.name,
          category: req.body.category || null,
          description: req.body.description || null,
          totalUnits,
          bundleSize,
          location: req.body.location || null,
          instructions: req.body.instructions || null,
          color: req.body.color || null,
          usesBundles,
          equipments: equipmentList.length > 0
            ? { create: equipmentList.map(e => ({ equipmentId: e.id, lotNumber: e.lotNumber })) }
            : undefined
        },
        include: { ...EQUIPMENT_SELECT }
      });

      res.status(201).json(mapResource(resource));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.post('/resources/bulk',
  [body('equipmentIds').isArray({ min: 1, max: 200 })],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { equipmentIds } = req.body;

      // Récupérer les équipements valides
      const equipments = await prisma.equipment.findMany({
        where: { id: { in: equipmentIds } },
        select: { id: true, name: true, type: true, location: true }
      });

      // Filtrer ceux qui ont déjà une ressource de prêt liée
      const alreadyLinked = await prisma.loanResourceEquipment.findMany({
        where: { equipmentId: { in: equipmentIds } },
        select: { equipmentId: true }
      });
      const linkedIds = new Set(alreadyLinked.map(r => r.equipmentId));
      const toCreate = equipments.filter(e => !linkedIds.has(e.id));

      const created = await prisma.$transaction(
        toCreate.map(e => prisma.loanResource.create({
          data: {
            name: e.name,
            totalUnits: 1,
            bundleSize: 1,
            equipments: { create: [{ equipmentId: e.id }] }
          }
        }))
      );

      res.status(201).json({
        created: created.length,
        skipped: equipmentIds.length - toCreate.length,
        message: `${created.length} ressource(s) créée(s), ${equipmentIds.length - toCreate.length} déjà liée(s) ignorée(s).`
      });
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.patch('/resources/:id',
  [
    body('name').optional().trim().isLength({ min: 2, max: 200 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('totalUnits').optional().isInt({ min: 1, max: 500 }),
    body('bundleSize').optional().isInt({ min: 1, max: 500 }),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('instructions').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('color').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
    body('isActive').optional().isBoolean(),
    body('usesBundles').optional().isBoolean(),
    body('equipments').optional().isArray()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.loanResource.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Ressource introuvable' });

      const totalUnits = req.body.totalUnits !== undefined ? Number(req.body.totalUnits) : existing.totalUnits;
      const usesBundles = req.body.usesBundles !== undefined ? !!req.body.usesBundles : (existing.usesBundles ?? true);

      // Calculer bundleSize intelligemment
      let bundleSize;
      if (req.body.bundleSize !== undefined) {
        // Bundlesize fourni explicitement
        bundleSize = Math.max(1, Math.min(totalUnits, Number(req.body.bundleSize) || 1));
      } else if (req.body.totalUnits !== undefined || req.body.usesBundles !== undefined) {
        // totalUnits ou usesBundles ont changé : recalculer bundleSize
        if (usesBundles) {
          // Mode avec lots : garder la proportion existante si possible
          bundleSize = existing.bundleSize ? Math.max(1, Math.min(totalUnits, existing.bundleSize)) : 1;
        } else {
          // Mode sans lots : bundleSize = totalUnits pour avoir 1 seul lot
          bundleSize = totalUnits;
        }
      } else {
        // Rien n'a changé sur bundleSize : garder l'existant
        bundleSize = existing.bundleSize;
      }

      const updateData = {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.category !== undefined ? { category: req.body.category || null } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description || null } : {}),
        ...(req.body.totalUnits !== undefined ? { totalUnits } : {}),
        ...(req.body.bundleSize !== undefined || req.body.totalUnits !== undefined || req.body.usesBundles !== undefined ? { bundleSize } : {}),
        ...(req.body.location !== undefined ? { location: req.body.location || null } : {}),
        ...(req.body.instructions !== undefined ? { instructions: req.body.instructions || null } : {}),
        ...(req.body.color !== undefined ? { color: req.body.color || null } : {}),
        ...(req.body.isActive !== undefined ? { isActive: !!req.body.isActive } : {}),
        ...(req.body.usesBundles !== undefined ? { usesBundles: !!req.body.usesBundles } : {})
      };

      // Si equipments fourni, remplacer la liste
      const rawList = req.body.equipments ?? req.body.equipmentIds;
      if (Array.isArray(rawList)) {
        const equipmentList = normalizeEquipmentList(rawList);
        await prisma.loanResourceEquipment.deleteMany({ where: { loanResourceId: req.params.id } });
        if (equipmentList.length > 0) {
          await prisma.loanResourceEquipment.createMany({
            data: equipmentList.map(e => ({ loanResourceId: req.params.id, equipmentId: e.id, lotNumber: e.lotNumber })),
            skipDuplicates: true
          });
        }
      }

      const updated = await prisma.loanResource.update({
        where: { id: req.params.id },
        data: updateData,
        include: { ...EQUIPMENT_SELECT }
      });

      res.json(mapResource(updated));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.get('/magic-links', async (_req, res, next) => {
  try {
    const links = await prisma.loanMagicLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        resource: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { requests: true } }
      }
    });
    res.json(links);
  } catch (err) {
    next(err);
  }
});

loansRouter.post('/magic-links',
  [
    body('title').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('resourceId').optional({ values: 'falsy' }).isString(),
    body('expiresAt').optional({ values: 'falsy' }).isISO8601()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      if (req.body.resourceId) {
        const resource = await prisma.loanResource.findUnique({ where: { id: req.body.resourceId } });
        if (!resource) return res.status(404).json({ error: 'Ressource introuvable' });
      }

      const link = await prisma.loanMagicLink.create({
        data: {
          title: req.body.title || null,
          resourceId: req.body.resourceId || null,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
          createdById: req.user.id
        },
        include: {
          resource: { select: { id: true, name: true } }
        }
      });

      res.status(201).json({
        ...link,
        url: `${config.appUrl}/loan-request.html?token=${encodeURIComponent(link.token)}`
      });
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.patch('/magic-links/:id',
  [
    body('isActive').optional().isBoolean()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const link = await prisma.loanMagicLink.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.isActive !== undefined ? { isActive: !!req.body.isActive } : {})
        }
      });
      res.json(link);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Lien introuvable' });
      next(err);
    }
  }
);

loansRouter.get('/reservations',
  [
    query('start').optional().isISO8601(),
    query('end').optional().isISO8601(),
    query('status').optional().isString()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

      const where = {
        startAt: { lt: end },
        endAt: { gt: start }
      };

      if (req.query.status) {
        where.status = req.query.status;
      }

      const reservations = await prisma.loanReservation.findMany({
        where,
        orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
        include: RESERVATION_INCLUDE
      });

      res.json(reservations.map(mapReservation));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.get('/calendar', async (req, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const reservations = await getCalendarEvents(start, end);
    res.json(reservations.map(item => ({
      ...item,
      resource: mapResource(item.resource)
    })));
  } catch (err) {
    next(err);
  }
});

loansRouter.post('/reservations',
  [
    body('resourceId').isString(),
    body('requesterName').trim().isLength({ min: 2, max: 200 }),
    body('requesterEmail').isEmail().normalizeEmail(),
    body('requesterPhone').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
    body('requesterOrganization').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('startAt').isISO8601(),
    body('endAt').isISO8601(),
    body('requestedUnits').isInt({ min: 1, max: 500 }),
    body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('internalNotes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('contractBody').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }),
    body('selectedEquipmentIds').optional().isArray({ max: 500 }),
    body('status').optional().isIn(['PENDING', 'APPROVED']),
    body('recurrence.type').optional().isIn(['none', 'daily', 'weekly', 'biweekly', 'monthly']),
    body('recurrence.until').optional().isISO8601()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { start, end } = ensureValidDates(req.body.startAt, req.body.endAt);
      const occurrences = computeOccurrences(start, end, req.body.recurrence);

      const created = [];
      const selectedEquipmentIds = normalizeSelectedEquipmentIds(req.body.selectedEquipmentIds);
      for (const occ of occurrences) {
        const availability = await ensureAvailable(req.body.resourceId, occ.startAt, occ.endAt, req.body.requestedUnits);
        const selectedEquipments = buildSelectedEquipmentSnapshots(availability.resource, selectedEquipmentIds);
        const reservation = await prisma.loanReservation.create({
          data: {
            resourceId: availability.resource.id,
            requesterName: req.body.requesterName,
            requesterEmail: normalizeEmail(req.body.requesterEmail),
            requesterPhone: req.body.requesterPhone || null,
            requesterOrganization: req.body.requesterOrganization || null,
            startAt: occ.startAt,
            endAt: occ.endAt,
            requestedUnits: availability.requestedUnits,
            reservedSlots: availability.reservedSlots,
            notes: req.body.notes || null,
            internalNotes: req.body.internalNotes || null,
            contractBody: req.body.contractBody ? String(req.body.contractBody).trim() : null,
            status: req.body.status || 'APPROVED',
            createdById: req.user.id,
            selectedEquipments: selectedEquipments.length
              ? { create: selectedEquipments }
              : undefined
          },
          include: RESERVATION_INCLUDE
        });
        created.push(reservation);
      }

      res.status(201).json({
        count: created.length,
        reservations: created.map(mapReservation)
      });
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.patch('/reservations/:id',
  [
    body('resourceId').optional().isString(),
    body('requesterName').optional().trim().isLength({ min: 2, max: 200 }),
    body('requesterEmail').optional().isEmail().normalizeEmail(),
    body('requesterPhone').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
    body('requesterOrganization').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('startAt').optional().isISO8601(),
    body('endAt').optional().isISO8601(),
    body('requestedUnits').optional().isInt({ min: 1, max: 500 }),
    body('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED']),
    body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('internalNotes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('additionalNeeds').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('contractBody').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }),
    body('selectedEquipmentIds').optional().isArray({ max: 500 }),
    body('skipNotification').optional().isBoolean()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.loanReservation.findUnique({
        where: { id: req.params.id },
        include: RESERVATION_INCLUDE
      });
      if (!existing) return res.status(404).json({ error: 'Réservation introuvable' });

      const nextData = {
        resourceId: req.body.resourceId || existing.resourceId,
        requesterName: req.body.requesterName !== undefined ? req.body.requesterName : existing.requesterName,
        requesterEmail: req.body.requesterEmail !== undefined ? normalizeEmail(req.body.requesterEmail) : existing.requesterEmail,
        requesterPhone: req.body.requesterPhone !== undefined ? (req.body.requesterPhone || null) : existing.requesterPhone,
        requesterOrganization: req.body.requesterOrganization !== undefined ? (req.body.requesterOrganization || null) : existing.requesterOrganization,
        notes: req.body.notes !== undefined ? (req.body.notes || null) : existing.notes,
        internalNotes: req.body.internalNotes !== undefined ? (req.body.internalNotes || null) : existing.internalNotes,
        additionalNeeds: req.body.additionalNeeds !== undefined ? (req.body.additionalNeeds || null) : existing.additionalNeeds,
        contractBody: req.body.contractBody !== undefined ? (String(req.body.contractBody || '').trim() || null) : existing.contractBody,
        status: req.body.status !== undefined ? req.body.status : existing.status
      };

      if (req.body.startAt !== undefined || req.body.endAt !== undefined) {
        const { start, end } = ensureValidDates(
          req.body.startAt !== undefined ? req.body.startAt : existing.startAt,
          req.body.endAt !== undefined ? req.body.endAt : existing.endAt
        );
        nextData.startAt = start;
        nextData.endAt = end;
      } else {
        nextData.startAt = existing.startAt;
        nextData.endAt = existing.endAt;
      }

      if (req.body.requestedUnits !== undefined) {
        nextData.requestedUnits = parseInt(req.body.requestedUnits, 10);
      } else {
        nextData.requestedUnits = existing.requestedUnits;
      }

      const scheduleChanged = hasReservationScheduleChange(existing, nextData);
      const shouldRecheckAvailability = scheduleChanged || (req.body.status === 'APPROVED' && existing.status !== 'APPROVED');
      let availability = null;
      const selectedEquipmentProvided = req.body.selectedEquipmentIds !== undefined;
      let selectedEquipmentSnapshots = null;

      if (shouldRecheckAvailability) {
        availability = await ensureAvailable(
          nextData.resourceId,
          nextData.startAt,
          nextData.endAt,
          nextData.requestedUnits,
          existing.id
        );
      }

      if (!availability && nextData.resourceId !== existing.resourceId) {
        const resource = await prisma.loanResource.findUnique({
          where: { id: nextData.resourceId },
          include: { ...EQUIPMENT_SELECT }
        });
        if (!resource || !resource.isActive) {
          return res.status(404).json({ error: 'Ressource de prêt introuvable' });
        }
        availability = {
          resource,
          requestedUnits: nextData.requestedUnits,
          reservedSlots: computeReservedSlots(resource, nextData.requestedUnits)
        };
      }

      let selectionResource = availability?.resource || existing.resource;
      if ((selectedEquipmentProvided || nextData.resourceId !== existing.resourceId) && !selectionResource?.id) {
        selectionResource = await prisma.loanResource.findUnique({
          where: { id: nextData.resourceId },
          include: { ...EQUIPMENT_SELECT }
        });
      }

      if (selectedEquipmentProvided || nextData.resourceId !== existing.resourceId) {
        selectedEquipmentSnapshots = buildSelectedEquipmentSnapshots(
          selectionResource,
          selectedEquipmentProvided ? req.body.selectedEquipmentIds : []
        );
      }

      const contractRelevantChange = existing.contractSignatureRequestId
        ? hasContractRelevantChange(existing, nextData, {
            contractBodyProvided: req.body.contractBody !== undefined,
            selectedEquipmentProvided,
            selectedEquipmentIds: selectedEquipmentProvided ? req.body.selectedEquipmentIds : []
          })
        : false;

      if (contractRelevantChange && existing.contractSignatureRequest?.status === 'SIGNED') {
        return res.status(409).json({
          error: 'Ce prêt possède déjà une fiche signée. Modifiez d’abord la fiche contractuelle ou créez une nouvelle réservation.'
        });
      }

      if (contractRelevantChange && existing.contractSignatureRequest?.status === 'PENDING') {
        await prisma.signatureRequest.update({
          where: { id: existing.contractSignatureRequest.id },
          data: { status: 'CANCELLED' }
        });
      }

      const reservation = await prisma.loanReservation.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.resourceId !== undefined ? { resourceId: nextData.resourceId } : {}),
          ...(req.body.requesterName !== undefined ? { requesterName: nextData.requesterName } : {}),
          ...(req.body.requesterEmail !== undefined ? { requesterEmail: nextData.requesterEmail } : {}),
          ...(req.body.requesterPhone !== undefined ? { requesterPhone: nextData.requesterPhone } : {}),
          ...(req.body.requesterOrganization !== undefined ? { requesterOrganization: nextData.requesterOrganization } : {}),
          ...(req.body.startAt !== undefined ? { startAt: nextData.startAt } : {}),
          ...(req.body.endAt !== undefined ? { endAt: nextData.endAt } : {}),
          ...(req.body.requestedUnits !== undefined ? { requestedUnits: nextData.requestedUnits } : {}),
          ...(availability ? { reservedSlots: availability.reservedSlots } : {}),
          ...(req.body.notes !== undefined ? { notes: nextData.notes } : {}),
          ...(req.body.status !== undefined ? { status: nextData.status, approvedById: nextData.status === 'APPROVED' ? req.user.id : existing.approvedById } : {}),
          ...(req.body.internalNotes !== undefined ? { internalNotes: nextData.internalNotes } : {}),
          ...(req.body.additionalNeeds !== undefined ? { additionalNeeds: nextData.additionalNeeds } : {}),
          ...(req.body.contractBody !== undefined ? { contractBody: nextData.contractBody } : {}),
          ...(contractRelevantChange ? { contractSignatureRequestId: null, contractGeneratedAt: null } : {})
        },
        include: RESERVATION_INCLUDE
      });

      if (selectedEquipmentSnapshots !== null) {
        await prisma.loanReservationEquipment.deleteMany({
          where: { loanReservationId: reservation.id }
        });
        if (selectedEquipmentSnapshots.length) {
          await prisma.loanReservationEquipment.createMany({
            data: selectedEquipmentSnapshots.map(item => ({
              loanReservationId: reservation.id,
              ...item
            }))
          });
        }
      }

      const refreshedReservation = await prisma.loanReservation.findUnique({
        where: { id: reservation.id },
        include: RESERVATION_INCLUDE
      });

      // Email si statut changé vers APPROVED ou REJECTED
      if (req.body.status && req.body.status !== existing.status && !req.body.skipNotification) {
        sendLoanStatusEmail(reservation, req.body.status).catch(() => {});
      }

      res.json(mapReservation(refreshedReservation || reservation));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.post('/reservations/:id/contract-signature',
  [
    body('message').optional({ values: 'falsy' }).trim().isLength({ max: 2000 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const reservation = await prisma.loanReservation.findUnique({
        where: { id: req.params.id },
        include: RESERVATION_INCLUDE
      });
      if (!reservation) {
        return res.status(404).json({ error: 'Réservation introuvable' });
      }

      if (reservation.contractSignatureRequest && ['PENDING', 'SIGNED'].includes(reservation.contractSignatureRequest.status)) {
        return res.status(409).json({
          error: reservation.contractSignatureRequest.status === 'SIGNED'
            ? 'Une fiche signée existe déjà pour cette réservation.'
            : 'Une fiche de prêt est déjà en attente de signature pour cette réservation.',
          signatureRequest: mapContractSignatureRequest(reservation.contractSignatureRequest)
        });
      }

      const resource = reservation.resource;
      const contractBody = getEffectiveContractBody(reservation, resource);
      const selectedEquipments = Array.isArray(reservation.selectedEquipments)
        ? reservation.selectedEquipments.map(mapSelectedEquipment)
        : [];
      const documentTitle = getLoanContractDocumentTitle(reservation, resource);
      const documentNotes = getLoanContractDocumentNotes(reservation, resource);
      const { buffer, signaturePlacement } = await buildLoanContractPdf({
        reservation,
        resource,
        contractBody,
        selectedEquipments
      });

      const sigReq = await prisma.signatureRequest.create({
        data: {
          orderId: null,
          token: randomUUID(),
          documentTitle,
          documentNotes,
          recipientEmail: reservation.requesterEmail,
          recipientName: reservation.requesterName,
          message: req.body.message ? String(req.body.message).trim() : 'Merci de signer cette fiche de prêt avant le retrait du matériel.',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdBy: req.user.id,
          posX: signaturePlacement?.posX ?? null,
          posY: signaturePlacement?.posY ?? null,
          sigWidth: signaturePlacement?.sigWidth ?? null,
          sigHeight: signaturePlacement?.sigHeight ?? null
        }
      });

      const srcDir = path.join(process.cwd(), 'uploads', 'signatures', 'source', sigReq.id);
      if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

      const sourceFileStoredAs = `${randomUUID()}.pdf`;
      fs.writeFileSync(path.join(srcDir, sourceFileStoredAs), buffer);

      await prisma.signatureRequest.update({
        where: { id: sigReq.id },
        data: {
          sourceFileStoredAs,
          sourceFilename: `${documentTitle}.pdf`,
          sourceFileMimetype: 'application/pdf'
        }
      });

      await prisma.loanReservation.update({
        where: { id: reservation.id },
        data: {
          contractBody,
          contractGeneratedAt: new Date(),
          contractSignatureRequestId: sigReq.id
        }
      });

      await sendLoanContractSignatureEmail(sigReq, reservation, documentTitle, documentNotes);

      res.status(201).json({
        success: true,
        message: 'Fiche de prêt générée et envoyée en signature.',
        signatureRequest: {
          id: sigReq.id,
          status: sigReq.status,
          documentTitle
        }
      });
    } catch (err) {
      if (err.message?.includes('SMTP')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

loansRouter.delete('/reservations/:id', async (req, res, next) => {
  try {
    const existing = await prisma.loanReservation.findUnique({
      where: { id: req.params.id },
      include: {
        contractSignatureRequest: {
          select: { id: true, status: true }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Réservation introuvable' });
    }

    if (existing.contractSignatureRequest?.status === 'PENDING') {
      await prisma.signatureRequest.update({
        where: { id: existing.contractSignatureRequest.id },
        data: { status: 'CANCELLED' }
      });
    }

    await prisma.loanReservation.delete({
      where: { id: req.params.id }
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = { loansRouter, loanPublicRouter };

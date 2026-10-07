const { randomUUID } = require('crypto');
const path = require('path');
const prisma = require('../lib/prisma');
const { notifyAdminsOfNewTicket } = require('../utils/ticketNotifications');
const { containsFilter } = require('../lib/db-utils');
const { createSmtpTransporter } = require('../utils/mail');
const config = require('../config');

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function notifyChatParticipants(ticket, message, supportSide) {
  const { transporter, from } = createSmtpTransporter();
  if (!transporter) return;
  let recipients;
  if (supportSide) {
    const reporters = [...(ticket.reporters || [])];
    if (ticket.reporterEmail && !reporters.some(reporter => reporter.email?.toLowerCase() === ticket.reporterEmail.toLowerCase())) {
      reporters.push({ email: ticket.reporterEmail, token: ticket.reporterToken, notifyByEmail: true });
    }
    recipients = reporters.filter(reporter => reporter.email && reporter.notifyByEmail !== false).map(reporter => ({
      email: reporter.email, token: reporter.token || ticket.reporterToken
    }));
  } else if (ticket.techId) {
    const tech = await prisma.user.findUnique({ where: { id: ticket.techId }, select: { email: true, contactEmail: true } });
    recipients = tech ? [{ email: tech.contactEmail || tech.email }] : [];
  } else {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { email: true, contactEmail: true } });
    recipients = admins.map(admin => ({ email: admin.contactEmail || admin.email }));
  }
  const unique = [...new Map(recipients.filter(recipient => recipient.email)
    .map(recipient => [recipient.email.toLowerCase(), recipient])).values()];
  await Promise.all(unique.map(recipient => {
    const path = supportSide && recipient.token
      ? `/ticket-status.html?token=${encodeURIComponent(recipient.token)}`
      : `/messages-ticket.html?id=${encodeURIComponent(ticket.id)}`;
    return transporter.sendMail({
      from, to: recipient.email,
      subject: `[Nouveau message] ${ticket.title.replace(/[\r\n]+/g, ' ')}`,
      html: `<p><strong>${escapeHtml(message.authorName)}</strong> a envoyé un message :</p><blockquote>${escapeHtml(message.content)}</blockquote><p><a href="${config.appUrl.replace(/\/$/, '')}${path}">Ouvrir la conversation</a></p>`
    });
  }));
}

function accessWhere(user) {
  if (user.role === 'ADMIN') return {};
  const email = user.contactEmail || user.email;
  return { OR: [
    { techId: user.id },
    { reporterEmail: email },
    { reporters: { some: { email } } }
  ] };
}

async function getAccessibleTicket(id, user) {
  if (!user?.id || !user.isActive) throw Object.assign(new Error('Utilisateur actif requis.'), { status: 403 });
  const ticket = await prisma.intervention.findFirst({
    where: { AND: [{ id, source: 'PUBLIC' }, accessWhere(user)] },
    include: { reporters: true, room: { select: { id: true, name: true } }, equipment: { select: { id: true, name: true } } }
  });
  if (!ticket) throw Object.assign(new Error('Demande de support introuvable ou inaccessible.'), { status: 404 });
  return ticket;
}

function ticketSummary(ticket) {
  return {
    id: ticket.id, title: ticket.title, description: ticket.description,
    status: ticket.status, priority: ticket.priority, reporterName: ticket.reporterName,
    reporterEmail: ticket.reporterEmail, techId: ticket.techId,
    room: ticket.room || null, suggestedRoom: ticket.suggestedRoom,
    equipment: ticket.equipment || null, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt
  };
}

async function listSupportRequests({ status, search, limit = 20 } = {}, { user }) {
  if (!user?.id || !user.isActive) throw Object.assign(new Error('Utilisateur actif requis.'), { status: 403 });
  const clauses = [{ source: 'PUBLIC', mergedIntoId: null }, accessWhere(user)];
  if (status) clauses.push({ status });
  if (search?.trim()) clauses.push({ OR: [
    { title: containsFilter(search.trim()) },
    { description: containsFilter(search.trim()) },
    { reporterName: containsFilter(search.trim()) },
    { reporterEmail: containsFilter(search.trim()) }
  ] });
  const tickets = await prisma.intervention.findMany({
    where: { AND: clauses }, orderBy: { createdAt: 'desc' }, take: limit,
    include: { room: { select: { id: true, name: true } }, equipment: { select: { id: true, name: true } } }
  });
  return tickets.map(ticketSummary);
}

async function getSupportRequest({ id }, { user }) {
  return ticketSummary(await getAccessibleTicket(id, user));
}

async function listSupportMessages({ id }, { user }) {
  const ticket = await getAccessibleTicket(id, user);
  const supportSide = user.role === 'ADMIN' || ticket.techId === user.id;
  const email = (user.contactEmail || user.email || '').trim().toLowerCase();
  const reporter = ticket.reporters?.find(item => item.email?.trim().toLowerCase() === email);
  const reporterToken = reporter?.token || (ticket.reporterEmail?.trim().toLowerCase() === email ? ticket.reporterToken : null);
  await prisma.ticketMessage.updateMany({
    where: { interventionId: id, authorType: supportSide ? 'REPORTER' : 'TECH', readAt: null },
    data: { readAt: new Date() }
  });
  const messages = await prisma.ticketMessage.findMany({
    where: { interventionId: id }, orderBy: { createdAt: 'asc' },
    select: { id: true, content: true, authorType: true, authorName: true, createdAt: true,
      readAt: true, attachmentPath: true, attachmentName: true, attachmentMime: true, attachmentSize: true }
  });
  return messages.map(message => ({
    ...message,
    attachmentPath: undefined,
    attachmentUrl: message.attachmentPath && (supportSide || reporterToken)
      ? `${supportSide ? `/api/interventions/${encodeURIComponent(id)}` : `/api/tickets/${encodeURIComponent(reporterToken)}`}/attachments/${encodeURIComponent(path.basename(message.attachmentPath))}`
      : null
  }));
}

async function sendSupportMessage({ id, content }, { user }) {
  const ticket = await getAccessibleTicket(id, user);
  const text = String(content || '').trim();
  if (!text || text.length > 2000) {
    throw Object.assign(new Error('Message requis (2000 caractères maximum).'), { status: 400 });
  }
  const supportSide = user.role === 'ADMIN' || ticket.techId === user.id;
  if (!supportSide) {
    const lastTechMessage = await prisma.ticketMessage.findFirst({
      where: { interventionId: id, authorType: 'TECH' }, orderBy: { createdAt: 'desc' }
    });
    const recentCount = await prisma.ticketMessage.count({
      where: { interventionId: id, authorType: 'REPORTER',
        createdAt: { gte: lastTechMessage?.createdAt || new Date(Date.now() - 60 * 60 * 1000) } }
    });
    if (recentCount >= 5) throw Object.assign(new Error('Trop de messages envoyés. Attendez une réponse du support.'), { status: 429 });
  }
  const message = await prisma.ticketMessage.create({ data: {
    interventionId: id, content: text, authorType: supportSide ? 'TECH' : 'REPORTER', authorName: user.name
  } });
  try { await notifyChatParticipants(ticket, message, supportSide); }
  catch (error) { console.error('[mcp] notification chat:', error); }
  return { id: message.id, interventionId: id, content: message.content,
    authorType: message.authorType, authorName: message.authorName, createdAt: message.createdAt };
}

async function createSupportRequest(input, { user }) {
  if (!user?.id || !user.isActive) {
    throw Object.assign(new Error('Un utilisateur actif est requis pour créer une demande de support.'), { status: 403 });
  }

  const reporterName = input.reporterName?.trim() || user.name?.trim();
  const reporterEmail = (input.reporterEmail?.trim() || user.contactEmail?.trim() || user.email?.trim())?.toLowerCase();
  if (!reporterName || !reporterEmail) {
    throw Object.assign(new Error('Le nom et l’adresse email du demandeur sont requis.'), { status: 400 });
  }
  if (!!input.reporterName !== !!input.reporterEmail) {
    throw Object.assign(new Error('Le nom et l’adresse email de l’autre demandeur sont requis ensemble.'), { status: 400 });
  }

  let roomId = null;
  if (input.roomId) {
    const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { id: true } });
    if (!room) throw Object.assign(new Error('Salle introuvable.'), { status: 404 });
    roomId = room.id;
  }
  const reporterToken = randomUUID();
  const intervention = await prisma.intervention.create({ data: {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    status: 'OPEN', priority: 'NORMAL', source: 'PUBLIC', techId: null,
    roomId, suggestedRoom: roomId ? null : input.suggestedRoom?.trim() || null,
    reporterName, reporterEmail, reporterToken,
    reporters: { create: { name: reporterName, email: reporterEmail, token: reporterToken, isPrimary: true, notifyByEmail: true } }
  } });

  try { await notifyAdminsOfNewTicket(intervention); }
  catch (error) { console.error('[mcp] notification nouvelle demande:', error); }

  return { id: intervention.id, status: intervention.status, reporterName, reporterEmail, reporterToken };
}

module.exports = { createSupportRequest, listSupportRequests, getSupportRequest, listSupportMessages, sendSupportMessage };

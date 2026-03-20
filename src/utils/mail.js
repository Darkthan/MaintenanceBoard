const nodemailer = require('nodemailer');
const { readSettings } = require('./settings');
const config = require('../config');

function createSmtpTransporter() {
  const s = (readSettings().smtp) || {};
  const host = s.host || config.smtp?.host;
  const port = parseInt(s.port || config.smtp?.port) || 587;
  const user = s.user || config.smtp?.user;
  const pass = s.pass || config.smtp?.pass;
  const from = s.from || config.smtp?.from || 'noreply@maintenance.local';
  const secure = s.secure || false;

  if (!host) return { transporter: null, from, orgName: '' };

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false }
  });

  const orgName = (readSettings().poTemplate || {}).orgName || '';
  return { transporter, from, orgName };
}

module.exports = { createSmtpTransporter };

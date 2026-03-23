const nodemailer = require('nodemailer');
const { readSettings } = require('./settings');
const config = require('../config');

function buildSmtpTransportOptions({ host, port, user, pass, secure, starttls }) {
  const useSecure = !!secure;
  const useStarttls = !useSecure && !!starttls;

  return {
    host,
    port,
    secure: useSecure,
    requireTLS: useStarttls,
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false }
  };
}

function createSmtpTransporter() {
  const s = (readSettings().smtp) || {};
  const host = s.host || config.smtp?.host;
  const port = parseInt(s.port || config.smtp?.port) || 587;
  const user = s.user || config.smtp?.user;
  const pass = s.pass || config.smtp?.pass;
  const from = s.from || config.smtp?.from || 'noreply@maintenance.local';
  const secure = s.secure ?? config.smtp?.secure ?? false;
  const starttls = s.starttls ?? config.smtp?.starttls ?? false;

  if (!host) return { transporter: null, from, orgName: '' };

  const transporter = nodemailer.createTransport(buildSmtpTransportOptions({
    host,
    port,
    user,
    pass,
    secure,
    starttls
  }));

  const orgName = (readSettings().poTemplate || {}).orgName || '';
  return { transporter, from, orgName };
}

module.exports = { createSmtpTransporter, buildSmtpTransportOptions };

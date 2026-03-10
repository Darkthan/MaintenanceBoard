const QRCode = require('qrcode');
const config = require('../config');

/**
 * Génère un QR code PNG en buffer pour un token donné
 */
async function generateQrCode(token, type = 'room') {
  const url = `${config.appUrl}/scan?token=${token}`;

  const pngBuffer = await QRCode.toBuffer(url, {
    type: 'png',
    width: 300,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    },
    errorCorrectionLevel: 'M'
  });

  return pngBuffer;
}

/**
 * Génère un QR code en Data URL (base64) pour affichage inline
 */
async function generateQrDataUrl(token) {
  const url = `${config.appUrl}/scan?token=${token}`;

  return QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: 'M'
  });
}

/**
 * Génère une URL de scan à partir d'un token
 */
function getScanUrl(token) {
  return `${config.appUrl}/scan?token=${token}`;
}

module.exports = { generateQrCode, generateQrDataUrl, getScanUrl };

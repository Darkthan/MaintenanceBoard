const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// S'assurer que le dossier uploads existe
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Storage pour les photos d'interventions
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.upload.dir, 'photos');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `photo-${uniqueSuffix}${ext}`);
  }
});

// Storage pour les imports CSV/Excel
const importStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.upload.dir, 'imports');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `import-${uniqueSuffix}${ext}`);
  }
});

// Filtre pour les images
const imageFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Seules les images (JPEG, PNG, GIF, WebP) sont acceptées'), false);
  }
};

// Filtre pour les fichiers d'import
const importFilter = (req, file, cb) => {
  const allowedMimes = [
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedMimes.includes(file.mimetype) || ['.csv', '.xlsx', '.xls'].includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers CSV et Excel sont acceptés'), false);
  }
};

const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: imageFilter
});

const uploadImport = multer({
  storage: importStorage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: importFilter
});

module.exports = { uploadPhoto, uploadImport };

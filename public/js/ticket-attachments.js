(function initTicketAttachments(global) {
  const INPUT_MAX_BYTES = 25 * 1024 * 1024;
  const FINAL_MAX_BYTES = 5 * 1024 * 1024;
  const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
      : `${Math.ceil(bytes / 1024)} Ko`;
  }

  function compressedFileName(name) {
    const base = String(name || 'photo').replace(/\.[^.]+$/, '').slice(0, 180) || 'photo';
    return `${base}-compressee.jpg`;
  }

  function renderImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const ratio = Math.min(1, maxWidth / image.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * ratio));
          canvas.height = Math.max(1, Math.round(image.height * ratio));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) return reject(new Error("La photo n'a pas pu être compressée."));
            resolve(new File([blob], compressedFileName(file.name), { type: 'image/jpeg', lastModified: Date.now() }));
          }, 'image/jpeg', quality);
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("La photo n'a pas pu être lue."));
      };
      image.src = objectUrl;
    });
  }

  async function compressImage(file) {
    let compressed = await renderImage(file, 1920, 0.78);
    if (compressed.size > FINAL_MAX_BYTES) {
      compressed = await renderImage(file, 1280, 0.64);
    }
    return compressed.size < file.size ? compressed : file;
  }

  async function prepare(file) {
    if (!file) return null;
    if (IMAGE_MIMES.has(file.type)) {
      const compressed = await compressImage(file);
      if (compressed.size > INPUT_MAX_BYTES) {
        throw new Error('La photo reste supérieure à 25 Mo après compression.');
      }
      return compressed;
    }
    if (file.size > INPUT_MAX_BYTES) {
      throw new Error('Le fichier dépasse 25 Mo. Réduisez-le avant de réessayer.');
    }
    if (!VIDEO_MIMES.has(file.type) && file.type !== 'application/pdf' && file.size > FINAL_MAX_BYTES) {
      throw new Error('Ce type de fichier doit faire 5 Mo maximum.');
    }
    return file;
  }

  function selectionMessage(file) {
    if (!file) return '';
    if ((VIDEO_MIMES.has(file.type) || file.type === 'application/pdf') && file.size > FINAL_MAX_BYTES) {
      return `${file.name} · ${formatSize(file.size)} · sera compressé à l’envoi`;
    }
    if (IMAGE_MIMES.has(file.type)) {
      return `${file.name} · ${formatSize(file.size)} · photo compressée à l’envoi`;
    }
    return `${file.name} · ${formatSize(file.size)}`;
  }

  global.TicketAttachments = {
    INPUT_MAX_BYTES,
    FINAL_MAX_BYTES,
    IMAGE_MIMES,
    VIDEO_MIMES,
    formatSize,
    prepare,
    selectionMessage
  };
})(window);

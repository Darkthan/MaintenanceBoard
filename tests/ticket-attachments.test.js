const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ALLOWED_TICKET_ATTACHMENT_MIMES,
  TICKET_ATTACHMENT_INPUT_MAX_BYTES,
  TICKET_ATTACHMENT_FINAL_MAX_BYTES,
  formatTicketUploadError,
  prepareTicketAttachment
} = require('../src/middleware/ticketAttachment');

describe('pièces jointes des demandes', () => {
  it('applique les limites d’entrée et de stockage attendues', () => {
    expect(TICKET_ATTACHMENT_INPUT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(TICKET_ATTACHMENT_FINAL_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(ALLOWED_TICKET_ATTACHMENT_MIMES).toEqual(expect.arrayContaining([
      'application/pdf',
      'video/mp4',
      'video/webm',
      'video/quicktime'
    ]));
    expect(formatTicketUploadError({ code: 'LIMIT_FILE_SIZE' })).toContain('25 Mo');
  });

  it('refuse et supprime un document qui dépasse la limite finale', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-ticket-'));
    const filePath = path.join(tempDir, 'document.docx');
    fs.writeFileSync(filePath, Buffer.alloc(TICKET_ATTACHMENT_FINAL_MAX_BYTES + 1));
    const req = {
      file: {
        path: filePath,
        filename: 'document.docx',
        originalname: 'document.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: TICKET_ATTACHMENT_FINAL_MAX_BYTES + 1
      }
    };
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    const next = jest.fn();

    await prepareTicketAttachment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('5 Mo') }));
    expect(next).not.toHaveBeenCalled();
    expect(fs.existsSync(filePath)).toBe(false);
    fs.rmdirSync(tempDir);
  });
});

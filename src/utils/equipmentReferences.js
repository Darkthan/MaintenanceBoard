const REFERENCE_FIELDS = ['invoiceNumber', 'deliveryNoteNumber'];

function equipmentReferences(input) {
  const data = {};
  for (const field of REFERENCE_FIELDS) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if (value !== null && (typeof value !== 'string' || value.trim().length > 200)) {
      const error = new Error(`${field} doit être un texte de 200 caractères maximum`);
      error.status = 400;
      throw error;
    }
    data[field] = value === null ? null : value.trim() || null;
  }
  return data;
}

module.exports = { equipmentReferences, REFERENCE_FIELDS };

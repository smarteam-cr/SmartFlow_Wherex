function isCustomerCareAssistance(fields, fieldIds) {
  for (const fieldId of fieldIds) {
    const raw = fields?.[fieldId];
    const value = raw && typeof raw === 'object' ? raw.value : raw;
    if (typeof value === 'string' && value.trim().startsWith('CC')) return true;
  }
  return false;
}

module.exports = { isCustomerCareAssistance };

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isCustomerCareAssistance } = require('../../src/modules/jira/utils/assistanceType');

describe('modules/jira/utils/assistanceType', () => {
  const fieldIds = ['customfield_10822', 'customfield_10823', 'customfield_10824', 'customfield_10825'];

  it('returns true when a configured field value starts with "CC"', () => {
    const fields = {
      customfield_10822: { value: 'CC - Registro y accesos', id: '12557' },
      customfield_10823: null,
      customfield_10824: null,
      customfield_10825: null,
    };
    expect(isCustomerCareAssistance(fields, fieldIds)).toBe(true);
  });

  it('returns false when all configured fields are null', () => {
    const fields = {
      customfield_10822: null,
      customfield_10823: null,
      customfield_10824: null,
      customfield_10825: null,
    };
    expect(isCustomerCareAssistance(fields, fieldIds)).toBe(false);
  });

  it('returns false when the populated field starts with "ING"', () => {
    const fields = {
      customfield_10822: null,
      customfield_10823: { value: 'ING - Soporte técnico', id: '99' },
      customfield_10824: null,
      customfield_10825: null,
    };
    expect(isCustomerCareAssistance(fields, fieldIds)).toBe(false);
  });

  it('finds a match regardless of which of the configured fields is populated', () => {
    const fields = { customfield_10825: { value: 'CC - Facturación', id: '1' } };
    expect(isCustomerCareAssistance(fields, fieldIds)).toBe(true);
  });

  it('accepts a plain string value, not only the { value } option shape', () => {
    const fields = { customfield_10822: 'CC - Registro y accesos' };
    expect(isCustomerCareAssistance(fields, fieldIds)).toBe(true);
  });

  it('returns false when fields is missing entirely', () => {
    expect(isCustomerCareAssistance(undefined, fieldIds)).toBe(false);
  });

  it('returns false when fieldIds is empty', () => {
    const fields = { customfield_10822: { value: 'CC - Registro y accesos' } };
    expect(isCustomerCareAssistance(fields, [])).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const buildIssueNote = require('../../src/modules/jira/utils/issueNote');

describe('modules/jira/utils/issueNote', () => {
  it('includes the description when present', () => {
    const issue = {
      fields: {
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ayuda con proveedor' }] }] },
      },
      names: {},
    };
    expect(buildIssueNote(issue)).toBe('Descripción: ayuda con proveedor');
  });

  it('includes custom fields with their human-readable label from names', () => {
    const issue = {
      fields: { customfield_10088: 'Acme Corp', customfield_10117: 'México' },
      names: { customfield_10088: 'Empresa solicitante', customfield_10117: 'País solicitud' },
    };
    const note = buildIssueNote(issue);
    expect(note).toContain('Empresa solicitante: Acme Corp');
    expect(note).toContain('País solicitud: México');
  });

  it('falls back to the raw field key when no name mapping exists', () => {
    const issue = { fields: { customfield_999: 'valor' }, names: {} };
    expect(buildIssueNote(issue)).toBe('customfield_999: valor');
  });

  it('unwraps { value } and { name } option objects', () => {
    const issue = {
      fields: { customfield_a: { value: 'Opción A' }, customfield_b: { name: 'Juan' } },
      names: { customfield_a: 'Campo A', customfield_b: 'Campo B' },
    };
    const note = buildIssueNote(issue);
    expect(note).toContain('Campo A: Opción A');
    expect(note).toContain('Campo B: Juan');
  });

  it('joins array values with commas', () => {
    const issue = { fields: { customfield_multi: ['uno', 'dos'] }, names: { customfield_multi: 'Multi' } };
    expect(buildIssueNote(issue)).toBe('Multi: uno, dos');
  });

  it('skips null, undefined, empty-string, and empty-object/array fields', () => {
    const issue = {
      fields: { a: null, b: undefined, c: '', d: {}, e: [], f: '  ' },
      names: {},
    };
    expect(buildIssueNote(issue)).toBe('');
  });

  it('skips standard bookkeeping fields (summary, project, status, etc.)', () => {
    const issue = {
      fields: {
        summary: 'Titulo',
        project: { key: 'PROJ' },
        status: { name: 'Open' },
        updated: '2026-07-10T10:00:00.000Z',
        reporter: { displayName: 'Ana' },
      },
      names: {},
    };
    expect(buildIssueNote(issue)).toBe('');
  });

  it('returns an empty string for a missing issue or missing fields', () => {
    expect(buildIssueNote(undefined)).toBe('');
    expect(buildIssueNote({})).toBe('');
  });
});

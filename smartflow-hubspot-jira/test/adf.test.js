import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const extractDescription = require('../src/utils/adf');

describe('utils/adf extractDescription', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(extractDescription(null)).toBe('');
    expect(extractDescription(undefined)).toBe('');
    expect(extractDescription('')).toBe('');
  });

  it('extracts text from a single paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hola mundo' }] },
      ],
    };
    expect(extractDescription(doc)).toBe('Hola mundo');
  });

  it('joins multiple paragraphs with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Linea 1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Linea 2' }] },
      ],
    };
    expect(extractDescription(doc)).toBe('Linea 1\nLinea 2');
  });

  it('extracts text from a heading', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Titulo' }] },
      ],
    };
    expect(extractDescription(doc)).toBe('Titulo');
  });

  it('extracts text from a bullet list', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dos' }] }] },
          ],
        },
      ],
    };
    expect(extractDescription(doc)).toBe('uno\ndos');
  });

  it('inserts newline on hardBreak nodes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'linea1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'linea2' },
          ],
        },
      ],
    };
    expect(extractDescription(doc)).toBe('linea1\nlinea2');
  });

  it('preserves codeBlock content', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
      ],
    };
    expect(extractDescription(doc)).toBe('const x = 1;');
  });

  it('walks deeply nested structures', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'anidado' }],
            },
          ],
        },
      ],
    };
    expect(extractDescription(doc)).toBe('anidado');
  });

  it('joins text marks as plain text (drops mark metadata)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'negrita', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' y ' },
            { type: 'text', text: 'cursiva', marks: [{ type: 'em' }] },
          ],
        },
      ],
    };
    expect(extractDescription(doc)).toBe('negrita y cursiva');
  });

  it('skips nodes that have no extractable text', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph' }, // no content
        { type: 'paragraph', content: [{ type: 'text', text: 'visible' }] },
      ],
    };
    expect(extractDescription(doc)).toBe('visible');
  });
});

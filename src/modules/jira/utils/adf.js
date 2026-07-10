const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
]);

function walk(node, lines) {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'text' && typeof node.text === 'string') {
    if (lines.length === 0) {
      lines.push(node.text);
    } else {
      lines[lines.length - 1] += node.text;
    }
    return;
  }

  if (node.type === 'hardBreak') {
    lines.push('');
    return;
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walk(child, lines);
    }
    if (BLOCK_TYPES.has(node.type) && lines.length > 0) {
      lines.push('');
    }
  }
}

function extractDescription(adf) {
  if (!adf) return '';
  const lines = [];
  walk(adf, lines);
  return lines
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

module.exports = extractDescription;
module.exports.extractDescription = extractDescription;
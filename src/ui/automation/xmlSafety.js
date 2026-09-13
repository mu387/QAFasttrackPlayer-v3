const MAX_XML_CHARS_DEFAULT = 500_000;

const isLikelyXml = value => {
  const text = String(value || '').trim();
  return text.startsWith('<') && text.includes('>');
};

const validateXmlSafety = (xmlText, { maxChars = MAX_XML_CHARS_DEFAULT } = {}) => {
  const text = String(xmlText || '');
  if (!text.trim()) return;
  if (text.length > maxChars) {
    throw new Error(`XML payload exceeds limit (${maxChars} chars).`);
  }

  const normalized = text.toLowerCase();
  if (normalized.includes('<!doctype')) {
    throw new Error('XML DOCTYPE is not allowed.');
  }
  if (normalized.includes('<!entity')) {
    throw new Error('XML ENTITY declarations are not allowed.');
  }
};

const sanitizeWsdlImportUrl = rawUrl => {
  const urlText = String(rawUrl || '').trim();
  if (!urlText) return '';
  const parsed = new URL(urlText);
  const host = String(parsed.hostname || '').toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  ) {
    throw new Error('WSDL import from local/internal hosts is blocked by policy.');
  }
  return parsed.toString();
};

module.exports = {
  isLikelyXml,
  validateXmlSafety,
  sanitizeWsdlImportUrl,
};


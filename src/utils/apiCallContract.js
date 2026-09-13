const API_CALL_SEGMENT_COUNT = 6;
const VALID_API_MODES = new Set(['auto', 'browser_session', 'session_http']);

const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'password',
  'secret',
  'client_secret',
];

const normalizeProtocol = protocol =>
  String(protocol || '').trim().toLowerCase() === 'soap' ? 'soap' : 'rest';

const normalizeMethod = method => {
  const normalized = String(method || '').trim().toUpperCase();
  return normalized || 'GET';
};

const normalizeMode = (mode, defaultMode = 'browser_session') => {
  const input = String(mode || '').trim().toLowerCase();
  if (!input) return defaultMode;
  if (input === 'browser' || input === 'browser-session') return 'browser_session';
  if (input === 'sessionhttp' || input === 'session-http') return 'session_http';
  if (VALID_API_MODES.has(input)) return input;
  return defaultMode;
};

const serializeSegment = (value, fallback = {}) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : JSON.stringify(fallback);
  }
  if (value == null) return JSON.stringify(fallback);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return JSON.stringify(fallback);
    }
  }
  return String(value);
};

const splitLegacyPipeSegments = (text, segmentCount = API_CALL_SEGMENT_COUNT) => {
  const source = String(text || '');
  const segments = [];
  let current = '';

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    // Legacy escape support:
    // \| => literal pipe, \\ => literal backslash
    if (char === '\\' && (next === '|' || next === '\\')) {
      current += next;
      i += 1;
      continue;
    }

    // Keep delimiter behavior stable while preventing over-splitting.
    if (char === '|' && segments.length < segmentCount - 1) {
      segments.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  segments.push(current.trim());
  while (segments.length < segmentCount) {
    segments.push('');
  }

  return segments.slice(0, segmentCount);
};

const parseApiCallValue = (rawValue, { defaultMode = 'browser_session' } = {}) => {
  const defaultNormalizedMode = normalizeMode(defaultMode, 'browser_session');
  const isRawObject = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue);
  const text = isRawObject ? '' : String(rawValue || '').trim();
  if (!text) {
    if (!isRawObject) {
      return {
        method: 'GET',
        url: '',
        queryJson: '{}',
        bodyJson: '{}',
        headersJson: '{}',
        mode: defaultNormalizedMode,
        protocol: 'rest',
        soap: {},
        sourceFormat: 'empty',
      };
    }
  }

  try {
    const parsed = isRawObject ? rawValue : JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed.apiCall && typeof parsed.apiCall === 'object' ? parsed.apiCall : parsed;
      const method = normalizeMethod(candidate.method || candidate.httpMethod || 'GET');
      const url = String(candidate.url || candidate.endpoint || '').trim();
      return {
        method,
        url,
        queryJson: serializeSegment(
          Object.prototype.hasOwnProperty.call(candidate, 'query') ? candidate.query : candidate.queryJson,
          {},
        ),
        bodyJson: serializeSegment(
          Object.prototype.hasOwnProperty.call(candidate, 'body') ? candidate.body : candidate.bodyJson,
          {},
        ),
        headersJson: serializeSegment(
          Object.prototype.hasOwnProperty.call(candidate, 'headers') ? candidate.headers : candidate.headersJson,
          {},
        ),
        mode: normalizeMode(candidate.mode, defaultNormalizedMode),
        protocol: normalizeProtocol(candidate.protocol),
        soap:
          candidate.soap && typeof candidate.soap === 'object'
            ? {
                wsdlUrl: String(candidate.soap.wsdlUrl || '').trim(),
                wsdlAuth: String(candidate.soap.wsdlAuth || '').trim() || 'none',
                wsdlFile: String(candidate.soap.wsdlFile || '').trim(),
                soapAction: String(candidate.soap.soapAction || '').trim(),
                soapVersion: String(candidate.soap.soapVersion || '').trim(),
              }
            : {},
        sourceFormat: isRawObject ? 'object' : 'json',
      };
    }
  } catch (_) {
    // fallback to legacy pipe path
  }

  const parts = splitLegacyPipeSegments(text, API_CALL_SEGMENT_COUNT);
  const [method, url, queryJson, bodyJson, headersJson, mode] = parts;
  return {
    method: normalizeMethod(method || 'GET'),
    url,
    queryJson: queryJson || '{}',
    bodyJson: bodyJson || '{}',
    headersJson: headersJson || '{}',
    mode: normalizeMode(mode, defaultNormalizedMode),
    protocol: 'rest',
    soap: {},
    sourceFormat: 'pipe',
  };
};

const safeParseJsonSegment = (raw, fallback = {}) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Invalid JSON segment: ${trimmed}`);
  }
};

const validateApiCallContract = parsed => {
  const errors = [];
  if (!parsed || typeof parsed !== 'object') {
    errors.push('Invalid apiCall payload object.');
    return errors;
  }
  if (!String(parsed.url || '').trim()) {
    errors.push('apiCall: URL segment is required.');
  }
  const method = String(parsed.method || '').trim().toUpperCase();
  if (!method) {
    errors.push('apiCall: HTTP method is required.');
  }
  if (!/^[A-Z]+$/.test(method)) {
    errors.push('apiCall: HTTP method must contain only letters.');
  }
  const mode = normalizeMode(parsed.mode, 'browser_session');
  if (!VALID_API_MODES.has(mode)) {
    errors.push('apiCall: mode must be one of auto, browser_session, session_http.');
  }
  return errors;
};

const maskSensitiveValue = value => {
  const str = String(value ?? '');
  if (!str) return str;
  if (str.length <= 8) return '***';
  return `${str.slice(0, 4)}***${str.slice(-2)}`;
};

const redactSensitiveObject = value => {
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveObject(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const redacted = {};
  for (const [key, rawVal] of Object.entries(value)) {
    const keyLc = String(key || '').toLowerCase();
    if (SENSITIVE_KEYS.some(sensitive => keyLc.includes(sensitive))) {
      redacted[key] = maskSensitiveValue(rawVal);
      continue;
    }
    if (typeof rawVal === 'string' && keyLc === 'authorization') {
      redacted[key] = maskSensitiveValue(rawVal);
      continue;
    }
    redacted[key] = redactSensitiveObject(rawVal);
  }
  return redacted;
};

const redactApiCallValueForLogs = rawValue => {
  const parsed = parseApiCallValue(rawValue);
  let queryObj = {};
  let headersObj = {};
  let bodyObjOrText = {};
  try {
    queryObj = safeParseJsonSegment(parsed.queryJson, {});
  } catch (_) {
    queryObj = {};
  }
  try {
    headersObj = safeParseJsonSegment(parsed.headersJson, {});
  } catch (_) {
    headersObj = {};
  }
  try {
    bodyObjOrText = safeParseJsonSegment(parsed.bodyJson, {});
  } catch (_) {
    bodyObjOrText = parsed.bodyJson;
  }

  const payload = {
    version: 2,
    protocol: normalizeProtocol(parsed.protocol),
    method: parsed.method,
    url: parsed.url,
    query: redactSensitiveObject(queryObj),
    body: redactSensitiveObject(bodyObjOrText),
    headers: redactSensitiveObject(headersObj),
    mode: normalizeMode(parsed.mode, 'browser_session'),
  };
  if (parsed.protocol === 'soap') {
    payload.soap = redactSensitiveObject(parsed.soap || {});
  }
  return JSON.stringify(payload);
};

module.exports = {
  API_CALL_SEGMENT_COUNT,
  normalizeProtocol,
  normalizeMethod,
  normalizeMode,
  parseApiCallValue,
  safeParseJsonSegment,
  serializeSegment,
  validateApiCallContract,
  redactApiCallValueForLogs,
  splitLegacyPipeSegments,
};

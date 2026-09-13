const normalizeRuntimeValue = value => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
};

const createManualApiRuntimeContext = () => {
  const runtimeVariables = {};

  const setRuntimeVariable = (name, value) => {
    const key = String(name || '').trim();
    if (!key) return;
    runtimeVariables[key] = normalizeRuntimeValue(value);
  };

  const setFlattenedRuntimeVariables = (prefix, value) => {
    if (!prefix) return;
    if (value == null) {
      setRuntimeVariable(prefix, '');
      return;
    }
    if (Array.isArray(value)) {
      setRuntimeVariable(prefix, value);
      value.forEach((item, index) => {
        setFlattenedRuntimeVariables(`${prefix}.${index}`, item);
      });
      return;
    }
    if (typeof value === 'object') {
      setRuntimeVariable(prefix, value);
      Object.entries(value).forEach(([key, nestedValue]) => {
        setFlattenedRuntimeVariables(`${prefix}.${key}`, nestedValue);
      });
      return;
    }
    setRuntimeVariable(prefix, value);
  };

  const mapLegacyOutputToken = token => {
    const key = String(token || '').trim();
    if (!key) return key;
    if (key === 'output') return 'api_capture';
    if (key.startsWith('output.')) return `api_capture.${key.slice('output.'.length)}`;
    return key;
  };

  const resolveToken = token => {
    const mapped = mapLegacyOutputToken(token);
    if (Object.prototype.hasOwnProperty.call(runtimeVariables, mapped)) {
      return runtimeVariables[mapped];
    }
    return null;
  };

  const resolveValue = value => {
    if (typeof value === 'string') {
      return value
        .replace(/{{\s*([^}]+)\s*}}/g, (match, token) => {
          const resolved = resolveToken(token);
          return resolved == null ? match : resolved;
        })
        .replace(/\$\{\s*([^}]+)\s*\}/g, (match, token) => {
          const resolved = resolveToken(token);
          return resolved == null ? match : resolved;
        });
    }
    if (Array.isArray(value)) {
      return value.map(item => resolveValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, resolveValue(nestedValue)]),
      );
    }
    return value;
  };

  const parseApiResult = rawValue => {
    if (rawValue == null || rawValue === '') return null;
    if (typeof rawValue === 'object') return rawValue;
    try {
      return JSON.parse(String(rawValue));
    } catch (_) {
      return null;
    }
  };

  const registerApiResult = rawApiResult => {
    const apiResult = parseApiResult(rawApiResult);
    if (!apiResult || typeof apiResult !== 'object') return;

    const primaryValue =
      typeof apiResult.body === 'string' && apiResult.body !== ''
        ? apiResult.body
        : apiResult.json != null
          ? normalizeRuntimeValue(apiResult.json)
          : normalizeRuntimeValue(apiResult);

    setRuntimeVariable('api_capture', primaryValue);
    setRuntimeVariable('api_capture.body', apiResult.body ?? '');
    setRuntimeVariable('api_capture.status', apiResult.status ?? 0);
    setRuntimeVariable('api_capture.statusText', apiResult.statusText ?? '');
    setRuntimeVariable('api_capture.url', apiResult.url ?? '');
    setRuntimeVariable('api_capture.raw', normalizeRuntimeValue(apiResult));
    setFlattenedRuntimeVariables('api_capture.response', {
      status: apiResult.status ?? 0,
      statusText: apiResult.statusText ?? '',
      ok: apiResult.ok ?? false,
      url: apiResult.url ?? '',
      body: apiResult.body ?? '',
      json: apiResult.json ?? null,
      headers: apiResult.headers ?? {},
      raw: normalizeRuntimeValue(apiResult),
    });
    if (apiResult.json != null) {
      setFlattenedRuntimeVariables('api_capture.json', apiResult.json);
    }
    if (apiResult.headers && typeof apiResult.headers === 'object') {
      setFlattenedRuntimeVariables('api_capture.headers', apiResult.headers);
    }

    // Compatibility aliases for existing user payload patterns.
    setRuntimeVariable('output', primaryValue);
    setRuntimeVariable('output.body', apiResult.body ?? '');
    setRuntimeVariable('output.status', apiResult.status ?? 0);
    setRuntimeVariable('output.statusText', apiResult.statusText ?? '');
    setRuntimeVariable('output.url', apiResult.url ?? '');
    if (apiResult.json != null) {
      setFlattenedRuntimeVariables('output.json', apiResult.json);
    }
    if (apiResult.headers && typeof apiResult.headers === 'object') {
      setFlattenedRuntimeVariables('output.headers', apiResult.headers);
    }
  };

  const reset = () => {
    Object.keys(runtimeVariables).forEach(key => delete runtimeVariables[key]);
  };

  return {
    registerApiResult,
    resolveValue,
    reset,
    _debugRuntimeVariables: runtimeVariables,
  };
};

module.exports = {
  createManualApiRuntimeContext,
};

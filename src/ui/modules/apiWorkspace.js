(function (global) {
  function createApiWorkspaceModule({
    elements,
    state,
    escapeHtml,
    express,
    documentRef = document,
    copyToClipboard = async () => false,
    useAutomationPayload = () => {},
  }) {
    const SENSITIVE_CAPTURE_HEADER_NAMES = new Set([
      'authorization',
      'cookie',
      'set-cookie',
      'x-csrf-token',
      'x-xsrf-token',
      'proxy-authorization',
    ]);

    const getState = () => state.get();
    const setState = patch => state.set(patch);

    let importedOpenApiMetadata = null;

    const parseManualApiCallOutput = output => {
      if (typeof output !== 'string') return null;
      try {
        const parsed = JSON.parse(output);
        if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'status')) {
          return parsed;
        }
      } catch (_) {}
      return null;
    };

    const VALID_API_MODES = new Set(['auto', 'browser_session', 'session_http']);
    const CAPTURE_TYPE_FILTER_DEFAULT = 'xhr_fetch';
    const KNOWN_CAPTURE_TYPES = new Set(['xhr', 'fetch', 'document', 'script', 'stylesheet', 'image']);
    const STATIC_ASSET_EXTENSIONS = [
      '.js',
      '.mjs',
      '.css',
      '.map',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.svg',
      '.webp',
      '.ico',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.mp4',
      '.webm',
      '.mp3',
      '.wav',
    ];
    const NOISE_HOST_PATTERNS = [
      /(^|\.)google\./i,
      /(^|\.)gstatic\.com$/i,
      /(^|\.)googletagmanager\.com$/i,
      /(^|\.)google-analytics\.com$/i,
      /(^|\.)doubleclick\.net$/i,
      /(^|\.)facebook\.com$/i,
      /(^|\.)facebook\.net$/i,
      /(^|\.)cdn\./i,
      /(^|\.)cloudfront\.net$/i,
    ];

    const normalizeMethod = method => {
      const normalized = String(method || '').trim().toUpperCase();
      return normalized || 'GET';
    };

    const normalizeMode = (mode, defaultMode = 'auto') => {
      const input = String(mode || '').trim().toLowerCase();
      if (!input) return defaultMode;
      if (input === 'browser' || input === 'browser-session') return 'browser_session';
      if (input === 'sessionhttp' || input === 'session-http') return 'session_http';
      if (VALID_API_MODES.has(input)) return input;
      return defaultMode;
    };

    const getSelectedCaptureTypeFilter = () => {
      const selected = String(elements.apiWorkspaceCaptureTypeFilter?.value || '').trim().toLowerCase();
      return selected || CAPTURE_TYPE_FILTER_DEFAULT;
    };

    const normalizeCaptureTypeToken = token => {
      const value = String(token || '').trim().toLowerCase();
      if (!value) return '';
      if (value === 'xmlhttprequest') return 'xhr';
      if (value === 'img') return 'image';
      if (value === 'css') return 'stylesheet';
      return value;
    };

    const resolveCaptureEntryType = entry => {
      const transport = normalizeCaptureTypeToken(entry?.transport);
      if (transport === 'xhr' || transport === 'fetch') return transport;

      const resourceType = normalizeCaptureTypeToken(entry?.resourceType || entry?.type || entry?.initiatorType);
      if (KNOWN_CAPTURE_TYPES.has(resourceType)) return resourceType;
      if (resourceType) return 'other';
      return transport && KNOWN_CAPTURE_TYPES.has(transport) ? transport : 'other';
    };

    const isCaptureEntryMatchingFilter = (entry, selectedFilter) => {
      const normalizedFilter = String(selectedFilter || '').trim().toLowerCase();
      if (!normalizedFilter || normalizedFilter === 'all') return true;
      const entryType = resolveCaptureEntryType(entry);
      if (normalizedFilter === 'xhr_fetch') return entryType === 'xhr' || entryType === 'fetch';
      if (normalizedFilter === 'other') return !KNOWN_CAPTURE_TYPES.has(entryType);
      return entryType === normalizedFilter;
    };

    const resolveCaptureUrl = entry => {
      const raw = String(entry?.url || '').trim();
      if (!raw) return null;
      try {
        return new URL(raw);
      } catch (_) {
        return null;
      }
    };

    const looksStaticAssetPath = pathname => {
      const text = String(pathname || '').toLowerCase();
      if (!text) return false;
      return STATIC_ASSET_EXTENSIONS.some(ext => text.endsWith(ext));
    };

    const isNoiseHost = host => {
      const text = String(host || '').trim().toLowerCase();
      if (!text) return false;
      return NOISE_HOST_PATTERNS.some(rx => rx.test(text));
    };

    const isLikelyBusinessApiUrl = urlObj => {
      if (!urlObj) return false;
      const pathText = String(urlObj.pathname || '').toLowerCase();
      return (
        pathText.includes('/api/') ||
        pathText.includes('/graphql') ||
        pathText.includes('/rest/') ||
        pathText.includes('/service/') ||
        pathText.includes('/v1/') ||
        pathText.includes('/v2/')
      );
    };

    const DYNAMIC_FIELD_KEY_PATTERN = /(id|uuid|guid|token|nonce|session|timestamp|ts|ref|reference|trace|correlation)/i;
    const UUID_VALUE_PATTERN =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const LONG_TOKEN_VALUE_PATTERN = /^[A-Za-z0-9+/_=-]{24,}$/;
    const EPOCH_MS_PATTERN = /^(1[6-9]\d{11}|2\d{12})$/;
    const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

    const isLikelyDynamicValue = value => {
      const raw = String(value ?? '').trim();
      if (!raw) return false;
      if (UUID_VALUE_PATTERN.test(raw)) return true;
      if (LONG_TOKEN_VALUE_PATTERN.test(raw)) return true;
      if (EPOCH_MS_PATTERN.test(raw)) return true;
      if (ISO_TIMESTAMP_PATTERN.test(raw)) return true;
      return false;
    };

    const pushDynamicSignal = (signals, key, value) => {
      const normalizedKey = String(key || '').trim();
      const normalizedValue = String(value ?? '').trim();
      if (!normalizedValue) return;
      if (DYNAMIC_FIELD_KEY_PATTERN.test(normalizedKey) || isLikelyDynamicValue(normalizedValue)) {
        signals.add(normalizedKey || normalizedValue.slice(0, 40));
      }
    };

    const walkDynamicSignals = (signals, source, pathPrefix = '') => {
      if (!source || typeof source !== 'object') return;
      Object.entries(source).forEach(([key, value]) => {
        const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        if (Array.isArray(value)) {
          value.forEach((item, idx) => {
            const arrayPath = `${nextPath}[${idx}]`;
            if (item && typeof item === 'object') {
              walkDynamicSignals(signals, item, arrayPath);
              return;
            }
            pushDynamicSignal(signals, arrayPath, item);
          });
          return;
        }
        if (value && typeof value === 'object') {
          walkDynamicSignals(signals, value, nextPath);
          return;
        }
        pushDynamicSignal(signals, nextPath, value);
      });
    };

    const parseCaptureBodyAsObject = rawBody => {
      const bodyText = String(rawBody || '').trim();
      if (!bodyText) return null;
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) {}

      if (bodyText.includes('=') && bodyText.includes('&')) {
        try {
          const params = new URLSearchParams(bodyText);
          const asObject = {};
          for (const [key, value] of params.entries()) {
            asObject[key] = value;
          }
          if (Object.keys(asObject).length) return asObject;
        } catch (_) {}
      }
      return null;
    };

    const getDynamicFieldCountForCaptureEntry = entry => {
      if (!entry || typeof entry !== 'object') return 0;
      const signals = new Set();
      const urlObj = resolveCaptureUrl(entry);
      if (urlObj?.searchParams) {
        for (const [key, value] of urlObj.searchParams.entries()) {
          pushDynamicSignal(signals, `query.${key}`, value);
        }
      }

      const bodyObject = parseCaptureBodyAsObject(entry?.requestBody || '');
      if (bodyObject) {
        walkDynamicSignals(signals, bodyObject, 'body');
      }

      return signals.size;
    };

    const getCaptureHeaderValue = (headers, headerName) => {
      const target = String(headerName || '').trim().toLowerCase();
      if (!target || !headers || typeof headers !== 'object') return '';
      const key = Object.keys(headers).find(name => String(name || '').trim().toLowerCase() === target);
      return key ? String(headers[key] || '').trim() : '';
    };

    const hasJsonCaptureSignal = entry => {
      const requestHeaders = entry?.requestHeaders && typeof entry.requestHeaders === 'object' ? entry.requestHeaders : {};
      const responseHeaders = entry?.responseHeaders && typeof entry.responseHeaders === 'object' ? entry.responseHeaders : {};
      const requestContentType = getCaptureHeaderValue(requestHeaders, 'content-type').toLowerCase();
      const requestAccept = getCaptureHeaderValue(requestHeaders, 'accept').toLowerCase();
      const responseContentType = getCaptureHeaderValue(responseHeaders, 'content-type').toLowerCase();
      if (requestContentType.includes('json')) return true;
      if (requestAccept.includes('json')) return true;
      if (responseContentType.includes('json')) return true;
      const responseBodyText = String(entry?.responseBody || '').trim();
      if (!responseBodyText) return false;
      if (
        (responseBodyText.startsWith('{') && responseBodyText.endsWith('}')) ||
        (responseBodyText.startsWith('[') && responseBodyText.endsWith(']'))
      ) {
        try {
          JSON.parse(responseBodyText);
          return true;
        } catch (_) {}
      }
      return false;
    };

    const isReplayableCaptureEntry = entry => {
      const entryType = resolveCaptureEntryType(entry);
      const status = Number(entry?.status || 0);
      const urlObj = resolveCaptureUrl(entry);
      if (!urlObj) return false;
      if (status >= 400 && !isLikelyBusinessApiUrl(urlObj)) return false;

      if (entryType === 'xhr' || entryType === 'fetch') {
        if (isNoiseHost(urlObj.hostname)) return false;
        if (looksStaticAssetPath(urlObj.pathname)) return false;
        if (isLikelyBusinessApiUrl(urlObj)) return true;
        return hasJsonCaptureSignal(entry);
      }
      if (isNoiseHost(urlObj.hostname)) return false;
      if (looksStaticAssetPath(urlObj.pathname)) return false;
      return isLikelyBusinessApiUrl(urlObj);
    };

    const getFilteredCaptureEntries = (entriesInput = null) => {
      const entries = Array.isArray(entriesInput)
        ? entriesInput
        : Array.isArray(getState().latestNetworkCaptureEntries)
          ? getState().latestNetworkCaptureEntries
          : [];
      const selectedFilter = getSelectedCaptureTypeFilter();
      return entries
        .map((entry, rawIndex) => ({ entry, rawIndex }))
        .filter(item => isCaptureEntryMatchingFilter(item.entry, selectedFilter));
    };

    const normalizeCaptureUrlForSignature = rawUrl => {
      const resolved = resolveCaptureUrl({ url: rawUrl });
      if (!resolved) return String(rawUrl || '').trim();
      const pairs = [];
      for (const [key, value] of resolved.searchParams.entries()) {
        pairs.push([key, value]);
      }
      pairs.sort((a, b) => {
        if (a[0] === b[0]) return String(a[1]).localeCompare(String(b[1]));
        return String(a[0]).localeCompare(String(b[0]));
      });
      const query = pairs
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      return `${resolved.origin}${resolved.pathname}${query ? `?${query}` : ''}`;
    };

    const buildCaptureEntrySignature = entry => {
      const method = String(entry?.method || 'GET').trim().toUpperCase();
      const normalizedUrl = normalizeCaptureUrlForSignature(entry?.url || '');
      const requestBody = String(entry?.requestBody || '').trim();
      const mode = normalizeMode(entry?.mode || 'auto', 'auto');
      return `${method}||${normalizedUrl}||${requestBody}||${mode}`;
    };

    const collapseDuplicateCaptureItems = items => {
      if (!Array.isArray(items) || !items.length) return [];
      const signatures = new Set();
      const kept = [];
      for (let idx = items.length - 1; idx >= 0; idx -= 1) {
        const item = items[idx];
        const signature = buildCaptureEntrySignature(item?.entry || {});
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        kept.push(item);
      }
      return kept.reverse();
    };

    const splitLegacyPipeSegments = (raw, segmentCount = 6) => {
      const source = String(raw || '');
      const segments = [];
      let current = '';

      for (let index = 0; index < source.length; index += 1) {
        const ch = source[index];
        const next = source[index + 1];

        if (ch === '\\' && (next === '|' || next === '\\')) {
          current += next;
          index += 1;
          continue;
        }
        if (ch === '|' && segments.length < segmentCount - 1) {
          segments.push(current.trim());
          current = '';
          continue;
        }
        current += ch;
      }

      segments.push(current.trim());
      while (segments.length < segmentCount) segments.push('');
      return segments.slice(0, segmentCount);
    };

    const parseExpectedValue = raw => {
      const trimmed = String(raw ?? '').trim();
      if (trimmed === '') return '';
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      if (trimmed === 'null') return null;
      if (!Number.isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
      try {
        return JSON.parse(trimmed);
      } catch (_) {
        return trimmed;
      }
    };

    const isLikelyXmlText = value => {
      const text = String(value || '').trim();
      return text.startsWith('<') && text.endsWith('>');
    };

    const parseXmlBodyDocument = xmlText => {
      const text = String(xmlText || '').trim();
      if (!text) {
        return { error: 'XML body is empty.', document: null };
      }
      if (!isLikelyXmlText(text)) {
        return { error: 'Body is not valid XML text.', document: null };
      }
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'application/xml');
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
          return { error: parserError.textContent?.trim() || 'Invalid XML body.', document: null };
        }
        return { error: '', document: xmlDoc };
      } catch (error) {
        return { error: error?.message || 'Failed to parse XML body.', document: null };
      }
    };

    const evaluateXmlXPath = (xmlDoc, xpathExpression) => {
      const expression = String(xpathExpression || '').trim();
      if (!expression) {
        return { error: 'XPath expression is empty.', nodes: [] };
      }
      try {
        const resolver = prefix =>
          xmlDoc.lookupNamespaceURI(prefix) ||
          xmlDoc.documentElement?.getAttribute?.(`xmlns:${prefix}`) ||
          null;
        const result = xmlDoc.evaluate(
          expression,
          xmlDoc,
          resolver,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );
        const nodes = [];
        for (let index = 0; index < result.snapshotLength; index += 1) {
          nodes.push(result.snapshotItem(index));
        }
        return { error: '', nodes };
      } catch (error) {
        return { error: error?.message || 'Invalid XPath expression.', nodes: [] };
      }
    };

    const formatXmlPretty = xmlText => {
      const text = String(xmlText || '').trim();
      if (!isLikelyXmlText(text)) return String(xmlText || '');
      const parsed = parseXmlBodyDocument(text);
      if (!parsed.document) return String(xmlText || '');
      try {
        const serialized = new XMLSerializer().serializeToString(parsed.document);
        const normalized = serialized.replace(/>\s*</g, '><').replace(/\r?\n/g, '');
        let indent = 0;
        return normalized
          .replace(/(>)(<)(\/*)/g, '$1\n$2$3')
          .split('\n')
          .map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('</')) {
              indent = Math.max(indent - 1, 0);
            }
            const formatted = `${'  '.repeat(indent)}${trimmed}`;
            if (
              trimmed.startsWith('<') &&
              !trimmed.startsWith('</') &&
              !trimmed.endsWith('/>') &&
              !trimmed.includes('</')
            ) {
              indent += 1;
            }
            return formatted;
          })
          .filter(Boolean)
          .join('\n');
      } catch (_) {
        return String(xmlText || '');
      }
    };

    const evaluateXmlAssertionClause = (apiResult, key, expectedRaw) => {
      const parsedXml = parseXmlBodyDocument(apiResult?.body || '');
      if (!parsedXml.document) {
        return {
          pass: false,
          actual: '',
          message: parsedXml.error || 'Unable to parse XML response body.',
        };
      }

      if (key === 'xml_exists') {
        const lookup = evaluateXmlXPath(parsedXml.document, expectedRaw);
        if (lookup.error) {
          return { pass: false, actual: '', message: lookup.error };
        }
        return {
          pass: lookup.nodes.length > 0,
          actual: lookup.nodes.length,
          message:
            lookup.nodes.length > 0
              ? `XPath matched ${lookup.nodes.length} node(s).`
              : `XPath did not match any node: ${expectedRaw}`,
        };
      }

      if (key === 'xml_count') {
        const [xpathExpression, expectedCountRaw] = String(expectedRaw || '').split('|');
        const lookup = evaluateXmlXPath(parsedXml.document, xpathExpression);
        if (lookup.error) {
          return { pass: false, actual: '', message: lookup.error };
        }
        const expectedCount = Number(String(expectedCountRaw || '').trim());
        if (!Number.isFinite(expectedCount)) {
          return { pass: false, actual: lookup.nodes.length, message: 'xml_count requires format: xml_count=<xpath>|<number>' };
        }
        return {
          pass: lookup.nodes.length === expectedCount,
          actual: lookup.nodes.length,
          message:
            lookup.nodes.length === expectedCount
              ? `XPath count matched ${expectedCount}.`
              : `Expected ${expectedCount} node(s), found ${lookup.nodes.length}.`,
        };
      }

      if (key === 'xml_value') {
        const [xpathExpression, expectedTextRaw] = String(expectedRaw || '').split('|');
        const lookup = evaluateXmlXPath(parsedXml.document, xpathExpression);
        if (lookup.error) {
          return { pass: false, actual: '', message: lookup.error };
        }
        if (lookup.nodes.length === 0) {
          return { pass: false, actual: '', message: `XPath did not match any node: ${xpathExpression}` };
        }
        const actualText = String(lookup.nodes[0]?.textContent || '').trim();
        const expectedText = String(expectedTextRaw || '').trim();
        return {
          pass: actualText === expectedText,
          actual: actualText,
          message:
            actualText === expectedText
              ? 'XPath text value matched.'
              : `Expected XPath text "${expectedText}" but found "${actualText}".`,
        };
      }

      return {
        pass: false,
        actual: '',
        message: `Unsupported XML assertion key "${key}".`,
      };
    };

    const resolveApiResultValue = (apiResult, key) => {
      const normalized = String(key || '').trim();
      if (!normalized) return undefined;
      if (normalized === 'status') return apiResult?.status;
      if (normalized === 'statusText') return apiResult?.statusText;
      if (normalized === 'ok') return apiResult?.ok;
      if (normalized === 'body') return apiResult?.body;
      if (normalized === 'url') return apiResult?.url;
      if (normalized === 'soap_fault') return !!apiResult?.soapFault;
      if (normalized === 'soap_fault_code') return apiResult?.soapFaultCode || '';
      if (normalized === 'soap_fault_string') return apiResult?.soapFaultString || '';
      if (normalized.startsWith('json.')) {
        return normalized.slice(5).split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), apiResult?.json);
      }
      if (normalized.startsWith('header.') || normalized.startsWith('headers.')) {
        const headerKey = normalized.startsWith('header.') ? normalized.slice(7) : normalized.slice(8);
        return apiResult?.headers?.[headerKey.toLowerCase()] ?? apiResult?.headers?.[headerKey];
      }
      return undefined;
    };

    const evaluateManualApiAssertions = (apiResult, expectedOutput) => {
      const clauses = String(expectedOutput || '')
        .split('||')
        .map(clause => clause.trim())
        .filter(Boolean);

      if (clauses.length === 0) {
        return { total: 0, passed: 0, failed: 0, results: [] };
      }

      const results = clauses.map(clause => {
        let key;
        let expectedRaw;
        if (clause.includes('=')) {
          const [left, ...rest] = clause.split('=');
          key = left.trim();
          expectedRaw = rest.join('=').trim();
        } else {
          key = 'body_contains';
          expectedRaw = clause;
        }

        let actual;
        let pass;
        if (key === 'body_contains') {
          actual = String(apiResult?.body ?? '');
          pass = actual.includes(expectedRaw);
        } else if (key === 'body_equals') {
          actual = String(apiResult?.body ?? '');
          pass = actual === expectedRaw;
        } else if (key === 'xml_exists' || key === 'xml_value' || key === 'xml_count') {
          const xmlAssertion = evaluateXmlAssertionClause(apiResult, key, expectedRaw);
          actual = xmlAssertion.actual;
          pass = xmlAssertion.pass;
          return {
            clause,
            pass,
            actual,
            message: xmlAssertion.message,
          };
        } else {
          actual = resolveApiResultValue(apiResult, key);
          pass = actual === parseExpectedValue(expectedRaw);
        }

        return {
          clause,
          pass,
          actual,
          message: pass
            ? `${key} matched.`
            : key === 'body_contains'
              ? `Expected body to contain "${expectedRaw}".`
              : key === 'body_equals'
                ? 'Expected exact body match.'
                : `Expected ${key}=${expectedRaw} but found ${actual}`,
        };
      });

      const passed = results.filter(result => result.pass).length;
      return {
        total: results.length,
        passed,
        failed: results.length - passed,
        results,
      };
    };

    const getApiResultTabContent = (apiResult, tab, { automationText = '', fallbackRaw = '' } = {}) => {
      if (tab === 'automation') {
        return automationText || 'No automation payload available yet.';
      }
      if (!apiResult) {
        const raw = String(fallbackRaw || '').trim();
        if (!raw) return 'No response yet.';
        if (tab === 'headers') {
          return 'Headers unavailable for unstructured response output.';
        }
        if (tab === 'xml') {
          return isLikelyXmlText(raw) ? formatXmlPretty(raw) : 'Response is not XML.';
        }
        return raw;
      }
      const isSoapResponse =
        String(apiResult?.protocol || '').toLowerCase() === 'soap' ||
        String(apiResult?.headers?.['content-type'] || apiResult?.headers?.['Content-Type'] || '')
          .toLowerCase()
          .includes('xml') ||
        isLikelyXmlText(apiResult?.body || '');
      switch (tab) {
        case 'body':
          return isSoapResponse ? formatXmlPretty(apiResult.body || '') : apiResult.body || '(empty)';
        case 'xml':
          if (isSoapResponse || isLikelyXmlText(apiResult.body || '')) {
            return formatXmlPretty(apiResult.body || '');
          }
          return 'Response is not XML.';
        case 'headers':
          return JSON.stringify(apiResult.headers || {}, null, 2);
        case 'raw':
          if (isSoapResponse) {
            const cloned = { ...(apiResult || {}), body: formatXmlPretty(apiResult.body || '') };
            return JSON.stringify(cloned, null, 2);
          }
          return JSON.stringify(apiResult, null, 2);
        case 'json':
        default:
          if (isSoapResponse && apiResult.soapFault) {
            return `SOAP fault detected: ${apiResult.soapFaultString || apiResult.soapFaultCode || 'Unknown fault'}\nUse Body tab for full XML.`;
          }
          if (isSoapResponse && (apiResult.json == null || apiResult.json === '')) {
            return 'SOAP XML response detected. Use Body tab for formatted XML.';
          }
          return JSON.stringify(apiResult.json ?? null, null, 2);
      }
    };

    const buildAutomationPayloadList = apiResult => {
      const payloads = [];
      const seen = new Set();
      const pushUnique = payload => {
        const value = String(payload || '').trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        payloads.push(value);
      };

      const currentUrl = String(elements.apiWorkspaceUrl?.value || '').trim();
      const currentPayload = buildApiCallValueFromWorkspace();
      if (currentUrl) {
        pushUnique(currentPayload);
      }

      const capturedEntries = getFilteredCaptureEntries().map(item => item.entry);
      const modeForRecordedPayloads = normalizeMode(elements.apiWorkspaceMode?.value || 'auto', 'auto');
      let authPlaceholder = '';
      capturedEntries
        .slice()
        .forEach((entry) => {
          try {
            const payload = buildApiStepFromCaptureEntry(entry, {
              modeOverride: modeForRecordedPayloads,
              authPlaceholder,
            });
            pushUnique(payload);
            if (!authPlaceholder) {
              authPlaceholder = deriveAuthPlaceholderFromCaptureEntry(entry);
            }
          } catch (_) {}
        });

      if (payloads.length === 0 && apiResult?.url) {
        let derivedQuery = '{}';
        let derivedUrl = String(apiResult.url || '').trim();
        try {
          const parsed = new URL(derivedUrl, 'http://local-placeholder');
          derivedQuery = JSON.stringify(Object.fromEntries(parsed.searchParams.entries()));
          derivedUrl = `${parsed.origin === 'http://local-placeholder' ? '' : parsed.origin}${parsed.pathname}`;
        } catch (_) {}
        pushUnique(
          JSON.stringify({
            version: 2,
            method: 'GET',
            url: derivedUrl,
            query: safeParseJson(derivedQuery, {}),
            body: {},
            headers: { Accept: 'application/json' },
            mode: String(apiResult.mode || 'auto').trim() || 'auto',
          }),
        );
      }

      return payloads;
    };

    const buildAutomationTabContent = apiResult => {
      const payloads = buildAutomationPayloadList(apiResult);
      const lines = [];
      if (payloads.length > 0) {
        lines.push('Generated step values:');
        payloads.forEach((payload, index) => lines.push(`${index + 1}. ${payload}`));
      }
      if (lines.length === 0) {
        return 'No automation payload available yet.';
      }

      return lines.join('\n');
    };

    const getAutomationAuthHint = () => {
      const capturedEntries = getFilteredCaptureEntries().map(item => item.entry);
      if (capturedEntries.length === 0) {
        return { tone: '', text: '' };
      }

      const modeForRecordedPayloads = normalizeMode(elements.apiWorkspaceMode?.value || 'auto', 'auto');
      if (modeForRecordedPayloads !== 'session_http') {
        return {
          tone: 'info',
          text: 'Automation payloads are currently in non-session_http mode. Auth variable chaining is applied only for session_http REST flows.',
        };
      }

      let authPlaceholder = '';
      capturedEntries.forEach(entry => {
        if (!authPlaceholder) {
          authPlaceholder = deriveAuthPlaceholderFromCaptureEntry(entry);
        }
      });

      if (authPlaceholder) {
        return {
          tone: 'success',
          text: `Auth chaining enabled. Subsequent REST calls use Authorization: Bearer ${authPlaceholder}.`,
        };
      }

      return {
        tone: 'warning',
        text: 'No auth bootstrap response was detected in captured calls. Auth variable chaining was not applied.',
      };
    };

    const renderAutomationPayloadPanel = apiResult => {
      if (!elements.apiWorkspaceAssertionResultsPanel) return;
      const payloads = buildAutomationPayloadList(apiResult);
      const authHint = getAutomationAuthHint();
      if (payloads.length === 0) {
        elements.apiWorkspaceAssertionResultsPanel.innerHTML = `
      <div class="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        No automation payload available yet.
      </div>
    `;
        return;
      }

      const authHintClass =
        authHint.tone === 'success'
          ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
          : authHint.tone === 'warning'
            ? 'border border-amber-200 bg-amber-50 text-amber-800'
            : 'border border-sky-200 bg-sky-50 text-sky-800';
      const authHintHtml = authHint.text
        ? `<div class="rounded p-3 text-xs ${authHintClass}">${escapeHtml(authHint.text)}</div>`
        : '';

      elements.apiWorkspaceAssertionResultsPanel.innerHTML = `
      ${authHintHtml}
      ${payloads
        .map((payload, index) => `
      <div class="rounded border border-slate-200 bg-slate-50 p-3">
        <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <span class="text-xs uppercase tracking-wide text-slate-500 font-semibold">Payload ${index + 1}</span>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-secondary btn-sm apiWorkspaceAutomationCopyBtn" data-payload-index="${index}">Copy</button>
            <button type="button" class="btn btn-primary btn-sm apiWorkspaceAutomationUseBtn" data-payload-index="${index}">Use in Runner</button>
          </div>
        </div>
        <pre class="mt-2 whitespace-pre-wrap break-words rounded bg-white p-2 text-[11px] text-slate-700">${escapeHtml(payload)}</pre>
      </div>
    `)
        .join('')}
    `;
    };

    const wireAutomationPayloadActions = () => {
      if (!elements.apiWorkspaceAssertionResultsPanel || elements.apiWorkspaceAssertionResultsPanel.dataset.automationBound === '1') {
        return;
      }
      elements.apiWorkspaceAssertionResultsPanel.dataset.automationBound = '1';
      elements.apiWorkspaceAssertionResultsPanel.addEventListener('click', async event => {
        const copyBtn = event.target?.closest?.('.apiWorkspaceAutomationCopyBtn');
        const useBtn = event.target?.closest?.('.apiWorkspaceAutomationUseBtn');
        if (!copyBtn && !useBtn) return;

        const { latestApiCallOutput } = getState();
        const apiResult = parseManualApiCallOutput(latestApiCallOutput || elements.testOutput?.value || '');
        const payloads = buildAutomationPayloadList(apiResult);
        const sourceBtn = copyBtn || useBtn;
        const index = Number(sourceBtn?.getAttribute('data-payload-index'));
        if (!Number.isInteger(index) || index < 0 || index >= payloads.length) return;
        const payload = payloads[index];

        if (copyBtn) {
          const copied = await copyToClipboard(payload);
          setApiWorkspaceStatus(copied ? 'Automation payload copied.' : 'Copy failed.');
          return;
        }

        useAutomationPayload(payload);
        setApiWorkspaceStatus('Automation payload sent to Runner.');
      });
    };

    const setNetworkCaptureStatus = (text, active = false) => {
      if (!elements.networkCaptureStatus) return;
      elements.networkCaptureStatus.textContent = text;
      elements.networkCaptureStatus.classList.toggle('text-emerald-600', !!active);
      elements.networkCaptureStatus.classList.toggle('dark:text-emerald-400', !!active);
      elements.networkCaptureStatus.classList.toggle('text-slate-500', !active);
      elements.networkCaptureStatus.classList.toggle('dark:text-slate-400', !active);
    };

    const renderNetworkCaptureEntries = entries => {
      if (!elements.networkCaptureList) return;
      const sourceEntries = Array.isArray(entries) ? entries : [];
      setState({ latestNetworkCaptureEntries: sourceEntries });
      const filteredEntries = getFilteredCaptureEntries(sourceEntries);
      const displayEntries = collapseDuplicateCaptureItems(filteredEntries);
      const selectedFilter = getSelectedCaptureTypeFilter();
      if (elements.apiWorkspaceCaptureList) {
        elements.apiWorkspaceCaptureList.innerHTML = '';
      }
      if (!sourceEntries.length) {
        elements.networkCaptureList.innerHTML = '<div class="text-slate-400">No captured requests yet.</div>';
        if (elements.apiWorkspaceCaptureList) {
          elements.apiWorkspaceCaptureList.innerHTML = '<div class="text-slate-400">No captured requests yet.</div>';
        }
        return;
      }
      if (!displayEntries.length) {
        const emptyFilteredText = selectedFilter === 'all'
          ? 'No captured requests yet.'
          : 'No captured requests for current filter.';
        elements.networkCaptureList.innerHTML = `<div class="text-slate-400">${emptyFilteredText}</div>`;
        if (elements.apiWorkspaceCaptureList) {
          elements.apiWorkspaceCaptureList.innerHTML = `<div class="text-slate-400">${emptyFilteredText}</div>`;
        }
        return;
      }

      const rendered = displayEntries
        .slice()
        .reverse()
        .map((item, index) => {
          const { entry, rawIndex } = item;
          const method = escapeHtml(entry?.method || 'GET');
          const url = escapeHtml(entry?.url || '');
          const status = escapeHtml(entry?.status ?? '');
          const duration = escapeHtml(entry?.durationMs ?? '');
          const requestBody = escapeHtml(entry?.requestBody || '');
          const responseBody = escapeHtml(entry?.responseBody || '');
          const transport = escapeHtml(entry?.transport || resolveCaptureEntryType(entry));
          const capturedAt = escapeHtml(entry?.capturedAt || '');
          const replayable = isReplayableCaptureEntry(entry);
          const dynamicFieldCount = getDynamicFieldCountForCaptureEntry(entry);
          return `
        <div class="rounded-4 border border-sky-200 dark:!border-sky-800 bg-gradient-to-r from-white via-sky-50 to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950 p-3 mb-3 shadow-sm">
          <div class="d-flex align-items-center justify-content-between gap-3">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="badge rounded-pill bg-sky-700 px-3 py-2 text-[11px] font-semibold tracking-wide">${method}</span>
              <span class="badge rounded-pill bg-emerald-600 px-3 py-2 text-[11px] font-semibold">${status}</span>
              <span class="rounded-pill bg-white/80 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">${transport}</span>
              ${replayable
                ? '<span class="rounded-pill bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Replayable</span>'
                : '<span class="rounded-pill bg-amber-50 dark:bg-amber-900/30 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">Noise / Bootstrap</span>'}
              ${dynamicFieldCount > 0
                ? `<span class="rounded-pill bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300">Dynamic fields detected (${dynamicFieldCount})</span>`
                : ''}
            </div>
            <div class="rounded-pill border border-slate-200 dark:!border-slate-700 bg-white/80 dark:bg-slate-900/80 px-3 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-300">${duration} ms</div>
          </div>
          <div class="mt-3 break-all rounded-xl border border-slate-200 dark:!border-slate-700 bg-white/90 dark:!bg-slate-950/80 px-3 py-2 font-mono text-[12px] leading-5 text-slate-800 dark:text-slate-100">${url}</div>
          <div class="mt-3 d-flex gap-2 flex-wrap">
            <button
              type="button"
              class="btn btn-primary btn-sm useNetworkCaptureBtn"
              data-entry-index="${rawIndex}"
              ${replayable ? '' : 'disabled title="Filtered as noise/bootstrap request. Choose a replayable API call."'} >
              ${replayable ? 'Use as API Step' : 'Filtered'}
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm replayNetworkCaptureBtn"
              data-entry-index="${rawIndex}"
              ${replayable ? '' : 'disabled title="Filtered as noise/bootstrap request. Choose a replayable API call."'} >
              Replay Call
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm editNetworkCaptureBtn"
              data-entry-index="${rawIndex}"
              ${replayable ? '' : 'disabled title="Filtered as noise/bootstrap request. Choose a replayable API call."'} >
              View/Edit Payload
            </button>
            <button
              type="button"
              class="btn btn-outline-danger btn-sm deleteNetworkCaptureBtn"
              data-entry-index="${rawIndex}">
              Remove
            </button>
          </div>
          <details class="mt-3">
            <summary class="cursor-pointer text-[11px] text-slate-500">Request/Response ${index + 1} - ${capturedAt}</summary>
            <div class="mt-2">
              <div class="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Request Body</div>
              <pre class="mt-1 whitespace-pre-wrap break-words rounded-xl border border-slate-200 dark:!border-slate-700 bg-white/90 dark:!bg-slate-950 p-3 text-[11px] text-slate-700 dark:text-slate-200">${requestBody || '(empty)'}</pre>
              <div class="mt-3 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Response Body</div>
              <pre class="mt-1 whitespace-pre-wrap break-words rounded-xl border border-slate-200 dark:!border-slate-700 bg-white/90 dark:!bg-slate-950 p-3 text-[11px] text-slate-700 dark:text-slate-200">${responseBody || '(empty)'}</pre>
            </div>
          </details>
        </div>
      `;
        })
        .join('');
      elements.networkCaptureList.innerHTML = rendered;
      if (elements.apiWorkspaceCaptureList) {
        elements.apiWorkspaceCaptureList.innerHTML = rendered;
      }
    };

    const safeJsonText = rawValue => {
      const trimmed = String(rawValue ?? '').trim();
      return trimmed === '' ? '{}' : trimmed;
    };

    const safeParseJson = (rawValue, fallback = {}) => {
      const trimmed = String(rawValue ?? '').trim();
      if (!trimmed) return fallback;
      try {
        return JSON.parse(trimmed);
      } catch (_) {
        return trimmed;
      }
    };

    const normalizeProtocol = protocol => (String(protocol || '').trim().toLowerCase() === 'soap' ? 'soap' : 'rest');

    const inferProtocolFromValues = ({ protocol = '', headers = {}, body = '', url = '' } = {}) => {
      const normalizedProtocol = normalizeProtocol(protocol);
      if (normalizedProtocol === 'soap') return 'soap';

      const headerObject =
        headers && typeof headers === 'object'
          ? headers
          : safeParseJson(headers, {});
      const normalizedHeaders =
        headerObject && typeof headerObject === 'object'
          ? Object.fromEntries(
              Object.entries(headerObject).map(([key, value]) => [String(key || '').toLowerCase(), value]),
            )
          : {};

      const contentType = String(normalizedHeaders['content-type'] || '').toLowerCase();
      const hasSoapAction = typeof normalizedHeaders.soapaction === 'string' && normalizedHeaders.soapaction.trim() !== '';
      const bodyText = typeof body === 'string' ? body.toLowerCase() : '';
      const urlText = String(url || '').toLowerCase();

      if (
        hasSoapAction ||
        contentType.includes('text/xml') ||
        contentType.includes('application/soap+xml') ||
        bodyText.includes('<soapenv:envelope') ||
        bodyText.includes('<soap:envelope') ||
        urlText.includes('/soap')
      ) {
        return 'soap';
      }

      return 'rest';
    };

    const parseApiValueForWorkspace = value => {
      const raw = String(value || '').trim();
      if (!raw) {
        return null;
      }

      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const candidate = parsed.apiCall && typeof parsed.apiCall === 'object'
            ? parsed.apiCall
            : parsed;
          if (candidate.url || candidate.endpoint) {
            const candidateQuery = Object.prototype.hasOwnProperty.call(candidate, 'query')
              ? candidate.query
              : candidate.queryJson;
            const candidateBody = Object.prototype.hasOwnProperty.call(candidate, 'body')
              ? candidate.body
              : candidate.bodyJson;
            const candidateHeaders = Object.prototype.hasOwnProperty.call(candidate, 'headers')
              ? candidate.headers
              : candidate.headersJson;
            const protocol = inferProtocolFromValues({
              protocol: candidate.protocol,
              headers: candidateHeaders,
              body: candidateBody,
              url: candidate.url || candidate.endpoint,
            });
            return {
              protocol,
              method: normalizeMethod(candidate.method || candidate.httpMethod || 'GET'),
              url: String(candidate.url || candidate.endpoint || ''),
              queryJson:
                typeof candidateQuery === 'string'
                  ? safeJsonText(candidateQuery)
                  : JSON.stringify(
                      Object.prototype.hasOwnProperty.call(candidate, 'query')
                        ? candidate.query || {}
                        : safeParseJson(candidateQuery, {}),
                    ),
              bodyJson:
                typeof candidateBody === 'string'
                  ? candidateBody
                  : JSON.stringify(
                      Object.prototype.hasOwnProperty.call(candidate, 'body')
                        ? candidate.body
                        : safeParseJson(candidateBody, {}),
                    ),
              headersJson:
                typeof candidateHeaders === 'string'
                  ? safeJsonText(candidateHeaders)
                  : JSON.stringify(
                      Object.prototype.hasOwnProperty.call(candidate, 'headers')
                        ? candidate.headers || {}
                        : safeParseJson(candidateHeaders, {}),
                    ),
              mode: normalizeMode(candidate.mode, 'auto'),
              wsdlUrl: String(candidate.soap?.wsdlUrl || ''),
              wsdlAuth: String(candidate.soap?.wsdlAuth || 'none'),
              wsdlFile: String(candidate.soap?.wsdlFile || ''),
              openApiUrl: String(candidate.rest?.openApiUrl || ''),
              openApiFile: String(candidate.rest?.openApiFile || ''),
              openApiOperation: String(candidate.rest?.operationId || ''),
            };
          }
        }
      } catch (_) {
        // legacy pipe value path
      }

      const parts = splitLegacyPipeSegments(raw, 6);
      if (parts.length < 6) {
        return null;
      }
      const [method, url, queryJson, bodyJson, headersJson, mode] = parts;
      const protocol = inferProtocolFromValues({ headers: headersJson, body: bodyJson, url });
      return {
        protocol,
        method: normalizeMethod(method || 'GET'),
        url: String(url || ''),
        queryJson: queryJson || '{}',
        bodyJson: bodyJson || '{}',
        headersJson: headersJson || '{}',
        mode: normalizeMode(mode, 'auto'),
        wsdlUrl: '',
        wsdlAuth: 'none',
        wsdlFile: '',
        openApiUrl: '',
        openApiFile: '',
        openApiOperation: '',
      };
    };

    const buildApiCallValueFromWorkspace = () => {
      const protocol = normalizeProtocol(elements.apiWorkspaceProtocol?.value || 'rest');
      const payload = {
        version: 2,
        method: normalizeMethod(elements.apiWorkspaceMethod?.value || 'GET'),
        url: String(elements.apiWorkspaceUrl?.value || '').trim(),
        query: safeParseJson(elements.apiWorkspaceQuery?.value, {}),
        body: safeParseJson(elements.apiWorkspaceBodyInput?.value, {}),
        headers: safeParseJson(elements.apiWorkspaceHeadersInput?.value, {}),
        mode: normalizeMode(elements.apiWorkspaceMode?.value || 'auto', 'auto'),
        protocol,
      };

      if (protocol === 'soap') {
        const parsedHeaders = safeParseJson(elements.apiWorkspaceHeadersInput?.value, {});
        const soapActionHeader =
          parsedHeaders && typeof parsedHeaders === 'object'
            ? Object.entries(parsedHeaders).find(([key]) => String(key || '').toLowerCase() === 'soapaction')?.[1]
            : '';
        payload.soap = {
          wsdlUrl: String(elements.apiWorkspaceWsdlUrl?.value || '').trim(),
          wsdlAuth: String(elements.apiWorkspaceWsdlAuth?.value || 'none').trim() || 'none',
          wsdlFile: String(elements.apiWorkspaceWsdlFile?.value || '').trim(),
          soapAction: String(soapActionHeader || '').trim(),
        };
      }

      if (protocol === 'rest' && !!elements.apiWorkspaceOpenApiToggle?.checked) {
        const selectedOperationId = String(elements.apiWorkspaceOpenApiOperation?.value || '').trim();
        if (importedOpenApiMetadata && selectedOperationId) {
          const selectedOperation = (importedOpenApiMetadata.operations || []).find(
            operation => String(operation.id || '') === selectedOperationId,
          );
          payload.rest = {
            openApiUrl: String(elements.apiWorkspaceOpenApiUrl?.value || '').trim(),
            openApiFile: String(elements.apiWorkspaceOpenApiFile?.value || '').trim(),
            serverUrl: String(importedOpenApiMetadata.serverUrl || '').trim(),
            operationId: String(selectedOperation?.operationId || selectedOperationId),
            operationPath: String(selectedOperation?.path || '').trim(),
          };
        }
      }

      return JSON.stringify(payload);
    };

    const syncApiWorkspaceProtocolFields = ({ applyDefaults = false } = {}) => {
      const openApiImportEnabled = !!elements.apiWorkspaceOpenApiToggle?.checked;
      if (elements.apiWorkspaceProtocol) {
        if (openApiImportEnabled) {
          elements.apiWorkspaceProtocol.value = 'rest';
          elements.apiWorkspaceProtocol.disabled = true;
          elements.apiWorkspaceProtocol.classList.add('opacity-75');
        } else {
          elements.apiWorkspaceProtocol.disabled = false;
          elements.apiWorkspaceProtocol.classList.remove('opacity-75');
        }
      }

      const protocol = normalizeProtocol(elements.apiWorkspaceProtocol?.value || 'rest');
      const isSoap = protocol === 'soap';
      elements.apiWorkspaceOpenApiToggleWrap?.classList.toggle('d-none', isSoap);
      elements.apiWorkspaceSoapWsdlRow?.classList.toggle('d-none', !isSoap);
      elements.apiWorkspaceOpenApiRow?.classList.toggle('d-none', isSoap || !openApiImportEnabled);
      if (elements.apiWorkspaceQueryLabel) {
        elements.apiWorkspaceQueryLabel.textContent = 'Query JSON';
      }
      if (elements.apiWorkspaceBodyLabel) {
        elements.apiWorkspaceBodyLabel.textContent = isSoap ? 'Body XML Envelope' : 'Body JSON / text';
      }

      const targetTab = isSoap ? 'body' : 'json';
      setState({ activeApiWorkspaceTab: targetTab });
      elements.apiWorkspaceTabButtons?.forEach(tabButton => {
        tabButton.classList.toggle('active', tabButton.getAttribute('data-tab') === targetTab);
      });

      if (applyDefaults) {
        const bodyText = String(elements.apiWorkspaceBodyInput?.value || '').trim();
        const headersText = String(elements.apiWorkspaceHeadersInput?.value || '').trim();
        if (isSoap) {
          if (elements.apiWorkspaceMode && !String(elements.apiWorkspaceMode.value || '').trim()) {
            elements.apiWorkspaceMode.value = 'auto';
          }
          if (elements.apiWorkspaceWsdlAuth && !String(elements.apiWorkspaceWsdlAuth.value || '').trim()) {
            elements.apiWorkspaceWsdlAuth.value = 'none';
          }
          if (!bodyText || bodyText === '{}') {
            if (elements.apiWorkspaceBodyInput) {
              elements.apiWorkspaceBodyInput.value = `<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\">\n  <soapenv:Header/>\n  <soapenv:Body>\n  </soapenv:Body>\n</soapenv:Envelope>`;
            }
          }
          if (!headersText || headersText === '{"Accept":"application/json"}') {
            if (elements.apiWorkspaceHeadersInput) {
              elements.apiWorkspaceHeadersInput.value = '{"Content-Type":"text/xml; charset=utf-8","Accept":"text/xml"}';
            }
          }
        } else {
          if (!headersText || headersText === '{"Content-Type":"text/xml; charset=utf-8","Accept":"text/xml"}') {
            if (elements.apiWorkspaceHeadersInput) {
              elements.apiWorkspaceHeadersInput.value = '{"Accept":"application/json"}';
            }
          }
          if (!bodyText) {
            if (elements.apiWorkspaceBodyInput) elements.apiWorkspaceBodyInput.value = '{}';
          }
        }
      }

      const rawOutput = getState().latestApiCallOutput || elements.testOutput?.value || '';
      const apiResult = parseManualApiCallOutput(rawOutput);
      renderApiWorkspaceActiveTab(apiResult, getState().latestApiWorkspaceAssertions);
    };

    const populateApiWorkspaceFromApiCallValue = value => {
      const parsed = parseApiValueForWorkspace(value);
      if (!parsed) {
        if (elements.apiWorkspaceUrl) elements.apiWorkspaceUrl.value = String(value || '');
        return;
      }
      if (elements.apiWorkspaceMethod) elements.apiWorkspaceMethod.value = String(parsed.method || 'GET').toUpperCase();
      if (elements.apiWorkspaceUrl) elements.apiWorkspaceUrl.value = String(parsed.url || '');
      if (elements.apiWorkspaceQuery) elements.apiWorkspaceQuery.value = parsed.queryJson || '{}';
      if (elements.apiWorkspaceBodyInput) elements.apiWorkspaceBodyInput.value = parsed.bodyJson || '{}';
      if (elements.apiWorkspaceHeadersInput) elements.apiWorkspaceHeadersInput.value = parsed.headersJson || '{}';
      if (elements.apiWorkspaceMode) elements.apiWorkspaceMode.value = parsed.mode || 'auto';
      if (elements.apiWorkspaceProtocol) elements.apiWorkspaceProtocol.value = normalizeProtocol(parsed.protocol || 'rest');
      if (elements.apiWorkspaceWsdlUrl) elements.apiWorkspaceWsdlUrl.value = parsed.wsdlUrl || '';
      if (elements.apiWorkspaceWsdlAuth) elements.apiWorkspaceWsdlAuth.value = parsed.wsdlAuth || 'none';
      if (elements.apiWorkspaceWsdlFile) elements.apiWorkspaceWsdlFile.value = parsed.wsdlFile || '';
      if (elements.apiWorkspaceOpenApiUrl) elements.apiWorkspaceOpenApiUrl.value = parsed.openApiUrl || '';
      if (elements.apiWorkspaceOpenApiFile) elements.apiWorkspaceOpenApiFile.value = parsed.openApiFile || '';
      const hasOpenApiData = !!(parsed.openApiUrl || parsed.openApiFile || parsed.openApiOperation);
      if (elements.apiWorkspaceOpenApiToggle) elements.apiWorkspaceOpenApiToggle.checked = hasOpenApiData;
      syncApiWorkspaceProtocolFields();
    };

    const setApiWorkspaceStatus = text => {
      if (elements.apiWorkspaceStatusText) {
        elements.apiWorkspaceStatusText.textContent = text;
      }
    };

    const syncApiCallResultExpansion = () => {
      const { apiCallResultExpanded } = getState();
      if (!elements.apiCallResultBody || !elements.toggleApiCallResultBtn) return;
      elements.apiCallResultBody.classList.toggle('hidden', !apiCallResultExpanded);
      elements.toggleApiCallResultBtn.textContent = apiCallResultExpanded ? 'Collapse' : 'Expand';
    };

    const shouldShowApiCallPanel = () => {
      const { latestApiCallOutput } = getState();
      const keyword = String(elements.testKeyword?.value || '').trim().toLowerCase();
      const value = String(elements.testValue?.value || '').trim();
      return keyword === 'apicall' && value !== '' && latestApiCallOutput !== '';
    };

    const syncApiCallPanelVisibility = () => {
      if (!elements.apiCallResultPanel) return;
      elements.apiCallResultPanel.classList.toggle('hidden', !shouldShowApiCallPanel());
    };

    const syncNetworkCaptureExpansion = () => {
      const { networkCaptureExpanded } = getState();
      if (!elements.networkCaptureBody || !elements.toggleNetworkCaptureBtn) return;
      elements.networkCaptureBody.classList.toggle('hidden', !networkCaptureExpanded);
      elements.toggleNetworkCaptureBtn.textContent = networkCaptureExpanded ? 'Collapse' : 'Expand';
    };

    const syncApiWorkspaceView = () => {
      const { latestApiCallOutput, latestApiWorkspaceAssertions } = getState();
      const rawOutput = latestApiCallOutput || elements.testOutput?.value || '';
      const apiResult = parseManualApiCallOutput(rawOutput);
      if (!apiResult) {
        const fallbackRaw = String(rawOutput || '').trim();
        if (!fallbackRaw) return;
        renderApiWorkspaceActiveTab(null, latestApiWorkspaceAssertions);
        if (elements.apiWorkspaceResponseContent) {
          elements.apiWorkspaceResponseContent.textContent = getApiResultTabContent(
            null,
            getState().activeApiWorkspaceTab,
            {
              automationText: buildAutomationTabContent(null),
              fallbackRaw,
            },
          );
        }
        if (elements.apiWorkspaceResponseMeta) {
          elements.apiWorkspaceResponseMeta.textContent = 'Unstructured response captured (non-JSON output).';
        }
        if (elements.apiWorkspaceResponseBadge) {
          elements.apiWorkspaceResponseBadge.className = 'badge bg-warning text-dark';
          elements.apiWorkspaceResponseBadge.textContent = 'Captured';
        }
        return;
      }
      renderApiWorkspaceActiveTab(apiResult, latestApiWorkspaceAssertions);
      if (elements.apiWorkspaceResponseMeta) {
        elements.apiWorkspaceResponseMeta.textContent = `${apiResult.mode || 'unknown'} - ${apiResult.url || ''}`;
      }
      if (elements.apiWorkspaceResponseBadge) {
        elements.apiWorkspaceResponseBadge.className = `badge ${apiResult.ok ? 'bg-success' : 'bg-danger'}`;
        elements.apiWorkspaceResponseBadge.textContent = apiResult.ok ? 'Success' : 'Failed';
      }
      if (apiResult.soapFault) {
        if (elements.apiWorkspaceResponseMeta) {
          const baseMeta = String(elements.apiWorkspaceResponseMeta.textContent || '').trim();
          const faultMeta = apiResult.soapFaultString || apiResult.soapFaultCode || 'Detected';
          elements.apiWorkspaceResponseMeta.textContent = `${baseMeta} | SOAP Fault: ${faultMeta}`;
        }
        if (elements.apiWorkspaceResponseBadge) {
          elements.apiWorkspaceResponseBadge.className = 'badge bg-warning text-dark';
          elements.apiWorkspaceResponseBadge.textContent = 'SOAP Fault';
        }
      }
    };

    const syncApiWorkspaceReport = () => {
      const { latestApiCallOutput, latestApiWorkspaceAssertions } = getState();
      const rawOutput = latestApiCallOutput || elements.testOutput?.value || '';
      const apiResult = parseManualApiCallOutput(rawOutput);
      if (!apiResult) {
        const fallbackRaw = String(rawOutput || '').trim();
        if (fallbackRaw) {
          if (elements.apiWorkspaceReportMeta) elements.apiWorkspaceReportMeta.textContent = 'Unstructured response captured (non-JSON output).';
          if (elements.apiWorkspaceReportExecution) elements.apiWorkspaceReportExecution.textContent = 'Execution completed with unstructured output.';
          if (elements.apiWorkspaceReportAssertions) elements.apiWorkspaceReportAssertions.textContent = 'Assertions unavailable for unstructured output.';
          if (elements.apiWorkspaceReportContent) elements.apiWorkspaceReportContent.textContent = fallbackRaw;
          return;
        }
        if (elements.apiWorkspaceReportMeta) elements.apiWorkspaceReportMeta.textContent = 'No response available.';
        if (elements.apiWorkspaceReportExecution) elements.apiWorkspaceReportExecution.textContent = 'No execution summary.';
        if (elements.apiWorkspaceReportAssertions) elements.apiWorkspaceReportAssertions.textContent = 'No assertions evaluated.';
        if (elements.apiWorkspaceReportContent) elements.apiWorkspaceReportContent.textContent = 'No response yet.';
        return;
      }
      const statusLine = `${apiResult.status ?? 0} ${apiResult.statusText || ''}`.trim();
      if (elements.apiWorkspaceReportMeta) {
        elements.apiWorkspaceReportMeta.textContent = `${apiResult.mode || 'unknown'} - ${apiResult.url || ''}`;
      }
      if (elements.apiWorkspaceReportExecution) {
        const faultSuffix = apiResult.soapFault
          ? ` | SOAP Fault: ${apiResult.soapFaultString || apiResult.soapFaultCode || 'Detected'}`
          : '';
        elements.apiWorkspaceReportExecution.textContent = `Status: ${statusLine || 'n/a'} | Capture: api_capture | OK: ${String(!!apiResult.ok)}${faultSuffix}`;
      }
      if (elements.apiWorkspaceReportAssertions) {
        elements.apiWorkspaceReportAssertions.textContent = !latestApiWorkspaceAssertions || latestApiWorkspaceAssertions.total === 0
          ? 'No assertions run yet.'
          : `${latestApiWorkspaceAssertions.passed}/${latestApiWorkspaceAssertions.total} assertions passed`;
      }
      if (elements.apiWorkspaceReportContent) {
        elements.apiWorkspaceReportContent.textContent = JSON.stringify(apiResult, null, 2);
      }
    };

    const resetApiCallResult = () => {
      setState({
        latestApiCallOutput: '',
        latestApiWorkspaceAssertions: { total: 0, passed: 0, failed: 0, results: [] },
        apiCallResultExpanded: true,
      });
      syncApiCallResultExpansion();
      syncApiCallPanelVisibility();
      if (elements.apiCallResultMeta) elements.apiCallResultMeta.textContent = 'No result yet.';
      if (elements.apiCallResultBadge) {
        elements.apiCallResultBadge.className = 'badge bg-secondary';
        elements.apiCallResultBadge.textContent = 'Idle';
      }
      if (elements.apiCallExecutionSummary) elements.apiCallExecutionSummary.textContent = 'No execution summary.';
      if (elements.apiCallAssertionSummary) elements.apiCallAssertionSummary.textContent = 'No assertions evaluated.';
      if (elements.apiCallAssertionList) elements.apiCallAssertionList.innerHTML = '';
      if (elements.apiCallResultContent) elements.apiCallResultContent.textContent = 'No response yet.';
      if (elements.apiWorkspaceResponseMeta) elements.apiWorkspaceResponseMeta.textContent = 'No API response yet.';
      if (elements.apiWorkspaceResponseBadge) {
        elements.apiWorkspaceResponseBadge.className = 'badge bg-secondary';
        elements.apiWorkspaceResponseBadge.textContent = 'Idle';
      }
      if (elements.apiWorkspaceAssertionSummary) elements.apiWorkspaceAssertionSummary.textContent = 'Results appear under the Assertions tab after you run them.';
      if (elements.apiWorkspaceResponseContent) elements.apiWorkspaceResponseContent.textContent = 'No response yet.';
      if (elements.apiWorkspaceAssertionResultsPanel) {
        elements.apiWorkspaceAssertionResultsPanel.innerHTML = '';
        elements.apiWorkspaceAssertionResultsPanel.classList.add('d-none');
      }
      if (elements.apiWorkspaceReportMeta) elements.apiWorkspaceReportMeta.textContent = 'No response available.';
      if (elements.apiWorkspaceReportExecution) elements.apiWorkspaceReportExecution.textContent = 'No execution summary.';
      if (elements.apiWorkspaceReportAssertions) elements.apiWorkspaceReportAssertions.textContent = 'No assertions evaluated.';
      if (elements.apiWorkspaceReportContent) elements.apiWorkspaceReportContent.textContent = 'No response yet.';
    };

    const renderAssertionResultList = (container, results) => {
      if (!container) return;
      container.innerHTML = results
        .map(result => `
      <div class="rounded border ${result.pass ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'} p-2 text-[11px]">
        <div class="d-flex align-items-center justify-content-between gap-2">
          <span class="font-mono text-slate-800">${escapeHtml(result.clause)}</span>
          <span class="badge ${result.pass ? 'bg-success' : 'bg-danger'}">${result.pass ? 'Passed' : 'Failed'}</span>
        </div>
        <div class="mt-1 text-slate-600">${escapeHtml(result.message)}</div>
      </div>
    `)
        .join('');
    };

    const renderApiWorkspaceActiveTab = (apiResult, assertions = getState().latestApiWorkspaceAssertions) => {
      const { activeApiWorkspaceTab } = getState();
      const automationText = buildAutomationTabContent(apiResult);
      const fallbackRaw = apiResult ? '' : String(getState().latestApiCallOutput || elements.testOutput?.value || '').trim();
      if (elements.apiWorkspaceResponseContent) {
        elements.apiWorkspaceResponseContent.classList.toggle('d-none', activeApiWorkspaceTab === 'assertions' || activeApiWorkspaceTab === 'automation');
        if (activeApiWorkspaceTab !== 'assertions' && activeApiWorkspaceTab !== 'automation') {
          elements.apiWorkspaceResponseContent.textContent = getApiResultTabContent(apiResult, activeApiWorkspaceTab, {
            automationText,
            fallbackRaw,
          });
        }
      }

      if (!elements.apiWorkspaceAssertionResultsPanel) return;

      const showAssertions = activeApiWorkspaceTab === 'assertions';
      const showAutomation = activeApiWorkspaceTab === 'automation';
      elements.apiWorkspaceAssertionResultsPanel.classList.toggle('d-none', !(showAssertions || showAutomation));

      if (!showAssertions && !showAutomation) {
        elements.apiWorkspaceAssertionResultsPanel.innerHTML = '';
        return;
      }

      if (showAutomation) {
        renderAutomationPayloadPanel(apiResult);
        return;
      }

      if (!assertions || assertions.total === 0) {
        elements.apiWorkspaceAssertionResultsPanel.innerHTML = `
      <div class="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        No assertions run yet. Enter an assertion string and click <strong>Run Assertions</strong>.
      </div>
    `;
        return;
      }

      elements.apiWorkspaceAssertionResultsPanel.innerHTML = `
    <div id="apiWorkspaceAssertionResultsList" class="d-flex flex-column gap-2 mt-2"></div>
  `;

      renderAssertionResultList(
        documentRef.querySelector('#apiWorkspaceAssertionResultsList'),
        assertions.results || [],
      );
    };

    const renderApiWorkspaceResult = (apiResult, assertions, evaluateAssertions = false) => {
      if (!apiResult) return;
      const { isBrowserLaunched } = getState();
      const statusLine = `${apiResult.status ?? 0} ${apiResult.statusText || ''}`.trim();
      if (elements.apiWorkspaceResponseMeta) {
        elements.apiWorkspaceResponseMeta.textContent = `${apiResult.mode || 'unknown'} - ${apiResult.url || ''}`;
      }
      if (elements.apiWorkspaceResponseBadge) {
        elements.apiWorkspaceResponseBadge.className = `badge ${apiResult.ok ? 'bg-success' : 'bg-danger'}`;
        elements.apiWorkspaceResponseBadge.textContent = apiResult.ok ? 'Success' : 'Failed';
      }
      if (apiResult.soapFault) {
        if (elements.apiWorkspaceResponseMeta) {
          const baseMeta = String(elements.apiWorkspaceResponseMeta.textContent || '').trim();
          const faultMeta = apiResult.soapFaultString || apiResult.soapFaultCode || 'Detected';
          elements.apiWorkspaceResponseMeta.textContent = `${baseMeta} | SOAP Fault: ${faultMeta}`;
        }
        if (elements.apiWorkspaceResponseBadge) {
          elements.apiWorkspaceResponseBadge.className = 'badge bg-warning text-dark';
          elements.apiWorkspaceResponseBadge.textContent = 'SOAP Fault';
        }
      }
      renderApiWorkspaceActiveTab(apiResult, getState().latestApiWorkspaceAssertions);
      if (!evaluateAssertions) {
        setState({ latestApiWorkspaceAssertions: { total: 0, passed: 0, failed: 0, results: [] } });
        if (elements.apiWorkspaceAssertionSummary) elements.apiWorkspaceAssertionSummary.textContent = 'Results appear under the Assertions tab after you run them.';
      } else if (assertions.total === 0) {
        setState({ latestApiWorkspaceAssertions: assertions });
        if (elements.apiWorkspaceAssertionSummary) elements.apiWorkspaceAssertionSummary.textContent = 'No assertions provided.';
      } else {
        setState({ latestApiWorkspaceAssertions: assertions });
        if (elements.apiWorkspaceAssertionSummary) elements.apiWorkspaceAssertionSummary.textContent = `${assertions.passed}/${assertions.total} assertions passed`;
      }
      setApiWorkspaceStatus(`Browser ${isBrowserLaunched ? 'active' : 'inactive'} - ${statusLine || 'No status'} - ${apiResult.mode || 'unknown'}`);
      renderApiWorkspaceActiveTab(apiResult, getState().latestApiWorkspaceAssertions);
      syncApiWorkspaceReport();
    };

    const renderApiCallResult = (output, expectedOutput, { evaluateAssertions = false } = {}) => {
      const apiResult = parseManualApiCallOutput(output);
      if (!apiResult || !elements.apiCallResultPanel) {
        resetApiCallResult();
        return;
      }

      setState({ latestApiCallOutput: output });
      syncApiCallPanelVisibility();
      syncApiCallResultExpansion();
      const assertions = evaluateAssertions
        ? evaluateManualApiAssertions(apiResult, expectedOutput)
        : { total: 0, passed: 0, failed: 0, results: [] };
      const statusLine = `${apiResult.status ?? 0} ${apiResult.statusText || ''}`.trim();
      elements.apiCallResultMeta.textContent = `${apiResult.mode || 'unknown'} - ${apiResult.url || ''}`;
      elements.apiCallExecutionSummary.textContent = `Status: ${statusLine || 'n/a'} | Capture: api_capture | OK: ${String(!!apiResult.ok)}`;
      elements.apiCallResultBadge.className = `badge ${apiResult.ok ? 'bg-success' : 'bg-danger'}`;
      elements.apiCallResultBadge.textContent = apiResult.ok ? 'Success' : 'Failed';
      if (apiResult.soapFault) {
        const faultMeta = apiResult.soapFaultString || apiResult.soapFaultCode || 'Detected';
        elements.apiCallResultMeta.textContent = `${elements.apiCallResultMeta.textContent} | SOAP Fault: ${faultMeta}`;
        elements.apiCallResultBadge.className = 'badge bg-warning text-dark';
        elements.apiCallResultBadge.textContent = 'SOAP Fault';
      }

      if (!evaluateAssertions) {
        elements.apiCallAssertionSummary.textContent = 'No assertions run yet.';
        elements.apiCallAssertionList.innerHTML = '';
      } else if (assertions.total === 0) {
        elements.apiCallAssertionSummary.textContent = 'No assertions provided.';
        elements.apiCallAssertionList.innerHTML = '';
      } else {
        elements.apiCallAssertionSummary.textContent = `${assertions.passed}/${assertions.total} assertions passed`;
        renderAssertionResultList(elements.apiCallAssertionList, assertions.results);
      }

      elements.apiCallResultContent.textContent = getApiResultTabContent(
        apiResult,
        getState().activeApiCallResultTab,
        { automationText: buildAutomationTabContent(apiResult) },
      );
      renderApiWorkspaceResult(apiResult, assertions, evaluateAssertions);
    };

    const runAssertions = expectedOutput => {
      const rawOutput = getState().latestApiCallOutput || elements.testOutput?.value || '';
      const apiResult = parseManualApiCallOutput(rawOutput);
      if (!apiResult) {
        return false;
      }

      const assertions = evaluateManualApiAssertions(apiResult, expectedOutput);
      setState({ latestApiWorkspaceAssertions: assertions });

      if (!assertions || assertions.total === 0) {
        if (elements.apiCallAssertionSummary) elements.apiCallAssertionSummary.textContent = 'No assertions provided.';
        if (elements.apiCallAssertionList) elements.apiCallAssertionList.innerHTML = '';
        if (elements.apiWorkspaceAssertionSummary) elements.apiWorkspaceAssertionSummary.textContent = 'No assertions provided.';
      } else {
        if (elements.apiCallAssertionSummary) elements.apiCallAssertionSummary.textContent = `${assertions.passed}/${assertions.total} assertions passed`;
        if (elements.apiCallAssertionList) renderAssertionResultList(elements.apiCallAssertionList, assertions.results);
        if (elements.apiWorkspaceAssertionSummary) elements.apiWorkspaceAssertionSummary.textContent = `${assertions.passed}/${assertions.total} assertions passed`;
      }

      renderApiWorkspaceActiveTab(apiResult, assertions);
      syncApiWorkspaceView();
      syncApiWorkspaceReport();
      return true;
    };

    const resetApiWorkspaceForm = () => {
      const { isBrowserLaunched, networkCaptureActive } = getState();
      if (elements.apiWorkspaceMethod) elements.apiWorkspaceMethod.value = 'GET';
      if (elements.apiWorkspaceUrl) elements.apiWorkspaceUrl.value = '';
      if (elements.apiWorkspaceProtocol) elements.apiWorkspaceProtocol.value = 'rest';
      if (elements.apiWorkspaceOpenApiToggle) elements.apiWorkspaceOpenApiToggle.checked = false;
      if (elements.apiWorkspaceQuery) elements.apiWorkspaceQuery.value = '{}';
      if (elements.apiWorkspaceBodyInput) elements.apiWorkspaceBodyInput.value = '{}';
      if (elements.apiWorkspaceHeadersInput) elements.apiWorkspaceHeadersInput.value = '{"Accept":"application/json"}';
      if (elements.apiWorkspaceMode) elements.apiWorkspaceMode.value = 'auto';
      if (elements.apiWorkspaceWsdlUrl) elements.apiWorkspaceWsdlUrl.value = '';
      if (elements.apiWorkspaceWsdlAuth) elements.apiWorkspaceWsdlAuth.value = 'none';
      if (elements.apiWorkspaceWsdlFile) elements.apiWorkspaceWsdlFile.value = '';
      if (elements.apiWorkspaceOpenApiUrl) elements.apiWorkspaceOpenApiUrl.value = '';
      if (elements.apiWorkspaceOpenApiFile) {
        elements.apiWorkspaceOpenApiFile.value = '';
        delete elements.apiWorkspaceOpenApiFile.dataset.openApiPath;
      }
      if (elements.apiWorkspaceOpenApiOperation) {
        elements.apiWorkspaceOpenApiOperation.innerHTML = '<option value="">No operation imported</option>';
      }
      if (elements.apiWorkspaceCaptureTypeFilter) {
        elements.apiWorkspaceCaptureTypeFilter.value = CAPTURE_TYPE_FILTER_DEFAULT;
      }
      importedOpenApiMetadata = null;
      if (elements.apiWorkspaceAssertionsInput) elements.apiWorkspaceAssertionsInput.value = '';
      syncApiWorkspaceProtocolFields();
      setState({ activeApiWorkspaceTab: 'json' });
      elements.apiWorkspaceTabButtons.forEach(tabButton => {
        tabButton.classList.toggle('active', tabButton.getAttribute('data-tab') === 'json');
      });
      resetApiCallResult();
      setApiWorkspaceStatus(
        `${isBrowserLaunched ? 'Browser active' : 'Browser inactive'} - ${networkCaptureActive ? 'Capture active' : 'Capture inactive'} - No response yet`,
      );
    };

    const buildApiStepFromCaptureEntry = (entry, options = {}) => {
      const fallbackUrl = String(entry?.url || '').trim();
      if (!fallbackUrl) {
        throw new Error('Captured request has no URL.');
      }

      let endpointUrl = fallbackUrl;
      let queryJson = {};
      try {
        const parsedUrl = new URL(fallbackUrl, 'http://local-placeholder');
        endpointUrl = `${parsedUrl.origin === 'http://local-placeholder' ? '' : parsedUrl.origin}${parsedUrl.pathname}`;
        queryJson = Object.fromEntries(parsedUrl.searchParams.entries());
      } catch (_) {
        endpointUrl = fallbackUrl;
      }

      let bodyJson = {};
      const requestBodyText = String(entry?.requestBody || '').trim();
      if (requestBodyText) {
        try {
          bodyJson = JSON.parse(requestBodyText);
        } catch (_) {
          bodyJson = requestBodyText;
        }
      }

      const headersJson = entry?.requestHeaders && typeof entry.requestHeaders === 'object'
        ? Object.fromEntries(
            Object.entries(entry.requestHeaders).filter(([key]) => {
              const normalized = String(key || '').trim().toLowerCase();
              return normalized && !SENSITIVE_CAPTURE_HEADER_NAMES.has(normalized);
            }),
          )
        : {};

      const protocol = inferProtocolFromValues({
        headers: headersJson,
        body: requestBodyText,
        url: endpointUrl,
      });

      const payload = {
        version: 2,
        method: normalizeMethod(entry?.method || 'GET'),
        url: endpointUrl,
        query: queryJson,
        body: bodyJson,
        headers: headersJson,
        mode: normalizeMode(options.modeOverride || elements.apiWorkspaceMode?.value || 'auto', 'auto'),
        protocol,
      };
      if (
        payload.mode === 'session_http' &&
        protocol === 'rest' &&
        String(options.authPlaceholder || '').trim() &&
        !Object.keys(headersJson).some(key => String(key || '').toLowerCase() === 'authorization')
      ) {
        payload.headers.Authorization = `Bearer ${String(options.authPlaceholder).trim()}`;
      }
      if (protocol === 'soap') {
        payload.soap = {
          wsdlUrl: '',
          wsdlAuth: 'none',
          wsdlFile: '',
        };
      }
      return JSON.stringify(payload);
    };

    const tryParseJsonObject = raw => {
      if (raw == null) return null;
      if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
      const text = String(raw || '').trim();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch (_) {
        return null;
      }
    };

    const findTokenPathInObject = (value, prefix = '', depth = 0) => {
      if (depth > 6 || value == null) return '';
      if (Array.isArray(value)) return '';
      if (typeof value !== 'object') return '';

      const preferredKeys = ['token', 'access_token', 'id_token', 'jwt', 'auth_token'];
      for (const key of preferredKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] === 'string' && String(value[key]).trim() !== '') {
          return prefix ? `${prefix}.${key}` : key;
        }
      }

      const priorityContainers = ['data', 'result', 'payload', 'response'];
      for (const key of priorityContainers) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        const nestedPath = findTokenPathInObject(value[key], prefix ? `${prefix}.${key}` : key, depth + 1);
        if (nestedPath) return nestedPath;
      }

      for (const [key, nested] of Object.entries(value)) {
        if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
        const nestedPath = findTokenPathInObject(nested, prefix ? `${prefix}.${key}` : key, depth + 1);
        if (nestedPath) return nestedPath;
      }

      return '';
    };

    const deriveAuthPlaceholderFromCaptureEntry = entry => {
      const responseJson = tryParseJsonObject(entry?.responseBody);
      const tokenPath = findTokenPathInObject(responseJson || {});
      if (!tokenPath) return '';
      return `{{api_capture.json.${tokenPath}}}`;
    };

    const looksLikeApiCallValue = value => {
      const parsed = parseApiValueForWorkspace(value);
      if (!parsed) return false;
      return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(
        String(parsed.method || '').trim().toUpperCase(),
      );
    };

    const refreshNetworkCaptureEntries = async () => {
      try {
        const entries = await express.getNetworkCaptureEntries();
        renderNetworkCaptureEntries(entries);
        if (getState().networkCaptureActive) {
          setNetworkCaptureStatus(`Capture active - ${entries.length} requests`, true);
          if (elements.apiWorkspaceCaptureStatus) elements.apiWorkspaceCaptureStatus.textContent = `Capture active - ${entries.length} requests`;
        }
      } catch (_) {
        setNetworkCaptureStatus('Capture read failed', false);
        if (elements.apiWorkspaceCaptureStatus) elements.apiWorkspaceCaptureStatus.textContent = 'Capture read failed';
      }
    };

    const applyWsdlMetadataToWorkspace = metadata => {
      if (!metadata || typeof metadata !== 'object') return;
      const currentHeaders = safeParseJson(elements.apiWorkspaceHeadersInput?.value, {});
      const mergedHeaders =
        currentHeaders && typeof currentHeaders === 'object' && !Array.isArray(currentHeaders)
          ? { ...currentHeaders }
          : {};

      if (!Object.keys(mergedHeaders).some(key => String(key || '').toLowerCase() === 'content-type')) {
        mergedHeaders['Content-Type'] = 'text/xml; charset=utf-8';
      }
      if (!Object.keys(mergedHeaders).some(key => String(key || '').toLowerCase() === 'accept')) {
        mergedHeaders.Accept = 'text/xml';
      }
      if (
        metadata.firstSoapAction &&
        !Object.keys(mergedHeaders).some(key => String(key || '').toLowerCase() === 'soapaction')
      ) {
        mergedHeaders.SOAPAction = metadata.firstSoapAction;
      }

      if (elements.apiWorkspaceHeadersInput) {
        elements.apiWorkspaceHeadersInput.value = JSON.stringify(mergedHeaders, null, 2);
      }

      if (elements.apiWorkspaceBodyInput) {
        const existingBody = String(elements.apiWorkspaceBodyInput.value || '').trim();
        const shouldReplaceBody =
          !existingBody ||
          existingBody === '{}' ||
          existingBody.includes('<!-- Add SOAP operation here -->');
        if (shouldReplaceBody && metadata.bodyTemplate) {
          elements.apiWorkspaceBodyInput.value = metadata.bodyTemplate;
        }
      }

      if (elements.apiWorkspaceUrl) {
        const currentUrl = String(elements.apiWorkspaceUrl.value || '').trim();
        if (!currentUrl && metadata.endpointUrl) {
          elements.apiWorkspaceUrl.value = metadata.endpointUrl;
        }
      }
    };

    const chooseWsdlFileFromDisk = async () => {
      try {
        const result = await express.apiWorkspaceChooseWsdlFile?.();
        if (!result || result.canceled) {
          setApiWorkspaceStatus('WSDL file selection canceled.');
          return;
        }
        if (!result.ok) {
          setApiWorkspaceStatus(result.message || 'Unable to choose WSDL file.');
          return;
        }
        if (elements.apiWorkspaceWsdlFile) {
          elements.apiWorkspaceWsdlFile.value = result.fileName || '';
          elements.apiWorkspaceWsdlFile.dataset.wsdlPath = result.filePath || '';
        }
        setApiWorkspaceStatus(`Selected WSDL file: ${result.fileName || result.filePath}`);
      } catch (error) {
        setApiWorkspaceStatus(`WSDL file selection failed: ${error?.message || error}`);
      }
    };

    const importWsdlIntoWorkspace = async () => {
      try {
        const wsdlUrl = String(elements.apiWorkspaceWsdlUrl?.value || '').trim();
        const wsdlFilePath = String(elements.apiWorkspaceWsdlFile?.dataset?.wsdlPath || '').trim();
        const wsdlAuthMode = String(elements.apiWorkspaceWsdlAuth?.value || 'none').trim().toLowerCase();
        const hasInput = !!wsdlUrl || !!wsdlFilePath;
        if (!hasInput) {
          setApiWorkspaceStatus('Enter WSDL URL or choose local WSDL file before import.');
          return;
        }
        if (wsdlAuthMode !== 'none') {
          setApiWorkspaceStatus('Only "none" WSDL auth is currently supported in this phase.');
          return;
        }

        const result = await express.apiWorkspaceImportWsdl?.({
          wsdlUrl,
          wsdlFilePath,
        });
        if (!result?.ok) {
          setApiWorkspaceStatus(result?.message || 'WSDL import failed.');
          return;
        }

        applyWsdlMetadataToWorkspace(result.metadata || {});
        const operationName = String(result?.metadata?.firstOperation || '').trim();
        const actionName = String(result?.metadata?.firstSoapAction || '').trim();
        const importedSummary =
          operationName || actionName
            ? `WSDL imported${operationName ? ` - op: ${operationName}` : ''}${actionName ? ` - SOAPAction set` : ''}.`
            : 'WSDL imported.';
        setApiWorkspaceStatus(importedSummary);
      } catch (error) {
        setApiWorkspaceStatus(`WSDL import failed: ${error?.message || error}`);
      }
    };

    const renderOpenApiOperationOptions = metadata => {
      if (!elements.apiWorkspaceOpenApiOperation) return;
      const operations = Array.isArray(metadata?.operations) ? metadata.operations : [];
      if (operations.length === 0) {
        elements.apiWorkspaceOpenApiOperation.innerHTML = '<option value="">No operation imported</option>';
        return;
      }
      const optionsHtml = operations
        .map(operation => {
          const optionValue = escapeHtml(String(operation.id || ''));
          const label = escapeHtml(`${String(operation.method || '').toUpperCase()} ${String(operation.path || '')} ${String(operation.operationId || '').trim() ? `(${String(operation.operationId)})` : ''}`.trim());
          return `<option value="${optionValue}">${label}</option>`;
        })
        .join('');
      elements.apiWorkspaceOpenApiOperation.innerHTML = optionsHtml;
    };

    const applyOpenApiOperationToWorkspace = operation => {
      if (!operation || typeof operation !== 'object') {
        setApiWorkspaceStatus('Select an imported operation first.');
        return;
      }

      const method = normalizeMethod(operation.method || 'GET');
      const routePath = String(operation.path || '').trim();
      const serverUrl = String(importedOpenApiMetadata?.serverUrl || '').trim();
      const normalizedServer = serverUrl.replace(/\/$/, '');
      const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
      const resolvedUrl = normalizedServer ? `${normalizedServer}${normalizedPath}` : routePath;

      if (elements.apiWorkspaceProtocol) elements.apiWorkspaceProtocol.value = 'rest';
      if (elements.apiWorkspaceOpenApiToggle) elements.apiWorkspaceOpenApiToggle.checked = true;
      if (elements.apiWorkspaceMethod) elements.apiWorkspaceMethod.value = method;
      if (elements.apiWorkspaceUrl && resolvedUrl) elements.apiWorkspaceUrl.value = resolvedUrl;
      if (elements.apiWorkspaceQuery) {
        elements.apiWorkspaceQuery.value = JSON.stringify(operation.query || {}, null, 2);
      }
      if (elements.apiWorkspaceBodyInput) {
        const bodyValue = operation.body != null ? operation.body : {};
        if (typeof bodyValue === 'string') {
          elements.apiWorkspaceBodyInput.value = bodyValue;
        } else {
          elements.apiWorkspaceBodyInput.value = JSON.stringify(bodyValue, null, 2);
        }
      }
      if (elements.apiWorkspaceHeadersInput) {
        elements.apiWorkspaceHeadersInput.value = JSON.stringify(operation.headers || {}, null, 2);
      }
      syncApiWorkspaceProtocolFields({ applyDefaults: false });
      const summary = `${method} ${routePath || resolvedUrl || ''}`.trim();
      setApiWorkspaceStatus(`OpenAPI operation applied: ${summary}`);
    };

    const chooseOpenApiFileFromDisk = async () => {
      try {
        const result = await express.apiWorkspaceChooseOpenApiFile?.();
        if (!result || result.canceled) {
          setApiWorkspaceStatus('OpenAPI file selection canceled.');
          return;
        }
        if (!result.ok) {
          setApiWorkspaceStatus(result.message || 'Unable to choose OpenAPI file.');
          return;
        }
        if (elements.apiWorkspaceOpenApiFile) {
          elements.apiWorkspaceOpenApiFile.value = result.fileName || '';
          elements.apiWorkspaceOpenApiFile.dataset.openApiPath = result.filePath || '';
        }
        setApiWorkspaceStatus(`Selected OpenAPI file: ${result.fileName || result.filePath}`);
      } catch (error) {
        setApiWorkspaceStatus(`OpenAPI file selection failed: ${error?.message || error}`);
      }
    };

    const importOpenApiIntoWorkspace = async () => {
      try {
        const openApiUrl = String(elements.apiWorkspaceOpenApiUrl?.value || '').trim();
        const openApiFilePath = String(elements.apiWorkspaceOpenApiFile?.dataset?.openApiPath || '').trim();
        if (!openApiUrl && !openApiFilePath) {
          setApiWorkspaceStatus('Enter OpenAPI URL or choose local spec file before import.');
          return;
        }

        const result = await express.apiWorkspaceImportOpenApi?.({
          openApiUrl,
          openApiFilePath,
        });
        if (!result?.ok) {
          setApiWorkspaceStatus(result?.message || 'OpenAPI import failed.');
          return;
        }

        importedOpenApiMetadata = result.metadata || null;
        renderOpenApiOperationOptions(importedOpenApiMetadata);
        const operationCount = Array.isArray(importedOpenApiMetadata?.operations)
          ? importedOpenApiMetadata.operations.length
          : 0;
        setApiWorkspaceStatus(`OpenAPI imported: ${operationCount} operation(s) available.`);

        const firstOperation = importedOpenApiMetadata?.operations?.[0];
        if (firstOperation) {
          applyOpenApiOperationToWorkspace(firstOperation);
        }
      } catch (error) {
        setApiWorkspaceStatus(`OpenAPI import failed: ${error?.message || error}`);
      }
    };

    const applySelectedOpenApiOperation = () => {
      const selectedId = String(elements.apiWorkspaceOpenApiOperation?.value || '').trim();
      if (!selectedId || !Array.isArray(importedOpenApiMetadata?.operations)) {
        setApiWorkspaceStatus('No imported OpenAPI operation selected.');
        return;
      }
      const operation = importedOpenApiMetadata.operations.find(item => String(item.id || '') === selectedId);
      if (!operation) {
        setApiWorkspaceStatus('Selected operation was not found in imported metadata.');
        return;
      }
      applyOpenApiOperationToWorkspace(operation);
    };
    wireAutomationPayloadActions();
    elements.apiWorkspaceProtocol?.addEventListener?.('change', () => syncApiWorkspaceProtocolFields({ applyDefaults: true }));
    elements.apiWorkspaceOpenApiToggle?.addEventListener?.('change', () => syncApiWorkspaceProtocolFields({ applyDefaults: true }));
    elements.apiWorkspaceWsdlImportBtn?.addEventListener?.('click', importWsdlIntoWorkspace);
    elements.apiWorkspaceWsdlChooseBtn?.addEventListener?.('click', chooseWsdlFileFromDisk);
    elements.apiWorkspaceOpenApiImportBtn?.addEventListener?.('click', importOpenApiIntoWorkspace);
    elements.apiWorkspaceOpenApiChooseBtn?.addEventListener?.('click', chooseOpenApiFileFromDisk);
    elements.apiWorkspaceOpenApiApplyBtn?.addEventListener?.('click', applySelectedOpenApiOperation);
    elements.apiWorkspaceOpenApiOperation?.addEventListener?.('change', applySelectedOpenApiOperation);
    elements.apiWorkspaceCaptureTypeFilter?.addEventListener?.('change', () => {
      const currentEntries = Array.isArray(getState().latestNetworkCaptureEntries)
        ? getState().latestNetworkCaptureEntries
        : [];
      renderNetworkCaptureEntries(currentEntries);
      const apiResult = parseManualApiCallOutput(getState().latestApiCallOutput || elements.testOutput?.value || '');
      renderApiWorkspaceActiveTab(apiResult, getState().latestApiWorkspaceAssertions);
    });
    syncApiWorkspaceProtocolFields();

    return {
      buildApiCallValueFromWorkspace,
      buildApiStepFromCaptureEntry,
      evaluateManualApiAssertions,
      getDynamicFieldCountForCaptureEntry,
      getApiResultTabContent,
      looksLikeApiCallValue,
      parseManualApiCallOutput,
      populateApiWorkspaceFromApiCallValue,
      refreshNetworkCaptureEntries,
      renderApiCallResult,
      renderApiWorkspaceActiveTab,
      renderNetworkCaptureEntries,
      resetApiCallResult,
      resetApiWorkspaceForm,
      runAssertions,
      setApiWorkspaceStatus,
      setNetworkCaptureStatus,
      syncApiCallPanelVisibility,
      syncApiCallResultExpansion,
      syncApiWorkspaceReport,
      syncApiWorkspaceView,
      syncNetworkCaptureExpansion,
    };
  }

  global.createApiWorkspaceModule = createApiWorkspaceModule;
})(window);





















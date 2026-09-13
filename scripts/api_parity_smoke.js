const { parseApiCallValue, validateApiCallContract, redactApiCallValueForLogs } = require('../src/utils/apiCallContract');

const failures = [];

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const runCase = (name, rawValue, expectations) => {
  const parsed = parseApiCallValue(rawValue, { defaultMode: 'browser_session' });
  const contractErrors = validateApiCallContract(parsed);
  assert(contractErrors.length === 0, `${name}: contract errors -> ${contractErrors.join(' | ')}`);
  expectations(parsed);
};

runCase(
  'REST JSON payload',
  JSON.stringify({
    version: 2,
    protocol: 'rest',
    method: 'GET',
    url: 'https://example.com/api/projects',
    query: { page: '1' },
    body: {},
    headers: { Accept: 'application/json' },
    mode: 'auto',
  }),
  parsed => {
    assert(parsed.protocol === 'rest', 'REST payload should stay protocol=rest');
    assert(parsed.method === 'GET', 'REST payload should keep GET method');
    assert(parsed.mode === 'auto', 'REST payload should keep mode=auto');
  },
);

runCase(
  'SOAP JSON payload',
  JSON.stringify({
    version: 2,
    protocol: 'soap',
    method: 'POST',
    url: 'https://example.com/soap/service',
    query: {},
    body: '<soapenv:Envelope><soapenv:Body/></soapenv:Envelope>',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'urn:GetCustomer',
    },
    mode: 'session_http',
    soap: {
      wsdlUrl: 'https://example.com/soap/service?wsdl',
      wsdlAuth: 'none',
      wsdlFile: 'customer.wsdl',
      soapAction: 'urn:GetCustomer',
    },
  }),
  parsed => {
    assert(parsed.protocol === 'soap', 'SOAP payload should stay protocol=soap');
    assert(parsed.method === 'POST', 'SOAP payload should keep POST method');
    assert(
      String(parsed.headersJson).includes('SOAPAction'),
      'SOAP payload should keep SOAPAction header',
    );
  },
);

runCase(
  'Legacy pipe payload compatibility',
  'POST|https://example.com/api/login|{}|{"user":"demo"}|{"Accept":"application/json"}|auto',
  parsed => {
    assert(parsed.method === 'POST', 'Legacy payload should parse method');
    assert(parsed.protocol === 'rest', 'Legacy payload should default to REST');
  },
);

const redacted = redactApiCallValueForLogs(
  JSON.stringify({
    version: 2,
    protocol: 'rest',
    method: 'GET',
    url: 'https://example.com/secure',
    query: {},
    body: {},
    headers: {
      Authorization: 'Bearer top-secret',
      Cookie: 'session=secret',
      Accept: 'application/json',
    },
    mode: 'auto',
  }),
);
assert(!redacted.includes('top-secret'), 'Redaction should remove authorization secrets');
assert(!redacted.includes('session=secret'), 'Redaction should remove cookie secrets');

if (failures.length > 0) {
  console.error('[api_parity_smoke] FAILED');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('[api_parity_smoke] PASS');

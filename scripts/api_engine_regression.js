const { parseApiCallValue } = require('../src/utils/apiCallContract');
const { createManualApiRuntimeContext } = require('../src/utils/manualApiRuntime');
const { WebActions } = require('../src/ui/automation/webActions');
const { FastTrackAutomation } = require('../src/ui/automation');

const failures = [];

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const createAutomation = () => {
  const automation = new FastTrackAutomation({
    testRunnerStepDataOriginal: [],
    testRunner: null,
    mainWindow: {
      webContents: {
        send: () => {},
      },
    },
    token: '',
    selectedScreen: null,
    isReExecuteFlag: false,
  });
  automation.setExecutionDelay(0);
  return automation;
};

const baseResponse = request => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  url: request.url,
  headers: {},
  body: '{}',
  json: {},
  mode: request.mode,
  protocol: request.protocol || 'rest',
  soapFault: false,
});

const testManualRuntimeInterpolation = () => {
  const ctx = createManualApiRuntimeContext();
  const loginResult = {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://beta-api.qafasttrack.com/api/client/login',
    headers: { 'content-type': 'application/json' },
    body: '{"success":true}',
    json: {
      success: true,
      data: {
        token: 'token-abc-123',
      },
    },
  };

  ctx.registerApiResult(JSON.stringify(loginResult));

  const payload = JSON.stringify({
    version: 2,
    method: 'GET',
    url: 'https://beta-api.qafasttrack.com/api/projects',
    query: { page: '1', limit: '16' },
    body: {},
    headers: {
      Authorization: 'Bearer {{api_capture.json.data.token}}',
      'X-Debug': '${output.json.data.token}',
    },
    mode: 'session_http',
    protocol: 'rest',
  });

  const resolved = ctx.resolveValue(payload);
  const parsed = parseApiCallValue(resolved, { defaultMode: 'browser_session' });
  const headers = JSON.parse(parsed.headersJson);
  assert(
    headers.Authorization === 'Bearer token-abc-123',
    'manual runtime should resolve {{api_capture.json.data.token}} in Authorization header',
  );
  assert(
    headers['X-Debug'] === 'token-abc-123',
    'manual runtime should resolve ${output.json.data.token} compatibility alias',
  );
};

const testApiCallModeRouting = async () => {
  const wa = new WebActions();
  const calls = {
    http: 0,
    browser: 0,
    ensure: 0,
  };

  wa.executeApiCallWithSessionHttp = async request => {
    calls.http += 1;
    return baseResponse(request);
  };
  wa.executeApiCallInBrowser = async request => {
    calls.browser += 1;
    return baseResponse(request);
  };
  wa.ensureSessionOrThrow = async () => {
    calls.ensure += 1;
  };

  wa.hasValidSession = async () => false;
  await wa.apiCall({
    value: JSON.stringify({
      version: 2,
      method: 'GET',
      url: 'https://example.com/session-http',
      headers: { Accept: 'application/json' },
      query: {},
      body: {},
      mode: 'session_http',
      protocol: 'rest',
    }),
  });
  assert(calls.http === 1, 'mode=session_http should execute HTTP path');
  assert(calls.browser === 0, 'mode=session_http should not execute browser path');
  assert(calls.ensure === 0, 'mode=session_http should not require browser session');

  await wa.apiCall({
    value: JSON.stringify({
      version: 2,
      method: 'GET',
      url: 'https://example.com/auto-no-session',
      headers: { Accept: 'application/json' },
      query: {},
      body: {},
      mode: 'auto',
      protocol: 'rest',
    }),
  });
  assert(calls.http === 2, 'mode=auto without session should fallback to HTTP path');
  assert(calls.browser === 0, 'mode=auto without session should not call browser path');

  wa.hasValidSession = async () => true;
  await wa.apiCall({
    value: JSON.stringify({
      version: 2,
      method: 'GET',
      url: 'https://example.com/browser-session',
      headers: { Accept: 'application/json' },
      query: {},
      body: {},
      mode: 'browser_session',
      protocol: 'rest',
    }),
  });
  assert(calls.browser === 1, 'mode=browser_session should execute browser path');
  assert(calls.ensure === 1, 'mode=browser_session should require browser session');
};

const testAutomationRuntimeInterpolation = async () => {
  const automation = createAutomation();
  let executedStep = null;
  automation.webDriver = {
    recorderActive: false,
    hasValidSession: async () => true,
    click: async step => {
      executedStep = { ...step };
      return 'clicked';
    },
  };
  automation.setRuntimeVariable('l_otp', '123456');

  await automation.runStep({
    keyword: { name: 'click' },
    value: '{{l_otp}}',
    xPath: "//*[@id='otp']",
    expected_output: 'OTP {{l_otp}} entered',
  });

  assert(executedStep?.value === '123456', 'automation should resolve runtime variables before web keyword execution');
  assert(
    executedStep?.expected_output === 'OTP 123456 entered',
    'automation should resolve runtime variables in expected output',
  );
};

const testAutomationCaptureKeywordRegistersRuntimeVariables = async () => {
  const automation = createAutomation();
  automation.webDriver = {
    recorderActive: false,
    hasValidSession: async () => true,
    getElementValue: async () => 'captured-value',
  };

  await automation.runStep({
    keyword: { name: 'getElementValue' },
    value: '',
    xPath: "//*[@id='token']",
    expected_output: '',
  });

  assert(automation.capturedData === 'captured-value', 'getElementValue should update capturedData');
  assert(
    automation.runtimeVariables.web_capture === 'captured-value',
    'getElementValue should register web_capture runtime variable',
  );
};

const testAutomationApiCallRegistersRuntimeVariablesWithoutBrowserForHttpMode = async () => {
  const automation = createAutomation();
  let apiCalled = false;
  automation.webDriver = {
    recorderActive: false,
    hasValidSession: async () => false,
    apiCall: async () => {
      apiCalled = true;
      return JSON.stringify({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://example.test/api/login',
        headers: { 'content-type': 'application/json' },
        body: '{"token":"abc"}',
        json: { token: 'abc' },
        mode: 'session_http',
      });
    },
  };

  await automation.runStep({
    keyword: { name: 'apiCall' },
    value: JSON.stringify({
      version: 2,
      method: 'GET',
      url: 'https://example.test/api/login',
      query: {},
      body: {},
      headers: { Accept: 'application/json' },
      mode: 'session_http',
      protocol: 'rest',
    }),
    xPath: '',
    expected_output: 'status=200||json.token=abc',
  });

  assert(apiCalled, 'apiCall should execute in session_http mode without browser session');
  assert(automation.runtimeVariables['api_capture.status'] === '200', 'apiCall should register api_capture.status');
  assert(automation.runtimeVariables['api_capture.json.token'] === 'abc', 'apiCall should flatten JSON runtime variables');
  assert(automation.capturedData === '{"token":"abc"}', 'apiCall should update capturedData with primary response body');
};

const testAutomationApiCallBrowserModeRequiresSession = async () => {
  const automation = createAutomation();
  let apiCalled = false;
  automation.webDriver = {
    recorderActive: false,
    hasValidSession: async () => false,
    apiCall: async () => {
      apiCalled = true;
      return '{}';
    },
  };

  let failed = false;
  try {
    await automation.runStep({
      keyword: { name: 'apiCall' },
      value: JSON.stringify({
        version: 2,
        method: 'GET',
        url: 'https://example.test/api/secure',
        query: {},
        body: {},
        headers: { Accept: 'application/json' },
        mode: 'browser_session',
        protocol: 'rest',
      }),
      xPath: '',
      expected_output: '',
    });
  } catch (error) {
    failed = String(error?.message || '').includes('WebDriver session is not active');
  }

  assert(failed, 'apiCall browser_session mode should require active WebDriver session');
  assert(!apiCalled, 'apiCall browser_session mode should not execute when WebDriver session is missing');
};

const testAutomationCloseBrowserSkipsWithoutSession = async () => {
  const automation = createAutomation();
  let closeCalled = false;
  automation.webDriver = {
    recorderActive: false,
    hasValidSession: async () => false,
    closeBrowser: async () => {
      closeCalled = true;
    },
  };

  await automation.runStep({
    keyword: { name: 'closeBrowser' },
    value: '',
    xPath: '',
    expected_output: '',
  });

  assert(!closeCalled, 'closeBrowser should skip safely when no valid WebDriver session exists');
};

const testAutomationApiEvidenceRedactsSensitiveValues = () => {
  const automation = createAutomation();
  const comment = automation.buildApiEvidenceComment({
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://example.test/api/secure',
    mode: 'session_http',
    headers: {
      Authorization: 'Bearer top-secret',
      Cookie: 'session=secret',
      Accept: 'application/json',
    },
    body: '{"access_token":"body-secret","name":"demo"}',
    json: {
      access_token: 'json-secret',
      name: 'demo',
    },
    raw: '{"refresh_token":"raw-secret"}',
  });

  assert(comment && comment.startsWith('__QAF_EVIDENCE__'), 'API evidence should use expected evidence prefix');
  assert(!comment.includes('top-secret'), 'API evidence should redact Authorization header');
  assert(!comment.includes('session=secret'), 'API evidence should redact Cookie header');
  assert(!comment.includes('body-secret'), 'API evidence should redact token values from body');
  assert(!comment.includes('json-secret'), 'API evidence should redact token values from JSON');
  assert(!comment.includes('raw-secret'), 'API evidence should redact token values from raw response');
};

const run = async () => {
  testManualRuntimeInterpolation();
  await testApiCallModeRouting();
  await testAutomationRuntimeInterpolation();
  await testAutomationCaptureKeywordRegistersRuntimeVariables();
  await testAutomationApiCallRegistersRuntimeVariablesWithoutBrowserForHttpMode();
  await testAutomationApiCallBrowserModeRequiresSession();
  await testAutomationCloseBrowserSkipsWithoutSession();
  testAutomationApiEvidenceRedactsSensitiveValues();

  if (failures.length > 0) {
    console.error('[api_engine_regression] FAILED');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
  }

  console.log('[api_engine_regression] PASS');
};

run().catch(error => {
  console.error('[api_engine_regression] ERROR', error?.message || error);
  process.exit(1);
});

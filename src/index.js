const { app, BrowserWindow, ipcMain, desktopCapturer, Menu, dialog } = require('electron');
app.disableHardwareAcceleration();
const fs = require('fs');
const http = require('http');
const axios = require('axios');
const { api } = require('./utils/api');
const net = require('net');
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dotenv = require('dotenv');
const {
  nowIso,
  readJsonSafe,
  writeJsonAtomic,
  clearFileSafe,
  buildInitialJournal,
} = require('./utils/runJournal');

const envName = process.env.APP_ENV || 'staging';
const appRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
dotenv.config({ path: path.join(appRoot, `.env.${envName}`) });
const queueWorkerConfigPath = () => path.join(app.getPath('userData'), 'queue-worker-config.json');
const runJournalPath = () => path.join(app.getPath('userData'), 'active-run-journal.json');
const RUNNER_PROTOCOL = 'qafasttrack-runner';

const { Browser } = require('selenium-webdriver');
const { expressApp } = require('./express');
const { stepLogCall } = require('./utils/stepLog');
const { getStepLogUrl, getUploadVideoUrl } = require('./utils/endpoint');
const { setRuntimeConfig, getRuntimeConfig } = require('./utils/runtimeConfig');
const { LocalQueueWorker } = require('./utils/localQueueWorker');
const { FastTrackAutomation } = require('../src/ui/automation/index');
const { WebActions, activeWebDrivers, getLastWebActionsInstance, clearLastWebActionsInstance, removeActiveWebDriver, quitWithTimeout } =require('./ui/automation/webActions');
const { generateSeleniumScripts } = require('./utils/seleniumExporter');
const { parseApiCallValue } = require('./utils/apiCallContract');
const { createManualApiRuntimeContext } = require('./utils/manualApiRuntime');
const {
  launchBrowser,
  launchDebugBrowser,
  connectBrowser,
  navigate,
  sendKeys,
  sendKey,
  setSecure,
  click,
  select,
  wait,
  waitForElement,
  waitForText,
  exist,
  rightClick,
  doubleClick,
  maxBrowser,
  minBrowser,
  openTab,
  closeTab,
  openWindow,
  closeBrowser,
  validateElement,
  clearInput,
  getElementValue,
  scrollToElement,
  scrollToText,
  selectAll,
  copy,
  paste,
  
  switchToIframe, //Haven't Tested this keyword
  switchToDom,
  hoverElement, //Haven't Tested this keyword
  digitalSignature,
  alertAccept,
  alertDismiss,
  verifyTextOnAlert,
  alertSetText,
  switchBrowser,
  connectPDF,
  verifyPDFText,
  disconnectPDF,
  deletePDFFile,
  getCookieValue,
  removeCookie,
  dragDrop,
  getDBValue,
  executeSQL,
  apiCall
} = require('./utils/keywordFunction');
const {
  //launchMobileDriver,
  //mobileTap,
  //mobileDoubleTap,
  //mobileLongPress,
  //mobileSetInputValue,
  //mobileBack,
  //mobileScrollToText,
  //mobileElementExists,
  //mobileElementNotExists,
  //mobileInputExistsAndValidate,
  //mobileHideKeyboard




//updated by Ayaz
mobileOpenApp,
mobileTap,
mobileDoubleTap,
mobileLongPress,
mobileFill,
mobileBack,
mobileSwipe,

//mobileScrollForward,
//mobileScrollBackward,
mobileScrollToText,
//mobileScrollToElement,
mobileElementExist,
mobileElementNotExist,
mobileElementValidate,
mobileSwitchContext,
mobileHideKeyboard,
mobilePinch,
//mobileCloseApp,
mobileDigitalSignature

} = require('./utils/appiumKeywordFunctionsRouter');
colors = require('colors');

let expressListen = null;
let serverStartPromise = null;
let driver = null;
let currentStep = 0;
let currentRunner = 0;
let isPaused = false;
let testRunnerStepData = null;
let testRunnerStepDataOriginal = null;
let testRunnerData = null;
let isReExecuteFlag = false;
let isServerRunning = false;
let routesRegistered = false;
let lastRunPayload = null;
let highlightEnabled = true;
let executionDelayMs = 200;
const execution = {
  NOT_EXECUTED: 0,
  EXECUTING: 1,
  EXECUTED: 2,
  FAILED: 3,
};
let token = '';
let selectedScreen = null;
let capturedData = null;
let fastTrackAutomation = null;
let selectScreenHandlerRegistered = false;
let screenSelected = false;
let lastRunAt = null;
let lastRunStatus = 'idle';
let lastViewerFrameAt = null;
let viewerFrameCache = null;
let isAutomationExecuting = false;
let queueStopInProgress = false;
let recoveryDecisionPending = false;
let pendingRecoveryJournal = null;
const localQueueWorker = new LocalQueueWorker({
  canClaim: () => !isAutomationExecuting && !isPaused && !recoveryDecisionPending && !queueStopInProgress,
  onExecute: async (payload, meta) => {
    return executeAutomationPayload(payload, {
      token: meta?.token,
      deviceKey: meta?.deviceKey,
      apiBaseUrl: meta?.apiBaseUrl,
      source: 'queue-local',
      queue: meta?.queue || null,
      item: meta?.item || null,
      claimToken: meta?.claimToken || meta?.claim_token || null,
    });
  },
  onQueueKilled: ({ message }) => {
    console.log('[queue-local] queue killed override', message || '');
    if (fastTrackAutomation?.pauseExecution) {
      try {
        fastTrackAutomation.pauseExecution();
      } catch (_) {}
    }
    isAutomationExecuting = false;
    isPaused = false;
    clearRunJournal('queue_kill_override');
    localQueueWorker.clearActiveExecution(message || 'queue_kill_override');
    clearRunnerExecutionUi('Queue was canceled. Execution has been stopped.');
  },
});
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}
let mainWindow;
let webServerPort = parseInt(process.env.WEBDRIVER_PORT, 10) || 3009;
let pendingProtocolUrl = null;
let pendingRunnerSetupPayload = null;
let lastServerStartIssueAt = 0;

const extractProtocolFromArgv = (argv = []) =>
  (argv || []).find(arg => String(arg || '').toLowerCase().startsWith(`${RUNNER_PROTOCOL}://`)) || null;

const focusMainWindow = () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const getServerBoundPort = () => {
  try {
    return Number(expressListen?.address?.()?.port || 0);
  } catch (_) {
    return 0;
  }
};

const syncServerRunningState = () => {
  isServerRunning = getServerBoundPort() > 0;
  return isServerRunning;
};

const notifyRunnerAlreadyRunning = port => {
  const nowMs = Date.now();
  if (nowMs - lastServerStartIssueAt < 4000) return;
  lastServerStartIssueAt = nowMs;
  const message = `Runner local server port ${port} is already in use.`;
  const detail = 'Another runner instance may already be running. Close the extra instance and use the existing runner window to pair.';
  try {
    mainWindow?.webContents?.send?.('getServerStatus', {
      status: false,
      code: 'runner_port_in_use',
      message,
    });
  } catch (_) {}
  try {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Runner Already Running',
      message,
      detail,
      buttons: ['OK'],
      defaultId: 0,
    });
  } catch (_) {}
};

const registerRunnerProtocolClient = () => {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(RUNNER_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(RUNNER_PROTOCOL);
    }
  } catch (err) {
    console.log('[protocol] registration failed', err?.message || err);
  }
};

const base64UrlDecodeUtf8 = value => {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  return Buffer.from(text + padding, 'base64').toString('utf8');
};

const base64UrlDecodeBuffer = value => {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  return Buffer.from(text + padding, 'base64');
};

const resolveViewerTokenSecret = deviceKey => {
  const rawDeviceKey = String(deviceKey || '').trim();
  if (rawDeviceKey) return rawDeviceKey;
  const configured = String(process.env.DEVICE_VIEWER_TOKEN_SECRET || '').trim();
  if (configured) return configured;
  return crypto.createHash('sha256').update(String(process.env.APP_KEY || 'qafasttrack-viewer-token-fallback')).digest('hex');
};

const verifyViewerAccessToken = (token, deviceKey = '') => {
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, reason: 'token_missing' };
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'token_format_invalid' };
  const [headerPart, payloadPart, signaturePart] = parts;
  try {
    const expected = crypto.createHmac('sha256', resolveViewerTokenSecret(deviceKey)).update(`${headerPart}.${payloadPart}`).digest();
    const incoming = base64UrlDecodeBuffer(signaturePart);
    if (incoming.length !== expected.length || !crypto.timingSafeEqual(incoming, expected)) {
      return { ok: false, reason: 'token_signature_invalid' };
    }
    const payload = JSON.parse(base64UrlDecodeUtf8(payloadPart) || '{}');
    const exp = Number(payload?.exp || 0);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'token_expired' };
    }
    return { ok: true, claims: payload };
  } catch (_) {
    return { ok: false, reason: 'token_decode_invalid' };
  }
};

const parseRunnerSetupPayload = url => {
  try {
    const parsed = new URL(String(url));
    const action = String(parsed.hostname || '').toLowerCase();
    if (action !== 'setup') return null;
    const sessionToken = String(parsed.searchParams.get('session') || '').trim();
    if (!sessionToken) return null;
    const apiBaseUrl = String(parsed.searchParams.get('api') || '').trim();
    return { sessionToken, apiBaseUrl };
  } catch (_) {
    return null;
  }
};

const dispatchRunnerSetupPayload = () => {
  if (!mainWindow || !pendingRunnerSetupPayload) return false;
  try {
    mainWindow.webContents.send('runnerSetupSession', pendingRunnerSetupPayload);
    return true;
  } catch (_) {
    return false;
  }
};

const handleRunnerProtocolUrl = url => {
  if (!url || !String(url).toLowerCase().startsWith(`${RUNNER_PROTOCOL}://`)) return;
  const setupPayload = parseRunnerSetupPayload(url);
  if (setupPayload) {
    pendingRunnerSetupPayload = setupPayload;
  }
  focusMainWindow();
  if (!isServerRunning && mainWindow) {
    startServer(mainWindow);
  }
  if (setupPayload) {
    setTimeout(() => {
      dispatchRunnerSetupPayload();
    }, 300);
  }
};

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    pendingProtocolUrl = extractProtocolFromArgv(argv) || pendingProtocolUrl;
    focusMainWindow();
    if (pendingProtocolUrl) {
      handleRunnerProtocolUrl(pendingProtocolUrl);
      pendingProtocolUrl = null;
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  pendingProtocolUrl = url;
  if (mainWindow) {
    handleRunnerProtocolUrl(url);
    pendingProtocolUrl = null;
  }
});

const loadPersistedQueueWorkerConfig = () => {
  try {
    const file = queueWorkerConfigPath();
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch (err) {
    console.log('[queue-local] load persisted config failed', err?.message || err);
    return {};
  }
};

const savePersistedQueueWorkerConfig = patch => {
  try {
    const file = queueWorkerConfigPath();
    const current = loadPersistedQueueWorkerConfig();
    const next = { ...current, ...patch };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.log('[queue-local] save persisted config failed', err?.message || err);
    return false;
  }
};

const getPersistedRecoveryEnabled = () => {
  const persisted = loadPersistedQueueWorkerConfig();
  return persisted.allowRecovery === true || persisted.allowRecovery === 'true';
};

const getPersistedExecutionDelay = () => {
  const persisted = loadPersistedQueueWorkerConfig();
  const parsed = Number(persisted.executionDelayMs);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 200;
};

const loadRunJournal = () => readJsonSafe(runJournalPath());

const persistRunJournal = payload => {
  try {
    writeJsonAtomic(runJournalPath(), payload);
    return true;
  } catch (err) {
    console.log('[recovery] persist journal failed', err?.message || err);
    return false;
  }
};

const clearRunJournal = reason => {
  const cleared = clearFileSafe(runJournalPath());
  if (reason) {
    console.log(`[recovery] journal cleared: ${reason}`);
  }
  if (cleared) {
    try {
      mainWindow?.webContents?.send('recoveryCleared', { reason: reason || 'cleared' });
    } catch (_) {}
  }
  pendingRecoveryJournal = null;
  recoveryDecisionPending = false;
  return cleared;
};

const updateRunJournalProgress = patch => {
  const journal = loadRunJournal();
  if (!journal) return;
  const next = {
    ...journal,
    updated_at: nowIso(),
    progress: {
      ...(journal.progress || {}),
      ...(patch || {}),
    },
  };
  persistRunJournal(next);
};

const maybePromptRecovery = () => {
  const allowRecovery = getPersistedRecoveryEnabled();
  if (!allowRecovery) return;
  const journal = loadRunJournal();
  if (!journal) return;
  if (journal.state && ['completed', 'failed', 'canceled', 'discarded'].includes(journal.state)) {
    clearRunJournal('terminal_journal_cleanup');
    return;
  }
  pendingRecoveryJournal = journal;
  recoveryDecisionPending = true;
  try {
    if (
      Array.isArray(journal?.progress?.steps_snapshot) &&
      Number.isFinite(Number(journal?.progress?.current_runner))
    ) {
      mainWindow?.webContents?.send('testRunnerStepData', {
        runner: journal.progress.steps_snapshot,
        currentRunner: Number(journal.progress.current_runner) || 0,
      });
    }
  } catch (_) {}
  try {
    mainWindow?.webContents?.send('recoveryPrompt', journal);
  } catch (_) {}
};

const extractWsdlMetadata = wsdlText => {
  const source = String(wsdlText || '');
  if (!source.trim()) {
    return { ok: false, message: 'WSDL content is empty.' };
  }

  const targetNamespaceMatch = source.match(/\btargetNamespace\s*=\s*["']([^"']+)["']/i);
  const endpointMatch =
    source.match(/<\s*soap(?:12)?:address[^>]*\blocation\s*=\s*["']([^"']+)["']/i) ||
    source.match(/\bsoap(?:12)?:address[^>]*\blocation\s*=\s*["']([^"']+)["']/i);
  const soapActionRegex = /<\s*soap(?:12)?:operation[^>]*\bsoapAction\s*=\s*["']([^"']+)["']/gi;
  const operationRegex = /<\s*(?:wsdl:)?operation\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi;

  const soapActions = [];
  let actionMatch = soapActionRegex.exec(source);
  while (actionMatch) {
    const value = String(actionMatch[1] || '').trim();
    if (value && !soapActions.includes(value)) soapActions.push(value);
    actionMatch = soapActionRegex.exec(source);
  }

  const operationNames = [];
  let operationMatch = operationRegex.exec(source);
  while (operationMatch) {
    const value = String(operationMatch[1] || '').trim();
    if (value && !operationNames.includes(value)) operationNames.push(value);
    operationMatch = operationRegex.exec(source);
  }

  const firstSoapAction = soapActions[0] || '';
  const firstOperation = operationNames[0] || '';
  const endpointUrl = endpointMatch?.[1] ? String(endpointMatch[1]).trim() : '';
  const targetNamespace = targetNamespaceMatch?.[1] ? String(targetNamespaceMatch[1]).trim() : '';

  const bodyTemplate = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"${
    targetNamespace ? ` xmlns:tns="${targetNamespace}"` : ''
  }>\n  <soapenv:Header/>\n  <soapenv:Body>\n    ${
    firstOperation
      ? `<tns:${firstOperation}></tns:${firstOperation}>`
      : '<!-- Add SOAP operation here -->'
  }\n  </soapenv:Body>\n</soapenv:Envelope>`;

  return {
    ok: true,
    metadata: {
      endpointUrl,
      targetNamespace,
      soapActions,
      operationNames,
      firstSoapAction,
      firstOperation,
      bodyTemplate,
    },
  };
};

const importWsdlMetadata = async ({ wsdlUrl = '', wsdlFilePath = '' } = {}) => {
  const remoteUrl = String(wsdlUrl || '').trim();
  const localPath = String(wsdlFilePath || '').trim();
  if (!remoteUrl && !localPath) {
    return { ok: false, message: 'Provide a WSDL URL or choose a local WSDL file.' };
  }

  try {
    let wsdlText = '';
    let source = '';

    if (localPath) {
      wsdlText = fs.readFileSync(localPath, 'utf8');
      source = localPath;
    } else {
      const response = await axios.get(remoteUrl, {
        timeout: 15000,
        responseType: 'text',
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, message: `WSDL URL returned HTTP ${response.status}.` };
      }
      wsdlText = String(response.data || '');
      source = remoteUrl;
    }

    const parsed = extractWsdlMetadata(wsdlText);
    if (!parsed.ok) return parsed;

    return {
      ok: true,
      source,
      ...parsed,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Failed to import WSDL: ${error?.message || error}`,
    };
  }
};

const chooseWsdlFile = async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose WSDL File',
    properties: ['openFile'],
    filters: [
      { name: 'WSDL/XML', extensions: ['wsdl', 'xml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  return {
    ok: true,
    filePath,
    fileName: path.basename(filePath),
  };
};

const toOpenApiExample = schema => {
  if (!schema || typeof schema !== 'object') return {};
  if (Object.prototype.hasOwnProperty.call(schema, 'example')) return schema.example;
  const type = String(schema.type || '').toLowerCase();
  if (type === 'object' || schema.properties) {
    const result = {};
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    Object.keys(props).forEach(key => {
      result[key] = toOpenApiExample(props[key]);
    });
    return result;
  }
  if (type === 'array') {
    return [toOpenApiExample(schema.items || {})];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  return '';
};

const extractOpenApiMetadata = openApiText => {
  const source = String(openApiText || '');
  if (!source.trim()) {
    return { ok: false, message: 'OpenAPI content is empty.' };
  }

  let doc;
  try {
    doc = JSON.parse(source);
  } catch (_) {
    return { ok: false, message: 'OpenAPI import currently supports JSON specs only.' };
  }

  if (!doc || typeof doc !== 'object') {
    return { ok: false, message: 'OpenAPI content is invalid.' };
  }

  const paths = doc.paths && typeof doc.paths === 'object' ? doc.paths : null;
  if (!paths) {
    return { ok: false, message: 'OpenAPI spec has no paths.' };
  }

  const serverUrl = String(doc?.servers?.[0]?.url || '').trim();
  const operations = [];
  const allowedMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  Object.entries(paths).forEach(([routePath, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') return;
    allowedMethods.forEach(method => {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') return;

      const requestContent = operation.requestBody?.content && typeof operation.requestBody.content === 'object'
        ? operation.requestBody.content
        : {};
      const requestContentTypes = Object.keys(requestContent);
      const preferredRequestContentType = requestContentTypes[0] || 'application/json';
      const requestContentNode = requestContent[preferredRequestContentType] || {};
      const requestExample =
        requestContentNode.example ??
        requestContentNode.examples?.default?.value ??
        toOpenApiExample(requestContentNode.schema || {});

      const responseContent = operation.responses && typeof operation.responses === 'object'
        ? Object.values(operation.responses)
            .map(resp => (resp && typeof resp === 'object' ? resp.content : null))
            .find(content => content && typeof content === 'object') || {}
        : {};
      const responseContentTypes = Object.keys(responseContent);
      const preferredResponseContentType = responseContentTypes[0] || 'application/json';

      const queryTemplate = {};
      const parameters = [];
      if (Array.isArray(pathItem.parameters)) parameters.push(...pathItem.parameters);
      if (Array.isArray(operation.parameters)) parameters.push(...operation.parameters);
      parameters.forEach(parameter => {
        if (!parameter || typeof parameter !== 'object') return;
        if (String(parameter.in || '').toLowerCase() !== 'query') return;
        const name = String(parameter.name || '').trim();
        if (!name) return;
        queryTemplate[name] = parameter.example ?? '';
      });

      const headers = { Accept: preferredResponseContentType };
      if (String(method).toLowerCase() !== 'get') {
        headers['Content-Type'] = preferredRequestContentType;
      }

      const operationId = String(operation.operationId || '').trim();
      operations.push({
        id: operationId || `${String(method).toUpperCase()} ${routePath}`,
        operationId,
        summary: String(operation.summary || operation.description || '').trim(),
        method: String(method).toUpperCase(),
        path: String(routePath || '').trim(),
        query: queryTemplate,
        body: requestExample,
        headers,
      });
    });
  });

  if (operations.length === 0) {
    return { ok: false, message: 'No operations were found in OpenAPI paths.' };
  }

  return {
    ok: true,
    metadata: {
      serverUrl,
      title: String(doc?.info?.title || '').trim(),
      version: String(doc?.info?.version || '').trim(),
      operations,
    },
  };
};

const importOpenApiMetadata = async ({ openApiUrl = '', openApiFilePath = '' } = {}) => {
  const remoteUrl = String(openApiUrl || '').trim();
  const localPath = String(openApiFilePath || '').trim();
  if (!remoteUrl && !localPath) {
    return { ok: false, message: 'Provide an OpenAPI URL or choose a local spec file.' };
  }

  try {
    let openApiText = '';
    let source = '';

    if (localPath) {
      openApiText = fs.readFileSync(localPath, 'utf8');
      source = localPath;
    } else {
      const response = await axios.get(remoteUrl, {
        timeout: 15000,
        responseType: 'text',
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, message: `OpenAPI URL returned HTTP ${response.status}.` };
      }
      openApiText = String(response.data || '');
      source = remoteUrl;
    }

    const parsed = extractOpenApiMetadata(openApiText);
    if (!parsed.ok) return parsed;

    return {
      ok: true,
      source,
      ...parsed,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Failed to import OpenAPI: ${error?.message || error}`,
    };
  }
};

const chooseOpenApiFile = async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose OpenAPI File',
    properties: ['openFile'],
    filters: [
      { name: 'OpenAPI JSON', extensions: ['json'] },
      { name: 'OpenAPI YAML', extensions: ['yaml', 'yml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  return {
    ok: true,
    filePath,
    fileName: path.basename(filePath),
  };
};

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true, // like here
      webSecurity: false,
      zoomFactor: 0.9, // keep UI scale consistent across DPI/packaged builds
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'ui/home.html'));
  mainWindow.webContents.on('did-finish-load', function () {
    // DevTools disabled for stability/perf
    desktopCapturer.getSources({ types: ['screen'] }).then(async sources => {
      const screens = sources?.map(({ name, id }) => ({ name, id }));
      mainWindow.webContents.send('setScreenOptions', { screens });
      if (!selectScreenHandlerRegistered) {
        ipcMain.handle('selectScreen', (e, id) => {
          selectedScreen = id || null;
          screenSelected = !!selectedScreen;
          viewerFrameCache = null;
          lastViewerFrameAt = null;
        });
        selectScreenHandlerRegistered = true;
      }
    });
    maybePromptRecovery();
    dispatchRunnerSetupPayload();
    setTimeout(() => {
      try {
        startServer(mainWindow);
      } catch (err) {
        console.log('auto start server failed', err?.message || err);
      }
    }, 250);
  });

  const forceReload = () => {
    try {
      mainWindow?.webContents?.reloadIgnoringCache();
      return true;
    } catch (err) {
      console.log('forceReload failed', err?.message || err);
      return false;
    }
  };

  const toggleDevTools = () => {
    try {
      if (!mainWindow?.webContents) return false;
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
        return false;
      } else {
        mainWindow.webContents.openDevTools({ mode: 'right' }); // docked vertically on the right
        return true;
      }
    } catch (err) {
      console.log('toggleDevTools failed', err?.message || err);
      return false;
    }
  };

  // Minimal app menu: keep only force reload and devtools toggles.
  const menu = Menu.buildFromTemplate([
  ]);
  Menu.setApplicationMenu(menu);
  // Open the DevTools.

  // ipcMain.handle('gettestRunnerStepData', () => 'pong')

  ipcMain.handle('startServer', (_e, port) => startServer(mainWindow, port));
  ipcMain.handle('stopServer', stopServer);
  ipcMain.handle('freePort', (_e, port) => {
    killPort(parseInt(port, 10));
    return true;
  });
  ipcMain.handle('checkPort', async (_e, port) => {
    const p = parseInt(port, 10);
    if (!p || p < 1 || p > 65535) return null;
    return await isPortAvailable(p);
  });
  ipcMain.handle('exportLastRun', async (_e, language = 'js') => {
    try {
      const runners =
        structuredClone(fastTrackAutomation?.testRunnerStepData) ||
        structuredClone(lastRunPayload?.test_runner_steps);
      if (!Array.isArray(runners) || runners.length === 0) {
        return { ok: false, message: 'No recent run data to export.' };
      }
      const outDir = path.join(appRoot, 'exports');
      fs.mkdirSync(outDir, { recursive: true });
      const scripts = generateSeleniumScripts(runners, {
        language,
        testRunner: lastRunPayload?.test_runner,
      });
      if (!scripts.length) {
        return { ok: false, message: 'No scripts generated from the last run.' };
      }
      const files = [];
      scripts.forEach(({ filename, content }) => {
        const filePath = path.join(outDir, filename);
        fs.writeFileSync(filePath, content, 'utf8');
        files.push(filePath);
      });
      return { ok: true, files };
    } catch (err) {
      console.log('exportLastRun failed', err?.message || err);
      return { ok: false, message: err?.message || 'Export failed' };
    }
  });
  ipcMain.handle('setHighlightEnabled', (_e, enabled) => {
    highlightEnabled = !!enabled;
    const wa = getActiveWebActions();
    if (wa?.setHighlightEnabled) {
      wa.setHighlightEnabled(highlightEnabled);
    }
    return highlightEnabled;
  });
  ipcMain.handle('getExecutionSettings', () => ({
    delayMs: getPersistedExecutionDelay(),
  }));
  ipcMain.handle('setExecutionSpeed', (_e, delayMs = 200) => {
    const parsed = Number(delayMs);
    executionDelayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 200;
    savePersistedQueueWorkerConfig({ executionDelayMs });
    if (fastTrackAutomation) {
      fastTrackAutomation.setExecutionDelay?.(executionDelayMs);
    }
    return { delayMs: executionDelayMs };
  });
  ipcMain.handle('testLaunchBrowser', testLaunchBrowser);
  ipcMain.handle('testExecute', testExecute);
  ipcMain.handle('closeTestBrowser', closeTestBrowser);
  ipcMain.handle('startNetworkCapture', async () => {
    const wa = getActiveWebActions();
    if (!wa?.driver) {
      return {
        ok: false,
        enabled: false,
        message: 'Automation browser is not initialized. Launch Browser first, then start capture.',
      };
    }
    const result = await wa.startNetworkCapture();
    return {
      ok: true,
      ...(result && typeof result === 'object' ? result : {}),
    };
  });
  ipcMain.handle('stopNetworkCapture', async () => {
    const wa = getActiveWebActions();
    if (!wa?.driver) {
      return { enabled: false, entries: [] };
    }
    return await wa.stopNetworkCapture();
  });
  ipcMain.handle('getNetworkCaptureEntries', async () => {
    const wa = getActiveWebActions();
    if (!wa?.driver) {
      return [];
    }
    return await wa.getNetworkCaptureEntries();
  });
  ipcMain.handle('clearNetworkCapture', async () => {
    const wa = getActiveWebActions();
    if (!wa?.driver) {
      return { enabled: false, entries: [] };
    }
    return await wa.clearNetworkCapture();
  });
  ipcMain.handle('removeNetworkCaptureEntriesMatching', async (_event, entry) => {
    const wa = getActiveWebActions();
    if (!wa?.driver) {
      return { entries: [], removed: 0 };
    }
    return await wa.removeNetworkCaptureEntriesMatching(entry);
  });
  ipcMain.handle('apiWorkspaceChooseWsdlFile', async () => {
    return await chooseWsdlFile();
  });
  ipcMain.handle('apiWorkspaceImportWsdl', async (_e, payload = {}) => {
    return await importWsdlMetadata(payload || {});
  });
  ipcMain.handle('apiWorkspaceChooseOpenApiFile', async () => {
    return await chooseOpenApiFile();
  });
  ipcMain.handle('apiWorkspaceImportOpenApi', async (_e, payload = {}) => {
    return await importOpenApiMetadata(payload || {});
  });

  ipcMain.handle('pauseExecution', pauseExecution);
  ipcMain.handle('resumeExecution', resumeExecution);
  ipcMain.handle('stopExecution', stopExecution);

  ipcMain.handle('reExecuteStep', reExecuteStep);
  ipcMain.handle('markStepAsPass', () => fastTrackAutomation?.markStepAsPass());
  ipcMain.handle('markStepAsFail', () => fastTrackAutomation?.markStepAsFail());
  ipcMain.handle('recordXpathStart', recordXpathStart);
  ipcMain.handle('recordXpathStop', recordXpathStop);
  ipcMain.on('uploadVideoLog', (event, payload) => {
    try {
      console.log('[video-upload]', payload);
    } catch (err) {
      console.log('[video-upload] log failed', err?.message || err);
    }
  });
  ipcMain.handle('recordXpathFetch', recordXpathFetch);
  ipcMain.handle('advancedSpyStart', advancedSpyStart);
  ipcMain.handle('advancedSpyStop', advancedSpyStop);
  ipcMain.handle('advancedSpyFetch', advancedSpyFetch);
  ipcMain.handle('forceReload', () => forceReload());
  ipcMain.handle('toggleDevTools', () => toggleDevTools());
  ipcMain.handle('getRecoverySettings', () => ({
    allowRecovery: getPersistedRecoveryEnabled(),
    reExecuteOnFail: isReExecuteFlag === true,
  }));
  ipcMain.handle('setRecoverySettings', (_e, settings = {}) => {
    const next = {
      allowRecovery: settings.allowRecovery === true || settings.allowRecovery === 'true',
    };
    savePersistedQueueWorkerConfig(next);
    if (!next.allowRecovery) {
      clearRunJournal('recovery_disabled');
    }
    return { ok: true, ...next };
  });
  ipcMain.handle('decideRecovery', async (_e, decision) => {
    const journal = pendingRecoveryJournal || loadRunJournal();
    if (!journal) {
      recoveryDecisionPending = false;
      return { ok: false, message: 'No recovery journal found.' };
    }
    const action = typeof decision === 'string' ? decision : String(decision?.action || '').trim();
    if (action === 'discard') {
      clearRunJournal('user_discarded_recovery');
      return { ok: true, action: 'discarded' };
    }
    if (action !== 'resume') {
      return { ok: false, message: 'Unsupported recovery decision.' };
    }
    recoveryDecisionPending = false;
    pendingRecoveryJournal = null;
    try {
      await executeAutomationPayload(journal.payload, {
        token: journal?.payload?.token || '',
        source: 'recovery-resume',
        recoveryState: journal?.progress || {},
        isRecoveryResume: true,
      });
      return { ok: true, action: 'resumed' };
    } catch (err) {
      console.log('[recovery] resume failed', err?.message || err);
      return { ok: false, message: err?.message || 'Recovery resume failed.' };
    }
  });
  ipcMain.on('isReExecute', (event, value) => {
    
    console.log('isReExecute', value)
    isReExecuteFlag = value === true || value === 'true';
    savePersistedQueueWorkerConfig({ reExecuteOnFail: isReExecuteFlag });
    if(fastTrackAutomation){
      fastTrackAutomation.isReExecuteFlag = isReExecuteFlag;
    }
  });
  ipcMain.handle('dataToReExecuteStep', (event, payload) => fastTrackAutomation.dataToReExecuteStep(payload));
  ipcMain.handle('consumePendingRunnerSetupSession', () => {
    const payload = pendingRunnerSetupPayload;
    pendingRunnerSetupPayload = null;
    return payload;
  });

  // startServer()
  if (pendingProtocolUrl) {
    handleRunnerProtocolUrl(pendingProtocolUrl);
    pendingProtocolUrl = null;
  }
};
// ipcMain.on('gettestRunnerStepData', (event, testRunnerStepData) => {
//   event.webContents.send('gettestRunnerStepData',testRunnerStepData)
//   console.log(event)
//   console.log(testRunnerStepData)
//  })

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  registerRunnerProtocolClient();
  isReExecuteFlag = false;
  executionDelayMs = getPersistedExecutionDelay();
  pendingProtocolUrl = extractProtocolFromArgv(process.argv) || pendingProtocolUrl;
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', async () => {
  

  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
  app.quit();
});
app.on('before-quit', async () => { 

  localQueueWorker.stop();
  expressListen?.close();
  if(fastTrackAutomation){
    await fastTrackAutomation.destorySession();
   }
   if(testDriver){
    await testDriver.driver.quit();
   }
   
});

const isPortAvailable = port =>
  new Promise(resolve => {
    const server = net.createServer();
    server.once('error', err => {
      if (err && err.code === 'EADDRINUSE') return resolve(false);
      return resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });

const killPort = port => {
  if (!port) return;
  try {
    execSync(
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /PID %a /F`,
      { stdio: 'ignore', shell: true },
    );
  } catch (err) {
    // best-effort
  }
};


app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

const buildRuntimeFromPayload = (input = {}) => {
  const payloadRuntime =
    input?.runtimeConfig && typeof input.runtimeConfig === 'object'
      ? input.runtimeConfig
      : {};
  const apiBaseUrl =
    payloadRuntime.apiBaseUrl ||
    input?.apiBaseUrl ||
    input?.api_base_url ||
    input?.baseUrl ||
    process.env.REACT_APP_API_BASE_URL ||
    '';
  const enableMockUiFallback =
    payloadRuntime.enableMockUiFallback ??
    input?.enableMockUiFallback ??
    null;
  const runtime = {
    ...payloadRuntime,
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
  };
  if (enableMockUiFallback !== null) {
    runtime.enableMockUiFallback = enableMockUiFallback;
  }
  return runtime;
};

const executeAutomationPayload = async (payload, options = {}) => {
  if (isAutomationExecuting) {
    throw new Error('Runner is already executing another test.');
  }

  const isRecoveryResume = options?.isRecoveryResume === true;
  if (!isRecoveryResume) {
    clearRunJournal('new_execution_start');
  }

  isAutomationExecuting = true;
  try {
    lastRunStatus = 'running';
    let interruptedReported = false;
    const reportInterruptedIfNeeded = async reason => {
      if (interruptedReported) return;
      if (typeof options?.reportInterrupted !== 'function') return;
      interruptedReported = true;
      try {
        await options.reportInterrupted(reason || 'paused_by_user');
        lastRunStatus = 'interrupted';
        updateRunJournalProgress({
          reason: reason || 'paused_by_user',
          is_paused: true,
        });
        const pausedJournal = loadRunJournal();
        if (pausedJournal) {
          persistRunJournal({
            ...pausedJournal,
            state: 'interrupted',
            updated_at: nowIso(),
          });
        }
      } catch (err) {
        console.log('[queue-local] interrupted report failed', err?.message || err);
      }
    };
    const incomingToken = String(options?.token || payload?.token || '').trim();
    if (incomingToken) {
      token = incomingToken;
    } else {
      token = String(token || '').trim();
    }

    const runtime = buildRuntimeFromPayload({
      ...payload,
      ...(options?.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
      token,
    });

            const runnerRuntimeOverrides = options?.deviceKey && runtime?.apiBaseUrl
      ? {
          deviceKey: options.deviceKey,
          runnerAuthMode: 'device-key',
          stepLogUrl: runtime.apiBaseUrl + '/runner/save/testsuites/steps/status',
          stepLogBulkUrl: runtime.apiBaseUrl + '/runner/bulk/testsuites/steps/status',
          uploadVideoUrl: runtime.apiBaseUrl + '/runner/upload/testsuites/video',
          saveCloseUrl: runtime.apiBaseUrl + '/runner/save/close/testsuites',
        }
      : (options?.deviceKey ? { deviceKey: options.deviceKey, runnerAuthMode: 'device-key' } : {});

    setRuntimeConfig({
      ...runtime,
      ...(token ? { token } : {}),
      ...runnerRuntimeOverrides,
    });
    const queueWorkerPatch = {};
    if (incomingToken) {
      queueWorkerPatch.token = incomingToken;
    }
    if (runtime?.apiBaseUrl) {
      queueWorkerPatch.apiBaseUrl = runtime.apiBaseUrl;
    }
    if (Object.keys(queueWorkerPatch).length) {
      localQueueWorker.configure(queueWorkerPatch);
    }

    console.log(`[run] source=${options?.source || 'manual'}`);
    console.log('[run] runtimeConfig', getRuntimeConfig());
    console.log('[run] stepLogUrl', getStepLogUrl());
    console.log('[run] uploadVideoUrl', getUploadVideoUrl());

    const { test_runner_steps, test_runner } = payload || {};
    const testPlanItemId =
      payload?.test_plan_item_id ||
      payload?.testPlanItemId ||
      test_runner?.test_plan_item_id ||
      test_runner?.testPlanItemId ||
      null;

    if (fastTrackAutomation) {
      await fastTrackAutomation.destorySession();
    }

    if (!screenSelected) {
      selectedScreen = null;
      viewerFrameCache = null;
      lastViewerFrameAt = null;
    }

    if (getPersistedRecoveryEnabled()) {
      const initialJournal = buildInitialJournal({
        payload,
        recoveryEnabled: true,
        meta: {
          source: options?.source || 'manual',
          queue: options?.queue || null,
          item: options?.item || null,
          claimToken: options?.claimToken || null,
        },
      });
      if (isRecoveryResume) {
        initialJournal.state = 'resuming';
        initialJournal.progress = {
          ...(initialJournal.progress || {}),
          ...(options?.recoveryState || {}),
          reason: 'resume_requested',
        };
      }
      persistRunJournal(initialJournal);
    }

    const queueRunReExecuteEnabled = isReExecuteFlag;

    fastTrackAutomation = new FastTrackAutomation({
      mainWindow,
      testRunnerStepDataOriginal: structuredClone(test_runner_steps),
      testRunner: test_runner,
      token,
      selectedScreen: selectedScreen,
      isReExecuteFlag: queueRunReExecuteEnabled,
      testPlanItemId: testPlanItemId,
      recoveryState: options?.recoveryState || null,      onProgress: snapshot => {
        if (getPersistedRecoveryEnabled()) {
          updateRunJournalProgress({
            ...(snapshot || {}),
          });
        }
        if (snapshot?.reason === 'paused' || snapshot?.reason === 'run_interrupted') {
          void reportInterruptedIfNeeded('paused_by_user');
        }
      },
      onInterrupted: async reason => {
        await reportInterruptedIfNeeded(reason || 'paused_by_user');
      },
    });
    fastTrackAutomation?.webDriver?.setHighlightEnabled?.(highlightEnabled);
    fastTrackAutomation?.setExecutionDelay?.(executionDelayMs);
    lastRunPayload = {
      test_runner_steps: structuredClone(test_runner_steps),
      test_runner: structuredClone(test_runner),
    };

    const runSummary = await fastTrackAutomation.runAutomation();
    if (runSummary?.interrupted) {
      await reportInterruptedIfNeeded('paused_by_user');
    }
    lastRunAt = new Date().toISOString();
    const finalStatus = runSummary?.canceled
      ? 'canceled'
      : runSummary?.interrupted
        ? 'interrupted'
        : runSummary?.failed > 0
        ? 'failed'
        : 'completed';
    lastRunStatus = finalStatus;
    updateRunJournalProgress({
      reason: finalStatus,
      is_paused: false,
    });
    const journal = loadRunJournal();
    if (journal) {
      const shouldScrubRuntime = finalStatus === 'completed' || finalStatus === 'failed' || finalStatus === 'canceled';
      const nextProgress = {
        ...(journal.progress || {}),
        ...(shouldScrubRuntime
          ? {
              runtime_variables: {},
              last_email_sandbox_result: null,
            }
          : {}),
      };
      persistRunJournal({
        ...journal,
        state: finalStatus,
        progress: nextProgress,
        updated_at: nowIso(),
      });
    }
    return {
      status: runSummary?.canceled ? 'canceled' : runSummary?.interrupted ? 'interrupted' : runSummary?.failed > 0 ? 'failed' : 'passed',
      summary: runSummary || null,
    };
  } catch (err) {
    lastRunAt = new Date().toISOString();
    lastRunStatus = 'failed';
    updateRunJournalProgress({
      reason: 'failed',
      is_paused: false,
    });
    const journal = loadRunJournal();
    if (journal) {
      persistRunJournal({
        ...journal,
        state: 'failed',
        progress: {
          ...(journal.progress || {}),
          runtime_variables: {},
          last_email_sandbox_result: null,
        },
        updated_at: nowIso(),
      });
    }
    throw err;
  } finally {
    isAutomationExecuting = false;
  }
};

const startServer = (mainWindow, portOverride) => {
  syncServerRunningState();
  if (isServerRunning) {
    mainWindow.webContents.send('getServerStatus', {status: true});
    console.log('server already running on ' + getServerBoundPort());
    return Promise.resolve(true);
  }
  if (serverStartPromise) {
    console.log('server start already in progress');
    return serverStartPromise;
  }
  if (expressListen) {
    console.log('server handle already exists; waiting for listen state');
    return Promise.resolve(true);
  }
  if (portOverride) {
    webServerPort = parseInt(portOverride, 10) || webServerPort;
  }
  if (!routesRegistered) {
    const resolveRunnerKey = () => {
      const envKey = process.env.RUNNER_API_KEY || process.env['RUNNER_API_KEY'];
      return envKey ? String(envKey).trim() : '';
    };

    const isAuthorized = req => {
      const key = resolveRunnerKey();
      if (!key) return true;
      const headerKey = String(req.headers['x-runner-key'] || '').trim();
      const auth = String(req.headers['authorization'] || '');
      const bearer = auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : '';
      return headerKey === key || bearer === key;
    };

    const authMiddleware = (req, res, next) => {
      if (isAuthorized(req)) return next();
      return res.status(401).json({ ok: false, message: 'Unauthorized runner request.' });
    };

    const getViewerFrame = async () => {
      if (!screenSelected || !selectedScreen) {
        return { ok: false, status: 409, message: 'Screen is not selected for live view.' };
      }
      const nowTs = Date.now();
      if (
        viewerFrameCache
        && viewerFrameCache.screenId === selectedScreen
        && nowTs - Number(viewerFrameCache.capturedTs || 0) < 700
      ) {
        return { ok: true, frame: viewerFrameCache };
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1280, height: 720 },
        });
        const source = (sources || []).find(s => s.id === selectedScreen);
        if (!source || source.thumbnail.isEmpty()) {
          return { ok: false, status: 404, message: 'Selected screen is unavailable.' };
        }
        const frame = {
          screenId: selectedScreen,
          capturedTs: nowTs,
          capturedAt: new Date(nowTs).toISOString(),
          dataUrl: source.thumbnail.toDataURL(),
        };
        viewerFrameCache = frame;
        lastViewerFrameAt = frame.capturedAt;
        return { ok: true, frame };
      } catch (err) {
        return { ok: false, status: 500, message: err?.message || 'Unable to capture viewer frame.' };
      }
    };

    expressApp.get('/health', authMiddleware, async (_req, res) => {
      let runnerVersion = 'unknown';
      try {
        const pkg = require('../package.json');
        runnerVersion = pkg?.version || runnerVersion;
      } catch (_) {}
      const workerStatus = localQueueWorker.status();
      return res.json({
        ok: true,
        server_up: true,
        screen_selected: screenSelected,
        recording_enabled: screenSelected,
        last_run_at: lastRunAt,
        last_run_status: lastRunStatus,
        runner_version: runnerVersion,
        runner_id: workerStatus?.runnerId || null,
        viewer_status: screenSelected ? 'available' : 'unavailable',
        last_frame_at: lastViewerFrameAt,
        capabilities: {
          platform: process.platform,
          hostname: os.hostname(),
          recording_enabled: !!screenSelected,
          interactive_session_required: true,
        },
      });
    });

    expressApp.get('/viewer/frame', authMiddleware, async (req, res) => {
      const viewerAccessToken = String(req.query?.viewer_access_token || req.query?.token || '').trim();
      const runnerDeviceKey = String(localQueueWorker?.token || '').trim();
      const verified = verifyViewerAccessToken(viewerAccessToken, runnerDeviceKey);
      if (!verified.ok) {
        return res.status(401).json({
          ok: false,
          message: 'Viewer access token is invalid or expired.',
          code: verified.reason,
        });
      }

      const claims = verified.claims || {};
      const workerStatus = localQueueWorker.status();
      const localDeviceId = Number(workerStatus?.deviceId || 0);
      const localClientId = Number(workerStatus?.clientId || 0);
      const tokenDeviceId = Number(claims?.device_id || 0);
      const tokenClientId = Number(claims?.client_id || 0);
      const tokenViewerUserId = Number(claims?.viewer_user_id || 0);
      const tokenSessionId = String(claims?.session_id || '').trim();

      if (!localDeviceId || !localClientId) {
        return res.status(409).json({
          ok: false,
          message: 'Runner device context is incomplete for live view.',
          code: 'runner_context_missing',
        });
      }

      if (!tokenDeviceId || !tokenClientId || tokenViewerUserId <= 0 || !tokenSessionId) {
        return res.status(401).json({
          ok: false,
          message: 'Viewer access token claims are invalid.',
          code: 'token_claims_invalid',
        });
      }

      if (tokenDeviceId !== localDeviceId || tokenClientId !== localClientId) {
        return res.status(403).json({
          ok: false,
          message: 'Viewer token does not match this runner device context.',
          code: 'token_context_mismatch',
        });
      }

      const frameResult = await getViewerFrame();
      if (!frameResult.ok) {
        return res.status(frameResult.status || 500).json({
          ok: false,
          message: frameResult.message || 'Unable to capture viewer frame.',
        });
      }
      return res.json({
        ok: true,
        frame_data_url: frameResult.frame.dataUrl,
        captured_at: frameResult.frame.capturedAt,
        viewer_status: 'available',
      });
    });

    expressApp.get('/queue/status', authMiddleware, async (_req, res) => {
      return res.json({
        ok: true,
        worker: localQueueWorker.status(),
      });
    });

    expressApp.post('/queue/cancel-active', authMiddleware, async (req, res) => {
      try {
        const body = req.body || {};
        const result = await cancelActiveQueueExecution({
          queueId: body.queue_id,
          queueItemId: body.queue_item_id,
        });
        return res.json(result);
      } catch (err) {
        return res.status(500).json({
          ok: false,
          message: err?.message || 'Active queue cancellation failed.',
        });
      }
    });

    expressApp.post('/run/cancel-active', authMiddleware, async (_req, res) => {
      try {
        const result = await stopExecution();
        return res.json(result);
      } catch (err) {
        return res.status(500).json({
          ok: false,
          message: err?.message || 'Active draft run cancellation failed.',
        });
      }
    });

    expressApp.get('/run/status', authMiddleware, async (_req, res) => {
      const workerStatus = localQueueWorker.status();
      const activeQueueId = Number(workerStatus?.currentQueueId || 0);
      const activeQueueItemId = Number(workerStatus?.currentQueueItemId || 0);
      const active =
        isAutomationExecuting ||
        !!fastTrackAutomation?.cancelCompletionPromise ||
        activeQueueId > 0 ||
        activeQueueItemId > 0;

      return res.json({
        ok: true,
        active,
        status: active ? 'running' : (lastRunStatus || 'idle'),
        last_run_at: lastRunAt,
        queue_id: activeQueueId || null,
        queue_item_id: activeQueueItemId || null,
      });
    });

    expressApp.post('/queue/config', authMiddleware, async (req, res) => {
      try {
        const body = req.body || {};
        const persisted = loadPersistedQueueWorkerConfig();
        const existingDeviceKey =
          String(body.deviceKey || '').trim() ||
          String(persisted.deviceKey || '').trim();
        const existingToken =
          existingDeviceKey ||
          String(body.token || '').trim() ||
          String(persisted.token || '').trim() ||
          String(getRuntimeConfig()?.token || '').trim();
        const existingApiBase =
          String(body.apiBaseUrl || '').trim() ||
          String(persisted.apiBaseUrl || '').trim() ||
          String(getRuntimeConfig()?.apiBaseUrl || '').trim();
        const runtimePatch = {};
        if (existingApiBase) runtimePatch.apiBaseUrl = existingApiBase;
        if (existingToken) runtimePatch.token = existingToken;
        if (Object.keys(runtimePatch).length) {
          setRuntimeConfig(runtimePatch);
        }
        const next = {
          enabled: body.enabled,
          token: existingToken || undefined,
          deviceKey: existingDeviceKey || existingToken || undefined,
          apiBaseUrl: existingApiBase || undefined,
          pollMs: body.pollMs,
          useRunnerSession: body.useRunnerSession,
          deviceId: Object.prototype.hasOwnProperty.call(body, 'deviceId') ? body.deviceId : (persisted.deviceId || ''),
          clientId: Object.prototype.hasOwnProperty.call(body, 'clientId') ? body.clientId : (persisted.clientId || ''),
          runnerId: Object.prototype.hasOwnProperty.call(body, 'runnerId') ? body.runnerId : (persisted.runnerId || ''),
          allowRecovery: body.allowRecovery,
        };
        savePersistedQueueWorkerConfig(next);
        const status = localQueueWorker.configure(next);
        if (status.enabled && status.hasToken && status.apiBaseUrl) {
          localQueueWorker.start();
        } else {
          localQueueWorker.stop();
        }
        return res.json({ ok: true, worker: localQueueWorker.status() });
      } catch (err) {
        return res.status(500).json({ ok: false, message: err?.message || 'Queue config failed.' });
      }
    });

    expressApp.post('/run', authMiddleware, async (req, res) => {
      console.log('[/run] received', {
        runner: req.body?.test_runner?.id,
        suites: Array.isArray(req.body?.test_runner_steps) ? req.body.test_runner_steps.length : 'n/a',
      });
      try {
        const authHeader = String(req.headers?.authorization || '');
        const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
          ? authHeader.slice(7).trim()
          : '';
        await executeAutomationPayload(req.body, {
          token: req.body?.token || bearerToken || '',
          source: 'manual-run-endpoint',
        });
        res.json({ ok: true, message: 'Run completed.' });
      } catch (err) {
        console.log('[/run] error', err);
        res.status(500).json({ ok: false, message: 'Run failed.' });
      }
    });
    routesRegistered = true;
  }

  serverStartPromise = new Promise((resolve, reject) => {
    const server = http.createServer(expressApp);
    expressListen = server;

    server.once('error', err => {
      const code = String(err?.code || '').toUpperCase();
      isServerRunning = false;
      serverStartPromise = null;
      try {
        server.close?.();
      } catch (_) {}
      if (expressListen === server) {
        expressListen = null;
      }
      if (code === 'EADDRINUSE') {
        notifyRunnerAlreadyRunning(webServerPort);
        resolve(false);
        return;
      }
      console.log('[runner-server] start failed', err?.message || err);
      reject(err);
    });

    server.once('listening', () => {
      console.log('>>>>>>> Server started on port ' + webServerPort);
      isServerRunning = true;
      serverStartPromise = null;
      try {
        mainWindow?.webContents?.send?.('getServerStatus', { status: true });
      } catch (err) {
        console.log('startServer notify error', err?.message || err);
      }
      const persisted = loadPersistedQueueWorkerConfig();
      isReExecuteFlag = false;
      executionDelayMs = getPersistedExecutionDelay();
      const initialEnabled =
        persisted.enabled !== undefined
          ? (persisted.enabled === true || persisted.enabled === 'true')
          : process.env.LOCAL_QUEUE_WORKER_ENABLED === 'true';
      const initialUseRunnerSession =
        persisted.useRunnerSession !== undefined
          ? (persisted.useRunnerSession === true || persisted.useRunnerSession === 'true')
          : process.env.LOCAL_QUEUE_RUNNER_SESSION_ENABLED === 'true';
      const initialPollMs = Number(persisted.pollMs || process.env.LOCAL_QUEUE_POLL_MS || 3000);
      const initialToken =
        String(persisted.deviceKey || '').trim() ||
        String(persisted.token || '').trim() ||
        process.env.LOCAL_QUEUE_DEVICE_KEY ||
        process.env.RUNNER_QUEUE_BEARER_TOKEN ||
        process.env.LOCAL_QUEUE_TOKEN ||
        '';
      const initialApiBase =
        String(persisted.apiBaseUrl || '').trim() ||
        getRuntimeConfig()?.apiBaseUrl ||
        process.env.REACT_APP_API_BASE_URL ||
        '';
      let detectedRunnerVersion = '';
      try {
        const pkg = require('../package.json');
        detectedRunnerVersion = String(pkg?.version || '');
      } catch (_) {}
      const initialRunnerId =
        String(persisted.runnerId || '').trim() ||
        String(process.env.LOCAL_QUEUE_RUNNER_ID || '').trim() ||
        `${os.hostname()}-${process.pid}`;
      const initialDeviceId =
        String(persisted.deviceId || '').trim() ||
        String(process.env.LOCAL_QUEUE_DEVICE_ID || '').trim();
      const initialClientId =
        String(persisted.clientId || '').trim() ||
        String(process.env.LOCAL_QUEUE_CLIENT_ID || '').trim();

      localQueueWorker.configure({
        enabled: initialEnabled,
        useRunnerSession: initialUseRunnerSession,
        pollMs: initialPollMs,
        token: initialToken,
        apiBaseUrl: initialApiBase,
        deviceId: initialDeviceId,
        clientId: initialClientId,
        runnerId: initialRunnerId,
        runnerVersion: detectedRunnerVersion,
      });

      const status = localQueueWorker.status();
      if (status.enabled && status.hasToken && status.apiBaseUrl) {
        localQueueWorker.start();
        console.log('[queue-local] worker started');
        void reconcileStaleQueueRunWithoutRecovery();
      } else {
        localQueueWorker.stop();
        console.log('[queue-local] worker idle (missing enabled/token/apiBaseUrl)');
      }
      resolve(true);
    });

    server.listen(webServerPort);
  });

  return serverStartPromise;
};

let testDriver = null;
const manualApiRuntime = createManualApiRuntimeContext();
const manualEmailSandboxRuntime = {
  runReference: '',
  runtimeAlias: '',
  outputs: {},
};

const isIssueAliasKeyword = keyword => {
  const normalized = String(keyword || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === 'issuealias' || normalized === 'emailsandboxissuealias' || normalized === 'emailissuealias';
};

const isWaitAliasEmailKeyword = keyword => {
  const normalized = String(keyword || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === 'waitaliasemail' || normalized === 'emailsandboxwaitextract' || normalized === 'emailwaitextract';
};

const parseKeyValueArgs = rawValue => {
  const text = String(rawValue ?? '').trim();
  if (!text) return {};
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {}
  }
  const result = {};
  text
    .split(/[,|]/)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(segment => {
      const idx = segment.indexOf('=');
      if (idx === -1) return;
      const key = segment.slice(0, idx).trim();
      const value = segment.slice(idx + 1).trim();
      if (!key) return;
      result[key] = value;
    });
  return result;
};

const toIntOrNull = value => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
};

const buildEmailSandboxManualError = (error, actionLabel) => {
  const status = Number(error?.response?.status || 0);
  const backendMessage = String(error?.response?.data?.message || error?.message || '').trim();
  if (status === 401 || status === 403) return `${actionLabel} failed: unauthorized session.`;
  if (status === 404) return `${actionLabel} failed: no matching email/resource not found.`;
  if (status === 422) return `${actionLabel} failed: invalid config or rule failure.`;
  if (status >= 500) return `${actionLabel} failed: backend server error (${status}).`;
  return `${actionLabel} failed: ${backendMessage || 'unexpected error.'}`;
};

const requestManualEmailSandbox = async (path, payload) => {
  const userToken = String(token || '').trim();
  if (userToken) {
    return await api.request({
      url: `/email-sandbox/assertions/${path}`,
      method: 'post',
      data: payload,
      token: userToken,
      runtimeConfig: getRuntimeConfig(),
    });
  }

  const worker = localQueueWorker?.status?.() || {};
  const deviceKey = String(localQueueWorker?.token || '').trim();
  const apiBase = String(worker?.apiBaseUrl || '').trim();
  if (!deviceKey || !apiBase) {
    const err = new Error('missing manual auth context');
    err.response = { status: 401, data: { message: 'Manual auth context is missing (token/device key).' } };
    throw err;
  }

  const response = await axios.request({
    url: `${apiBase}/runner/email-sandbox/assertions/${path}`,
    method: 'post',
    data: payload,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${deviceKey}`,
      'X-Device-Key': deviceKey,
    },
    timeout: 15000,
  });
  return response?.data;
};

const executeManualEmailSandboxHelper = async ({ keyword, value }) => {
  const normalized = String(keyword || '').toLowerCase();
  const args = parseKeyValueArgs(value);

  if (isIssueAliasKeyword(normalized)) {
    mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
      phase: 'issue_alias_started',
      status: 'running',
    });
    const payload = {};
    const profileId = toIntOrNull(args.profile_id);
    const inboxId = toIntOrNull(args.inbox_id);
    const ttlMinutes = toIntOrNull(args.ttl_minutes);
    const runReference = String(args.run_reference || manualEmailSandboxRuntime.runReference || '').trim();
    const prefix = String(args.prefix || '').trim();
    if (profileId) payload.profile_id = profileId;
    if (inboxId) payload.inbox_id = inboxId;
    if (ttlMinutes) payload.ttl_minutes = ttlMinutes;
    if (runReference) payload.run_reference = runReference;
    if (prefix) payload.prefix = prefix;
    const response = await requestManualEmailSandbox('runtime-alias/issue', payload);
    const data = response?.data ?? {};
    manualEmailSandboxRuntime.runReference = String(data.run_reference || '');
    manualEmailSandboxRuntime.runtimeAlias = String(data.full_address || '');
    mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
      phase: 'issue_alias_done',
      status: 'ok',
      run_reference: manualEmailSandboxRuntime.runReference,
      runtime_alias: manualEmailSandboxRuntime.runtimeAlias,
    });
    return JSON.stringify(data);
  }

  if (isWaitAliasEmailKeyword(normalized)) {
    mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
      phase: 'wait_extract_started',
      status: 'running',
    });
    const profileId = toIntOrNull(args.profile_id);
    const profileName = String(args.profile || args.profile_name || '').trim();
    const ruleId = toIntOrNull(args.rule_id);
    const ruleName = String(args.rule || '').trim();
    const extractSpec = String(args.extract || '').trim();
    if (!profileId && !profileName && !ruleId && !ruleName && !extractSpec) {
      throw new Error('waitAliasEmail requires profile/profile_id or rule/extract.');
    }
    const payload = {};
    if (profileId) payload.profile_id = profileId;
    if (profileName) payload.profile = profileName;
    if (ruleId) payload.rule_id = ruleId;
    if (ruleName) payload.rule = ruleName;
    if (extractSpec) payload.extract = extractSpec;
    const runReference = String(args.run_reference || manualEmailSandboxRuntime.runReference || '').trim();
    const runtimeAlias = String(args.runtime_alias || manualEmailSandboxRuntime.runtimeAlias || '').trim();
    const inboxId = toIntOrNull(args.inbox_id);
    const withinMinutes = toIntOrNull(args.within_minutes);
    const timeoutSeconds = toIntOrNull(args.timeout_seconds);
    const pollIntervalMs = toIntOrNull(args.poll_interval_ms);
    if (!runReference && !runtimeAlias && !inboxId) {
      throw new Error('emailSandboxWaitExtract requires run_reference, runtime_alias, or inbox_id.');
    }
    if (runReference) payload.run_reference = runReference;
    if (runtimeAlias) payload.runtime_alias = runtimeAlias;
    if (inboxId) payload.inbox_id = inboxId;
    if (withinMinutes) payload.within_minutes = withinMinutes;
    if (timeoutSeconds) payload.timeout_seconds = timeoutSeconds;
    if (pollIntervalMs) payload.poll_interval_ms = pollIntervalMs;
    const response = await requestManualEmailSandbox('wait-extract', payload);
    const data = response?.data ?? {};
    manualEmailSandboxRuntime.outputs = data?.outputs && typeof data.outputs === 'object' ? data.outputs : {};
    mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
      phase: 'wait_extract_done',
      status: data.status || 'ok',
      snapshot_id: data.snapshot_id ?? '',
      message_id: data.message_id ?? '',
      outputs: manualEmailSandboxRuntime.outputs,
    });
    return JSON.stringify(data);
  }

  return null;
};

const testLaunchBrowser = async () => {
  if(testDriver?.driver){
    try { await testDriver.driver.quit(); } catch (_) {}
  }
  try {
    const lastWA = getLastWebActionsInstance?.();
    if (lastWA?.driver) {
      try { await lastWA.driver.quit(); } catch (_) {}
      clearLastWebActionsInstance?.();
    }
  } catch (err) {
    console.log('cleanup previous launch error', err?.message || err);
  }
  testDriver = new WebActions()
  testDriver.setHighlightEnabled?.(highlightEnabled);
  await testDriver.launchBrowser({value:Browser.CHROME,implicitWait:1})
  // await testDriver.navigate({value:'https://demoqa.com/buttons'}) 
  // await testDriver?.quit();
  //  testDriver = await launchBrowser({value:Browser.CHROME,implicitWait:1});
}

const testExecute = async (e, { locator, keyword, value="", expectedOutput="" }) => {
  const perfEnabled = process.env.DEBUG_PERF === 'true' || process.env.DEBUG_PERF === '1';
  const perfStartMs = Date.now();
  const perfStamp = () => new Date().toISOString();
  const perfLog = (phase, extra = {}) => {
    if (!perfEnabled) return;
    const elapsedMs = Date.now() - perfStartMs;
    console.log(`[perf][${perfStamp()}][manual-runner] ${phase}`, {
      elapsedMs,
      keyword,
      ...extra,
    });
  };
  perfLog('start', { locator, value });
  console.log('[manual-runner] start', {
    keyword,
    locator,
    value,
  });
  mainWindow.webContents.send('testExecuteOutput', {output: ''});

  const normalizedKeyword = String(keyword || '').trim();
  const normalizedKeywordLower = normalizedKeyword.toLowerCase();
  const isApiCallKeyword = normalizedKeyword.toLowerCase() === 'apicall';
  const isBrowserSessionCreatorKeyword = ['launchbrowser', 'launchdebugbrowser', 'debugbrowser', 'connectbrowser', 'closebrowser']
    .includes(normalizedKeywordLower);
  const isEmailSandboxHelperKeyword =
    isIssueAliasKeyword(normalizedKeywordLower) || isWaitAliasEmailKeyword(normalizedKeywordLower);
  const resolvedValue = isApiCallKeyword ? manualApiRuntime.resolveValue(value) : value;
  const step = { keyword: { name: keyword }, xPath: locator, value: resolvedValue, expected_output: expectedOutput }
  let apiCallRequestedMode = 'browser_session';
  if (isApiCallKeyword) {
    try {
      apiCallRequestedMode = parseApiCallValue(resolvedValue, { defaultMode: 'browser_session' })?.mode || 'browser_session';
    } catch (_) {}
  }
  if (!testDriver) {
    testDriver = new WebActions();
    testDriver.setHighlightEnabled?.(highlightEnabled);
  }
  let capturedData = null;
  const isBrowserSessionKeyword = ['launchbrowser', 'launchdebugbrowser', 'debugbrowser', 'connectbrowser', 'closebrowser']
    .includes(normalizedKeywordLower);
  const normalizeManualOutput = output => {
    if (isBrowserSessionKeyword) {
      return `${normalizedKeyword || 'Browser session keyword'} completed.`;
    }
    if (output === undefined || output === null || output === '') {
      return `${normalizedKeyword || 'Keyword'} completed.`;
    }
    if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') {
      return output;
    }
    try {
      return JSON.stringify(output);
    } catch (_) {
      return String(output);
    }
  };
  try {
    if (testDriver?.recorderActive) {
      testDriver.recorderActive = false;
    }
  } catch (_) {}
  const requiresBrowserSession =
    !isEmailSandboxHelperKeyword &&
    !isBrowserSessionCreatorKeyword &&
    !testDriver?.driver &&
    (!isApiCallKeyword || apiCallRequestedMode === 'browser_session');
  if (requiresBrowserSession) {
    const browserRequiredMessage = normalizedKeyword.toLowerCase() === 'apicall'
      ? 'API Call requires an active test browser session. Click Launch Browser, open the application under test, sign in if the endpoint is secured, and then run apiCall again.'
      : `${normalizedKeyword || 'This keyword'} requires an active test browser session. Click Launch Browser and try again.`;
    console.log('[manual-runner] blocked: browser not active', browserRequiredMessage);
    mainWindow.webContents.send('testExecuteOutput', { output: browserRequiredMessage });
    perfLog('blocked_no_browser');
    return;
  }
  if (!isEmailSandboxHelperKeyword && typeof testDriver[normalizedKeyword] !== 'function') {
    console.log('[manual-runner] blocked: keyword not available', normalizedKeyword);
    mainWindow.webContents.send('testExecuteOutput', {
      output: `Keyword "${normalizedKeyword}" is not available in the manual Electron runner.`,
    });
    perfLog('blocked_keyword_not_available');
    return;
  }
  if (testDriver?.driver) {
    try {
      const contextBeforeStart = Date.now();
      const contextInfo = await testDriver.driver.executeScript(() => ({
        href: window.location.href,
        title: document.title,
        readyState: document.readyState,
        inFrame: window.parent !== window,
      }));
      perfLog('context_before_done', { segmentMs: Date.now() - contextBeforeStart });
      console.log('[manual-runner] context-before', contextInfo);
    } catch (error) {
      console.log('[manual-runner] context-before unavailable', error?.message || error);
      perfLog('context_before_failed', {
        error: error?.message || String(error),
      });
    }
  }
  try {
    const keywordStart = Date.now();
    if (isEmailSandboxHelperKeyword) {
      capturedData = await executeManualEmailSandboxHelper({
        keyword: normalizedKeyword,
        value: resolvedValue,
      });
    } else {
      capturedData  = await testDriver[normalizedKeyword](step)
    }
    capturedData = normalizeManualOutput(capturedData);
    perfLog('keyword_done', { segmentMs: Date.now() - keywordStart });
    console.log('[manual-runner] success', {
      keyword: normalizedKeyword,
      output: capturedData,
    });
  } catch (error) {
    capturedData = isEmailSandboxHelperKeyword
      ? buildEmailSandboxManualError(error, normalizedKeyword)
      : (error?.message || String(error));
    if (isEmailSandboxHelperKeyword) {
      mainWindow?.webContents?.send?.('emailSandboxRuntimeStatus', {
        phase: normalizedKeywordLower.includes('issuealias') ? 'issue_alias_failed' : 'wait_extract_failed',
        status: 'failed',
        error: capturedData,
      });
    }
    perfLog('keyword_failed', {
      error: capturedData,
    });
    console.log('[manual-runner] failure', {
      keyword: normalizedKeyword,
      output: capturedData,
    });
  }
  if (testDriver?.driver) {
    try {
      const contextAfterStart = Date.now();
      const contextInfo = await testDriver.driver.executeScript(() => ({
        href: window.location.href,
        title: document.title,
        readyState: document.readyState,
        inFrame: window.parent !== window,
      }));
      perfLog('context_after_done', { segmentMs: Date.now() - contextAfterStart });
      console.log('[manual-runner] context-after', contextInfo);
    } catch (error) {
      console.log('[manual-runner] context-after unavailable', error?.message || error);
      perfLog('context_after_failed', {
        error: error?.message || String(error),
      });
    }
  }
  // try {
  //   switch (step.keyword.name.toLowerCase()) {

  //     case 'click':   
  //       capturedData = await click(testDriver, step);
  //       capturedData = 'Element Clicked!'
  //     break;

  //     case 'getelementvalue':
  //       capturedData = await getElementValue(testDriver, step);
  //       break;
  //     case 'exist':
  //       capturedData = await exist(testDriver, step);
  //       capturedData = 'Element Found!'
  //       break;
  //     case 'validateelement':
  //       capturedData = await validateElement(testDriver, step);
  //       break;
  //     case 'sendkeys':
  //       await sendKeys(testDriver, step);
  //       capturedData = `${step.value} set to ${step.xPath}`
  //       break;

  //       case 'clearinput':
  //         capturedData = await clearInput(testDriver, step);
  //         break;

  //       case 'selectall':
  //         await selectAll(testDriver, step);
  //         capturedData = `${step.value} set to ${step.xPath}`
  //         break;

  //     case 'scrolltoelement':
  //       await scrollToElement(testDriver, step);
  //       capturedData = `Scrolled to  ${step.xPath}`
  //       break;
  //     case 'scrolltotext':
  //       const scrollToTextScript = `
  //       const text = "${step.value}";
  //       const element = Array.from(document.querySelectorAll('body, body *'))
  //           .find(e => e.textContent.trim() === text);
  //           console.log(element)
  //       if (element) {
  //           element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  //           return true;
  //       } else {
  //           return false;
  //       }`;
  //       await testDriver.executeScript(scrollToTextScript);
  //       break


  //     case 'dragdrop':
  //       capturedData = await dragDrop(testDriver, step);
  //       break;

  //     case 'getcookievalue':
  //       capturedData = await getCookieValue(testDriver, step);
  //       break;

  //     case 'removecookie':
  //       capturedData = await removeCookie(testDriver, step);
  //       break;

  //     case 'connectpdf':
  //       capturedData = await connectPDF(testDriver, step);
  //       break;

  //     case 'verifypdftext':
  //       capturedData = await verifyPDFText(testDriver, step);
  //       break;

  //     case 'disconnectpdf':
  //       capturedData = await disconnectPDF(testDriver, step);
  //       break;

  //     case 'deletepdffile':
  //       capturedData = await deletePDFFile(testDriver, step);
  //       break;

  //     case 'select':
  //       capturedData = await select(testDriver, step);
  //       break;

  //     case 'alertaccept':
  //       capturedData = await alertAccept(testDriver, step);
  //       break;
  //     case 'alertdismiss':
  //       capturedData = await alertDismiss(testDriver, step);
  //       break;

  //     case 'verifytextonalert':
  //       capturedData = await verifyTextOnAlert(testDriver, step);
  //       break;

  //     case 'alertsettext':
  //       capturedData = await alertSetText(testDriver, step);
  //       break;       

  //     case 'switchbrowser':
  //       capturedData = await switchBrowser(testDriver, step);
  //       break;
  //     case 'digitalsignature':
  //       capturedData = await digitalSignature(testDriver, step);
  //       break;
  //     case 'switchtoiframe':
  //       capturedData = await switchToIframe(testDriver, step);
  //       break;
  //     case 'hoverelement':
  //       capturedData = await hoverElement(testDriver, step);
  //       break;

  //     case 'getdbalue':
  //       capturedData = await getDBValue(testDriver, step);
  //       break;
  //     case 'executesql':
  //       capturedData = await executeSQL(testDriver, step);
  //       break;

  //       //mobile keywords
  //     case 'mobileopenapp':
  //       testDriver = await mobileOpenApp(step);
  //       return;

  //     case 'mobiletap':
  //       return await mobileTap(testDriver, step);

  //     case 'mobilefill':
  //       return await mobileFill(testDriver, step);

  //     case 'mobilescrolltotext':
  //       return await mobileScrollToText(testDriver, step);
  //   }
  // } catch (error) {
  //   capturedData = error.message;
  // }
  capturedData = normalizeManualOutput(capturedData);
  if (isApiCallKeyword) {
    manualApiRuntime.registerApiResult(capturedData);
  }
  console.log('[manual-runner] end', {
    keyword: normalizedKeyword,
    output: capturedData,
  });
  perfLog('end', { outputPreview: String(capturedData).slice(0, 120) });
  mainWindow.webContents.send('testExecuteOutput', {output: capturedData});
}

const closeTestBrowser = async () => {
  const closeDriver = async driverRef => {
    if (!driverRef) return;
    try {
      await quitWithTimeout(driverRef, 3000);
    } catch (err) {
      console.log('closeTestBrowser error', err?.message || err);
    }
  };

  const driversToClose = new Set();
  if (testDriver?.driver) driversToClose.add(testDriver.driver);
  if (fastTrackAutomation?.webDriver?.driver) driversToClose.add(fastTrackAutomation.webDriver.driver);
  activeWebDrivers.forEach(d => driversToClose.add(d));
  const lastWA = getLastWebActionsInstance?.();
  if (lastWA?.driver) driversToClose.add(lastWA.driver);

  testDriver = null;
  if (fastTrackAutomation?.webDriver) {
    fastTrackAutomation.webDriver.driver = null;
  }
  clearLastWebActionsInstance?.();

  if (driversToClose.size === 0) {
    console.log('closeTestBrowser: no tracked drivers to close; attempting chromedriver kill');
    try {
      execSync('taskkill /IM chromedriver.exe /F /T', { stdio: 'ignore' });
    } catch (err) {}
    return false;
  }

  await Promise.all(Array.from(driversToClose, async d => {
    console.log('closeTestBrowser: attempting quit on driver');
    try {
      await closeDriver(d);
    } finally {
      activeWebDrivers.delete(d);
    }
  }));
  return true;
};

const getActiveWebActions = () => {
  if (testDriver) return testDriver;
  if (fastTrackAutomation?.webDriver) return fastTrackAutomation.webDriver;
  const lastWA = getLastWebActionsInstance?.();
  if (lastWA) return lastWA;
  return null;
};

const recordXpathStart = async () => {
  const wa = getActiveWebActions();
  if (!wa || !wa.driver) {
    console.log('recordXpathStart: no active WebActions driver');
    return false;
  }
  const startTs = Date.now();
  try {
    console.log('[recordXpathStart] requested');
    await wa.startXPathRecorder();
    console.log('[recordXpathStart] ok', { elapsedMs: Date.now() - startTs });
    return true;
  } catch (err) {
    console.log('recordXpathStart error', err?.message || err, { elapsedMs: Date.now() - startTs });
    return false;
  }
};

const recordXpathFetch = async () => {
  const wa = getActiveWebActions();
  if (!wa) {
    return { paths: [], locator: '', source: 'inactive' };
  }
  const fetchTs = Date.now();
  try {
    const paths = await wa.fetchRecordedXPath();
    if (paths?.source && paths.source !== 'none') {
      const logSig = `${paths.source}||${paths?.locator || ''}||${paths?.value || ''}`;
      if (recordXpathFetch._lastSig !== logSig) {
        recordXpathFetch._lastSig = logSig;
        console.log('[recordXpathFetch] source', paths.source, {
          locator: paths?.locator || '',
          value: paths?.value || '',
          fetchMs: Date.now() - fetchTs,
          captureAgeMs: Number.isFinite(Number(paths?.captureAgeMs)) ? Number(paths.captureAgeMs) : null,
        });
      }
    }
    return paths || { paths: [], locator: '', source: 'none' };
  } catch (err) {
    const message = String(err?.message || err || '');
    const name = String(err?.name || '');
    const isIgnorableShutdownError =
      name === 'NoSuchSessionError' ||
      message.includes('NoSuchSessionError') ||
      message.includes('ECONNREFUSED') ||
      message.includes('invalid session ID') ||
      message.includes('This driver instance does not have a valid session ID');
    if (!isIgnorableShutdownError) {
      console.log('recordXpathFetch error', err?.message || err, { fetchMs: Date.now() - fetchTs });
    }
    return { paths: [], locator: '', source: 'error' };
  }
};

const recordXpathStop = async () => {
  const wa = getActiveWebActions();
  if (!wa) return false;
  const stopTs = Date.now();
  try {
    console.log('[recordXpathStop] requested');
    await wa.stopXPathRecorder();
    console.log('[recordXpathStop] ok', { elapsedMs: Date.now() - stopTs });
    return true;
  } catch (err) {
    console.log('recordXpathStop error', err?.message || err, { elapsedMs: Date.now() - stopTs });
    return false;
  }
};

const advancedSpyStart = async () => {
  const wa = getActiveWebActions();
  if (!wa || !wa.driver) {
    return { active: false, source: 'inactive', message: 'No active browser session for Advanced Spy.' };
  }
  try {
    await wa.startAdvancedSpy();
    return { active: true, source: 'start', message: 'Advanced Spy active. Hover to inspect and click once to capture.' };
  } catch (err) {
    console.log('advancedSpyStart error', err?.message || err);
    return { active: false, source: 'error', message: 'Advanced Spy could not be started.' };
  }
};

const advancedSpyFetch = async () => {
  const wa = getActiveWebActions();
  if (!wa) {
    return { active: false, source: 'inactive', message: 'No active Advanced Spy session.' };
  }
  try {
    return await wa.fetchAdvancedSpyCapture();
  } catch (err) {
    console.log('advancedSpyFetch error', err?.message || err);
    return { active: false, source: 'error', message: 'Advanced Spy fetch failed.' };
  }
};

const advancedSpyStop = async () => {
  const wa = getActiveWebActions();
  if (!wa) return { ok: false };
  try {
    await wa.stopAdvancedSpy();
    return { ok: true };
  } catch (err) {
    console.log('advancedSpyStop error', err?.message || err);
    return { ok: false };
  }
};


const stopServer = () => {
  if (!expressListen) return false;
  serverStartPromise = null;
  localQueueWorker.stop();
  try {
    expressListen.close();
  } catch (err) {
    console.log('stopServer close error', err?.message || err);
  }
  try {
    mainWindow?.webContents?.send?.('getServerStatus', { status: false });
    mainWindow?.webContents?.send?.('SET_SOURCE', null);
  } catch (err) {
    console.log('stopServer notify error', err?.message || err);
  }
  isServerRunning = false;
  screenSelected = false;
  selectedScreen = null;
  viewerFrameCache = null;
  lastViewerFrameAt = null;
  clearRunJournal('server_stopped_cleanup');
  resetAutomationValues();
  console.log('<<<<<<<<<< Server Stopped');
  expressListen = null;
  return true;
};

const resetAutomationValues = () => {
  // driver = null;
  currentStep = 0;
  currentRunner = 0;
  isPaused = false;
  testRunnerStepData = null;
  mainWindow.webContents.send('testRunnerStepData', []);
  capturedData = null;
};

if (false) {
  // LEGACY: Unused execution path kept for reference during validation.
  // This mirrors the old automation engine in src/legacy_automation.js.
const runAutomation = async test_runner_steps => {
  for (let i = currentRunner; i < test_runner_steps.length; i++) {
    console.log(JSON.stringify(test_runner_steps, null, 2));
    if (isPaused) {
      break;
    }
    currentRunner = i;
    mainWindow.webContents.send('startScreenRecording', {
      selectedScreen,
      testRunnerId: testRunnerData.id,
      suiteId: test_runner_steps[currentRunner].test_suite.id,
      token: token,
    });

    const runner = test_runner_steps[i];
    console.log('168---', JSON.stringify(runner, null, 2));
    console.log('\n\n' + 'TEST CASE: ' + (currentRunner + 1));
    for (let j = currentStep; j < runner.steps.length; j++) {
      // console.log(i, j)
      currentStep = j;
      const step = runner.steps[j];
      // console.log(step.keyword.name, step.value)
      // try {
      console.log(
        'step : ' +
          j +
          '___Is_Actual____' +
          (step.actual_step || false) +
          '__ID___' +
          step?.id +
          '___' +
          step?.description,
      );
      if (step.actual_step) {
        step.execution = execution.EXECUTING;
        mainWindow.webContents.send('testRunnerStepData', {
          runner: test_runner_steps,
          currentRunner,
        });
      }

      if (step.before_step && step.before_step.length > 0) {
        // console.log('in before')//
        for (beforeStep of step.before_step) {
          // console.log(beforeStep)
          try {
            await runStep({ ...beforeStep, highlight: false });
          } catch (error) {
            console.log(error);
          }
        }
      }
      // console.log('actual stepp')
      try {
        await runStep(step);
        await stepLogCall({
          runnerId: testRunnerData.id,
          testSuiteId: runner.test_suite.id,
          stepId: step.id,
          datasetId: step.dataset_id,
          testRunnerSteps: testRunnerStepDataOriginal,
          runnerIndex: currentRunner,
          stepIndex: currentStep,
          token,
        });
      } catch (error) {
        if (isReExecuteFlag) {
          console.log('failed');
          isPaused = true;
          if (step.actual_step || step.parent) {
            console.log('actual step');
            if (step.parent) {
              runner.steps.find(({ id }) => id === step.parent).execution =
                execution.FAILED;
            } else {
              step.execution = execution.FAILED;
            }
            // step.xPath='//*[@id="password"]'
            mainWindow.webContents.send('testRunnerStepData', {
              runner: test_runner_steps,
              currentRunner,
            });
            mainWindow.webContents.send('openReExecuteDataModal', null);
          }
          return;
        }

        await stepLogCall({
          runnerId: testRunnerData.id,
          testSuiteId: runner.test_suite.id,
          stepId: step.id,
          datasetId: step.dataset_id,
          testRunnerSteps: testRunnerStepDataOriginal,
          runnerIndex: currentRunner,
          stepIndex: currentStep,
          error,
          token,
        });
      }

      if (step.after_step && step.after_step.length > 0) {
        // console.log('in before')
        for (afterStep of step.after_step) {
          // console.log(afterStep)
          try {
            await runStep({ ...afterStep, highlight: false });
          } catch (error) {
            console.log(error);
          }
        }
      }
      if (step.actual_step || step.parent) {
        // console.log(step.parent)
        if (step.parent) {
          runner.steps.find(({ id }) => id === step.parent).execution =
            execution.EXECUTED;
        }
        step.execution = execution.EXECUTED;
        mainWindow.webContents.send('testRunnerStepData', {
          runner: test_runner_steps,
          currentRunner,
        });
      }
      if (isPaused) {
        break;
      }
      // } catch (error) {
      //     console.log(error)
      // }
    }
    if (!isPaused) {
      currentStep = 0;
    }
    mainWindow.webContents.send('stopScreenRecording');
  }
  if (!isPaused) {
    resetAutomationValues();
  }
};
const makeConfigStep = test_runner_steps => {
  let x = test_runner_steps.map(runner => {
    if (runner?.test_suite?.configuration) {
      const { configuration_variables } = runner?.test_suite?.configuration;
      const configSteps = [];
      configuration_variables.forEach(({ variable, value }) => {
        if (variable.name.toLowerCase() === 'browser') {
          const step = {
            keyword: { name: 'launchBrowser' },
            value: value.name,
            xPath: null,
            actual_step: true,
            execution: execution.NOT_EXECUTED,
            description: 'Launch Browser',
          };
          configSteps.push(step);
        }
        if (variable.name.toLowerCase() === 'mobile capabilities') {
          const step = {
            keyword: { name: 'launchMobile' },
            value: value.name,
            xPath: null,
            actual_step: true,
            execution: execution.NOT_EXECUTED,
            description: 'Launch Mobile',
          };
          configSteps.push(step);
        }
      });
      runner.steps.unshift(...configSteps);
      console.log(JSON.stringify(runner, null, 2));
      return runner;
    } else {
      return runner;
    }
  });
  return x;
};

const formatBeforeAfterSteps = test_runner_steps => {
  //checks if before or after steps exits then it converts
  //it into array of object of the below format
  // [
  //     {
  //         keyword:{
  //             name:'some name',
  //             value:'some value'
  //         },
  //         value:'some value'
  //     }
  // ]
  let x = test_runner_steps.map(runner => {
    runner.steps = runner.steps.map(step => {
      const helperUsesOwnLocator = (keywordName, rawValue) => {
        const normalizedKeyword = String(keywordName || '').trim().toLowerCase();
        const value = String(rawValue || '');
        const entries = value
          .split('>>')
          .map(part => String(part || '').trim())
          .filter(Boolean)
          .map(part => {
            const separatorIndex = part.indexOf('=');
            return separatorIndex > 0
              ? part.slice(0, separatorIndex).trim().toLowerCase()
              : '';
          });
        const hasAnyKey = keys => keys.some(key => entries.includes(key));

        if (normalizedKeyword === 'waitforelement' || normalizedKeyword === 'waitfortext') {
          return hasAnyKey(['target', 'scope', 'xpath']);
        }

        if (normalizedKeyword === 'sendkey') {
          return hasAnyKey(['locator']);
        }

        if (normalizedKeyword === 'switchtoiframe') {
          return value.trim().length > 0;
        }

        return false;
      };
      const mapStep = (stepProperty,xPath, explicitTargetIndex) => {
        if (stepProperty && stepProperty.length > 0) {
          return stepProperty.map(sp => {
            console.log(Object.entries(sp)[0])
            const [name, value] = Object.entries(sp)[0];
            const mappedStep = { keyword: { name }, value, xPath };
            if (
              explicitTargetIndex !== undefined
              && explicitTargetIndex !== null
              && !helperUsesOwnLocator(name, value)
            ) {
              mappedStep.__explicitTargetIndex = explicitTargetIndex;
            }
            return mappedStep;
          });
        }
        return stepProperty;
      };
      step.before_step = mapStep(step.before_step, step.xPath, step.__explicitTargetIndex);
      step.after_step = mapStep(step.after_step, step.xPath, step.__explicitTargetIndex);
      step.actual_step = true;
      step.execution = execution.NOT_EXECUTED;
      return step;
    });
    return runner;
  });
  mainWindow.webContents.send('testRunnerStepData', x);
  return x;
};

const splitGroupedKeywords = test_runner_steps => {
  return test_runner_steps.map(runner => {
    runner.steps = runner.steps.reduce((prev, curr) => {
      const { keyword_combination_names } = curr.keyword;
      if (keyword_combination_names && keyword_combination_names !== '') {
        console.log(keyword_combination_names);
        const newGroup = keyword_combination_names
          .split(',')
          .map((keyword, i) => {
            return {
              after_step: curr.after_step,
              before_step: curr.before_step,
              description: curr.description,
              expected_output: curr.expected_output,
              keyword: { name: keyword },
              value: curr.value.split('||')[i],
              xPath: curr.xPath.split('||')[i],
              dataset_id: curr.dataset_id,
              ...(i === 0 && { id: curr.id }),
              ...(i === 0 && { actual_step: true }),
              ...(i === 0 && { execution: execution.NOT_EXECUTED }),
              ...(i !== 0 && { parent: curr.id }),
            };
          });
        return [...prev, ...newGroup];
      }
      return [...prev, curr];
    }, []);
    return runner;
  });
};

const runStep = async step => {
  const parseExplicitIndexedStepValue = rawValue => {
    const value = String(rawValue ?? '');
    const match = value.match(/^(\d+)\[\](.*)$/s);
    if (!match) {
      return null;
    }
    return {
      explicitTargetIndex: Number(match[1]),
      value: match[2],
    };
  };

  /**
   * if the step value contains {{u_localVar}} then it will replace the value with the captured data
   */
  if (capturedData != null && step.value.includes('{{u_capture}}')) {
    step.value = step.value.replace('{{u_capture}}', capturedData);
  }
  const parsedIndexedValue = parseExplicitIndexedStepValue(step.value);
  if (parsedIndexedValue) {
    step.value = parsedIndexedValue.value;
    step.__explicitTargetIndex = parsedIndexedValue.explicitTargetIndex;
  }
  console.log(step.keyword.name.toLowerCase().bgGreen)
  console.log(step.value.bgGreen)
  console.log(step.xPath.bgGreen)

  switch (step.keyword.name.toLowerCase()) {
    //for alert test cases only:
    case 'alertaccept':
      return await alertAccept(driver);

    case 'alertdismiss':
      return await alertDismiss(driver);

    case 'alertsettext':
      return await alertSetText(driver, step);

      case 'launchbrowser':
        driver = await launchBrowser(step);
        return;

      case 'launchdebugbrowser':
      case 'debugbrowser':
        driver = await launchDebugBrowser(step);
        return;

      case 'connectbrowser':
        driver = await connectBrowser(step);
        return;

      case 'openwindow':
        return await openWindow(driver, step);

    case 'closebrowser':
      return await closeBrowser(driver, step);

    case 'navigate':
      return await navigate(driver, step);

    case 'sendkeys':
      return await sendKeys(driver, step);

    case 'sendkey':
      return await sendKey(driver, step);

    case 'selectall':
      return await selectAll(driver, step);

    case 'copy':
      return await copy(driver, step);

    case 'paste':
      return await paste(driver, step);

    case 'clearinput':
      return await clearInput(driver, step);

    case 'setsecure':
      return await setSecure(driver, step);

    case 'click':
      return await click(driver, step);

    case 'select':
      return await select(driver, step);

    case 'closetab':
      return await closeTab(driver, step);

    case 'opentab':
      return await openTab(driver, step);

    case 'exist':
      return await exist(driver, step);

    case 'wait':
      return new Promise(resolve => setTimeout(() => resolve(), step.value));

    case 'waitforelement':
      return await waitForElement(driver, step);

    case 'waitfortext':
      return await waitForText(driver, step);

    case 'rightclick':
      return await rightClick(driver, step);

    case 'doubleclick':
      return await doubleClick(driver, step);

    case 'maxbrowser':
      return await maxBrowser(driver);

    case 'minbrowser':
      return await minBrowser(driver);

    case 'switchbrowser':
      return await switchBrowser(driver, step);

    case 'validateelement':
      return await validateElement(driver, step);

    case 'getelementvalue':
      capturedData = await getElementValue(driver, step);
      return;

    case 'scrolltoelement':
      return await scrollToElement(driver, step);

    case 'scrolltotext':
        return await scrollToText(driver, step);

    case 'hoverelement':
      return await hoverElement(driver, step);

    case 'dragdrop':
      return await dragDrop(driver, step);

    case 'verifytextonalert':
      return await verifyTextOnAlert(driver, step);

    case 'switchtoiframe':
      return await switchToIframe(driver, step);

    case 'switchtodom':
      return await switchToDom(driver, step);

    case 'connectpdf':
      return await connectPDF(driver, step);

    case 'verifypdftext':
      return await verifyPDFText(driver, step);

    case 'disconnectpdf':
      return await disconnectPDF(driver, step);

    case 'deletepdffile':
      return await deletePDFFile(driver, step);

    case 'getcookievalue':
      return await getCookieValue(driver, step);

    case 'removecookie':
      return await removeCookie(driver, step);

    case 'getdbvalue':
      return await getDBValue(driver, step);

    case 'executesql':
      return await executeSQL(driver, step);

    case 'apicall':
      {
        const activeWebActions = getActiveWebActions();
        if (activeWebActions?.driver === driver && typeof activeWebActions.apiCall === 'function') {
          capturedData = await activeWebActions.apiCall(step);
        } else {
          const apiBridge = new WebActions();
          apiBridge.driver = driver;
          capturedData = await apiBridge.apiCall(step);
        }
      }
      return;

    //mobile keywords
    case 'mobileopenapp':
      driver = await mobileOpenApp(step);
      return;

    case 'back':
      return await mobileBack(driver, step);

    case 'mobiletap':
      return await mobileTap(driver, step);

    case 'mobiledoubletap':
      return await mobileDoubleTap(driver, step);

    case 'mobilelongpress':
      return await mobileLongPress(driver, step);

    case 'mobilefill':
      return await mobileFill(driver, step);

    case 'mobilescrolltotext':
      return await mobileScrollToText(driver, step);

    case 'mobilescrollbackward':
      return await mobileScrollBackward(driver, step, false, true);

    case 'mobilescrollforward':
      return await mobileScrollForward(driver, step, true, false);

    case 'mobileelementexist':
      return await mobileElementExist(driver, step);

    case 'mobileinputexistandvalidate':
      return mobileInputExistsAndValidate(driver, step);

    case 'mobileelementnotexist':
      return await mobileElementNotExist(driver, step);

    case 'mobilehidekeyboard':
      return await mobileHideKeyboard(driver, step);

    case 'mobilepinch':
      return await mobilePinch(driver, step);

    case 'mobileswipe':
      return await mobileSwipe(driver, step);

    case 'mobiledigitalsignature':
      return await mobileDigitalSignature(driver, step);

    case 'mobileelementvalidate':
      return await mobileElementValidate(driver, step);

    case 'mobileswitchcontext':
      return await mobileSwitchContext(driver, step);

    default:
      console.log(
        `no keyword matched for ${step.keyword.name.toLowerCase()}`.bgRed,
      );
      break;
  }

};
}

const pauseExecution = () => {
  const hasActiveRunner =
    !!fastTrackAutomation &&
    Array.isArray(fastTrackAutomation.testRunnerSteps) &&
    fastTrackAutomation.testRunnerSteps.length > 0 &&
    !fastTrackAutomation.isPaused;
  if (!hasActiveRunner) {
    try {
      mainWindow?.webContents?.send('noActiveTest', { message: 'No active test is running.' });
    } catch (err) {
      console.log('notify no active test failed (ignored)', err?.message || err);
    }
    return false;
  }
  fastTrackAutomation.pauseExecution();
  return true;
};
const resumeExecution = () => {
  fastTrackAutomation.resumeExecution();
};

const stopExecution = async () => {
  const workerStatus = localQueueWorker.status();
  const activeQueueId = Number(workerStatus?.currentQueueId || 0);
  const activeQueueItemId = Number(workerStatus?.currentQueueItemId || 0);

  const hasActiveAutomation =
    isAutomationExecuting ||
    !!fastTrackAutomation?.cancelCompletionPromise ||
    activeQueueId > 0 ||
    activeQueueItemId > 0;

  if (activeQueueId > 0 || activeQueueItemId > 0) {
    return await cancelActiveQueueExecution({
      queueId: activeQueueId || undefined,
      queueItemId: activeQueueItemId || undefined,
    });
  }

  if (!hasActiveAutomation) {
    try {
      mainWindow?.webContents?.send('noActiveTest', { message: 'No active test is running.' });
    } catch (err) {
      console.log('notify no active test failed (ignored)', err?.message || err);
    }
    return { ok: true, engaged: false, message: 'No active local run is in progress.' };
  }

  if (fastTrackAutomation?.requestCancelAndReset) {
    await fastTrackAutomation.requestCancelAndReset({ immediate: true, waitMs: 3000 });
  }

  isAutomationExecuting = false;
  isPaused = false;
  recoveryDecisionPending = false;
  pendingRecoveryJournal = null;
  lastRunAt = new Date().toISOString();
  lastRunStatus = 'canceled';
  clearRunJournal('manual_run_cancelled_by_request');
  clearRunnerExecutionUi('Draft run was stopped. Execution has been canceled.');

  return {
    ok: true,
    engaged: true,
    message: 'Active draft run canceled and reset.',
  };
};

const reExecuteStep = () => {
  fastTrackAutomation.reExecuteStep();
};

const clearRunnerExecutionUi = (message = 'Queue was canceled. Execution has been stopped.') => {
  try {
    mainWindow?.webContents?.send?.('openReExecuteDataModal', null);
    mainWindow?.webContents?.send?.('testRunnerStepData', []);
    mainWindow?.webContents?.send?.('noActiveTest', { message });
    mainWindow?.webContents?.send?.('stopScreenRecording');
  } catch (_) {}
};

const cancelActiveQueueExecution = async ({ queueId, queueItemId } = {}) => {
  const workerStatus = localQueueWorker.status();
  const activeQueueId = Number(workerStatus?.currentQueueId || 0);
  const activeQueueItemId = Number(workerStatus?.currentQueueItemId || 0);
  const activeClaimToken = String(workerStatus?.currentClaimToken || '').trim();
  const activeQueue = workerStatus?.currentQueue || localQueueWorker.currentQueue || null;
  const activeItem = workerStatus?.currentItem || localQueueWorker.currentItem || null;
  const requestedQueueId = Number(queueId || 0);
  const requestedQueueItemId = Number(queueItemId || 0);
  const journal = pendingRecoveryJournal || loadRunJournal();
  const journalQueueId = Number(journal?.meta?.queue_id || 0);
  const journalQueueItemId = Number(journal?.meta?.queue_item_id || 0);
  const matchesJournalContext =
    requestedQueueId > 0 &&
    journalQueueId === requestedQueueId &&
    (requestedQueueItemId <= 0 || journalQueueItemId === requestedQueueItemId);

  if ((!activeQueueId || !activeQueueItemId) && !matchesJournalContext) {
    return { ok: true, engaged: false, message: 'No active local queue run is engaged.' };
  }

  if (activeQueueId > 0 && requestedQueueId > 0 && activeQueueId !== requestedQueueId) {
    return { ok: true, engaged: false, message: 'Requested queue is not the active local run.' };
  }

  if (activeQueueItemId > 0 && requestedQueueItemId > 0 && activeQueueItemId !== requestedQueueItemId) {
    return { ok: true, engaged: false, message: 'Requested queue item is not the active local run item.' };
  }

  if (fastTrackAutomation?.requestCancelAndReset) {
    await fastTrackAutomation.requestCancelAndReset({ immediate: true, waitMs: 3000 });
  }

  queueStopInProgress = true;
  isAutomationExecuting = false;
  isPaused = false;
  recoveryDecisionPending = false;
  pendingRecoveryJournal = null;
  lastRunAt = new Date().toISOString();
  lastRunStatus = 'canceled';
  clearRunJournal('queue_cancelled_by_request');

  const resolvedQueueId = activeQueueId || journalQueueId || requestedQueueId || null;
  const resolvedItem = activeItem || {};
  const resolvedClaimToken = activeClaimToken || String(journal?.meta?.claim_token || '').trim();
  const resolvedTestSuiteId = Number(resolvedItem?.test_suite_id || journal?.meta?.test_suite_id || 0);
  const resolvedConfigurationId =
    resolvedItem?.configuration_id !== undefined && resolvedItem?.configuration_id !== null
      ? Number(resolvedItem.configuration_id || 0) || null
      : (Number(journal?.meta?.configuration_id || 0) || null);
  const resolvedTestDesignDatasetId =
    resolvedItem?.test_design_dataset_id !== undefined && resolvedItem?.test_design_dataset_id !== null
      ? Number(resolvedItem.test_design_dataset_id || 0) || null
      : (Number(journal?.meta?.test_design_dataset_id || 0) || null);
  const resolvedAttemptNo = Number(resolvedItem?.attempts || journal?.meta?.attempt_no || 0) || null;
  const resolvedQueueRunId = Number(resolvedItem?.queue_run_id || journal?.meta?.queue_run_id || 0) || null;

  if (!resolvedQueueId || !resolvedTestSuiteId || !resolvedClaimToken) {
    queueStopInProgress = false;
    throw new Error('Active queue stop is missing queue claim context.');
  }

  try {
    await localQueueWorker.request('post', `/runner/execution-queue/${Number(resolvedQueueId)}/cancel-active`, {
      queue_run_id: resolvedQueueRunId,
      claim_token: resolvedClaimToken,
      attempt_no: resolvedAttemptNo,
      test_suite_id: resolvedTestSuiteId,
      configuration_id: resolvedConfigurationId,
      test_design_dataset_id: resolvedTestDesignDatasetId,
      reason: 'runner_stop_requested',
    });

    localQueueWorker.clearActiveExecution('queue_cancelled_by_request');
    queueStopInProgress = false;
    clearRunnerExecutionUi();
  } catch (err) {
    console.log('[queue-local] safe queue cancel sync failed', err?.message || err);
    clearRunnerExecutionUi('Queue stop failed to sync with the server. Restart the runner or refresh the queue before continuing.');
    throw err;
  }

  return {
    ok: true,
    engaged: true,
    queue_id: resolvedQueueId,
    queue_item_id: activeQueueItemId || journalQueueItemId || requestedQueueItemId || null,
    message: 'Active local queue run canceled and reset.',
  };
};

const reconcileStaleQueueRunWithoutRecovery = async () => {
  if (getPersistedRecoveryEnabled()) return { ok: true, skipped: true, reason: 'recovery_enabled' };
  const journal = loadRunJournal();
  if (!journal) return { ok: true, skipped: true, reason: 'no_journal' };
  if (journal.state && ['completed', 'failed', 'canceled', 'discarded'].includes(journal.state)) {
    clearRunJournal('terminal_journal_cleanup');
    return { ok: true, skipped: true, reason: 'terminal_journal' };
  }

  const journalMeta = journal?.meta || {};
  const queueId = Number(journalMeta.queue_id || 0);
  const queueItemId = Number(journalMeta.queue_item_id || 0);
  const claimToken = String(journalMeta.claim_token || '').trim();
  const testSuiteId = Number(journalMeta.test_suite_id || 0);
  if (!queueId || !queueItemId || !claimToken || !testSuiteId) {
    clearRunJournal('stale_journal_missing_interrupt_keys');
    return { ok: true, skipped: true, reason: 'missing_interrupt_keys' };
  }

  try {
    await localQueueWorker.reportInterruptedFromJournalMeta(journalMeta, 'runner_restarted_recovery_disabled');
    clearRunJournal('stale_queue_interrupted_after_restart');
    localQueueWorker.clearActiveExecution('stale_queue_interrupted_after_restart');
    isAutomationExecuting = false;
    isPaused = false;
    recoveryDecisionPending = false;
    pendingRecoveryJournal = null;
    lastRunAt = new Date().toISOString();
    lastRunStatus = 'interrupted';
    clearRunnerExecutionUi('Previous queue execution was interrupted because the runner restarted with recovery disabled.');
    return { ok: true, reconciled: true };
  } catch (err) {
    console.log('[queue-local] stale recovery-off reconciliation failed', err?.message || err);
    return { ok: false, message: err?.message || 'Failed to reconcile stale interrupted queue run.' };
  }
};













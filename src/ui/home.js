const execution = {
  NOT_EXECUTED: 0,
  EXECUTING: 1,
  EXECUTED: 2,
  FAILED: 3,
};
const startServerBtn = document.querySelector('#startServer');
const captureXpath = document.querySelector('#captureXpath');

const stopServerBtn = document.querySelector('#stopServer');
const startWinAppServerBtn = document.querySelector('#startWinAppServer');
const stopWinAppServerBtn = document.querySelector('#stopWinAppServer');
const appiumServerToggle = document.querySelector('#appiumServerToggle');
const appiumServerIcon = document.querySelector('#appiumServerIcon');
const appiumServerLabel = document.querySelector('#appiumServerLabel');
const serverText = document.querySelector('#serverText');
// const startSeleniumBtn=document.querySelector('#startSelenium')
const pauseBtn = document.querySelector('#pause');
const stopExecutionBtn = document.querySelector('#stopExecution');
const resumeBtn = document.querySelector('#resume');
let automationRunning = false;

const setSidebarActionVisible = (element, visible) => {
  if (!element) return;
  element.classList.toggle('hidden', !visible);
  element.classList.toggle('d-none', !visible);
};

const setExecutionControlState = state => {
  const mode = String(state || 'idle');
  if (mode === 'running') {
    setSidebarActionVisible(pauseBtn, true);
    setSidebarActionVisible(stopExecutionBtn, true);
    setSidebarActionVisible(resumeBtn, false);
    return;
  }

  if (mode === 'paused') {
    setSidebarActionVisible(pauseBtn, false);
    setSidebarActionVisible(stopExecutionBtn, true);
    setSidebarActionVisible(resumeBtn, true);
    return;
  }

  if (mode === 'decision') {
    setSidebarActionVisible(pauseBtn, false);
    setSidebarActionVisible(stopExecutionBtn, true);
    setSidebarActionVisible(resumeBtn, false);
    return;
  }

  setSidebarActionVisible(pauseBtn, false);
  setSidebarActionVisible(stopExecutionBtn, false);
  setSidebarActionVisible(resumeBtn, false);
};
// Disable in-app control of Appium/WinAppDriver; they should be run externally.
const DEVICE_SERVER_CONTROL_DISABLED = true;
const reExecuteCheckbox = document.querySelector('#reExecute');
const reExecuteModalXpath = document.querySelector('#reExecuteModalXpath');
const reExecuteModalKeyword = document.querySelector('#reExecuteModalKeyword');
const reExecuteModalValue = document.querySelector('#reExecuteModalValue');
const reExecuteModalExecuteBtn = document.querySelector('#reExecuteModalExecuteBtn');
const reExecuteModalResetBtn = document.querySelector('#reExecuteModalResetBtn');
const reExecuteModalMarkFailBtn = document.querySelector('#reExecuteModalMarkFailBtn');
const reExecuteModalMarkPassBtn = document.querySelector('#reExecuteModalMarkPassBtn');
const reExecuteModalCancelBtn = document.querySelector('#reExecuteModalCancelBtn');
const reExecStepLabel = document.querySelector('#reExecStepLabel');
const reExecLocatorLabel = document.querySelector('#reExecLocatorLabel');
const reExecDataLabel = document.querySelector('#reExecDataLabel');
const resumeFailedStepBtn = document.querySelector('#resumeFailedStepBtn');
const forceReloadBtn = document.querySelector('#forceReloadBtn');
const toggleDevToolsBtn = document.querySelector('#toggleDevToolsBtn');
const highlightToggle = document.querySelector('#highlightToggle');
const executionDelayInput = document.querySelector('#executionDelayInput');
const allowRecoveryToggle = document.querySelector('#allowRecoveryToggle');
const screenDropdown = document.querySelector('#screenDropdown');
const openApiCallsWorkspace = document.querySelector('#openApiCallsWorkspace');
const openAdvancedSpyWorkspace = document.querySelector('#openAdvancedSpyWorkspace');
const runnerWorkspace = document.querySelector('#runnerWorkspace');
const apiWorkspace = document.querySelector('#apiWorkspace');
const advancedSpyWorkspace = document.querySelector('#advancedSpyWorkspace');
const closeApiWorkspaceBtn = document.querySelector('#closeApiWorkspaceBtn');
const closeAdvancedSpyWorkspaceBtn = document.querySelector('#closeAdvancedSpyWorkspaceBtn');
const advancedSpyLaunchBrowserBtn = document.querySelector('#advancedSpyLaunchBrowserBtn');
const advancedSpyStartBtn = document.querySelector('#advancedSpyStartBtn');
const advancedSpyFetchBtn = document.querySelector('#advancedSpyFetchBtn');
const advancedSpyStopBtn = document.querySelector('#advancedSpyStopBtn');
const advancedSpyStatusText = document.querySelector('#advancedSpyStatusText');
const advancedSpyUseInRunnerBtn = document.querySelector('#advancedSpyUseInRunnerBtn');
const advancedSpyCopyBtn = document.querySelector('#advancedSpyCopyBtn');
const advancedSpySelectorList = document.querySelector('#advancedSpySelectorList');
const advancedSpyIframeChain = document.querySelector('#advancedSpyIframeChain');
const advancedSpyShadowPath = document.querySelector('#advancedSpyShadowPath');
const advancedSpyContextSummary = document.querySelector('#advancedSpyContextSummary');
const advancedSpyElementDetails = document.querySelector('#advancedSpyElementDetails');

const testKeyword = document.querySelector('#testKeyword');
const testLocator = document.querySelector('#testLocator');
const testExecute = document.querySelector('#testExecute');
const testOutput = document.querySelector('#testOutput');
const testValue = document.querySelector('#testValue');
const testExpectedOutput = document.querySelector('#testExpectedOutput');
const testLaunchBrowser = document.querySelector('#testLaunchBrowser');
const apiCallResultPanel = document.querySelector('#apiCallResultPanel');
const apiCallResultMeta = document.querySelector('#apiCallResultMeta');
const apiCallResultBadge = document.querySelector('#apiCallResultBadge');
const apiCallExecutionSummary = document.querySelector('#apiCallExecutionSummary');
const apiCallAssertionSummary = document.querySelector('#apiCallAssertionSummary');
const apiCallAssertionList = document.querySelector('#apiCallAssertionList');
const apiCallResultContent = document.querySelector('#apiCallResultContent');
const apiCallResultBody = document.querySelector('#apiCallResultBody');
const toggleApiCallResultBtn = document.querySelector('#toggleApiCallResultBtn');
const resetApiCallResultBtn = document.querySelector('#resetApiCallResultBtn');
const apiCallTabButtons = Array.from(document.querySelectorAll('.apiCallTabBtn'));
const runApiAssertionsBtn = document.querySelector('#runApiAssertionsBtn');
const startNetworkCaptureBtn = document.querySelector('#startNetworkCaptureBtn');
const refreshNetworkCaptureBtn = document.querySelector('#refreshNetworkCaptureBtn');
const stopNetworkCaptureBtn = document.querySelector('#stopNetworkCaptureBtn');
const networkCaptureStatus = document.querySelector('#networkCaptureStatus');
const networkCaptureList = document.querySelector('#networkCaptureList');
const networkCaptureBody = document.querySelector('#networkCaptureBody');
const toggleNetworkCaptureBtn = document.querySelector('#toggleNetworkCaptureBtn');
const clearLogBtn = document.querySelector('#clearLogBtn');
const emailSandboxStatusPanel = document.querySelector('#emailSandboxStatusPanel');
const emailSandboxStatusBadge = document.querySelector('#emailSandboxStatusBadge');
const emailSandboxStatusText = document.querySelector('#emailSandboxStatusText');
const apiWorkspaceMethod = document.querySelector('#apiWorkspaceMethod');
const apiWorkspaceUrl = document.querySelector('#apiWorkspaceUrl');
const apiWorkspaceProtocol = document.querySelector('#apiWorkspaceProtocol');
const apiWorkspaceOpenApiToggle = document.querySelector('#apiWorkspaceOpenApiToggle');
const apiWorkspaceOpenApiToggleWrap = document.querySelector('#apiWorkspaceOpenApiToggleWrap');
const apiWorkspaceSoapWsdlRow = document.querySelector('#apiWorkspaceSoapWsdlRow');
const apiWorkspaceWsdlUrl = document.querySelector('#apiWorkspaceWsdlUrl');
const apiWorkspaceWsdlAuth = document.querySelector('#apiWorkspaceWsdlAuth');
const apiWorkspaceWsdlFile = document.querySelector('#apiWorkspaceWsdlFile');
const apiWorkspaceWsdlChooseBtn = document.querySelector('#apiWorkspaceWsdlChooseBtn');
const apiWorkspaceWsdlImportBtn = document.querySelector('#apiWorkspaceWsdlImportBtn');
const apiWorkspaceOpenApiRow = document.querySelector('#apiWorkspaceOpenApiRow');
const apiWorkspaceOpenApiUrl = document.querySelector('#apiWorkspaceOpenApiUrl');
const apiWorkspaceOpenApiFile = document.querySelector('#apiWorkspaceOpenApiFile');
const apiWorkspaceOpenApiChooseBtn = document.querySelector('#apiWorkspaceOpenApiChooseBtn');
const apiWorkspaceOpenApiImportBtn = document.querySelector('#apiWorkspaceOpenApiImportBtn');
const apiWorkspaceOpenApiOperation = document.querySelector('#apiWorkspaceOpenApiOperation');
const apiWorkspaceOpenApiApplyBtn = document.querySelector('#apiWorkspaceOpenApiApplyBtn');
const apiWorkspaceQueryLabel = document.querySelector('#apiWorkspaceQueryLabel');
const apiWorkspaceBodyLabel = document.querySelector('#apiWorkspaceBodyLabel');
const apiWorkspaceQuery = document.querySelector('#apiWorkspaceQuery');
const apiWorkspaceBodyInput = document.querySelector('#apiWorkspaceBodyInput');
const apiWorkspaceHeadersInput = document.querySelector('#apiWorkspaceHeadersInput');
const apiWorkspaceMode = document.querySelector('#apiWorkspaceMode');
const apiWorkspaceRunBtn = document.querySelector('#apiWorkspaceRunBtn');
const apiWorkspaceResetBtn = document.querySelector('#apiWorkspaceResetBtn');
const apiWorkspaceReportBtn = document.querySelector('#apiWorkspaceReportBtn');
const apiWorkspaceLaunchBrowserBtn = document.querySelector('#apiWorkspaceLaunchBrowserBtn');
const apiWorkspaceSessionLoginBtn = document.querySelector('#apiWorkspaceSessionLoginBtn');
const apiWorkspaceStartCaptureBtn = document.querySelector('#apiWorkspaceStartCaptureBtn');
const apiWorkspaceRefreshCaptureBtn = document.querySelector('#apiWorkspaceRefreshCaptureBtn');
const apiWorkspaceStopCaptureBtn = document.querySelector('#apiWorkspaceStopCaptureBtn');
const apiWorkspaceStatusText = document.querySelector('#apiWorkspaceStatusText');
const apiWorkspaceResponseMeta = document.querySelector('#apiWorkspaceResponseMeta');
const apiWorkspaceResponseBadge = document.querySelector('#apiWorkspaceResponseBadge');
const apiWorkspaceResponseContent = document.querySelector('#apiWorkspaceResponseContent');
const apiWorkspaceAssertionResultsPanel = document.querySelector('#apiWorkspaceAssertionResultsPanel');
const apiWorkspaceAssertionsInput = document.querySelector('#apiWorkspaceAssertionsInput');
const apiWorkspaceRunAssertionsBtn = document.querySelector('#apiWorkspaceRunAssertionsBtn');
const apiWorkspaceAssertionSummary = document.querySelector('#apiWorkspaceAssertionSummary');
const apiWorkspaceCaptureStatus = document.querySelector('#apiWorkspaceCaptureStatus');
const apiWorkspaceCaptureTypeFilter = document.querySelector('#apiWorkspaceCaptureTypeFilter');
const apiWorkspaceCaptureList = document.querySelector('#apiWorkspaceCaptureList');
const apiWorkspaceTabButtons = Array.from(document.querySelectorAll('.apiWorkspaceTabBtn'));
const apiWorkspaceReportMeta = document.querySelector('#apiWorkspaceReportMeta');
const apiWorkspaceReportExecution = document.querySelector('#apiWorkspaceReportExecution');
const apiWorkspaceReportAssertions = document.querySelector('#apiWorkspaceReportAssertions');
const apiWorkspaceReportContent = document.querySelector('#apiWorkspaceReportContent');
const apiWorkspaceCaptureEditModal = document.querySelector('#apiWorkspaceCaptureEditModal');
const apiWorkspaceCaptureEditMethod = document.querySelector('#apiWorkspaceCaptureEditMethod');
const apiWorkspaceCaptureEditUrl = document.querySelector('#apiWorkspaceCaptureEditUrl');
const apiWorkspaceCaptureEditMode = document.querySelector('#apiWorkspaceCaptureEditMode');
const apiWorkspaceCaptureEditQuery = document.querySelector('#apiWorkspaceCaptureEditQuery');
const apiWorkspaceCaptureEditBody = document.querySelector('#apiWorkspaceCaptureEditBody');
const apiWorkspaceCaptureEditHeaders = document.querySelector('#apiWorkspaceCaptureEditHeaders');
const apiWorkspaceCaptureEditStatus = document.querySelector('#apiWorkspaceCaptureEditStatus');
const apiWorkspaceCaptureEditReplayBtn = document.querySelector('#apiWorkspaceCaptureEditReplayBtn');
const apiWorkspaceCaptureEditSaveBtn = document.querySelector('#apiWorkspaceCaptureEditSaveBtn');
const apiWorkspaceCaptureEditOpenAdvancedBtn = document.querySelector('#apiWorkspaceCaptureEditOpenAdvancedBtn');
const apiWorkspaceBasicView = document.querySelector('#apiWorkspaceBasicView');
const apiWorkspaceAdvancedView = document.querySelector('#apiWorkspaceAdvancedView');
const apiWorkspaceViewToggleBtn = document.querySelector('#apiWorkspaceViewToggleBtn');
const apiWorkspaceBasicBrowserBtn = document.querySelector('#apiWorkspaceBasicBrowserBtn');
const apiWorkspaceBasicBrowserText = document.querySelector('#apiWorkspaceBasicBrowserText');
const apiWorkspaceBasicBrowserDot = document.querySelector('#apiWorkspaceBasicBrowserDot');
const apiWorkspaceBasicCaptureBtn = document.querySelector('#apiWorkspaceBasicCaptureBtn');
const apiWorkspaceBasicCaptureText = document.querySelector('#apiWorkspaceBasicCaptureText');
const apiWorkspaceBasicCaptureDot = document.querySelector('#apiWorkspaceBasicCaptureDot');
const apiWorkspaceBasicLoginBtn = document.querySelector('#apiWorkspaceBasicLoginBtn');
const apiWorkspaceBasicCaptureStatus = document.querySelector('#apiWorkspaceBasicCaptureStatus');
const apiWorkspaceBasicCaptureTypeFilter = document.querySelector('#apiWorkspaceBasicCaptureTypeFilter');
const apiWorkspaceBasicCaptureList = document.querySelector('#apiWorkspaceBasicCaptureList');
const apiWorkspaceBasicResponseMeta = document.querySelector('#apiWorkspaceBasicResponseMeta');
const apiWorkspaceBasicResponseBadge = document.querySelector('#apiWorkspaceBasicResponseBadge');
const apiWorkspaceBasicResponseContent = document.querySelector('#apiWorkspaceBasicResponseContent');
const apiWorkspaceBasicAssertionResultsPanel = document.querySelector('#apiWorkspaceBasicAssertionResultsPanel');
const apiWorkspaceBasicAssertionsInput = document.querySelector('#apiWorkspaceBasicAssertionsInput');
const apiWorkspaceBasicRunAssertionsBtn = document.querySelector('#apiWorkspaceBasicRunAssertionsBtn');
const apiWorkspaceBasicAssertionSummary = document.querySelector('#apiWorkspaceBasicAssertionSummary');
const apiWorkspaceBasicTabButtons = Array.from(document.querySelectorAll('.apiWorkspaceBasicTabBtn'));
let apiWorkspaceGuideStep = 0;
const queueWorkerEnabled = document.querySelector('#queueWorkerEnabled');
const queueWorkerPairingCode = document.querySelector('#queueWorkerPairingCode');
const queueWorkerClaimToken = document.querySelector('#queueWorkerClaimToken');
const pairDeviceSetupBtn = document.querySelector('#pairDeviceSetupBtn');
const queueWorkerPairingMessage = document.querySelector('#queueWorkerPairingMessage');
const queueWorkerDeviceId = document.querySelector('#queueWorkerDeviceId');
const queueWorkerRunnerId = document.querySelector('#queueWorkerRunnerId');
const queueWorkerPollMs = document.querySelector('#queueWorkerPollMs');
const queueWorkerApiBaseUrl = document.querySelector('#queueWorkerApiBaseUrl');
const queueWorkerDeviceKey = document.querySelector('#queueWorkerToken');
const queueWorkerState = document.querySelector('#queueWorkerState');
const queueWorkerMessage = document.querySelector('#queueWorkerMessage');
const saveQueueWorkerConfigBtn = document.querySelector('#saveQueueWorkerConfigBtn');
const tableBody = document.getElementById('myTable').getElementsByTagName('tbody')[0];
const xpathRecorderBtn = captureXpath;
const spyIndicator = document.querySelector('#spyIndicator');
let currentAppiumPort = 4723;
let currentWinAppPort = 4725;
let currentWebPort = 3009;

let hasExecutionRows = false;
let networkCaptureActive = false;
let latestNetworkCaptureEntries = [];
let activeApiCallResultTab = 'json';
let activeApiWorkspaceTab = 'json';
let latestApiCallOutput = '';
let latestApiWorkspaceAssertions = { total: 0, passed: 0, failed: 0, results: [] };
let apiCallResultExpanded = true;
let networkCaptureExpanded = true;
let captureEditDraft = null;

const escapeHtml = value =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

let browserSessionController = null;
let spyWorkspaceModule = null;
let reExecuteFlowModule = null;
let serverDeviceControlsModule = null;
let queueWorkerSetupModule = null;
let advancedSpyWorkspaceModule = null;

const apiWorkspaceModule = window.createApiWorkspaceModule({
  elements: {
    apiCallAssertionList,
    apiCallAssertionSummary,
    apiCallExecutionSummary,
    apiCallResultBadge,
    apiCallResultBody,
    apiCallResultContent,
    apiCallResultMeta,
    apiCallResultPanel,
    apiCallTabButtons,
    apiWorkspaceAssertionResultsPanel,
    apiWorkspaceAssertionSummary,
    apiWorkspaceAssertionsInput,
    apiWorkspaceBodyInput,
    apiWorkspaceCaptureList,
    apiWorkspaceCaptureStatus,
    apiWorkspaceCaptureTypeFilter,
    apiWorkspaceHeadersInput,
    apiWorkspaceMethod,
    apiWorkspaceMode,
    apiWorkspaceProtocol,
    apiWorkspaceOpenApiToggle,
    apiWorkspaceOpenApiToggleWrap,
    apiWorkspaceSoapWsdlRow,
    apiWorkspaceWsdlUrl,
    apiWorkspaceWsdlAuth,
    apiWorkspaceWsdlFile,
    apiWorkspaceWsdlChooseBtn,
    apiWorkspaceWsdlImportBtn,
    apiWorkspaceOpenApiRow,
    apiWorkspaceOpenApiUrl,
    apiWorkspaceOpenApiFile,
    apiWorkspaceOpenApiChooseBtn,
    apiWorkspaceOpenApiImportBtn,
    apiWorkspaceOpenApiOperation,
    apiWorkspaceOpenApiApplyBtn,
    apiWorkspaceQueryLabel,
    apiWorkspaceBodyLabel,
    apiWorkspaceQuery,
    apiWorkspaceReportAssertions,
    apiWorkspaceReportContent,
    apiWorkspaceReportExecution,
    apiWorkspaceReportMeta,
    apiWorkspaceResponseBadge,
    apiWorkspaceResponseContent,
    apiWorkspaceResponseMeta,
    apiWorkspaceStatusText,
    apiWorkspaceTabButtons,
    apiWorkspaceUrl,
    networkCaptureBody,
    networkCaptureList,
    networkCaptureStatus,
    testKeyword,
    testOutput,
    testValue,
    toggleApiCallResultBtn,
    toggleNetworkCaptureBtn,
  },
  state: {
    get: () => ({
      activeApiCallResultTab,
      activeApiWorkspaceTab,
      apiCallResultExpanded,
      isBrowserLaunched: browserSessionController?.getIsBrowserLaunched?.() ?? false,
      latestApiCallOutput,
      latestNetworkCaptureEntries,
      latestApiWorkspaceAssertions,
      networkCaptureActive,
      networkCaptureExpanded,
    }),
    set: patch => {
      if (Object.prototype.hasOwnProperty.call(patch, 'activeApiCallResultTab')) activeApiCallResultTab = patch.activeApiCallResultTab;
      if (Object.prototype.hasOwnProperty.call(patch, 'activeApiWorkspaceTab')) activeApiWorkspaceTab = patch.activeApiWorkspaceTab;
      if (Object.prototype.hasOwnProperty.call(patch, 'apiCallResultExpanded')) apiCallResultExpanded = patch.apiCallResultExpanded;
      if (Object.prototype.hasOwnProperty.call(patch, 'latestApiCallOutput')) latestApiCallOutput = patch.latestApiCallOutput;
      if (Object.prototype.hasOwnProperty.call(patch, 'latestApiWorkspaceAssertions')) latestApiWorkspaceAssertions = patch.latestApiWorkspaceAssertions;
      if (Object.prototype.hasOwnProperty.call(patch, 'latestNetworkCaptureEntries')) latestNetworkCaptureEntries = patch.latestNetworkCaptureEntries;
      if (Object.prototype.hasOwnProperty.call(patch, 'networkCaptureExpanded')) networkCaptureExpanded = patch.networkCaptureExpanded;
    },
  },
  escapeHtml,
  express,
  documentRef: document,
  copyToClipboard: async text => {
    const value = String(text ?? '');
    if (!value) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    try {
      const temp = document.createElement('textarea');
      temp.value = value;
      temp.setAttribute('readonly', 'readonly');
      temp.style.position = 'absolute';
      temp.style.left = '-9999px';
      document.body.appendChild(temp);
      temp.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(temp);
      return !!ok;
    } catch (_) {
      return false;
    }
  },
  useAutomationPayload: payload => {
    const value = String(payload || '').trim();
    if (!value) return;
    testKeyword.value = 'apiCall';
    testValue.value = value;
    testLocator.value = '';
    workspaceModeModule?.setWorkspaceMode('runner');
  },
});

const {
  buildApiCallValueFromWorkspace,
  buildApiStepFromCaptureEntry,
  getDynamicFieldCountForCaptureEntry,
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
} = apiWorkspaceModule;

const workspaceModeModule = window.createWorkspaceModeModule({
  elements: {
    openApiCallsWorkspace,
    openAdvancedSpyWorkspace,
    runnerWorkspace,
    apiWorkspace,
    advancedSpyWorkspace,
    closeApiWorkspaceBtn,
    closeAdvancedSpyWorkspaceBtn,
  },
  onEnterApiWorkspace: () => {
    setApiWorkspaceViewMode('basic');
    syncApiWorkspaceView();
    syncApiWorkspaceReport();
    syncApiWorkspaceBasicFromAdvanced();
  },
});

const networkCaptureModule = window.createNetworkCaptureModule({
  elements: {
    apiWorkspaceCaptureList,
    apiWorkspaceCaptureStatus,
    apiWorkspaceRefreshCaptureBtn,
    apiWorkspaceStartCaptureBtn,
    apiWorkspaceStopCaptureBtn,
    networkCaptureList,
    refreshNetworkCaptureBtn,
    startNetworkCaptureBtn,
    stopNetworkCaptureBtn,
    testOutput,
  },
  express,
  getNetworkCaptureActive: () => networkCaptureActive,
  setNetworkCaptureActive: value => {
    networkCaptureActive = !!value;
  },
  getLatestNetworkCaptureEntries: () => latestNetworkCaptureEntries,
  buildApiStepFromCaptureEntry,
  refreshNetworkCaptureEntries,
  renderNetworkCaptureEntries,
  resetApiWorkspaceForm,
  populateApiWorkspaceFromApiCallValue,
  openCaptureEditorFromCaptureEntry: openCaptureEditModalFromEntry,
  runApiCallFromCaptureEntry: async entry => {
    const apiStepValue = buildApiStepFromCaptureEntry(entry);
    populateApiWorkspaceFromApiCallValue(apiStepValue);
    setApiWorkspaceStatus('Replaying captured request...');
    resetApiCallResult();
    manualRunnerModule?.setExecutionSource?.('api');
    express.testExecute('', 'apiCall', apiStepValue, '');
  },
  setApiWorkspaceStatus,
  setNetworkCaptureStatus,
  setManualApiDraft: (apiStepValue, { message = 'Captured request converted into apiCall draft.', skipOutput = false } = {}) => {
    testKeyword.value = 'apiCall';
    testValue.value = apiStepValue;
    testLocator.value = '';
    if (!skipOutput) {
      testOutput.value = message;
    }
  },
  openApiWorkspace: () => workspaceModeModule.setWorkspaceMode('api'),
});

advancedSpyWorkspaceModule = window.createAdvancedSpyWorkspaceModule({
  elements: {
    advancedSpyCopyBtn,
    advancedSpyContextSummary,
    advancedSpyElementDetails,
    advancedSpyFetchBtn,
    advancedSpyLaunchBrowserBtn,
    advancedSpySelectorList,
    advancedSpyStartBtn,
    advancedSpyStatusText,
    advancedSpyStopBtn,
    advancedSpyIframeChain,
    advancedSpyShadowPath,
    advancedSpyUseInRunnerBtn,
  },
  express,
  launchBrowser: () => testLaunchBrowser?.click(),
  getActiveWorkspace: () => workspaceModeModule.getActiveWorkspace(),
  useInRunner: ({ locator, preferredKeyword }) => {
    testLocator.value = locator || '';
    if (preferredKeyword) {
      testKeyword.value = preferredKeyword;
    }
    workspaceModeModule.setWorkspaceMode('runner');
  },
});

browserSessionController = window.createBrowserSessionController({
  elements: {
    apiWorkspaceLaunchBrowserBtn,
    testLaunchBrowser,
  },
  express,
  beforeClose: async () => {
    if (spyWorkspaceModule?.isRecording()) {
      spyWorkspaceModule.stopSpyInspectionSync({ notifyRemote: false });
    }
    advancedSpyWorkspaceModule?.stopSync?.();
    if (networkCaptureActive) {
      await networkCaptureModule.stopCapture();
    }
    const capturedCount = Array.isArray(latestNetworkCaptureEntries) ? latestNetworkCaptureEntries.length : 0;
    if (capturedCount > 0) {
      const shouldClose = confirm(
        'Closing the browser will end the authenticated browser session and clear the captured network calls. You will need to start a fresh browser session and capture again. Continue?'
      );
      if (!shouldClose) {
        return false;
      }
    }
    return true;
  },
  onStateChange: running => {
    advancedSpyWorkspaceModule.syncBrowserState(running);
    setApiWorkspaceStatus(
      `${running ? 'Browser active' : 'Browser inactive'} - ${networkCaptureActive ? 'Capture active' : 'Capture inactive'}${latestApiCallOutput ? ' - Response ready' : ' - No response yet'}`,
    );
  },
  onBrowserClosed: () => {
    networkCaptureModule.handleBrowserClosed();
    if (testOutput) {
      testOutput.value = '';
    }
    resetApiCallResult();
    apiWorkspaceGuideStep = 0;
    syncApiWorkspaceBasicCardState();
  },
});

const manualRunnerModule = window.createManualRunnerModule({
  elements: {
    apiCallAssertionList,
    apiCallTabButtons,
    resetApiCallResultBtn,
    runApiAssertionsBtn,
    testExecute,
    testExpectedOutput,
    testKeyword,
    testLocator,
    testOutput,
    testValue,
    toggleApiCallResultBtn,
  },
  express,
  getActiveApiCallResultTab: () => activeApiCallResultTab,
  setActiveApiCallResultTab: value => {
    activeApiCallResultTab = value || 'json';
  },
  onToggleApiCallResult: () => {
    apiCallResultExpanded = !apiCallResultExpanded;
    syncApiCallResultExpansion();
  },
  resetApiCallResult,
  runAssertions,
  renderApiCallResult,
  syncApiCallPanelVisibility,
  stopSpyBeforeExecute: () => {
    if (spyWorkspaceModule?.isRecording()) {
      spyWorkspaceModule.stopSpyInspectionSync({ notifyRemote: false });
    }
  },
  setLaunchButtonState: running => browserSessionController.setLaunchButtonState(running),
  getLatestApiCallOutput: () => latestApiCallOutput,
});

reExecuteFlowModule = window.createReExecuteFlowModule({
  elements: {
    reExecDataLabel,
    reExecLocatorLabel,
    reExecStepLabel,
    reExecuteDataModal: document.querySelector('#reExecuteDataModal'),
    reExecuteModalCancelBtn,
    reExecuteModalExecuteBtn,
    reExecuteModalKeyword,
    reExecuteModalMarkFailBtn,
    reExecuteModalMarkPassBtn,
    reExecuteModalResetBtn,
    reExecuteModalValue,
    reExecuteModalXpath,
    resumeFailedStepBtn,
  },
  express,
  bootstrapRef: bootstrap,
  resolveStepKeyword: step => resolveStepKeyword(step),
});

serverDeviceControlsModule = window.createServerDeviceControlsModule({
  elements: {
    allowRecoveryToggle,
    appiumServerIcon,
    appiumServerLabel,
    appiumServerToggle,
    executionDelayInput,
    forceReloadBtn,
    highlightToggle,
    screenDropdown,
    startServerBtn,
    startWinAppServerBtn,
    stopServerBtn,
    stopWinAppServerBtn,
    toggleDevToolsBtn,
  },
  express,
  jqueryRef: $,
  documentRef: document,
  deviceServerControlDisabled: DEVICE_SERVER_CONTROL_DISABLED,
  getCurrentAppiumPort: () => currentAppiumPort,
});

queueWorkerSetupModule = window.createQueueWorkerSetupModule({
  elements: {
    pairDeviceSetupBtn,
    queueWorkerApiBaseUrl,
    queueWorkerClaimToken,
    queueWorkerDeviceId,
    queueWorkerDeviceKey,
    queueWorkerEnabled,
    queueWorkerMessage,
    queueWorkerPairingCode,
    queueWorkerPairingMessage,
    queueWorkerPollMs,
    queueWorkerRunnerId,
    queueWorkerState,
    saveQueueWorkerConfigBtn,
  },
  express,
  currentWebPortRef: () => currentWebPort,
  documentRef: document,
});

toggleNetworkCaptureBtn?.addEventListener('click', () => {
  networkCaptureExpanded = !networkCaptureExpanded;
  syncNetworkCaptureExpansion();
});
const resolveStepKeyword = step => {
  const candidates = [
    step?.keyword?.name,
    step?.keyword,
    step?.keyword_name,
    step?.keywordName,
  ];
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }
    const text = String(candidate).trim();
    if (text !== '') {
      return candidate;
    }
  }
  return '';
};

function parseApiCallPayload(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    const apiCall = parsed?.apiCall && typeof parsed.apiCall === 'object' ? parsed.apiCall : parsed;
    return apiCall && typeof apiCall === 'object' ? apiCall : {};
  } catch (_) {
    return {};
  }
}

function toPrettyJsonString(value, fallback = '{}') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch (_) {
      return trimmed;
    }
  }
  if (value == null) return fallback;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return fallback;
  }
}

function readCaptureEditPayloadFromModal() {
  const queryText = String(apiWorkspaceCaptureEditQuery?.value || '{}').trim();
  const bodyText = String(apiWorkspaceCaptureEditBody?.value || '{}').trim();
  const headersText = String(apiWorkspaceCaptureEditHeaders?.value || '{}').trim();
  const mode = String(apiWorkspaceCaptureEditMode?.value || 'auto').trim() || 'auto';
  const method = String(apiWorkspaceCaptureEditMethod?.value || 'GET').trim().toUpperCase() || 'GET';
  const url = String(apiWorkspaceCaptureEditUrl?.value || '').trim();
  return JSON.stringify({
    protocol: 'rest',
    mode,
    apiCall: {
      method,
      url,
      query: queryText,
      body: bodyText,
      headers: headersText,
    },
  });
}

function openCaptureEditModalFromEntry(entry) {
  if (!entry || !apiWorkspaceCaptureEditModal) return;
  const value = buildApiStepFromCaptureEntry(entry);
  const payload = parseApiCallPayload(value);
  const dynamicFieldCount = Number(getDynamicFieldCountForCaptureEntry?.(entry) || 0);
  captureEditDraft = { entry };

  if (apiWorkspaceCaptureEditMethod) {
    apiWorkspaceCaptureEditMethod.value = String(payload.method || 'GET').toUpperCase();
  }
  if (apiWorkspaceCaptureEditUrl) {
    apiWorkspaceCaptureEditUrl.value = String(payload.url || '');
  }
  if (apiWorkspaceCaptureEditMode) {
    apiWorkspaceCaptureEditMode.value = String(payload.mode || 'auto');
  }
  if (apiWorkspaceCaptureEditQuery) {
    apiWorkspaceCaptureEditQuery.value = toPrettyJsonString(payload.query, '{}');
  }
  if (apiWorkspaceCaptureEditBody) {
    apiWorkspaceCaptureEditBody.value = toPrettyJsonString(payload.body, '{}');
  }
  if (apiWorkspaceCaptureEditHeaders) {
    apiWorkspaceCaptureEditHeaders.value = toPrettyJsonString(payload.headers, '{"Accept":"application/json"}');
  }
  if (apiWorkspaceCaptureEditStatus) {
    apiWorkspaceCaptureEditStatus.textContent = dynamicFieldCount > 0
      ? `Dynamic fields detected (${dynamicFieldCount}). Edit request payload, then replay or save.`
      : 'Edit request payload, then replay or save.';
  }

  const instance = bootstrap.Modal.getOrCreateInstance
    ? bootstrap.Modal.getOrCreateInstance(apiWorkspaceCaptureEditModal)
    : new bootstrap.Modal(apiWorkspaceCaptureEditModal);
  instance.show();
}

function initCaptureEditModalActions() {
  if (!apiWorkspaceCaptureEditModal) return;

  apiWorkspaceCaptureEditReplayBtn?.addEventListener('click', () => {
    const payload = readCaptureEditPayloadFromModal();
    populateApiWorkspaceFromApiCallValue(payload);
    setApiWorkspaceStatus('Replaying edited captured request...');
    resetApiCallResult();
    manualRunnerModule?.setExecutionSource?.('api');
    express.testExecute('', 'apiCall', payload, '');
    if (apiWorkspaceCaptureEditStatus) {
      apiWorkspaceCaptureEditStatus.textContent = 'Replayed request. Check response/assertions panel.';
    }
  });

  apiWorkspaceCaptureEditSaveBtn?.addEventListener('click', () => {
    const payload = readCaptureEditPayloadFromModal();
    testKeyword.value = 'apiCall';
    testValue.value = payload;
    testLocator.value = '';
    populateApiWorkspaceFromApiCallValue(payload);
    setApiWorkspaceStatus('Edited payload saved as API step.');
    if (apiWorkspaceCaptureEditStatus) {
      apiWorkspaceCaptureEditStatus.textContent = 'Saved as API step draft.';
    }
  });

  apiWorkspaceCaptureEditOpenAdvancedBtn?.addEventListener('click', () => {
    const payload = readCaptureEditPayloadFromModal();
    populateApiWorkspaceFromApiCallValue(payload);
    setApiWorkspaceViewMode('advanced');
    if (apiWorkspaceCaptureEditModal) {
      const instance = bootstrap.Modal.getOrCreateInstance
        ? bootstrap.Modal.getOrCreateInstance(apiWorkspaceCaptureEditModal)
        : new bootstrap.Modal(apiWorkspaceCaptureEditModal);
      instance.hide();
    }
    setApiWorkspaceStatus('Opened in advanced view with edited payload.');
  });
}

function setApiWorkspaceViewMode(mode = 'basic') {
  const normalized = mode === 'advanced' ? 'advanced' : 'basic';
  apiWorkspace?.classList?.toggle('api-workspace-advanced-mode', normalized === 'advanced');
  if (apiWorkspaceViewToggleBtn) {
    apiWorkspaceViewToggleBtn.textContent = normalized === 'advanced' ? 'Basic View' : 'Advanced View';
    apiWorkspaceViewToggleBtn.classList.toggle('btn-primary', normalized === 'advanced');
    apiWorkspaceViewToggleBtn.classList.toggle('btn-outline-secondary', normalized !== 'advanced');
  }
}

function syncApiWorkspaceGuideState(browserRunning, captureRunning) {
  const basicCards = [
    apiWorkspaceBasicBrowserBtn,
    apiWorkspaceBasicLoginBtn,
    apiWorkspaceBasicCaptureBtn,
  ].filter(Boolean);
  const advancedCards = [
    apiWorkspaceLaunchBrowserBtn,
    apiWorkspaceSessionLoginBtn,
    apiWorkspaceStartCaptureBtn,
  ].filter(Boolean);

  basicCards.forEach(card => card.classList.remove('api-basic-card-guide'));
  advancedCards.forEach(card => card.classList.remove('api-session-guide-active'));

  apiWorkspaceLaunchBrowserBtn?.classList.toggle('api-session-guide-complete', !!browserRunning);
  apiWorkspaceStartCaptureBtn?.classList.toggle('api-session-guide-recording', !!captureRunning);

  if (captureRunning) {
    return;
  }

  if (!browserRunning) {
    const stepIndex = apiWorkspaceGuideStep % 3;
    basicCards[stepIndex]?.classList.add('api-basic-card-guide');
    advancedCards[stepIndex]?.classList.add('api-session-guide-active');
    return;
  }

  apiWorkspaceBasicCaptureBtn?.classList.add('api-basic-card-guide');
  apiWorkspaceStartCaptureBtn?.classList.add('api-session-guide-active');
}

function syncApiWorkspaceBasicCardState() {
  const browserRunning = /close browser/i.test(String(apiWorkspaceLaunchBrowserBtn?.textContent || ''));
  const captureRunning = /stop (capture|recording)/i.test(String(apiWorkspaceStartCaptureBtn?.textContent || ''));

  if (apiWorkspaceBasicBrowserText) {
    apiWorkspaceBasicBrowserText.textContent = browserRunning ? 'Close Browser' : 'Start Browser';
  }
  if (apiWorkspaceBasicBrowserDot) {
    apiWorkspaceBasicBrowserDot.classList.toggle('api-basic-dot-active', browserRunning);
  }
  if (apiWorkspaceBasicBrowserBtn) {
    apiWorkspaceBasicBrowserBtn.classList.toggle('api-basic-card-filled', browserRunning);
  }

  if (apiWorkspaceBasicCaptureText) {
    apiWorkspaceBasicCaptureText.textContent = captureRunning ? 'Stop Recording' : 'Start Recording';
  }
  if (apiWorkspaceBasicCaptureDot) {
    apiWorkspaceBasicCaptureDot.classList.toggle('api-basic-dot-rec', captureRunning);
  }
  if (apiWorkspaceBasicCaptureBtn) {
    apiWorkspaceBasicCaptureBtn.classList.toggle('api-basic-card-primary', captureRunning);
  }
  syncApiWorkspaceGuideState(browserRunning, captureRunning);
}

function syncApiWorkspaceBasicFromAdvanced() {
  if (apiWorkspaceBasicCaptureStatus && apiWorkspaceCaptureStatus) {
    apiWorkspaceBasicCaptureStatus.textContent = apiWorkspaceCaptureStatus.textContent || 'Capture inactive';
  }
  if (apiWorkspaceBasicCaptureList && apiWorkspaceCaptureList) {
    apiWorkspaceBasicCaptureList.innerHTML = apiWorkspaceCaptureList.innerHTML || '<div class="text-slate-400">No captured requests yet.</div>';
  }
  if (apiWorkspaceBasicResponseMeta && apiWorkspaceResponseMeta) {
    apiWorkspaceBasicResponseMeta.textContent = apiWorkspaceResponseMeta.textContent || 'No API response yet.';
  }
  if (apiWorkspaceBasicResponseBadge && apiWorkspaceResponseBadge) {
    apiWorkspaceBasicResponseBadge.className = apiWorkspaceResponseBadge.className;
    apiWorkspaceBasicResponseBadge.textContent = apiWorkspaceResponseBadge.textContent || 'Idle';
  }
  if (apiWorkspaceBasicResponseContent && apiWorkspaceResponseContent) {
    apiWorkspaceBasicResponseContent.textContent = apiWorkspaceResponseContent.textContent || 'No response yet.';
  }
  if (apiWorkspaceBasicAssertionResultsPanel && apiWorkspaceAssertionResultsPanel) {
    apiWorkspaceBasicAssertionResultsPanel.innerHTML = apiWorkspaceAssertionResultsPanel.innerHTML || '';
  }
  if (apiWorkspaceBasicAssertionSummary && apiWorkspaceAssertionSummary) {
    apiWorkspaceBasicAssertionSummary.textContent =
      apiWorkspaceAssertionSummary.textContent || 'Results appear under the Assertions tab after you run them.';
  }
  if (apiWorkspaceBasicAssertionsInput && apiWorkspaceAssertionsInput) {
    apiWorkspaceBasicAssertionsInput.value = apiWorkspaceAssertionsInput.value || '';
  }
  if (apiWorkspaceBasicCaptureTypeFilter && apiWorkspaceCaptureTypeFilter) {
    apiWorkspaceBasicCaptureTypeFilter.value = apiWorkspaceCaptureTypeFilter.value || 'xhr_fetch';
  }
  const activeAdvancedTabRaw = apiWorkspaceTabButtons.find(btn => btn.classList.contains('active'))?.getAttribute('data-tab') || 'json';
  const activeAdvancedTab = activeAdvancedTabRaw === 'automation' ? 'json' : activeAdvancedTabRaw;
  apiWorkspaceBasicTabButtons.forEach(tabBtn => {
    tabBtn.classList.toggle('active', tabBtn.getAttribute('data-tab') === activeAdvancedTab);
  });
  const showAssertions = activeAdvancedTab === 'assertions';
  if (apiWorkspaceBasicResponseContent) {
    apiWorkspaceBasicResponseContent.classList.toggle('d-none', showAssertions);
  }
  if (apiWorkspaceBasicAssertionResultsPanel) {
    apiWorkspaceBasicAssertionResultsPanel.classList.toggle('d-none', !showAssertions);
    if (showAssertions && !String(apiWorkspaceBasicAssertionResultsPanel.innerHTML || '').trim()) {
      apiWorkspaceBasicAssertionResultsPanel.innerHTML =
        '<div class="rounded border border-slate-200 dark:!border-slate-700 bg-slate-50 dark:!bg-slate-950 p-3 text-xs text-slate-500 dark:text-slate-400">Run Assertions to view results.</div>';
    }
  }
  syncApiWorkspaceBasicCardState();
}

function initApiWorkspaceBasicUi() {
  if (!apiWorkspaceBasicView || !apiWorkspaceAdvancedView) return;

  apiWorkspaceViewToggleBtn?.addEventListener('click', () => {
    const currentlyAdvanced = apiWorkspace?.classList?.contains('api-workspace-advanced-mode');
    setApiWorkspaceViewMode(currentlyAdvanced ? 'basic' : 'advanced');
    syncApiWorkspaceBasicFromAdvanced();
  });

  apiWorkspaceBasicBrowserBtn?.addEventListener('click', () => {
    apiWorkspaceLaunchBrowserBtn?.click();
  });

  apiWorkspaceBasicCaptureBtn?.addEventListener('click', () => {
    apiWorkspaceStartCaptureBtn?.click();
  });

  apiWorkspaceBasicRunAssertionsBtn?.addEventListener('click', () => {
    if (apiWorkspaceAssertionsInput && apiWorkspaceBasicAssertionsInput) {
      apiWorkspaceAssertionsInput.value = apiWorkspaceBasicAssertionsInput.value || '';
    }
    const advancedAssertionsTabBtn = apiWorkspaceTabButtons.find(btn => (btn.getAttribute('data-tab') || '') === 'assertions');
    advancedAssertionsTabBtn?.click();
    if (apiWorkspaceBasicAssertionResultsPanel) {
      apiWorkspaceBasicAssertionResultsPanel.classList.remove('d-none');
      apiWorkspaceBasicAssertionResultsPanel.innerHTML =
        '<div class="rounded border border-sky-200 dark:!border-sky-700 bg-sky-50 dark:!bg-sky-900/20 p-3 text-xs text-sky-700 dark:text-sky-300">Running assertions...</div>';
    }
    if (apiWorkspaceBasicAssertionSummary) {
      apiWorkspaceBasicAssertionSummary.textContent = 'Running assertions...';
    }
    apiWorkspaceRunAssertionsBtn?.click();
    syncApiWorkspaceBasicFromAdvanced();
  });

  apiWorkspaceBasicAssertionsInput?.addEventListener('input', () => {
    if (apiWorkspaceAssertionsInput) {
      apiWorkspaceAssertionsInput.value = apiWorkspaceBasicAssertionsInput.value || '';
    }
  });

  apiWorkspaceBasicCaptureTypeFilter?.addEventListener('change', () => {
    if (!apiWorkspaceCaptureTypeFilter) return;
    apiWorkspaceCaptureTypeFilter.value = apiWorkspaceBasicCaptureTypeFilter.value;
    apiWorkspaceCaptureTypeFilter.dispatchEvent(new Event('change'));
  });

  apiWorkspaceBasicTabButtons.forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tab = tabBtn.getAttribute('data-tab') || 'json';
      const advancedTabBtn = apiWorkspaceTabButtons.find(btn => (btn.getAttribute('data-tab') || 'json') === tab);
      advancedTabBtn?.click();
      syncApiWorkspaceBasicFromAdvanced();
    });
  });

  apiWorkspaceBasicCaptureList?.addEventListener('click', event => {
    const useBtn = event.target?.closest?.('.useNetworkCaptureBtn');
    const replayBtn = event.target?.closest?.('.replayNetworkCaptureBtn');
    const editBtn = event.target?.closest?.('.editNetworkCaptureBtn');
    const deleteBtn = event.target?.closest?.('.deleteNetworkCaptureBtn');
    const sourceBtn = useBtn || replayBtn || editBtn || deleteBtn;
    if (!sourceBtn) return;
    const index = sourceBtn.getAttribute('data-entry-index');
    if (index == null) return;
    const advancedSelector = useBtn
      ? `.useNetworkCaptureBtn[data-entry-index="${index}"]`
      : replayBtn
        ? `.replayNetworkCaptureBtn[data-entry-index="${index}"]`
        : editBtn
          ? `.editNetworkCaptureBtn[data-entry-index="${index}"]`
          : `.deleteNetworkCaptureBtn[data-entry-index="${index}"]`;
    const advancedBtn = apiWorkspaceCaptureList?.querySelector?.(advancedSelector);
    advancedBtn?.click();
    syncApiWorkspaceBasicFromAdvanced();
  });

  const observeTarget = (target, options = { childList: true, subtree: true, characterData: true, attributes: true }) => {
    if (!target) return;
    const observer = new MutationObserver(() => syncApiWorkspaceBasicFromAdvanced());
    observer.observe(target, options);
  };

  observeTarget(apiWorkspaceCaptureList);
  observeTarget(apiWorkspaceCaptureStatus);
  observeTarget(apiWorkspaceResponseMeta);
  observeTarget(apiWorkspaceResponseBadge);
  observeTarget(apiWorkspaceResponseContent);
  observeTarget(apiWorkspaceAssertionResultsPanel);
  observeTarget(apiWorkspaceAssertionSummary);
  const buttonTextObserverOptions = { childList: true, subtree: true, characterData: true };
  observeTarget(apiWorkspaceStartCaptureBtn, buttonTextObserverOptions);
  observeTarget(apiWorkspaceLaunchBrowserBtn, buttonTextObserverOptions);

  setInterval(() => {
    apiWorkspaceGuideStep = (apiWorkspaceGuideStep + 1) % 3;
    syncApiWorkspaceBasicCardState();
  }, 1000);

  setApiWorkspaceViewMode('basic');
  syncApiWorkspaceBasicFromAdvanced();
}

syncNetworkCaptureExpansion();
workspaceModeModule.init();
networkCaptureModule.init();
manualRunnerModule.init();
advancedSpyWorkspaceModule.init();
browserSessionController.init();
reExecuteFlowModule.init();
serverDeviceControlsModule.init();
queueWorkerSetupModule.init();
initApiWorkspaceBasicUi();
initCaptureEditModalActions();
workspaceModeModule.setWorkspaceMode('runner');
setApiWorkspaceStatus('Browser inactive - Capture inactive - No response yet');

express.getReExecuteSettings?.().then(settings => {
  if (reExecuteCheckbox) {
    reExecuteCheckbox.checked = !!settings?.reExecuteOnFail;
  }
  express.isReExecute(!!reExecuteCheckbox?.checked);
}).catch(() => {
  express.isReExecute(!!reExecuteCheckbox?.checked);
});
reExecuteCheckbox.addEventListener('change', () =>
  express.isReExecute(reExecuteCheckbox.checked),
);
let test = false;


pauseBtn.addEventListener('click', () => {
  const hasRows = tableBody?.rows?.length > 0 || hasExecutionRows;
  if (!hasRows || !automationRunning) {
    alert('No test is running.');
    return;
  }
  express.pauseExecution();
  automationRunning = true;
  setExecutionControlState('paused');
});

stopExecutionBtn.addEventListener('click', async () => {
  const hasRows = tableBody?.rows?.length > 0 || hasExecutionRows;
  if (!hasRows && !automationRunning) {
    alert('No test is running.');
    return;
  }
  try {
    const result = await express.stopExecution?.();
    const message = String(result?.message || '').trim();
    if (message) {
      console.log('[runner-stop]', message);
    }
  } catch (error) {
    console.log('stop execution failed', error?.message || error);
    alert('Unable to stop the active execution.');
  } finally {
    automationRunning = false;
    setExecutionControlState('idle');
  }
});

resumeBtn.addEventListener('click', () => {
  const hasRows = tableBody?.rows?.length > 0 || hasExecutionRows;
  if (!hasRows || !automationRunning) {
    alert('No test is running.');
    return;
  }
  express.resumeExecution();
  automationRunning = true;
  setExecutionControlState('running');
});

express.testRunnerStepData((event, { runner, currentRunner }) => {
  if (!runner || !Array.isArray(runner) || currentRunner === undefined || currentRunner === null || !runner[currentRunner]) {
    tableBody.innerHTML = '';
    hasExecutionRows = false;
    automationRunning = false;
    setExecutionControlState('idle');
    return;
  }
  console.log(!runner , currentRunner , runner[currentRunner]?.steps?.length === 0)
  try {
    // console.log({runner}, { currentRunner }, { 'runner[currentRunner]': runner[currentRunner] }, { 'runner[currentRunner].steps': runner[currentRunner]?.steps })
    if (runner?.[currentRunner]?.steps?.length === 0)
      return;
    // receiving step data implies a run is active
    automationRunning = true;
    const hasExecutingStep = runner[currentRunner].steps.some(s => s.execution === execution.EXECUTING);
    const hasFailedStep = runner[currentRunner].steps.some(s => s.execution === execution.FAILED);
    setExecutionControlState(hasExecutingStep ? 'running' : (hasFailedStep ? 'decision' : 'paused'));
    const progressEl = document.querySelector('#stepProgress');
    if (progressEl) {
      const totalSteps = runner[currentRunner].steps.filter(s => s.actual_step).length;
      const currentIdx = runner[currentRunner].steps.findIndex(s => s.execution === execution.EXECUTING);
      if (currentIdx >= 0 && totalSteps > 0) {
        progressEl.textContent = `${currentIdx + 1} of ${totalSteps}`;
        progressEl.classList.remove('hidden');
      } else {
        progressEl.textContent = '';
        progressEl.classList.add('hidden');
      }
    }
    const rows = runner[currentRunner].steps.reduce((acc, step, i) => {
      if (!step.actual_step) return acc;
      const tr = document.createElement('tr');
      tr.setAttribute('scope', 'row');
      tr.classList.add('bg-white', 'border-b', 'border-gray-200', 'hover:bg-gray-100' , "dark:!bg-neutral-900" , "dark:!text-slate-400");

      const descTd = document.createElement('td');
      descTd.innerText = `${i + 1}- ${step.description}`;
      tdColor(descTd, step);
      descTd.classList.add('px-6', 'py-1');

      const keywordTd = document.createElement('td');
      const keywordName = resolveStepKeyword(step);
      keywordTd.innerText = keywordName;
      tdColor(keywordTd, step);
      keywordTd.classList.add('px-6', 'py-1');

      const valueTd = document.createElement('td');
      valueTd.innerText = step.value;
      tdColor(valueTd, step);
      valueTd.classList.add('px-6', 'py-1', "max-w-[400px]");

      const xpathTd = document.createElement('td');
      xpathTd.innerText = step.xPath;
      tdColor(xpathTd, step);
      xpathTd.classList.add('px-6', 'py-1');

      const actionTd = document.createElement('td');
      tdColor(actionTd, step);
      actionTd.classList.add('px-6', 'py-1');
      

      tr.appendChild(descTd);
      tr.appendChild(keywordTd);
      tr.appendChild(valueTd);
      tr.appendChild(xpathTd);
      tr.appendChild(actionTd);

      return [...acc, tr];
    }, []);
    const table = document
      .getElementById('myTable')
      .getElementsByTagName('tbody')[0];
    table.innerHTML = null;
    rows.forEach(row => table.append(row));
    hasExecutionRows = rows.length > 0;
    // console.log(event, runner)
  } catch (error) {
    const table = document
      .getElementById('myTable')
      .getElementsByTagName('tbody')[0];
    table.innerHTML = null;
    hasExecutionRows = false;
    console.log(error);
  }
});

const tdColor = (td, step) => {
  // Apply styles based on execution state (enterprise status colors)
  if (step.execution === execution.NOT_EXECUTED) {
    td.style.backgroundColor = '#1e293b';
    td.style.color = '#94a3b8';
  }

  if (step.execution === execution.EXECUTING) {
    // Add a flag to ensure we scroll only once
   
      // Apply styles for the executing step
      td.classList.add('rounded-0');
      td.style.backgroundColor = '#2563eb';
      td.style.color = '#ffffff';

      setTimeout(() => {
        td.scrollIntoView({
          behavior: 'smooth',   
          block: 'center',      
          inline: 'nearest'
        });
      }, 100);  
    
  }

  if (step.execution === execution.EXECUTED) {
    td.classList.add('rounded-0');
    td.style.backgroundColor = '#14532d';
    td.style.color = '#86efac';
    td.style.minWidth = '300px';
  }

  if (step.execution === execution.FAILED) {
    td.style.backgroundColor = '#7f1d1d';
    td.style.color = '#fecaca';
  }
};



express.openReExecuteDataModal((event, data) => {
  if (!data || !data.step) {
    reExecuteFlowModule.clearPendingState({ clearFields: true });
    reExecuteFlowModule.dismissReExecuteModal({ clearFields: true });
    return;
  }
  automationRunning = true;
  setExecutionControlState('decision');
  reExecuteFlowModule.showForStep(data.step);
});

express.noActiveTest((_event, data) => {
  automationRunning = false;
  if (tableBody) {
    tableBody.innerHTML = '';
  }
  hasExecutionRows = false;
  setExecutionControlState('idle');
  reExecuteFlowModule.clearPendingState({ clearFields: true });
  const message = data?.message || 'No active test is running.';
  alert(message);
});

express.emailSandboxRuntimeStatus?.((_event, payload) => {
  if (!emailSandboxStatusPanel || !emailSandboxStatusBadge || !emailSandboxStatusText) return;
  emailSandboxStatusPanel.classList.remove('hidden');

  const phase = String(payload?.phase || '').trim();
  const status = String(payload?.status || '').trim() || 'info';
  const runReference = String(payload?.run_reference || '').trim();
  const runtimeAlias = String(payload?.runtime_alias || '').trim();
  const snapshotId = String(payload?.snapshot_id || '').trim();
  const outputKeys = payload?.outputs && typeof payload.outputs === 'object'
    ? Object.keys(payload.outputs)
    : [];

  emailSandboxStatusBadge.className = 'badge';
  if (status === 'ok' || status === 'passed') {
    emailSandboxStatusBadge.classList.add('bg-success');
  } else if (status === 'failed' || status === 'error') {
    emailSandboxStatusBadge.classList.add('bg-danger');
  } else if (status === 'running') {
    emailSandboxStatusBadge.classList.add('bg-primary');
  } else {
    emailSandboxStatusBadge.classList.add('bg-secondary');
  }
  emailSandboxStatusBadge.textContent = status.toUpperCase();

  if (phase === 'issue_alias_started') {
    emailSandboxStatusText.textContent = 'Issuing runtime alias...';
    return;
  }
  if (phase === 'issue_alias_done') {
    emailSandboxStatusText.textContent = runtimeAlias
      ? `Runtime alias ready: ${runtimeAlias}${runReference ? ` (run: ${runReference})` : ''}`
      : 'Runtime alias issued.';
    return;
  }
  if (phase === 'wait_extract_started') {
    emailSandboxStatusText.textContent = 'Waiting for matching email and extracting outputs...';
    return;
  }
  if (phase === 'wait_extract_done') {
    const keyText = outputKeys.length ? outputKeys.join(', ') : 'none';
    emailSandboxStatusText.textContent = `Extract complete. Snapshot: ${snapshotId || 'n/a'} - Output keys: ${keyText}`;
    return;
  }
  if (phase === 'wait_extract_failed') {
    emailSandboxStatusText.textContent = String(payload?.error || 'Email extract failed.');
    return;
  }

  emailSandboxStatusText.textContent = 'Email sandbox helper update received.';
});

express.recoveryPrompt?.(async (_event, journal) => {
  const shouldResume = window.confirm(
    'An unfinished test execution was found. Resume from the last saved step?',
  );
  if (shouldResume) {
    await express.decideRecovery?.({ action: 'resume' });
    return;
  }
  await express.decideRecovery?.({ action: 'discard' });
});

const keywordArr = [
  {
    id: 1,
    name: 'Click',
    value: 'click',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2023-03-28T14:38:45.000000Z',
    updated_at: '2023-03-28T14:38:45.000000Z',
    keyword_combination_names: null,
  },

  {
    id: 5,
    name: 'Send Keys',
    value: 'sendKeys',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2023-03-28T14:38:45.000000Z',
    updated_at: '2023-03-28T14:38:45.000000Z',
    keyword_combination_names: null,
  },

  {
    id: 29,
    name: 'Exist',
    value: 'exist',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2023-03-28T14:38:45.000000Z',
    updated_at: '2023-03-28T14:38:45.000000Z',
    keyword_combination_names: null,
  },

  {
    id: 71,
    name: 'Alert Accept',
    value: 'alertAccept',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2023-04-10T14:40:51.000000Z',
    updated_at: '2023-04-10T14:40:51.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 72,
    name: 'Alert Dismiss',
    value: 'alertDismiss',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2023-04-10T14:40:51.000000Z',
    updated_at: '2023-04-10T14:40:51.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 73,
    name: 'Alert Set Text',
    value: 'alertSetText',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2023-04-10T14:40:51.000000Z',
    updated_at: '2023-04-10T14:40:51.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 1200,
    name: 'Close Browser',
    value: 'closeBrowser',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2025-01-01T00:00:00.000000Z',
    updated_at: '2025-01-01T00:00:00.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 1201,
    name: 'Launch Debug Browser',
    value: 'launchDebugBrowser',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2026-07-29T00:00:00.000000Z',
    updated_at: '2026-07-29T00:00:00.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 1202,
    name: 'Connect Browser',
    value: 'connectBrowser',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2026-07-29T00:00:00.000000Z',
    updated_at: '2026-07-29T00:00:00.000000Z',
    keyword_combination_names: null,
  },

  {
    id: 102,
    name: 'Validate Element',
    value: 'validateElement',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-02T18:26:36.000000Z',
    updated_at: '2024-03-02T18:26:36.000000Z',
    keyword_combination_names: null,
  },

  {
    id: 107,
    name: 'Get Element Value',
    value: 'getElementValue',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 108,
    name: 'Scroll To Text',
    value: 'scrollToText',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 110,
    name: 'Scroll To Element',
    value: 'scrollToElement',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 111,
    name: 'Digital Signature',
    value: 'digitalSignature',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 112,
    name: 'Hover Element',
    value: 'hoverElement',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 113,
    name: 'Switch To Iframe',
    value: 'switchToIframe',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 1131,
    name: 'Switch To DOM',
    value: 'switchToDom',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2026-03-16T00:00:00.000000Z',
    updated_at: '2026-03-16T00:00:00.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 114,
    name: 'Switch Browser',
    value: 'switchBrowser',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 115,
    name: 'Right Click',
    value: 'rightClick',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 116,
    name: 'Double Click',
    value: 'doubleClick',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 117,
    name: 'select',
    value: 'select',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 118,
    name: 'Connect PDF',
    value: 'connectPDF',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 119,
    name: 'Verify PDF Text',
    value: 'verifyPDFText',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 120,
    name: 'Disconnect PDF',
    value: '  disconnectPDF',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 121,
    name: 'Delete PDF File',
    value: 'deletePDFFile',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 122,
    name: 'Get Cookie Value',
    value: 'getCookieValue',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 123,
    name: 'Remove Cookie',
    value: 'removeCookie',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 124,
    name: 'Verify Text On Alert',
    value: 'verifyTextOnAlert',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 125,
    name: 'Drag Drop',
    value: 'dragDrop',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 126,
    name: 'Get DB Value',
    value: 'getDBValue',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 127,
    name: 'Execute SQL',
    value: 'executeSQL',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 1280,
    name: 'API Call',
    value: 'apiCall',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2026-03-11T00:00:00.000000Z',
    updated_at: '2026-03-11T00:00:00.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 1281,
    name: 'Issue Alias',
    value: 'issueAlias',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2026-04-29T00:00:00.000000Z',
    updated_at: '2026-04-29T00:00:00.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 1282,
    name: 'Wait Alias Email',
    value: 'waitAliasEmail',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2026-04-29T00:00:00.000000Z',
    updated_at: '2026-04-29T00:00:00.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 128,
    name: 'Select All',
    value: 'selectAll',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 129,
    name: 'Clear Input',
    value: 'clearInput',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 130,
    name: 'Mobile Open App',
    value: 'mobileOpenApp',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 131,
    name: 'Mobile Tap',
    value: 'mobileTap',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 132,
    name: 'Mobile Double Tap',
    value: 'mobileDoubleTap',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 133,
    name: 'Mobile Long Press',
    value: 'mobileLongPress',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 134,
    name: 'Mobile Fill',
    value: 'mobileFll',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 135,
    name: 'Mobile Back',
    value: 'mobileBack',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },

  {
    id: 136,
    name: 'Mobile Swipe',
    value: 'mobileSwipe',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 137,
    name: 'Mobile Scroll To Text',
    value: 'mobileScrollToText',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 138,
    name: 'Mobile Element Exist',
    value: 'mobileElementExist',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 139,
    name: 'Mobile Element Not Exist',
    value: 'mobileElementNotExist',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 140,
    name: 'Mobile Element Validate',
    value: 'mobileElementValidate',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 141,
    name: 'Mobile Hide Keyboard',
    value: 'mobileHideKeyboard',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 142,
    name: 'Mobile Digital Signature',
    value: 'mobileDigitalSignature',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 143,
    name: 'Mobile Pinch',
    value: 'mobilePinch',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
  {
    id: 144,
    name: 'Mobile Switch Context',
    value: 'mobileSwitchContext',
    client_id: null,
    keyword_combination_ids: null,
    created_at: '2024-03-09T14:44:49.000000Z',
    updated_at: '2024-03-09T14:44:49.000000Z',
    keyword_combination_names: null,
  },
];

keywordArr.forEach(k => {
  const option = document.createElement('option');
  option.value = k.value;
  option.textContent = k.name;
  const optionClone = option.cloneNode(true);
  testKeyword.append(option);
  reExecuteModalKeyword.append(optionClone);
});

const setLaunchButtonState = running => browserSessionController.setLaunchButtonState(running);

spyWorkspaceModule = window.createSpyWorkspaceModule({
  elements: {
    captureXpath,
    spyIndicator,
    testLocator,
    testValue,
    testOutput,
    xpathRecorderBtn,
  },
  express,
  setLaunchButtonState,
});
spyWorkspaceModule.init();

apiWorkspaceRunBtn?.addEventListener('click', () => {
  const rawUrlInput = String(apiWorkspaceUrl?.value || '').trim();
  if (!rawUrlInput) {
    setApiWorkspaceStatus('Enter an API URL before running.');
    return;
  }
  if (looksLikeApiCallValue(rawUrlInput)) {
    populateApiWorkspaceFromApiCallValue(rawUrlInput);
  }
  const url = String(apiWorkspaceUrl?.value || '').trim();
  if (!url) {
    setApiWorkspaceStatus('The apiCall value could not be parsed into a valid URL.');
    return;
  }
  const payload = buildApiCallValueFromWorkspace();
  resetApiCallResult();
  manualRunnerModule.setExecutionSource('api');
  express.testExecute('', 'apiCall', payload, '');
});

apiWorkspaceReportBtn?.addEventListener('click', () => {
  const modalEl = document.querySelector('#apiWorkspaceReportModal');
  if (!modalEl) return;
  syncApiWorkspaceReport();
  const instance = bootstrap.Modal.getOrCreateInstance
    ? bootstrap.Modal.getOrCreateInstance(modalEl)
    : new bootstrap.Modal(modalEl);
  instance.show();
});

apiWorkspaceResetBtn?.addEventListener('click', () => {
  networkCaptureModule.resetCapture();
});

  window.addEventListener('beforeunload', () => {
    if (spyWorkspaceModule.isRecording()) {
      spyWorkspaceModule.stopSpyInspectionSync({ notifyRemote: false });
    }
  express.stopNetworkCapture?.();
  express.closeTestBrowser();
  setLaunchButtonState(false);
});


// Splash handling
const splashEl = document.getElementById('qaf-splash');
const splashBar = document.getElementById('qaf-progress-bar');
const hideSplash = () => {
  if (!splashEl) return;
  splashEl.classList.remove('active');
  splashEl.style.opacity = '0';
  splashEl.style.pointerEvents = 'none';
  setTimeout(() => {
    if (splashEl && splashEl.parentNode) splashEl.parentNode.removeChild(splashEl);
  }, 260);
};
const showSplash = () => {
  if (!splashEl) return;
  splashEl.classList.add('active');
};
const setSplashProgress = pct => {
  if (!splashBar) return;
  splashBar.style.animation = 'none';
  splashBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
};
// Show immediately, hide shortly after load to avoid blocking UI
showSplash();
window.addEventListener('load', () => {
  setSplashProgress(90);
  setTimeout(() => {
    setSplashProgress(100);
    hideSplash();
  }, 500);
});

clearLogBtn.addEventListener('click', () => {
  tableBody.innerHTML = '';
});

express.testExecuteOutput((event, { output }) => {
  testOutput.value = output;
  const executionSource = manualRunnerModule.getExecutionSource();
  const keyword = executionSource === 'api'
    ? 'apicall'
    : manualRunnerModule.getSelectedManualKeyword();
  if (keyword === 'apicall') {
    latestApiCallOutput = output;
    const assertionsValue = executionSource === 'api'
      ? apiWorkspaceAssertionsInput?.value || ''
      : testExpectedOutput?.value || '';
    renderApiCallResult(output, assertionsValue, { evaluateAssertions: false });
    syncApiWorkspaceView();
    syncApiWorkspaceReport();
    if (executionSource === 'api') {
      workspaceModeModule.setWorkspaceMode('api');
    }
  } else {
    resetApiCallResult();
  }
});

apiWorkspaceTabButtons.forEach(button => {
  button.addEventListener('click', () => {
    activeApiWorkspaceTab = button.getAttribute('data-tab') || 'json';
    apiWorkspaceTabButtons.forEach(tabButton => tabButton.classList.toggle('active', tabButton === button));
    const apiResult = parseManualApiCallOutput(latestApiCallOutput || testOutput.value || '');
    renderApiWorkspaceActiveTab(apiResult, latestApiWorkspaceAssertions);
  });
});

apiWorkspaceRunAssertionsBtn?.addEventListener('click', () => {
  if (!latestApiCallOutput && !testOutput.value) {
    return;
  }
  activeApiWorkspaceTab = 'assertions';
  apiWorkspaceTabButtons.forEach(tabButton =>
    tabButton.classList.toggle('active', tabButton.getAttribute('data-tab') === 'assertions'),
  );
  runAssertions(apiWorkspaceAssertionsInput?.value || '');
});






// Action feedback is presentation-only; helper outcomes never set test-step status.
let activeHelperWaitId = null;
let activeStripAction = null;
let helperFailureCount = 0;
let latestHelperFailure = '';
express.automationHelperWaiting((_event, payload) => {
  const strip = document.getElementById('automationWaitStrip');
  const label = document.getElementById('automationWaitText');
  const failure = document.getElementById('automationHelperFailure');
  if (!strip || !label || !failure) return;
  const phaseLabel = phase => phase === 'before' ? 'Before helper' : phase === 'after' ? 'After helper' : 'Main action';
  const actionLabel = action => 'Step ' + action.stepNumber + ' | ' + phaseLabel(action.phase) + ': ' + action.keyword;
  const show = text => {
    label.textContent = text;
    label.title = text;
    failure.textContent = latestHelperFailure + (helperFailureCount > 1 ? ' | ' + helperFailureCount + ' helper failures' : '');
    failure.title = failure.textContent;
    failure.hidden = !helperFailureCount;
    strip.hidden = false;
  };
  if (payload.reason === 'reset' || payload.reason === 'action_step_started') {
    activeHelperWaitId = null;
    activeStripAction = null;
    helperFailureCount = 0;
    latestHelperFailure = '';
    label.textContent = '';
    failure.textContent = '';
    failure.hidden = true;
    strip.hidden = true;
    return;
  }
  if (payload.reason === 'action_started') {
    activeHelperWaitId = null;
    activeStripAction = payload;
    show(actionLabel(payload) + ' | Running');
  } else if (payload.reason === 'action_passed' || payload.reason === 'action_failed') {
    activeHelperWaitId = null;
    activeStripAction = payload;
    const failed = payload.reason === 'action_failed';
    if (failed && payload.phase !== 'main') {
      helperFailureCount += 1;
      latestHelperFailure = phaseLabel(payload.phase) + ': ' + payload.keyword + ' | Failed: ' + payload.error;
    }
    show(actionLabel(payload) + (failed ? ' | Failed: ' + payload.error : ' | Passed'));
  } else if (payload.reason === 'helper_waiting') {
    activeHelperWaitId = payload.id;
    const isTextWait = payload.keyword === 'waitfortext';
    const details = [
      activeStripAction ? actionLabel(activeStripAction) : 'Waiting: ' + (isTextWait ? 'waitForText' : 'waitForElement'),
      isTextWait ? 'Text: ' + JSON.stringify(payload.text || '') : 'Element: ' + (payload.target || ''),
      'State: ' + payload.state,
      'Max timeout: ' + payload.timeout + ' ms',
    ];
    if (isTextWait && payload.scope) details.push('Scope: ' + payload.scope);
    if (isTextWait && payload.match) details.push('Match: ' + payload.match);
    show(details.join(' | '));
  } else if (payload.reason === 'helper_waiting_done' && payload.id === activeHelperWaitId) {
    activeHelperWaitId = null;
    if (!activeStripAction) {
      strip.hidden = true;
      label.textContent = '';
    }
  }
});

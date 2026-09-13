const { PDFDocument } = require('pdf-lib');
const axios = require('axios');
const fsSync = require('fs');
const fs = require('fs').promises;
const os = require('os');
const pdfParse = require('pdf-parse'); // Make sure this line is present
const path = require('path');
const { execFile, spawn } = require('child_process');
// Module-level variable to store PDF text
let pdfText = null;
//const mysql = require('mysql');
const mysql = require('mysql2/promise'); // Use mysql2/promise for async/await support

const {
    Builder,
    Browser,
    By,
    Key,
    until,
    Select,
} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const edge = require('selenium-webdriver/edge');
const { table } = require('console');
const { injectXPathRecorderHooksScript, injectAdvancedSpyHooksScript } = require('./spyHookScripts');
const {
    parseApiCallValue,
    safeParseJsonSegment,
    validateApiCallContract,
} = require('../../utils/apiCallContract');
const { isLikelyXml, validateXmlSafety } = require('./xmlSafety');

// Track all Selenium drivers started by WebActions so we can close them all on demand.
const activeWebDrivers = new Set();
let lastWebActionsInstance = null;
const clearLastWebActionsInstance = () => {
    lastWebActionsInstance = null;
};
const STATIC_CAPTURE_EXTENSIONS = [
    '.js', '.mjs', '.css', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
    '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.mp3', '.wav',
];
const NOISE_CAPTURE_HOST_PATTERNS = [
    /(^|\\.)google\\./i,
    /(^|\\.)gstatic\\.com$/i,
    /(^|\\.)googletagmanager\\.com$/i,
    /(^|\\.)google-analytics\\.com$/i,
    /(^|\\.)doubleclick\\.net$/i,
    /(^|\\.)facebook\\.com$/i,
    /(^|\\.)facebook\\.net$/i,
];
const BUSINESS_CAPTURE_PATH_HINTS = ['/api/', '/graphql', '/rest/', '/service/', '/v1/', '/v2/'];
const removeActiveWebDriver = driverRef => {
    if (!driverRef) return;
    try {
        activeWebDrivers.delete(driverRef);
    } catch (_) {}
};
const isIgnorableDriverShutdownError = err => {
    const message = String(err?.message || err || '');
    const name = String(err?.name || '');
    return (
        name === 'NoSuchSessionError' ||
        message.includes('NoSuchSessionError') ||
        message.includes('ECONNREFUSED') ||
        message.includes('invalid session ID') ||
        message.includes('This driver instance does not have a valid session ID')
    );
};
const quitWithTimeout = async (driverRef, ms = 5000) => {
    if (!driverRef) return false;
    let completed = false;
    try {
        await Promise.race([
            driverRef.quit(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`quit timeout after ${ms}ms`)), ms),
            ),
        ]);
        completed = true;
    } catch (err) {
        if (!isIgnorableDriverShutdownError(err)) {
            console.log('driver quit timeout/err (ignored)', err?.message || err);
        }
        try { await driverRef.close(); } catch (_) {}
    } finally {
        removeActiveWebDriver(driverRef);
    }
    return completed;
};
const resetRecorderGlobals = () => {
    return {
        setupScript: function () {
            const cleanupDoc = doc => {
                if (!doc) return;
                const win = doc.defaultView;
                if (!win) return;
                win.__qaRecorderActive = false;
                if (win.__qaRecorderMouseMove && win.__qaRecorderHandlersAttached) {
                    doc.removeEventListener('mousemove', win.__qaRecorderMouseMove, true);
                }
                if (win.__qaRecorderMouseLeave && win.__qaRecorderHandlersAttached) {
                    doc.removeEventListener('mouseleave', win.__qaRecorderMouseLeave, true);
                }
                if (win.__qaRecorderClick && win.__qaRecorderHandlersAttached) {
                    doc.removeEventListener('click', win.__qaRecorderClick, true);
                }
                win.__qaRecorderHandlersAttached = false;
                if (win.__qaRecorderLastEl) {
                    win.__qaRecorderLastEl.style.outline = win.__qaRecorderLastOutline || '';
                    win.__qaRecorderLastEl = null;
                    win.__qaRecorderLastOutline = null;
                }
                win.__qaRecorderQueue = [];
                const frames = Array.from(doc.querySelectorAll('iframe, frame'));
                frames.forEach(frame => {
                    try {
                        cleanupDoc(frame.contentDocument);
                    } catch (_) {
                        // ignore cross-origin/unavailable child frames
                    }
                });
            };
            cleanupDoc(document);
        },
    };
};

const safeParseJson = (raw, fallback = {}) => safeParseJsonSegment(raw, fallback);

const splitTopLevelSegments = (rawValue, delimiter) => {
    const value = String(rawValue || '');
    const segments = [];
    let current = '';
    let quote = '';
    let bracketDepth = 0;
    let parenDepth = 0;
    let braceDepth = 0;

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        const next = value.slice(index, index + delimiter.length);

        if (quote) {
            current += char;
            if (char === quote && value[index - 1] !== '\\') {
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }

        if (char === '[') bracketDepth += 1;
        if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        if (char === '(') parenDepth += 1;
        if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        if (char === '{') braceDepth += 1;
        if (char === '}') braceDepth = Math.max(0, braceDepth - 1);

        if (
            delimiter.length > 0 &&
            next === delimiter &&
            bracketDepth === 0 &&
            parenDepth === 0 &&
            braceDepth === 0
        ) {
            segments.push(current.trim());
            current = '';
            index += delimiter.length - 1;
            continue;
        }

        current += char;
    }

    segments.push(current.trim());
    return segments.filter(Boolean);
};

const splitHelperValueParts = rawValue => splitTopLevelSegments(rawValue, '>>');

const parseNamedHelperValue = rawValue => {
    const parts = splitHelperValueParts(rawValue);
    const entries = [];
    for (const part of parts) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex <= 0) {
            entries.push({ key: '', value: part });
            continue;
        }
        entries.push({
            key: part.slice(0, separatorIndex).trim().toLowerCase(),
            value: part.slice(separatorIndex + 1).trim(),
        });
    }
    return entries;
};

const helperHasNamedLocatorOption = (step, allowedKeys) => {
    const keys = new Set(
        parseNamedHelperValue(step?.value)
            .map(entry => entry.key)
            .filter(Boolean),
    );
    return allowedKeys.some(key => keys.has(key));
};

const helperUsesOwnLocator = step => {
    const keywordName = String(step?.keyword?.name || step?.keyword || '').trim().toLowerCase();

    if (keywordName === 'waitforelement' || keywordName === 'waitfortext') {
        return helperHasNamedLocatorOption(step, ['target', 'scope', 'xpath']);
    }

    if (keywordName === 'sendkey') {
        return helperHasNamedLocatorOption(step, ['locator']);
    }

    if (keywordName === 'switchtoiframe') {
        return String(step?.value || '').trim().length > 0;
    }

    return false;
};

const applyExplicitTargetIndex = (target, explicitTargetIndex) => {
    const normalizedTarget = String(target || '').trim();
    if (!normalizedTarget) {
        return normalizedTarget;
    }

    const normalizedIndex = Number(explicitTargetIndex);
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) {
        return normalizedTarget;
    }

    if (/\[\d+\]$/.test(normalizedTarget)) {
        return normalizedTarget;
    }

    return `${normalizedTarget}[${normalizedIndex}]`;
};

const resolveSendKeyConfig = step => {
    const entries = parseNamedHelperValue(step?.value);
    const config = {
        action: '',
        target: String(step?.xPath || '').trim(),
    };

    for (const entry of entries) {
        if (!entry.key) {
            if (!config.action) {
                config.action = entry.value.toLowerCase().replace(/^:+/, '');
            }
            continue;
        }

        if (['locator', 'target', 'scope', 'xpath'].includes(entry.key) && entry.value.trim()) {
            config.target = entry.value.trim();
        }
    }

    return config;
};

const normalizeDebugBrowserName = value => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'chrome';
    if (normalized.includes('edg') || normalized.includes('microsoft edge') || normalized.includes('msedge')) return 'edge';
    if (normalized.includes('chrome') || normalized.includes('chromium')) return 'chrome';
    if (['chrome', 'google chrome', 'chromium'].includes(normalized)) return 'chrome';
    if (['edge', 'microsoft edge', 'msedge'].includes(normalized)) return 'edge';
    return normalized;
};

const inferDebugBrowserName = metadata => {
    const browserText = String(metadata?.Browser || metadata?.browser || '').toLowerCase();
    if (browserText.includes('edg')) return 'edge';
    if (browserText.includes('chrome')) return 'chrome';
    return '';
};

const resolveDebugBrowserConfig = (step, options = {}) => {
    const entries = parseNamedHelperValue(step?.value);
    const config = {
        browser: 'chrome',
        port: 9222,
        userDataDir: '',
        implicitWait: 10000,
    };

    for (const entry of entries) {
        if (!entry.key) {
            if (/^\d+$/.test(entry.value)) {
                config.port = Number(entry.value);
            } else if (entry.value) {
                const parsedBrowser = normalizeDebugBrowserName(entry.value);
                if (['chrome', 'edge'].includes(parsedBrowser) || !options.ignoreUnknownPositionalBrowser) {
                    config.browser = parsedBrowser;
                }
            }
            continue;
        }

        switch (entry.key) {
            case 'browser':
            case 'name':
                config.browser = normalizeDebugBrowserName(entry.value);
                break;
            case 'port': {
                const parsedPort = Number(entry.value);
                if (Number.isFinite(parsedPort) && parsedPort > 0) {
                    config.port = parsedPort;
                }
                break;
            }
            case 'profile':
            case 'userdatadir':
                config.userDataDir = entry.value.trim();
                break;
            case 'implicitwait':
            case 'timeout': {
                const parsedWait = Number(entry.value);
                if (Number.isFinite(parsedWait) && parsedWait > 0) {
                    config.implicitWait = parsedWait;
                }
                break;
            }
            default:
                throw new Error(`Unknown debug browser option: ${entry.key}`);
        }
    }

    return config;
};

const resolveDebugBrowserExecutable = browser => {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const candidatesByBrowser = {
        chrome: [
            process.env.CHROME_BIN,
            path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ],
        edge: [
            process.env.EDGE_BIN,
            path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ],
    };

    for (const candidate of candidatesByBrowser[browser] || []) {
        const trimmed = String(candidate || '').trim();
        if (!trimmed) continue;
        try {
            if (fsSync.existsSync(trimmed)) {
                return trimmed;
            }
        } catch (_) {}
    }

    return '';
};

const resolveDebugBrowserProfileDir = config => {
    if (config.userDataDir) {
        return config.userDataDir;
    }

    return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'QAFastTrack',
        'BrowserDebugProfiles',
        `${config.browser}-${config.port}`,
    );
};

const queryDebugBrowserMetadata = async port => {
    try {
        const response = await axios.get(`http://127.0.0.1:${port}/json/version`, {
            timeout: 1500,
            validateStatus: status => status >= 200 && status < 500,
        });
        return response.status === 200 && response.data && typeof response.data === 'object'
            ? response.data
            : null;
    } catch (_) {
        return null;
    }
};

const waitForDebugBrowserMetadata = async (port, timeoutMs = 10000) => {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
        const metadata = await queryDebugBrowserMetadata(port);
        if (metadata) {
            return metadata;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return null;
};

const normalizeDebugBrowserLabel = browser => {
    if (browser === 'edge') return 'Edge';
    if (browser === 'chrome') return 'Chrome';
    return String(browser || 'unknown');
};

const runPowerShellJson = command => new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, (error, stdout) => {
        if (error) {
            resolve(null);
            return;
        }
        const output = String(stdout || '').trim();
        if (!output) {
            resolve(null);
            return;
        }
        try {
            resolve(JSON.parse(output));
        } catch (_) {
            resolve(null);
        }
    });
});

const getDebugBrowserProcessOnPort = async port => {
    if (process.platform !== 'win32') return null;
    const safePort = Number(port);
    if (!Number.isFinite(safePort) || safePort <= 0) return null;

    const command = [
        `$port=${safePort};`,
        "$owner=(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess);",
        "if ($owner) {",
        "Get-CimInstance Win32_Process -Filter \"ProcessId=$owner\" |",
        "Where-Object { $_.Name -match '^(chrome|msedge)\\.exe$' } |",
        "Select-Object -First 1 ProcessId,Name,ExecutablePath,CommandLine |",
        "ConvertTo-Json -Compress",
        "}",
    ].join(' ');
    const result = await runPowerShellJson(command);
    return result && !Array.isArray(result) ? result : null;
};

const isQafOwnedDebugProcess = processInfo => {
    const commandLine = String(processInfo?.CommandLine || '').toLowerCase();
    return (
        commandLine.includes('--remote-debugging-port=') &&
        (
            commandLine.includes('\\qafasttrack\\browserdebugprofiles\\') ||
            commandLine.includes('/qafasttrack/browserdebugprofiles/') ||
            commandLine.includes('dcdudebug-')
        )
    );
};

const killProcessTree = processId => new Promise((resolve, reject) => {
    const pid = Number(processId);
    if (!Number.isFinite(pid) || pid <= 0) {
        reject(new Error('Invalid process id for debug browser cleanup.'));
        return;
    }
    execFile('taskkill.exe', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }, error => {
        if (error) {
            reject(error);
            return;
        }
        resolve(true);
    });
});

const waitForDebugPortToClear = async (port, timeoutMs = 5000) => {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
        const metadata = await queryDebugBrowserMetadata(port);
        if (!metadata) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
};

const normalizeWhitespace = value => String(value || '').replace(/\s+/g, ' ').trim();

const resolveWaitForElementConfig = step => {
    const entries = parseNamedHelperValue(step?.value);
    const config = {
        state: '',
        timeout: 10000,
        target: String(step?.xPath || '').trim(),
    };

    for (const entry of entries) {
        if (!entry.key) {
            config.state = entry.value.toLowerCase();
            continue;
        }

        switch (entry.key) {
            case 'state':
                config.state = entry.value.toLowerCase();
                break;
            case 'timeout': {
                const parsedTimeout = Number(entry.value);
                if (!Number.isNaN(parsedTimeout) && parsedTimeout > 0) {
                    config.timeout = parsedTimeout;
                }
                break;
            }
            case 'target':
            case 'scope':
            case 'xpath':
                config.target = entry.value;
                break;
            default:
                throw new Error(`Unknown waitForElement option: ${entry.key}`);
        }
    }

    return config;
};

const resolveWaitForTextConfig = step => {
    const entries = parseNamedHelperValue(step?.value);
    const config = {
        text: '',
        scope: '',
        match: 'contains',
        timeout: 10000,
    };

    for (const entry of entries) {
        if (!entry.key) {
            config.text = entry.value;
            continue;
        }

        switch (entry.key) {
            case 'text':
                config.text = entry.value;
                break;
            case 'scope':
            case 'target':
            case 'xpath':
                config.scope = entry.value;
                break;
            case 'match':
                config.match = entry.value.toLowerCase();
                break;
            case 'timeout': {
                const parsedTimeout = Number(entry.value);
                if (!Number.isNaN(parsedTimeout) && parsedTimeout > 0) {
                    config.timeout = parsedTimeout;
                }
                break;
            }
            default:
                throw new Error(`Unknown waitForText option: ${entry.key}`);
        }
    }

    return config;
};

const resolveInFunctionWaitConfig = rawValue => {
    const entries = parseNamedHelperValue(rawValue);
    const config = {
        delayMs: 0,
    };

    for (const entry of entries) {
        if (!entry.key) {
            continue;
        }

        switch (entry.key) {
            case 'setinfuncwait':
            case 'infuncwait':
            case 'wait': {
                const rawDelay = String(entry.value || '').trim().replace(/^:+/, '');
                const parsedDelay = Number(rawDelay);
                if (Number.isFinite(parsedDelay) && parsedDelay > 0) {
                    config.delayMs = parsedDelay;
                }
                break;
            }
            default:
                break;
        }
    }

    return config;
};

const resolvePrimaryHelperValue = rawValue => {
    const entries = parseNamedHelperValue(rawValue);
    const positional = entries.find(entry => !entry.key);
    if (positional) {
        return positional.value;
    }

    return String(rawValue || '').trim();
};

const resolveSelectConfig = rawValue => {
    const entries = parseNamedHelperValue(rawValue);
    const config = {
        method: 'text',
        value: '',
    };

    for (const entry of entries) {
        if (!entry.key) {
            config.value = entry.value;
            continue;
        }

        switch (entry.key) {
            case 'text':
            case 'value':
            case 'index':
            case 'multiple':
                config.method = entry.key;
                config.value = entry.value;
                break;
            case 'setinfuncwait':
            case 'infuncwait':
            case 'wait':
                break;
            default:
                break;
        }
    }

    return config;
};

const selectMultipleByVisibleText = async (select, rawValue) => {
    const values = String(rawValue || '')
        .split('>>')
        .map(value => value.trim())
        .filter(Boolean);

    if (!values.length) {
        throw new Error('Multi-select requires at least one option value.');
    }

    if (!await select.isMultiple()) {
        throw new Error('Select method "multiple" requires a native multi-select element.');
    }

    for (const value of values) {
        await select.selectByVisibleText(value);
    }
};

const resolveRequestedToggleState = rawValue => {
    const normalized = String(resolvePrimaryHelperValue(rawValue) || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (['on', 'true', 'yes', '1', 'selected'].includes(normalized)) {
        return true;
    }

    if (['off', 'false', 'no', '0', 'unselected'].includes(normalized)) {
        return false;
    }

    return null;
};

const buildResolvedUrl = (baseUrl, requestUrl, query = {}) => {
    const targetUrl = new URL(requestUrl, baseUrl);
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            return;
        }
        targetUrl.searchParams.set(key, String(value));
    });
    return targetUrl;
};

const normalizeRequestHeaders = headers => {
    if (!headers || typeof headers !== 'object') {
        return {};
    }
    return { ...headers };
};

const buildRequestBody = ({ method, headers, body }) => {
    if (['GET', 'HEAD'].includes(String(method || '').toUpperCase())) {
        return undefined;
    }

    const contentTypeKey = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    const contentType = contentTypeKey ? String(headers[contentTypeKey]).toLowerCase() : '';

    if (!contentTypeKey) {
        headers['Content-Type'] = 'application/json';
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
        if (typeof body === 'string') {
            return body;
        }
        if (body && typeof body === 'object') {
            return new URLSearchParams(
                Object.entries(body).map(([key, value]) => [key, value == null ? '' : String(value)])
            ).toString();
        }
        return String(body ?? '');
    }

    if (contentType.includes('application/json') || !contentType) {
        return typeof body === 'string' ? body : JSON.stringify(body ?? {});
    }

    if (typeof body === 'string') {
        return body;
    }

    return JSON.stringify(body ?? {});
};

const detectSoapResponse = ({ protocol = '', headers = {}, body = '' }) => {
    const contentType = String(getHeaderValue(headers || {}, 'content-type') || '').toLowerCase();
    const normalizedProtocol = String(protocol || '').trim().toLowerCase();
    const bodyText = String(body || '');
    return (
        normalizedProtocol === 'soap' ||
        contentType.includes('text/xml') ||
        contentType.includes('application/soap+xml') ||
        isLikelyXml(bodyText)
    );
};

const parseSoapFault = bodyText => {
    const body = String(bodyText || '');
    const faultTagMatch = body.match(/<([a-zA-Z0-9_-]+:)?Fault\b[\s\S]*?<\/([a-zA-Z0-9_-]+:)?Fault>/i);
    if (!faultTagMatch) {
        return {
            present: false,
            code: '',
            string: '',
            actor: '',
            detail: '',
        };
    }

    const extractTagText = tagName => {
        const match = body.match(new RegExp(`<([a-zA-Z0-9_-]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/([a-zA-Z0-9_-]+:)?${tagName}>`, 'i'));
        return String(match?.[2] || '').replace(/\s+/g, ' ').trim();
    };

    return {
        present: true,
        code: extractTagText('faultcode'),
        string: extractTagText('faultstring'),
        actor: extractTagText('faultactor'),
        detail: extractTagText('detail'),
    };
};

const enrichApiResponseWithSoapDiagnostics = (response, protocol = '') => {
    if (!response || typeof response !== 'object') return response;
    const body = String(response.body || '');
    const isSoap = detectSoapResponse({
        protocol,
        headers: response.headers || {},
        body,
    });
    if (!isSoap) {
        return {
            ...response,
            protocol: String(protocol || response.protocol || 'rest').toLowerCase() === 'soap' ? 'soap' : 'rest',
            soapFault: false,
        };
    }

    const fault = parseSoapFault(body);
    return {
        ...response,
        protocol: 'soap',
        soapFault: !!fault.present,
        soapFaultCode: fault.code || '',
        soapFaultString: fault.string || '',
        soapFaultActor: fault.actor || '',
        soapFaultDetail: fault.detail || '',
        diagnostics: fault.present ? 'SOAP_FAULT_DETECTED' : '',
    };
};

const getHeaderValue = (headers, headerName) => {
    const matchKey = Object.keys(headers || {}).find(
        key => String(key || '').toLowerCase() === String(headerName || '').toLowerCase(),
    );
    return matchKey ? headers[matchKey] : undefined;
};

class WebActions {
    driver = null;
    visibleOnlyLookup = false;
    recorderActive = false;
    recorderSyncTimer = null;
    recorderFetchInFlight = false;
    recorderSyncInFlight = false;
    recorderLastFetchAt = 0;
    recorderLifecycleSeq = 0;
    recorderRunId = 0;
    recorderDeferredCleanupTimer = null;
    recorderLifecycleChain = Promise.resolve();
    recorderLifecycleBusy = false;
    highlightEnabled = false;
    networkCaptureEnabled = false;
    networkCaptureEntries = [];
    networkCaptureRemovedSignatures = new Set();
    observedAuthByOrigin = {};
    networkCaptureLayerBSupported = null;
    networkCaptureLayerBInFlight = new Map();
    networkCaptureLayerBSeen = new Set();

    setHighlightEnabled(enabled) {
        this.highlightEnabled = !!enabled;
    }

    getVisibleOnlyLookup() {
        return this.visibleOnlyLookup === true;
    }

    setVisibleOnlyLookup(enabled) {
        this.visibleOnlyLookup = enabled === true;
    }

    async visible() {
        this.visibleOnlyLookup = true;
        return 'Visible-only lookup enabled for current step.';
    }

    async ensureNetworkCaptureHooks() {
        await this.ensureSessionOrThrow();
        await this.driver.executeScript(() => {
            if (window.__qaNetworkCaptureInstalled) {
                return;
            }

            window.__qaNetworkCaptureInstalled = true;
            window.__qaNetworkCaptureEnabled = true;
            window.__qaNetworkCaptureQueue = window.__qaNetworkCaptureQueue || [];
            window.__qaNetworkCaptureMaxBody = 4000;

            const truncate = (value) => {
                const text =
                    typeof value === 'string'
                        ? value
                        : value == null
                            ? ''
                            : (() => {
                                  try {
                                      return JSON.stringify(value);
                                  } catch (_) {
                                      return String(value);
                                  }
                              })();
                return text.length > window.__qaNetworkCaptureMaxBody
                    ? `${text.slice(0, window.__qaNetworkCaptureMaxBody)}...[truncated]`
                    : text;
            };

            const enqueue = (entry) => {
                if (!window.__qaNetworkCaptureEnabled) {
                    return;
                }
                window.__qaNetworkCaptureQueue.push({
                    ...entry,
                    capturedAt: new Date().toISOString(),
                });
            };

            const originalFetch = window.fetch.bind(window);
            window.fetch = async (...args) => {
                const startedAt = Date.now();
                const input = args[0];
                const init = args[1] || {};
                const url = typeof input === 'string' ? input : input?.url || '';
                const method = String(init?.method || input?.method || 'GET').toUpperCase();
                const requestBody = truncate(init?.body || '');
                const requestHeaders = (() => {
                    const rawHeaders = init?.headers || input?.headers;
                    if (!rawHeaders) return {};
                    if (rawHeaders instanceof Headers) {
                        const mapped = {};
                        rawHeaders.forEach((value, key) => {
                            mapped[key] = value;
                        });
                        return mapped;
                    }
                    if (Array.isArray(rawHeaders)) {
                        return Object.fromEntries(rawHeaders);
                    }
                    if (typeof rawHeaders === 'object') {
                        return { ...rawHeaders };
                    }
                    return {};
                })();
                try {
                    const response = await originalFetch(...args);
                    let responseBody = '';
                    const responseHeaders = {};
                    try {
                        const clone = response.clone();
                        responseBody = truncate(await clone.text());
                    } catch (_) {}
                    try {
                        response.headers.forEach((value, key) => {
                            responseHeaders[key] = value;
                        });
                    } catch (_) {}
                    enqueue({
                        transport: 'fetch',
                        method,
                        url,
                        status: response.status,
                        statusText: response.statusText,
                        ok: response.ok,
                        durationMs: Date.now() - startedAt,
                        requestBody,
                        responseBody,
                        requestHeaders,
                        responseHeaders,
                    });
                    return response;
                } catch (error) {
                    enqueue({
                        transport: 'fetch',
                        method,
                        url,
                        status: 0,
                        statusText: 'CLIENT_ERROR',
                        ok: false,
                        durationMs: Date.now() - startedAt,
                        requestBody,
                        responseBody: '',
                        requestHeaders,
                        responseHeaders: {},
                        error: error?.message || String(error),
                    });
                    throw error;
                }
            };

            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;
            const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                this.__qaCapture = {
                    method: String(method || 'GET').toUpperCase(),
                    url: String(url || ''),
                    headers: {},
                    startedAt: 0,
                    requestBody: '',
                };
                return originalOpen.call(this, method, url, ...rest);
            };

            XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                if (this.__qaCapture) {
                    this.__qaCapture.headers[name] = value;
                }
                return originalSetRequestHeader.call(this, name, value);
            };

            XMLHttpRequest.prototype.send = function(body) {
                if (this.__qaCapture) {
                    this.__qaCapture.startedAt = Date.now();
                    this.__qaCapture.requestBody = truncate(body || '');
                    this.addEventListener('loadend', () => {
                        const responseHeaders = {};
                        try {
                            String(this.getAllResponseHeaders() || '')
                                .trim()
                                .split(/[\r\n]+/)
                                .forEach((line) => {
                                    if (!line) return;
                                    const parts = line.split(': ');
                                    const header = parts.shift();
                                    if (!header) return;
                                    responseHeaders[header] = parts.join(': ');
                                });
                        } catch (_) {}
                        enqueue({
                            transport: 'xhr',
                            method: this.__qaCapture?.method || 'GET',
                            url: this.__qaCapture?.url || '',
                            status: this.status,
                            statusText: this.statusText,
                            ok: this.status >= 200 && this.status < 400,
                            durationMs: Date.now() - (this.__qaCapture?.startedAt || Date.now()),
                            requestBody: this.__qaCapture?.requestBody || '',
                            responseBody: truncate(this.responseText || ''),
                            requestHeaders: this.__qaCapture?.headers || {},
                            responseHeaders,
                        });
                    });
                }
                return originalSend.call(this, body);
            };
        });
    }

    async syncNetworkCaptureEntries() {
        await this.ensureSessionOrThrow();
        await this.syncNetworkCaptureLayerBEntries();
        const entries = await this.driver.executeScript(() => {
            const queue = Array.isArray(window.__qaNetworkCaptureQueue) ? [...window.__qaNetworkCaptureQueue] : [];
            window.__qaNetworkCaptureQueue = [];
            return queue;
        });
        if (Array.isArray(entries) && entries.length > 0) {
            const accepted = entries.filter(entry => this.shouldPersistCaptureEntry(entry));
            if (accepted.length > 0) {
                this.networkCaptureEntries.push(...accepted);
                this.indexObservedAuthEntries(accepted);
            }
        }
        return this.networkCaptureEntries;
    }

    isLayerBNetworkCaptureEnabled() {
        const flag = String(process.env.NETWORK_CAPTURE_LAYER_B || 'true').trim().toLowerCase();
        return !['0', 'false', 'off', 'no'].includes(flag);
    }

    getLayerBSeenKey(entry = {}) {
        const requestId = String(entry.requestId || '').trim();
        const method = String(entry.method || '').trim().toUpperCase();
        const url = String(entry.url || '').trim();
        const status = String(entry.status ?? '');
        if (!requestId || !method || !url) return '';
        return `${requestId}|${method}|${url}|${status}`;
    }

    finalizeLayerBEntry(base = {}, patch = {}) {
        const merged = {
            source: 'layer_b',
            transport: 'network',
            ...base,
            ...patch,
        };
        merged.method = String(merged.method || 'GET').toUpperCase();
        merged.url = String(merged.url || '');
        merged.status = Number(merged.status || 0);
        merged.ok = merged.status >= 200 && merged.status < 400;
        merged.requestHeaders = merged.requestHeaders && typeof merged.requestHeaders === 'object' ? merged.requestHeaders : {};
        merged.responseHeaders = merged.responseHeaders && typeof merged.responseHeaders === 'object' ? merged.responseHeaders : {};
        merged.requestBody = String(merged.requestBody || '');
        merged.responseBody = String(merged.responseBody || '');
        merged.capturedAt = merged.capturedAt || new Date().toISOString();
        return merged;
    }

    resolveCaptureEntryType(entry = {}) {
        const transport = String(entry?.transport || '').trim().toLowerCase();
        if (transport === 'xhr' || transport === 'fetch') return transport;
        const resourceType = String(entry?.resourceType || entry?.type || '').trim().toLowerCase();
        if (resourceType) return resourceType;
        return transport || 'other';
    }

    isStaticCapturePath(pathname = '') {
        const text = String(pathname || '').trim().toLowerCase();
        if (!text) return false;
        return STATIC_CAPTURE_EXTENSIONS.some(ext => text.endsWith(ext));
    }

    isNoiseCaptureHost(hostname = '') {
        const text = String(hostname || '').trim().toLowerCase();
        if (!text) return false;
        return NOISE_CAPTURE_HOST_PATTERNS.some(rx => rx.test(text));
    }

    isBusinessCapturePath(pathname = '') {
        const text = String(pathname || '').trim().toLowerCase();
        if (!text) return false;
        return BUSINESS_CAPTURE_PATH_HINTS.some(token => text.includes(token));
    }

    getCaptureHeader(headers = {}, headerName = '') {
        const target = String(headerName || '').trim().toLowerCase();
        if (!target || !headers || typeof headers !== 'object') return '';
        const key = Object.keys(headers).find(name => String(name || '').trim().toLowerCase() === target);
        return key ? String(headers[key] || '').trim() : '';
    }

    hasJsonCaptureSignal(entry = {}) {
        const requestHeaders = entry?.requestHeaders && typeof entry.requestHeaders === 'object' ? entry.requestHeaders : {};
        const responseHeaders = entry?.responseHeaders && typeof entry.responseHeaders === 'object' ? entry.responseHeaders : {};
        const requestContentType = this.getCaptureHeader(requestHeaders, 'content-type').toLowerCase();
        const requestAccept = this.getCaptureHeader(requestHeaders, 'accept').toLowerCase();
        const responseContentType = this.getCaptureHeader(responseHeaders, 'content-type').toLowerCase();
        if (requestContentType.includes('json')) return true;
        if (requestAccept.includes('json')) return true;
        if (responseContentType.includes('json')) return true;
        const responseBody = String(entry?.responseBody || '').trim();
        if (!responseBody) return false;
        if ((responseBody.startsWith('{') && responseBody.endsWith('}')) || (responseBody.startsWith('[') && responseBody.endsWith(']'))) {
            try {
                JSON.parse(responseBody);
                return true;
            } catch (_) {}
        }
        return false;
    }

    getCaptureEntrySignature(entry = {}) {
        const method = String(entry?.method || 'GET').trim().toUpperCase() || 'GET';
        const urlText = String(entry?.url || '').trim();
        if (!urlText) return '';
        try {
            const parsed = new URL(urlText);
            parsed.hash = '';
            return `${method} ${parsed.href}`;
        } catch (_) {
            return `${method} ${urlText}`;
        }
    }

    shouldPersistCaptureEntry(entry = {}) {
        const urlText = String(entry?.url || '').trim();
        if (!urlText) return false;
        const signature = this.getCaptureEntrySignature(entry);
        if (signature && this.networkCaptureRemovedSignatures.has(signature)) return false;
        let parsed = null;
        try {
            parsed = new URL(urlText);
        } catch (_) {
            return false;
        }
        if (this.isNoiseCaptureHost(parsed.hostname)) return false;
        if (this.isStaticCapturePath(parsed.pathname)) return false;

        const type = this.resolveCaptureEntryType(entry);
        const status = Number(entry?.status || 0);
        if (status >= 400 && !this.isBusinessCapturePath(parsed.pathname)) return false;
        if (type === 'xhr' || type === 'fetch') {
            if (this.isBusinessCapturePath(parsed.pathname)) return true;
            return this.hasJsonCaptureSignal(entry);
        }
        if (type === 'document' || type === 'other' || type === 'network') {
            return this.isBusinessCapturePath(parsed.pathname);
        }
        return false;
    }

    pushLayerBCaptureEntries(entries = []) {
        if (!Array.isArray(entries) || entries.length === 0) return;
        const accepted = [];
        for (const raw of entries) {
            const entry = this.finalizeLayerBEntry(raw);
            if (!entry.url) continue;
            if (!this.shouldPersistCaptureEntry(entry)) continue;
            const seenKey = this.getLayerBSeenKey(entry);
            if (seenKey && this.networkCaptureLayerBSeen.has(seenKey)) {
                continue;
            }
            if (seenKey) {
                this.networkCaptureLayerBSeen.add(seenKey);
            }
            accepted.push(entry);
        }
        if (accepted.length === 0) return;
        this.networkCaptureEntries.push(...accepted);
        this.indexObservedAuthEntries(accepted);
    }

    async primeLayerBNetworkCapture() {
        if (!this.isLayerBNetworkCaptureEnabled()) return false;
        await this.ensureSessionOrThrow();
        try {
            await this.driver.manage().logs().get('performance');
            this.networkCaptureLayerBSupported = true;
            return true;
        } catch (_) {
            this.networkCaptureLayerBSupported = false;
            return false;
        }
    }

    async syncNetworkCaptureLayerBEntries() {
        if (!this.isLayerBNetworkCaptureEnabled()) {
            return this.networkCaptureEntries;
        }
        if (this.networkCaptureLayerBSupported === false) {
            return this.networkCaptureEntries;
        }
        let perfLogs = [];
        try {
            perfLogs = await this.driver.manage().logs().get('performance');
            this.networkCaptureLayerBSupported = true;
        } catch (_) {
            this.networkCaptureLayerBSupported = false;
            return this.networkCaptureEntries;
        }
        if (!Array.isArray(perfLogs) || perfLogs.length === 0) {
            return this.networkCaptureEntries;
        }
        const completed = [];
        for (const item of perfLogs) {
            let event = null;
            try {
                event = JSON.parse(String(item?.message || '{}'))?.message || null;
            } catch (_) {}
            const method = String(event?.method || '');
            const params = event?.params || {};
            const requestId = String(params?.requestId || '').trim();
            if (!requestId) continue;

            if (method === 'Network.requestWillBeSent') {
                const existing = this.networkCaptureLayerBInFlight.get(requestId) || {};
                const request = params?.request || {};
                if (params?.redirectResponse && existing.url) {
                    const redirect = params.redirectResponse;
                    completed.push(this.finalizeLayerBEntry(existing, {
                        status: Number(redirect?.status || 302),
                        statusText: String(redirect?.statusText || 'REDIRECT'),
                        responseHeaders: redirect?.headers || {},
                        responseBody: '',
                        capturedAt: new Date().toISOString(),
                    }));
                }
                this.networkCaptureLayerBInFlight.set(requestId, {
                    requestId,
                    method: String(request?.method || existing.method || 'GET').toUpperCase(),
                    url: String(request?.url || existing.url || ''),
                    requestHeaders: request?.headers || existing.requestHeaders || {},
                    requestBody: existing.requestBody || '',
                    startedAtMono: Number(params?.timestamp || existing.startedAtMono || 0),
                    initiatedAt: new Date().toISOString(),
                });
                continue;
            }

            if (method === 'Network.responseReceived') {
                const inFlight = this.networkCaptureLayerBInFlight.get(requestId) || { requestId };
                const response = params?.response || {};
                this.networkCaptureLayerBInFlight.set(requestId, {
                    ...inFlight,
                    url: String(response?.url || inFlight.url || ''),
                    status: Number(response?.status || inFlight.status || 0),
                    statusText: String(response?.statusText || inFlight.statusText || ''),
                    responseHeaders: response?.headers || inFlight.responseHeaders || {},
                    mimeType: String(response?.mimeType || ''),
                    resourceType: String(params?.type || ''),
                    responseAtMono: Number(params?.timestamp || 0),
                });
                continue;
            }

            if (method === 'Network.loadingFailed') {
                const inFlight = this.networkCaptureLayerBInFlight.get(requestId);
                if (!inFlight) continue;
                completed.push(this.finalizeLayerBEntry(inFlight, {
                    status: Number(inFlight.status || 0),
                    statusText: String(params?.errorText || inFlight.statusText || 'LOADING_FAILED'),
                    responseBody: '',
                    capturedAt: new Date().toISOString(),
                    error: String(params?.errorText || ''),
                }));
                this.networkCaptureLayerBInFlight.delete(requestId);
                continue;
            }

            if (method === 'Network.loadingFinished') {
                const inFlight = this.networkCaptureLayerBInFlight.get(requestId);
                if (!inFlight) continue;
                const endMono = Number(params?.timestamp || 0);
                const startMono = Number(inFlight.startedAtMono || 0);
                const durationMs = Number.isFinite(endMono) && Number.isFinite(startMono) && endMono > startMono
                    ? Math.round((endMono - startMono) * 1000)
                    : undefined;
                completed.push(this.finalizeLayerBEntry(inFlight, {
                    durationMs,
                    responseBody: '',
                    capturedAt: new Date().toISOString(),
                }));
                this.networkCaptureLayerBInFlight.delete(requestId);
            }
        }
        this.pushLayerBCaptureEntries(completed);
        return this.networkCaptureEntries;
    }

    async startNetworkCapture() {
        await this.ensureNetworkCaptureHooks();
        await this.driver.executeScript(() => {
            window.__qaNetworkCaptureQueue = [];
            window.__qaNetworkCaptureEnabled = true;
        });
        this.networkCaptureEnabled = true;
        this.networkCaptureEntries = [];
        this.networkCaptureRemovedSignatures = new Set();
        this.observedAuthByOrigin = {};
        this.networkCaptureLayerBInFlight = new Map();
        this.networkCaptureLayerBSeen = new Set();
        await this.primeLayerBNetworkCapture();
        return { enabled: true };
    }

    async stopNetworkCapture() {
        if (await this.hasValidSession()) {
            try {
                await this.syncNetworkCaptureEntries();
                await this.driver.executeScript(() => {
                    window.__qaNetworkCaptureEnabled = false;
                });
            } catch (_) {}
        }
        this.networkCaptureEnabled = false;
        return { enabled: false, entries: this.networkCaptureEntries };
    }

    async getNetworkCaptureEntries() {
        if (this.networkCaptureEnabled && await this.hasValidSession()) {
            await this.syncNetworkCaptureEntries();
        }
        return this.networkCaptureEntries;
    }

    async removeNetworkCaptureEntriesMatching(entry = {}) {
        if (this.networkCaptureEnabled && await this.hasValidSession()) {
            try {
                await this.syncNetworkCaptureEntries();
            } catch (_) {}
        }
        const signature = this.getCaptureEntrySignature(entry);
        if (!signature) {
            return { entries: this.networkCaptureEntries, removed: 0 };
        }
        this.networkCaptureRemovedSignatures.add(signature);
        const beforeCount = Array.isArray(this.networkCaptureEntries) ? this.networkCaptureEntries.length : 0;
        this.networkCaptureEntries = (this.networkCaptureEntries || []).filter(
            item => this.getCaptureEntrySignature(item) !== signature,
        );
        const removed = beforeCount - this.networkCaptureEntries.length;
        return { entries: this.networkCaptureEntries, removed, signature };
    }

    async clearNetworkCapture() {
        if (await this.hasValidSession()) {
            try {
                await this.driver.executeScript(() => {
                    window.__qaNetworkCaptureQueue = [];
                    window.__qaNetworkCaptureEnabled = false;
                });
            } catch (_) {}
        }
        this.networkCaptureEnabled = false;
        this.networkCaptureEntries = [];
        this.networkCaptureRemovedSignatures = new Set();
        this.observedAuthByOrigin = {};
        this.networkCaptureLayerBInFlight = new Map();
        this.networkCaptureLayerBSeen = new Set();
        return { enabled: false, entries: [] };
    }

    indexObservedAuthEntries(entries = []) {
        for (const entry of entries) {
            if (!entry?.url || !entry?.requestHeaders || typeof entry.requestHeaders !== 'object') {
                continue;
            }
            let origin = '';
            try {
                origin = new URL(entry.url).origin;
            } catch (_) {
                continue;
            }
            if (!origin) {
                continue;
            }
            const resolvedHeaders = {};
            ['authorization', 'x-csrf-token', 'x-xsrf-token'].forEach(headerName => {
                const value = getHeaderValue(entry.requestHeaders, headerName);
                if (value) {
                    resolvedHeaders[headerName] = value;
                }
            });
            if (Object.keys(resolvedHeaders).length > 0) {
                this.observedAuthByOrigin[origin] = {
                    ...this.observedAuthByOrigin[origin],
                    ...resolvedHeaders,
                    capturedAt: entry.capturedAt || new Date().toISOString(),
                };
            }
        }
    }

    findCapturedAuthHeaders(targetUrl) {
        try {
            const targetOrigin = new URL(targetUrl).origin;
            if (this.observedAuthByOrigin[targetOrigin]) {
                const cachedHeaders = { ...this.observedAuthByOrigin[targetOrigin] };
                delete cachedHeaders.capturedAt;
                if (Object.keys(cachedHeaders).length > 0) {
                    return cachedHeaders;
                }
            }
            const authEntries = [...(this.networkCaptureEntries || [])].reverse();
            for (const entry of authEntries) {
                if (!entry?.url || !entry?.requestHeaders || typeof entry.requestHeaders !== 'object') {
                    continue;
                }
                let entryOrigin = '';
                try {
                    entryOrigin = new URL(entry.url, targetUrl).origin;
                } catch (_) {
                    continue;
                }
                if (entryOrigin !== targetOrigin) {
                    continue;
                }
                const capturedHeaders = {};
                ['authorization', 'x-csrf-token', 'x-xsrf-token'].forEach(headerName => {
                    const value = getHeaderValue(entry.requestHeaders, headerName);
                    if (value) {
                        capturedHeaders[headerName] = value;
                    }
                });
                if (Object.keys(capturedHeaders).length > 0) {
                    return capturedHeaders;
                }
            }
        } catch (_) {}
        return {};
    }

    async resolveRuntimeAuthHeaders(targetUrl) {
        const currentUrl = await this.driver.getCurrentUrl();
        const resolvedUrl = buildResolvedUrl(currentUrl, targetUrl);
        const capturedHeaders = this.findCapturedAuthHeaders(resolvedUrl.toString());
        const browserAuth = await this.driver.executeScript((urlToInspect, observedHeaders) => {
            const readStorageSnapshot = storage => {
                const snapshot = {};
                try {
                    if (!storage) return snapshot;
                    for (let i = 0; i < storage.length; i += 1) {
                        const key = storage.key(i);
                        snapshot[key] = storage.getItem(key);
                    }
                } catch (_) {
                    // SecurityError can happen on data: or restricted contexts.
                    return {};
                }
                return snapshot;
            };
            const readStorageSnapshotSafe = getStorage => {
                try {
                    return readStorageSnapshot(getStorage());
                } catch (_) {
                    // Accessing window.localStorage/sessionStorage itself can throw in restricted contexts.
                    return {};
                }
            };

            const tryParseJson = value => {
                if (typeof value !== 'string') return null;
                try {
                    return JSON.parse(value);
                } catch (_) {
                    return null;
                }
            };

            const looksLikeJwt = value =>
                typeof value === 'string' && /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(value);

            const extractToken = source => {
                if (source == null) return null;
                if (typeof source === 'string') {
                    const trimmed = source.trim();
                    if (!trimmed) return null;
                    if (/^bearer\s+/i.test(trimmed)) {
                        return trimmed.replace(/^bearer\s+/i, '').trim();
                    }
                    if (looksLikeJwt(trimmed)) {
                        return trimmed;
                    }
                    const parsed = tryParseJson(trimmed);
                    if (parsed) {
                        return extractToken(parsed);
                    }
                    return null;
                }
                if (Array.isArray(source)) {
                    for (const item of source) {
                        const found = extractToken(item);
                        if (found) return found;
                    }
                    return null;
                }
                if (typeof source === 'object') {
                    const preferredKeys = [
                        'access_token',
                        'accessToken',
                        'token',
                        'id_token',
                        'idToken',
                        'jwt',
                        'bearerToken',
                    ];
                    for (const key of preferredKeys) {
                        if (source[key]) {
                            const found = extractToken(source[key]);
                            if (found) return found;
                        }
                    }
                    for (const value of Object.values(source)) {
                        const found = extractToken(value);
                        if (found) return found;
                    }
                }
                return null;
            };

            const storages = [
                readStorageSnapshotSafe(() => window.localStorage),
                readStorageSnapshotSafe(() => window.sessionStorage),
            ];
            const extractPreferredTokenFromSnapshots = snapshots => {
                const preferredStorageKeys = [
                    'currentUser',
                    'current_user',
                    'authUser',
                    'auth_user',
                    'user',
                    'session',
                    'auth',
                ];

                for (const snapshot of snapshots) {
                    for (const storageKey of preferredStorageKeys) {
                        if (!Object.prototype.hasOwnProperty.call(snapshot, storageKey)) {
                            continue;
                        }
                        const found = extractToken(snapshot[storageKey]);
                        if (found) {
                            return { token: found, source: `storage:${storageKey}` };
                        }
                    }
                }

                for (const snapshot of snapshots) {
                    for (const [key, value] of Object.entries(snapshot)) {
                        const loweredKey = String(key || '').toLowerCase();
                        if (!/(token|auth|oauth|jwt|session|currentuser|current_user)/i.test(loweredKey)) {
                            continue;
                        }
                        const found = extractToken(value);
                        if (found) {
                            return { token: found, source: `storage:${key}` };
                        }
                    }
                }

                return { token: null, source: null };
            };

            const preferredToken = extractPreferredTokenFromSnapshots(storages);
            const bearerToken = preferredToken.token;

            const metaSelectors = [
                'meta[name="csrf-token"]',
                'meta[name="csrfToken"]',
                'meta[name="xsrf-token"]',
                'meta[name="x-csrf-token"]',
            ];
            let metaCsrf = null;
            for (const selector of metaSelectors) {
                const el = document.querySelector(selector);
                if (el?.content) {
                    metaCsrf = el.content;
                    break;
                }
            }

            const safeReadCookie = () => {
                try {
                    return String(document.cookie || '');
                } catch (_) {
                    // SecurityError can happen in data: or restricted contexts.
                    return '';
                }
            };

            const cookieMap = Object.fromEntries(
                safeReadCookie()
                    .split(';')
                    .map(part => part.trim())
                    .filter(Boolean)
                    .map(part => {
                        const [name, ...rest] = part.split('=');
                        return [name, rest.join('=')];
                    }),
            );

            const xsrfCookie =
                cookieMap['XSRF-TOKEN'] ||
                cookieMap['xsrf-token'] ||
                cookieMap['CSRF-TOKEN'] ||
                cookieMap['csrf-token'] ||
                null;

            const observed = observedHeaders || {};
            const response = {};
            let authModel = 'anonymous';

            if (observed.authorization) {
                response.Authorization = observed.authorization;
                authModel = 'observed_authorization';
            } else if (bearerToken) {
                response.Authorization = `Bearer ${bearerToken}`;
                authModel = preferredToken.source === 'storage:currentUser'
                    ? 'current_user_bearer'
                    : 'storage_bearer';
            }

            if (observed['x-xsrf-token']) {
                response['X-XSRF-TOKEN'] = observed['x-xsrf-token'];
                if (authModel === 'anonymous') authModel = 'observed_xsrf';
            } else if (observed['x-csrf-token']) {
                response['X-CSRF-TOKEN'] = observed['x-csrf-token'];
                if (authModel === 'anonymous') authModel = 'observed_csrf';
            } else if (metaCsrf) {
                response['X-CSRF-TOKEN'] = metaCsrf;
                if (authModel === 'anonymous') authModel = 'meta_csrf';
            } else if (xsrfCookie) {
                try {
                    response['X-XSRF-TOKEN'] = decodeURIComponent(xsrfCookie);
                } catch (_) {
                    response['X-XSRF-TOKEN'] = xsrfCookie;
                }
                if (authModel === 'anonymous') authModel = 'cookie_xsrf';
            }

            const hasLikelySessionCookie = Object.keys(cookieMap).some(name =>
                /(laravel_session|session|auth|jwt|access_token|refresh_token)/i.test(String(name || '')),
            );

            return {
                headers: response,
                authModel,
                hasLikelySessionCookie,
                source: preferredToken.source,
            };
        }, resolvedUrl.toString(), capturedHeaders);

        if (!browserAuth || typeof browserAuth !== 'object') {
            return {};
        }

        return browserAuth.headers && typeof browserAuth.headers === 'object'
            ? browserAuth.headers
            : {};
    }

    async hasValidSession() {
        if (!this.driver) return false;
        try {
            const session = await this.driver.getSession();
            return !!session?.getId?.() || !!session?.id_ || !!session?.id;
        } catch (err) {
            return false;
        }
    }

    async destroyTrackedDrivers() {
        const driversToClose = new Set(activeWebDrivers);
        if (this.driver) {
            driversToClose.add(this.driver);
        }
        if (driversToClose.size === 0) {
            this.driver = null;
            return;
        }
        for (const d of driversToClose) {
            await quitWithTimeout(d);
        }
        this.driver = null;
    }

    async ensureSessionOrThrow() {
        const ok = await this.hasValidSession();
        if (!ok) {
            throw new Error('WebDriver session is not active. Please launch the browser again.');
        }
    }

    async launchBrowser(step, implicitWait = 10000) {
        // Browser.CHROME
        // Browser.FIREFOX
        // Browser.EDGE
        // Browser.INTERNET_EXPLORER
        // Browser.SAFARI
       if (step?.forceCleanup) {
           await this.destroyTrackedDrivers();
        }
        const browserKey = typeof step?.value === 'string' ? step.value.trim().toUpperCase() : '';
        const browserName = Browser[browserKey] || (typeof step?.value === 'string' ? step.value.trim().toLowerCase() : '');
        if (!browserName) {
            const expected = Object.keys(Browser).join(', ');
            throw new Error(`Invalid browser value '${step?.value}'. Expected one of: ${expected}`);
        }
        console.log(`[launchBrowser] browser=${browserName}`);
        // ensure any prior recorder state/handlers are cleared before new session
        try {
           await this.driver?.executeScript(resetRecorderGlobals().setupScript);
        } catch (e) {}
        let builder = new Builder()
            .forBrowser(browserName)
            .setCapability('unhandledPromptBehavior', 'ignore');
        if (String(browserName).toLowerCase() === 'chrome') {
            builder = builder
                .setChromeOptions(
                    new chrome.Options().setPerfLoggingPrefs({
                        enableNetwork: true,
                        enablePage: true,
                    }),
                )
                .setCapability('goog:loggingPrefs', { performance: 'ALL', browser: 'ALL' });
        }
        this.driver = await builder.build();
       // console.log('[webActions] driver created');
        activeWebDrivers.add(this.driver);
        lastWebActionsInstance = this;
        this.driver.manage().window().minimize();
        // Add sleep to wait between minimize and maximize
        await this.driver.sleep(100); // Sleep for 1 second (1000 milliseconds)
        this.driver.manage().window().maximize();
        await this.driver.manage().setTimeouts({ implicit: implicitWait });
    };
    async launchDebugBrowser(step) {
        const config = resolveDebugBrowserConfig(step);
        if (!['chrome', 'edge'].includes(config.browser)) {
            throw new Error(`launchDebugBrowser only supports Chrome and Edge. Received: ${config.browser}`);
        }

        const existingMetadata = await queryDebugBrowserMetadata(config.port);
        if (existingMetadata) {
            const existingBrowser = inferDebugBrowserName(existingMetadata);
            if (existingBrowser && existingBrowser !== config.browser) {
                const processInfo = await getDebugBrowserProcessOnPort(config.port);
                const existingLabel = normalizeDebugBrowserLabel(existingBrowser);
                const requestedLabel = normalizeDebugBrowserLabel(config.browser);
                if (!isQafOwnedDebugProcess(processInfo)) {
                    throw new Error(`Debug port ${config.port} is already used by ${existingLabel}. Requested ${requestedLabel}. Close that browser or use a different port.`);
                }

                console.log(`[launchDebugBrowser] clearing QAF-owned ${existingLabel} debug browser on port ${config.port} before launching ${requestedLabel}`);
                await killProcessTree(processInfo.ProcessId);
                const cleared = await waitForDebugPortToClear(config.port, 5000);
                if (!cleared) {
                    throw new Error(`Debug port ${config.port} is still occupied after closing the QAF-owned ${existingLabel} debug browser.`);
                }
            } else {
                console.log(`[launchDebugBrowser] debug browser already available on port ${config.port}; connecting`);
                return await this.connectBrowser(step, { config, metadata: existingMetadata });
            }
        }

        const executable = resolveDebugBrowserExecutable(config.browser);
        if (!executable) {
            throw new Error(`Could not find a local ${config.browser} executable for launchDebugBrowser.`);
        }

        const profileDir = resolveDebugBrowserProfileDir(config);
        fsSync.mkdirSync(profileDir, { recursive: true });

        const args = [
            `--remote-debugging-port=${config.port}`,
            `--user-data-dir=${profileDir}`,
            '--disable-popup-blocking',
            '--no-first-run',
            '--no-default-browser-check',
        ];

        const child = spawn(executable, args, {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();

        const metadata = await waitForDebugBrowserMetadata(config.port, 10000);
        if (!metadata) {
            throw new Error(`Timed out waiting for ${config.browser} debug browser on port ${config.port}.`);
        }

        return await this.connectBrowser(step, { config, metadata });
    };
    async debugBrowser(step) {
        return await this.launchDebugBrowser(step);
    };
    async connectBrowser(step, options = {}) {
        const config = options?.config || resolveDebugBrowserConfig(step, { ignoreUnknownPositionalBrowser: true });
        const requestedBrowser = normalizeDebugBrowserName(config.browser);
        config.browser = requestedBrowser;
        const metadata = options?.metadata || await queryDebugBrowserMetadata(config.port);
        if (!metadata) {
            throw new Error(`No debug browser is listening on port ${config.port}. Start launchDebugBrowser first.`);
        }

        const rawInferredBrowser = inferDebugBrowserName(metadata);
        const inferredBrowser = rawInferredBrowser ? normalizeDebugBrowserName(rawInferredBrowser) : '';
        const browser = inferredBrowser || requestedBrowser;
        if (!['chrome', 'edge'].includes(browser)) {
            throw new Error(`connectBrowser only supports Chrome and Edge. Detected: ${browser || 'unknown'}`);
        }
        if (inferredBrowser && inferredBrowser !== requestedBrowser) {
            const existingLabel = normalizeDebugBrowserLabel(inferredBrowser);
            const requestedLabel = normalizeDebugBrowserLabel(requestedBrowser);
            throw new Error(`Debug port ${config.port} is already used by ${existingLabel}. Requested ${requestedLabel}. Close that browser or use a different port.`);
        }

        const debuggerAddress = `127.0.0.1:${config.port}`;
        let builder = new Builder()
            .forBrowser(browser === 'edge' ? Browser.EDGE : Browser.CHROME)
            .setCapability('unhandledPromptBehavior', 'ignore');

        if (browser === 'chrome') {
            const chromeOptions = new chrome.Options();
            chromeOptions.options_.debuggerAddress = debuggerAddress;
            chromeOptions.addArguments('--start-maximized');
            builder = builder.setChromeOptions(chromeOptions);
        } else {
            const edgeOptions = new edge.Options();
            edgeOptions.options_.debuggerAddress = debuggerAddress;
            edgeOptions.addArguments('--start-maximized');
            builder = builder.setEdgeOptions(edgeOptions);
        }

        this.driver = await builder.build();
        activeWebDrivers.add(this.driver);
        lastWebActionsInstance = this;
        await this.driver.manage().setTimeouts({ implicit: config.implicitWait });
        return this.driver;
    };
    async navigate(step) {
        await this.ensureSessionOrThrow();
        const url = (step.value || '').trim();
        if (!url) {
            throw new Error('Navigate URL is empty.');
        }
        console.log(url);
        await this.driver.get(url);
        try {
            await this.driver.wait(
                async () => {
                    const state = await this.driver.executeScript('return document.readyState');
                    return state === 'complete';
                },
                5000,
            );
        } catch (_) {
            // ignore readyState timeout to avoid breaking existing flows
        }
        if (this.networkCaptureEnabled) {
            try {
                await this.ensureNetworkCaptureHooks();
            } catch (_) {}
        }
    };
    findStrategy(path) {
        if (/^id=(.*)(\[\d+\])?$/.test(path)) {
            return 'id';
        } else if (/^name=(.*)(\[\d+\])?$/.test(path)) {
            return 'name';
        } else if (/^css=(.*)(\[\d+\])?$/.test(path)) {
            return 'css';
        } else if (/^linkText=(.*)(\[\d+\])?$/.test(path)) {
            return 'linkText';
        } else if (/^partialLinkText=(.*)(\[\d+\])?$/.test(path)) {
            return 'partialLinkText';
        } else if (/^tagName=(.*)(\[\d+\])?$/.test(path)) {
            return 'tagName';
        } else {
            return 'xPath';
        }
    };
    findElementBy(path) {
        const strategy = this.findStrategy(path);
        console.log({ strategy, path });

        //The regular expression /(.*)(\[\d+\])$/ is used to match any string that ends with a positive number enclosed in square brackets (arrayindex).
        const parts = path.match(/(.*)(\[\d+\])$/);
        // console.log({ strategy, parts });
        let elAddress = Array.isArray(parts) && parts.length > 0 ? parts[1] : path;

        if (elAddress.includes(`${strategy}=`)) {
            elAddress = elAddress.replace(`${strategy}=`, '');
        }
        // elAddress = elAddress.replace(/^["']|["']$/g, ''); // Remove quotes
        // console.log({ elAddress });
        try {
            switch (strategy) {
                case 'id':
                    return By.id(elAddress);
                case 'name':
                    return By.name(elAddress);
                case 'css':
                    return By.css(elAddress);
                case 'linkText':
                    return By.linkText(elAddress);
                case 'partialLinkText':
                    return By.partialLinkText(elAddress);
                case 'tagName':
                    return By.tagName(elAddress);
                default:
                    console.log('xPath', elAddress);
                    return By.xpath(elAddress);
            }
        } catch (error) {
            console.log(error);
            console.log(
                `Failed in findElementBy strategy: ${strategy} path:  '${path}'`.bgRed,
            );
            return null;
        }
    };

    async highlightElement(element) {
        try {
            await this.driver.executeScript(function (target) {
                if (!target) return;
                const overlayId = '__qaRuntimeHighlightOverlay';
                const existing = document.getElementById(overlayId);
                if (existing) {
                    existing.remove();
                }
                const rect = target.getBoundingClientRect();
                if (!rect || (!rect.width && !rect.height)) {
                    return;
                }
                const overlay = document.createElement('div');
                overlay.id = overlayId;
                Object.assign(overlay.style, {
                    position: 'fixed',
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    border: '2px solid #f59e0b',
                    background: 'rgba(245, 158, 11, 0.18)',
                    boxShadow: '0 0 0 1px rgba(15,23,42,0.18)',
                    borderRadius: '3px',
                    pointerEvents: 'none',
                    zIndex: '2147483647',
                });
                document.documentElement.appendChild(overlay);
            }, element);
            await this.driver.sleep(200);
            await this.driver.executeScript(function () {
                document.getElementById('__qaRuntimeHighlightOverlay')?.remove();
            });
        } catch (error) {
            console.log('error in hightlight element', error);
        }
    }
    // NOTE: Current indexing uses JS array positions for trailing [n] and may be 1-off vs XPath.
    // Example: //div[1] maps to elements[1] (second element). Tests rely on this today.
    // Recommendation: add a compatibility flag before switching to true XPath indexing.
    async findElement(path, step = null) {
        try {
            console.log(path);
            console.log(this.driver.findElements)
            console.log(this.findElementBy(path))
            const shadowContextActive = await this.driver.executeScript('return !!window.__qaCurrentShadowRoot;').catch(() => false);
            if (shadowContextActive) {
                const strategy = this.findStrategy(path);
                if (['css', 'id', 'name'].includes(strategy)) {
                    const parts = path.match(/(.*)(\[\d+\])$/);
                    let index = 0;
                    if (Array.isArray(parts) && parts.length > 2) {
                        index = parseInt(parts[2].replace('[', '').replace(']', ''), 10) || 0;
                    }
                    const element = await this.driver.executeScript(function (rawPath, currentIndex, visibleOnlyLookup) {
                        const path = String(rawPath || '').trim();
                        const root = window.__qaCurrentShadowRoot;
                        if (!root) return null;
                        const normalize = value => String(value ?? '').trim().replace(/^["']|["']$/g, '');
                        let selector = path;
                        let strategy = 'css';
                        if (/^id=/.test(path)) {
                            strategy = 'id';
                            selector = normalize(path.slice(3));
                        } else if (/^name=/.test(path)) {
                            strategy = 'name';
                            selector = normalize(path.slice(5));
                        } else if (/^css=/.test(path)) {
                            strategy = 'css';
                            selector = path.slice(4).trim();
                        }
                        let matches = [];
                        try {
                            if (strategy === 'id') {
                                const found = root.querySelector(`#${CSS.escape(selector)}`);
                                matches = found ? [found] : [];
                            } else if (strategy === 'name') {
                                matches = Array.from(root.querySelectorAll(`[name="${CSS.escape(selector)}"]`));
                            } else {
                                matches = Array.from(root.querySelectorAll(selector));
                            }
                        } catch (_) {
                            matches = [];
                        }
                        if (visibleOnlyLookup) {
                            matches = matches.filter(element => {
                                if (!element || !(element instanceof Element)) return false;
                                const style = window.getComputedStyle(element);
                                const rect = element.getBoundingClientRect();
                                return style.display !== 'none'
                                    && style.visibility !== 'hidden'
                                    && style.opacity !== '0'
                                    && rect.width > 0
                                    && rect.height > 0;
                            });
                        }
                        return matches[currentIndex] || matches[0] || null;
                    }, path, index, this.visibleOnlyLookup === true);
                    if (!element) {
                        throw new Error(this.visibleOnlyLookup ? 'No visible element found' : 'Element not found');
                    }
                    const shouldHighlight = typeof step?.highlight === 'boolean' ? step.highlight : this.highlightEnabled === true;
                    if (shouldHighlight) {
                        await this.highlightElement(element);
                    }
                    return element;
                }
            }
            let element;
            let elements = await this.driver.findElements(this.findElementBy(path));
            if (this.visibleOnlyLookup && Array.isArray(elements) && elements.length > 0) {
                const visibleMatches = [];
                for (const candidate of elements) {
                    try {
                        if (await candidate.isDisplayed()) {
                            visibleMatches.push(candidate);
                        }
                    } catch (_) {}
                }
                elements = visibleMatches;
            }
            console.log(elements);
            if (Array.isArray(elements) && elements.length > 1) {
                //The regular expression /(.*)(\[\d+\])$/ is used to match any string that ends with a positive number enclosed in square brackets (arrayindex).
                const parts = path.match(/(.*)(\[\d+\])$/);
                element = elements[parseInt(parts[2].replace('[', '').replace(']', ''))];
            }else if (elements[0]) {
                element = elements[0];
            } else {
                throw new Error(this.visibleOnlyLookup ? 'No visible element found' : 'Element not found');
            }
            const shouldHighlight = typeof step?.highlight === 'boolean' ? step.highlight : this.highlightEnabled === true;
            if (shouldHighlight) {
                await this.highlightElement(element);
            }
            return element;
        } catch (error) {
            console.log(`Element not found using expression '${path}'`.bgRed);
            throw new Error(this.visibleOnlyLookup ? 'No visible element found' : 'Element not found');
        }
    };
    async countVisibleElements(path) {
        const locator = String(path || '').trim();
        if (!locator || !this.driver) {
            return 0;
        }

        try {
            const shadowContextActive = await this.driver.executeScript('return !!window.__qaCurrentShadowRoot;').catch(() => false);
            if (shadowContextActive) {
                const strategy = this.findStrategy(locator);
                if (['css', 'id', 'name'].includes(strategy)) {
                    return await this.driver.executeScript(function (rawPath) {
                        const path = String(rawPath || '').trim();
                        const root = window.__qaCurrentShadowRoot;
                        if (!root) return 0;
                        const normalize = value => String(value ?? '').trim().replace(/^["']|["']$/g, '');
                        let selector = path;
                        let strategy = 'css';
                        if (/^id=/.test(path)) {
                            strategy = 'id';
                            selector = normalize(path.slice(3));
                        } else if (/^name=/.test(path)) {
                            strategy = 'name';
                            selector = normalize(path.slice(5));
                        } else if (/^css=/.test(path)) {
                            strategy = 'css';
                            selector = path.slice(4).trim();
                        }

                        let matches = [];
                        try {
                            if (strategy === 'id') {
                                const found = root.querySelector(`#${CSS.escape(selector)}`);
                                matches = found ? [found] : [];
                            } else if (strategy === 'name') {
                                matches = Array.from(root.querySelectorAll(`[name="${CSS.escape(selector)}"]`));
                            } else {
                                matches = Array.from(root.querySelectorAll(selector));
                            }
                        } catch (_) {
                            matches = [];
                        }

                        return matches.filter(element => {
                            if (!element || !(element instanceof Element)) return false;
                            const style = window.getComputedStyle(element);
                            const rect = element.getBoundingClientRect();
                            return style.display !== 'none'
                                && style.visibility !== 'hidden'
                                && style.opacity !== '0'
                                && rect.width > 0
                                && rect.height > 0;
                        }).length;
                    }, locator);
                }
            }

            const elements = await this.driver.findElements(this.findElementBy(locator));
            let visibleCount = 0;
            for (const candidate of elements || []) {
                try {
                    if (await candidate.isDisplayed()) {
                        visibleCount += 1;
                    }
                } catch (_) {}
            }
            return visibleCount;
        } catch (error) {
            console.log('[automation] loop visible count failed', error?.message || error);
            return 0;
        }
    };
    async sendKeys(step) {
        const el = await this.findElement(step.xPath, step);
        const result = await el.sendKeys(resolvePrimaryHelperValue(step?.value));
        await this.applyInFunctionWait(step);
        return result;
    };
    async sendKey(step) {
        const config = resolveSendKeyConfig(step);
        const scopedStep = config.target && config.target !== String(step?.xPath || '').trim()
            ? { ...step, xPath: config.target }
            : step;

        switch (config.action) {
                case 'selectall':
                    await this.selectAll(scopedStep);
                    break;
                case 'tab': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.sendKeys(Key.TAB);
                    break;
                }
                case 'clear':
                    await this.clearInput(scopedStep);
                    break;
                case 'escape':
                case 'esc': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.sendKeys(Key.ESCAPE);
                    break;
                }
                case 'home': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.sendKeys(Key.HOME);
                    break;
                }
                case 'backspace': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.sendKeys(Key.BACK_SPACE);
                    break;
                }
                case 'enter': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.sendKeys(Key.ENTER);
                    break;
                }
                case 'keyup':
                case 'arrowup': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.sendKeys(Key.ARROW_UP);
                    break;
                }
                case 'keydown':
                case 'arrowdown': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.sendKeys(Key.ARROW_DOWN);
                    break;
                }
                case 'click': {
                    const el = await this.findElement(scopedStep.xPath, scopedStep);
                    await el.click();
                    break;
                }
                case 'focusout':
                    await this.focusOut(scopedStep);
                    break;
                case 'dismissalert':
                    await this.alertDismiss();
                    break;
                case 'acceptalert':
                    await this.alertAccept();
                    break;
                case 'hover':
                    await this.hoverElement(scopedStep);
                    break;
                default:
                    throw new Error(`Unknown sendkey action: ${step?.value}`);
        }
    };
    async selectAll(step) {
        const el = await this.findElement(step.xPath, step);
        await el.click(); // Ensure the element is focused
        return await el.sendKeys(Key.chord(Key.CONTROL, 'a'));
    };
    async copy(step) {
        const el = await this.findElement(step.xPath, step);
        return await el.sendKeys(Key.chord(Key.CONTROL, 'c'));
    };
    async paste(step) {
        const el = await this.findElement(step.xPath, step);
        return await el.sendKeys(Key.chord(Key.CONTROL, 'v'));
    };
    async multiKeyboardActions(step) {
        const el = await this.findElement(step.xPath, step);
    
        // Check if multiple actions are provided using '>>'
        const raw = String(step?.value || '');
        const actions = raw.includes('>>') 
            ? splitHelperValueParts(raw).map(action => action.trim().toLowerCase())
            : [raw.toLowerCase().trim()];  // Single action
    
        // Loop through each action and execute the corresponding key event
        for (const action of actions) {
            switch (action) {
                case 'selectall':
                    await el.click(); // Ensure the element is focused
                    await el.sendKeys(Key.chord(Key.CONTROL, 'a'));
                    break;
    
                case 'copy':
                    await el.sendKeys(Key.chord(Key.CONTROL, 'c'));
                    break;
    
                case 'paste':
                    await el.sendKeys(Key.chord(Key.CONTROL, 'v'));
                    break;
    
                case 'cut':
                    await el.sendKeys(Key.chord(Key.CONTROL, 'x'));
                    break;
    
                case 'tab':
                    await el.sendKeys(Key.TAB);
                    break;
    
                case 'enter':
                    await el.sendKeys(Key.ENTER);
                    break;
    
                case 'keydown':
                    await el.sendKeys(Key.ARROW_DOWN);
                    break;
    
                case 'keyup':
                    await el.sendKeys(Key.ARROW_UP);
                    break;
    
                case 'esc':
                case 'escape':
                    await el.sendKeys(Key.ESCAPE);
                    break;
    
                case 'delete':
                    await el.sendKeys(Key.DELETE);
                    break;
    
                case 'backspace':
                    await el.sendKeys(Key.BACK_SPACE);
                    break;
    
                case 'clear':
                    await el.clear();
                    break;
                case 'click':
                    await el.click();
                    break;

                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        }
    };
    async click(step) {
        const el = await this.findElement(step.xPath, step);
        const requestedState = resolveRequestedToggleState(step?.value);
        if (requestedState !== null) {
            const currentState = await this.resolveElementToggleState(el);
            if (currentState === requestedState) {
                await this.applyInFunctionWait(step);
                return `element already ${requestedState ? 'selected' : 'unselected'}`;
            }
        }
        await el.click();
        await this.applyInFunctionWait(step);
        return 'element clicked';
    };
    // NOTE: No current keyword mapping uses setSecure in this engine.
    async setSecure(step) {
        return setText(step);
    };
    async wait(step) {
        await this.driver.sleep(step.value);
    };
    async applyInFunctionWait(step) {
        const config = resolveInFunctionWaitConfig(step?.value);
        if (!config.delayMs) {
            return;
        }
        await this.driver.sleep(config.delayMs);
    };
    async resolveElementToggleState(element) {
        try {
            return await element.isSelected();
        } catch (_) {
            // fall through to DOM inspection
        }

        try {
            return await this.driver.executeScript(
                `
                    const el = arguments[0];
                    if (!el) return false;

                    if (typeof el.checked === 'boolean') {
                        return el.checked;
                    }

                    const ariaPressed = el.getAttribute('aria-pressed');
                    if (ariaPressed === 'true') return true;
                    if (ariaPressed === 'false') return false;

                    const ariaSelected = el.getAttribute('aria-selected');
                    if (ariaSelected === 'true') return true;
                    if (ariaSelected === 'false') return false;

                    const ariaChecked = el.getAttribute('aria-checked');
                    if (ariaChecked === 'true') return true;
                    if (ariaChecked === 'false') return false;

                    return el.classList.contains('active')
                        || el.classList.contains('selected')
                        || el.classList.contains('checked')
                        || el.classList.contains('on');
                `,
                element,
            );
        } catch (_) {
            return false;
        }
    };
    async waitForElement(step) {
        const config = resolveWaitForElementConfig(step);
        const target = String(config.target || '').trim();
        const state = String(config.state || '').trim().toLowerCase();
        const useInheritedParentLocator = !helperUsesOwnLocator(step);
        const indexedInheritedTarget = useInheritedParentLocator
            ? applyExplicitTargetIndex(target, step?.__explicitTargetIndex)
            : target;

        if (!target) {
            throw new Error('waitForElement requires a target XPath or the step XPath.');
        }

        if (!state) {
            throw new Error('waitForElement requires a state value.');
        }

        await this.driver.wait(async () => {
            let elements = [];
            if (useInheritedParentLocator && indexedInheritedTarget !== target) {
                try {
                    const element = await this.findElement(indexedInheritedTarget, {
                        ...step,
                        xPath: indexedInheritedTarget,
                        highlight: false,
                    });
                    elements = element ? [element] : [];
                } catch (_) {
                    elements = [];
                }
            } else {
                elements = await this.getLookupContext().findElements(this.findElementBy(target));
            }

            switch (state) {
                case 'exist':
                    return elements.length > 0;
                case 'notexist':
                    return elements.length === 0;
                case 'visible':
                    return (await Promise.all(elements.map(async element => {
                        try {
                            return await element.isDisplayed();
                        } catch (_) {
                            return false;
                        }
                    }))).some(Boolean);
                case 'hidden': {
                    if (elements.length === 0) {
                        return true;
                    }

                    const visibleStates = await Promise.all(elements.map(async element => {
                        try {
                            return await element.isDisplayed();
                        } catch (_) {
                            return false;
                        }
                    }));
                    return visibleStates.every(isVisible => !isVisible);
                }
                case 'enabled':
                    return (await Promise.all(elements.map(async element => {
                        try {
                            return await element.isEnabled();
                        } catch (_) {
                            return false;
                        }
                    }))).some(Boolean);
                case 'disabled': {
                    if (elements.length === 0) {
                        return false;
                    }

                    const enabledStates = await Promise.all(elements.map(async element => {
                        try {
                            return await element.isEnabled();
                        } catch (_) {
                            return false;
                        }
                    }));
                    return enabledStates.every(isEnabled => !isEnabled);
                }
                case 'selected':
                    return (await Promise.all(elements.map(async element => {
                        try {
                            return await element.isSelected();
                        } catch (_) {
                            return false;
                        }
                    }))).some(Boolean);
                case 'notselected': {
                    if (elements.length === 0) {
                        return false;
                    }

                    const selectedStates = await Promise.all(elements.map(async element => {
                        try {
                            return await element.isSelected();
                        } catch (_) {
                            return false;
                        }
                    }));
                    return selectedStates.every(isSelected => !isSelected);
                }
                default:
                    throw new Error(`Unsupported waitForElement state: ${config.state}`);
            }
        }, config.timeout, `waitForElement timed out waiting for ${state} on ${indexedInheritedTarget}`);
    };
    async waitForText(step) {
        const config = resolveWaitForTextConfig(step);
        const text = normalizeWhitespace(config.text);
        const match = String(config.match || 'contains').trim().toLowerCase();

        if (!text) {
            throw new Error('waitForText requires a text value.');
        }

        if (match !== 'contains' && match !== 'exact') {
            throw new Error(`Unsupported waitForText match: ${config.match}`);
        }

        await this.driver.wait(async () => {
            const scopeElement = config.scope
                ? await this.findElement(config.scope, step)
                : this.currentContext && this.currentContext !== this.driver
                    ? this.currentContext
                    : null;
            return await this.driver.executeScript(
                `
                    const root = arguments[0] || document.body;
                    const expectedText = arguments[1];
                    const matchMode = arguments[2];
                    const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
                    const expected = normalize(expectedText);
                    if (!expected) {
                        return false;
                    }

                    const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
                    return nodes.some(node => {
                        const textValue = normalize(node.innerText || node.textContent || '');
                        if (!textValue) {
                            return false;
                        }

                        return matchMode === 'exact'
                            ? textValue === expected
                            : textValue.includes(expected);
                    });
                `,
                scopeElement,
                text,
                match,
            );
        }, config.timeout, `waitForText timed out waiting for text ${text}`);
    };
    async existold(step) {
        return await this.findElement(step.xPath, step);
    };
    async exist(step) {
        try {
            await this.findElement(step.xPath, step);
            console.log("Element found");
            return true;
        } catch (error) {
            console.log("Element not found");
            throw new Error(`Element not found for locator: ${step.xPath}`);
        }
    };
    async maxBrowser() {
        await this.driver.manage().window().maximize();
    };
    async minBrowser() {
        await this.driver.manage().window().minimize();
    };
    async openTab(step) {
        await this.driver.switchTo().newWindow('tab');
        //if no value then just opens the new tab
        if ((step.value ?? '') !== '' && isValidUrl(step.value)) {
            await this.navigate(step);
        }
    };
    async closeTab(step) {
        //if no value then closes  the current tab
        console.log(step.value.bgRed);
        if (step.value ?? '' !== '') {
            const windows = await this.driver.getAllWindowHandles();
            console.log(windows);
            await this.driver.switchTo().window(windows[parseInt(step.value)]);
            await this.driver.close();
            const updatedWindows = await this.driver.getAllWindowHandles();
            console.log(updatedWindows);
            if (updatedWindows.length >= 1) {
                console.log('in condition');
                console.log(updatedWindows[updatedWindows.length - 1]);
                await this.driver.switchTo().window(updatedWindows[updatedWindows.length - 1]);
                return;
            }
            return;
        }

        await this.driver.close();
    };
    async openWindow(step) {
        await this.driver.switchTo().newWindow('window');
        console.log(await this.driver.getAllWindowHandles());
        //if no value then just opens the new window
        if ((step.value ?? '') !== '' && this.isValidUrl(step.value)) {
            await this.navigate(step);
        }
    };

    async closeBrowser(step = {}) {
        const hasSession = await this.hasValidSession();
        if (!hasSession) {
            console.log('[webActions] closeBrowser: no valid driver session; clearing tracked refs');
            try { removeActiveWebDriver(this.driver); } catch (_) {}
            this.driver = null;
            return;
        }
        const shouldDestroySession =
            step?.isLastTestCaseStep ?? (step?.isLastTestCase && step?.lastStep) ?? true;
        let shouldClear = false;
        try {
            const handles = await this.driver.getAllWindowHandles();
            const idx = parseInt(step?.value, 10);
            console.log('closeBrowser handles:', handles, 'idx:', idx, 'destroy:', !!shouldDestroySession);
            if (idx && idx >= 1 && idx <= handles.length) {
                await this.driver.switchTo().window(handles[idx - 1]);
            }
            if (shouldDestroySession) {
                await quitWithTimeout(this.driver);
                shouldClear = true;
                return;
            }
            if (handles.length > 1) {
                await this.driver.close();
                const remaining = await this.driver.getAllWindowHandles().catch(() => []);
                console.log('closeBrowser remaining after close:', remaining);
                if (remaining.length) {
                    await this.driver.switchTo().window(remaining[0]);
                }
                return;
            }
            await quitWithTimeout(this.driver);
            shouldClear = true;
        } catch (err) {
            console.log('closeBrowser error (ignored)', err?.message || err);
        } finally {
            if (shouldClear) {
                try { removeActiveWebDriver(this.driver); } catch (_) {}
                this.driver = null;
            }
        }
    };

    async switchBrowser(step) {
        const windows = await this.driver.getAllWindowHandles();
        await this.driver.switchTo().window(windows[parseInt(step.value) - 1]);
    };
    async alertAccept() {
        await this.driver.wait(until.alertIsPresent(), 5000);
        let alert = await this.driver.switchTo().alert();
        await alert.accept();
    };
    async alertDismiss() {
        await this.driver.wait(until.alertIsPresent(), 5000);
        let alert = await this.driver.switchTo().alert();
        await alert.dismiss();
    };  
    async alertSetText(step) {
        await this.driver.wait(until.alertIsPresent(), 10000); // Timeout of 10 seconds
        let alert = await this.driver.switchTo().alert();
        await alert.sendKeys(step.value);
      //  await alert.accept();
    };
    async clearInput(step) {
        try {
            // Try finding the element
            const el = await this.findElement(step.xPath, step);
            if (el) {
                console.log("Element found, clearing data.");
                await el.clear();
                return "Element found and data cleared.";
            }
            throw new Error("Element not found.");
        } catch (error) {
            console.log("Error occurred while finding or clearing data:", error);
            throw error;
        }
    };

    async scrollToElementold(step) {
        const el = await this.findElement(step.xPath, step);
        await this.driver.actions().scroll(0, 0, 0, 0, el).perform();
    };
    async scrollToElement(step) {
        try {
            const el = await this.findElement(step.xPath, step);
            if (el) {
                console.log("Element found, scrolling to it.");
                await this.driver.actions().scroll(0, 0, 0, 0, el).perform();
                return "Element found and scrolled to.";
            }
            throw new Error("Element not found.");
        } catch (error) {
            console.log("Error occurred while finding or scrolling to element:", error);
            throw error;
        }
    };
    async scrollToTextold(step) {
        const scrollToTextScript = `
          const text = "${step.value}";
          const element = Array.from(document.querySelectorAll('body, body *'))
              .find(e => e.textContent.trim() === text);
              console.log(element)
          if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return true;
          } else {
              return false;
          }
      `;
        await this.driver.executeScript(scrollToTextScript);
    };

    async scrollToText(step) {
  try {
    const text = String(step?.value || '');
    if (!text) {
      throw new Error('Text is empty.');
    }
    const result = await this.driver.executeScript(
      `
        const text = arguments[0];
        const element = Array.from(document.querySelectorAll('body, body *'))
          .find(e => (e.textContent || '').trim() === text);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
        return false;
      `,
      text
    );

    if (result) {
      console.log("Text found, scrolled to element.");
      return "Text found and scrolled to element.";
    }
    throw new Error("Text not found.");
  } catch (error) {
    console.log("Error occurred while scrolling to text:", error);
    throw error;
  }
};
    // LEGACY: uses raw text injection; kept for reference/testing only.
    async scrollToTexlastworkingt(step) {
        try {
            const scrollToTextScript = `
              const text = "${step.value}";
              const element = Array.from(document.querySelectorAll('body, body *'))
                  .find(e => e.textContent.trim() === text);
              if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return true;
              } else {
                  return false;
              }
            `;
            const result = await this.driver.executeScript(scrollToTextScript);
    
            if (result) {
                console.log("Text found, scrolled to element.");
                return "Text found and scrolled to element.";
            }
            throw new Error("Text not found.");
        } catch (error) {
            console.log("Error occurred while scrolling to text:", error);
            throw error;
        }
    };
    
    async isValidUrl(str) {
        try {
            new URL(str);
            return true;
        } catch (err) {
            console.log('isValidUrl', err);
            return false;
        }
    };
    async executeSQL(step) {
        // Parse step.value to get connectionConfigString and sqlStatement
        const [connectionConfigStr, sqlStatementStr] = step.value.split('||').map(part => part.trim());
        // Parse the connection configuration string into an object
        const connectionConfig = JSON.parse(connectionConfigStr);
        const connection = await mysql.createConnection(connectionConfig);
        try {
            console.log('Connected to database successfully.');
            await connection.execute(sqlStatementStr);
        } finally {
            await connection.end();
        }
    };
    async connectPDF(step) {
        try {
            // url = "file:///C:/Users/Dell/Downloads/payment-receipt.pdf";
            // url = "C:\Users\Dell\Downloads\payment-receipt.pdf";    
            // url = "https://pdf-lib.js.org/assets/with_large_page_count.pdf";

            let buffer;
            let url = step.value; // Assuming step.value contains the URL or file path

            if (url.startsWith('http') || url.startsWith('https')) {
                // Fetch the PDF from the URL
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                buffer = response.data;
            } else {
                // Handle local PDF file
                const filePath = url.startsWith('file://') ? decodeURIComponent(url.replace('file:///', '')) : url;
                buffer = await fs.readFile(filePath);
            }
            // Load the PDF document using pdf-lib
            const pdfDoc = await PDFDocument.load(buffer);
            console.log('PDF loaded successfully.');
            // Extract text from the PDF using pdf-parse
            const data = await pdfParse(buffer);
            console.log('PDF content:');
            console.log(data.text);

            // Store PDF text in module-level variable
            pdfText = data.text;
            return `PDF Connection established : ${step.value}`;

        } catch (error) {
            console.error('Error loading PDF:', error);
        }
    };
    async verifyPDFText(step) {
        try {
            let textToVerify = step.value;
            if (!pdfText) {
                throw new Error('PDF text not loaded. Call connectPDF first.');
            }
            // Check if the text to verify is present in the PDF text
            if (pdfText.includes(textToVerify)) {
                console.log(`Text "${textToVerify}" found in the PDF.`);
                return `${textToVerify} value matched! Value Passed: ${textToVerify} | Value Found: ${textToVerify}`;
            } else {
                throw new Error(`Text "${textToVerify}" not found in the PDF.`);
            }
        } catch (error) {
            console.error('Error verifying PDF text:', error.message);
            throw error; // Rethrow the error to be handled by the calling function
        }
    };
    async disconnectPDF(step) {
        // Clear the reference to the PDF document to allow for garbage collection
        pdfText = null;
        console.log('PDF connection disconnected and object destroyed.');
        // Reconnect to the new PDF if step parameter is provided
        // if (step) {
        //     console.log('Pdf disconnected');
        //     await connectPDF(step);
        // }
        return `PDF Connection Disconnected`;
    };
    async deletePDFFile(step) {
        let filePath = step.value;

        console.log(`Attempting to delete file at path: "${filePath}"`);

        try {
            // Check if the file exists
            const fileExists = await fs.access(filePath)
                .then(() => true)
                .catch(() => false);

            if (fileExists) {
                // File exists, proceed with deletion
                await fs.unlink(filePath);
                console.log('File deleted successfully!');
            } else {
                console.log(`File at path "${filePath}" does not exist.`);
            }
        } catch (err) {
            console.error('Error deleting file:', err);
        }
        console.log('deletePDFFile function executed.');
    };
    async getDBValue(step) {
        // Parse step.value to get connectionConfigString and sqlStatement
        const [connectionConfigStr, sqlStatementStr] = step.value.split('||').map(part => part.trim());
        console.log(`Connection string. ${connectionConfigStr}`);
        console.log(`Connection string. ${sqlStatementStr}`);
        // Parse the connection configuration string into an object
        const connectionConfig = JSON.parse(connectionConfigStr);
        const connection = await mysql.createConnection(connectionConfig);
        try {
            console.log('Connected to database successfully.');
            const [rows] = await connection.execute(sqlStatementStr);
            return rows;
        } finally {
            await connection.end();
        }
    };
    async executeApiCallInBrowser(request) {
        const currentUrl = await this.driver.getCurrentUrl();
        const resolvedUrl = buildResolvedUrl(currentUrl, request.url, request.query);
        const runtimeAuthHeaders = await this.resolveRuntimeAuthHeaders(resolvedUrl.toString());
        const mergedHeaders = normalizeRequestHeaders(request.headers);
        Object.entries(runtimeAuthHeaders).forEach(([key, value]) => {
            if (value != null && getHeaderValue(mergedHeaders, key) == null) {
                mergedHeaders[key] = value;
            }
        });

        const response = await this.driver.executeAsyncScript(
            (input, done) => {
                (async () => {
                    try {
                        const currentHref = window.location.href;
                        const targetUrl = new URL(input.url, currentHref);
                        const queryEntries = input.query && typeof input.query === 'object'
                            ? Object.entries(input.query)
                            : [];
                        queryEntries.forEach(([key, value]) => {
                            if (value === undefined || value === null) {
                                return;
                            }
                            targetUrl.searchParams.set(key, String(value));
                        });

                        const headers = input.headers && typeof input.headers === 'object'
                            ? { ...input.headers }
                            : {};

                        const fetchOptions = {
                            method: input.method,
                            headers,
                            credentials: 'include',
                        };

                        if (input.hasBody) {
                            const contentTypeKey = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
                            const contentType = contentTypeKey ? String(headers[contentTypeKey]).toLowerCase() : '';
                            if (!contentTypeKey) {
                                headers['Content-Type'] = 'application/json';
                            }

                            if (contentType.includes('application/json') || !contentType) {
                                fetchOptions.body =
                                    typeof input.body === 'string'
                                        ? input.body
                                        : JSON.stringify(input.body ?? {});
                            } else if (typeof input.body === 'string') {
                                fetchOptions.body = input.body;
                            } else {
                                fetchOptions.body = JSON.stringify(input.body ?? {});
                            }
                        }

                        const res = await fetch(targetUrl.toString(), fetchOptions);
                        const text = await res.text();
                        const responseHeaders = {};
                        res.headers.forEach((value, key) => {
                            responseHeaders[key] = value;
                        });

                        let parsedJson = null;
                        try {
                            parsedJson = text ? JSON.parse(text) : null;
                        } catch (_) {}

                        done({
                            ok: res.ok,
                            status: res.status,
                            statusText: res.statusText,
                            url: targetUrl.toString(),
                            headers: responseHeaders,
                            body: text,
                            json: parsedJson,
                            mode: input.mode,
                        });
                    } catch (error) {
                        done({
                            ok: false,
                            status: 0,
                            statusText: 'CLIENT_ERROR',
                            url: input.url,
                            headers: {},
                            body: '',
                            json: null,
                            mode: input.mode,
                            error: error?.message || String(error),
                        });
                    }
                })();
            },
            {
                ...request,
                headers: mergedHeaders,
                url: resolvedUrl.toString(),
            },
        );
        return enrichApiResponseWithSoapDiagnostics(response, request.protocol);
    };
    async executeApiCallWithSessionHttp(request) {
        const hasSession = await this.hasValidSession();
        const currentUrl = hasSession ? await this.driver.getCurrentUrl() : undefined;
        const targetUrl = buildResolvedUrl(currentUrl, request.url, request.query);
        const headers = normalizeRequestHeaders(request.headers);
        const runtimeAuthHeaders = hasSession ? await this.resolveRuntimeAuthHeaders(targetUrl.toString()) : {};
        Object.entries(runtimeAuthHeaders).forEach(([key, value]) => {
            if (value != null && getHeaderValue(headers, key) == null) {
                headers[key] = value;
            }
        });
        const cookies = hasSession ? await this.driver.manage().getCookies() : [];

        if (!Object.keys(headers).some(key => key.toLowerCase() === 'cookie') && Array.isArray(cookies) && cookies.length > 0) {
            headers.Cookie = cookies
                .map(cookie => `${cookie.name}=${cookie.value}`)
                .join('; ');
        }

        const xsrfCookie = cookies.find(cookie => String(cookie.name || '').toLowerCase() === 'xsrf-token');
        if (xsrfCookie && !Object.keys(headers).some(key => key.toLowerCase() === 'x-xsrf-token')) {
            try {
                headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrfCookie.value);
            } catch (_) {
                headers['X-XSRF-TOKEN'] = xsrfCookie.value;
            }
        }

        const body = buildRequestBody({
            method: request.method,
            headers,
            body: request.body,
        });

        const response = await axios({
            method: request.method,
            url: targetUrl.toString(),
            headers,
            data: body,
            maxRedirects: 5,
            decompress: true,
            validateStatus: () => true,
        });

        const rawBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {});
        let parsedJson = null;
        if (response.data && typeof response.data === 'object') {
            parsedJson = response.data;
        } else {
            try {
                parsedJson = rawBody ? JSON.parse(rawBody) : null;
            } catch (_) {}
        }

        const responsePayload = {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            statusText: response.statusText || '',
            url: targetUrl.toString(),
            headers: response.headers || {},
            body: rawBody,
            json: parsedJson,
            mode: request.mode,
        };
        return enrichApiResponseWithSoapDiagnostics(responsePayload, request.protocol);
    };
    async apiCall(step) {
        const parsedStep = parseApiCallValue(step?.value, { defaultMode: 'browser_session' });
        const contractErrors = validateApiCallContract(parsedStep);
        if (contractErrors.length > 0) {
            throw new Error(contractErrors.join(' '));
        }
        const query = safeParseJson(parsedStep.queryJson, {});
        const headers = safeParseJson(parsedStep.headersJson, {});
        let bodyValue;
        try {
            bodyValue = safeParseJson(parsedStep.bodyJson, {});
        } catch (_) {
            // SOAP/XML and other raw text payloads are valid body inputs.
            bodyValue = String(parsedStep.bodyJson || '');
        }
        const hasBody = !['GET', 'HEAD'].includes(parsedStep.method);

        const contentType = String(
            Object.entries(headers || {}).find(([key]) => String(key || '').toLowerCase() === 'content-type')?.[1] || '',
        ).toLowerCase();
        const treatAsSoap =
            parsedStep.protocol === 'soap' ||
            contentType.includes('text/xml') ||
            contentType.includes('application/soap+xml') ||
            (typeof bodyValue === 'string' && isLikelyXml(bodyValue));
        if (treatAsSoap && typeof bodyValue === 'string') {
            validateXmlSafety(bodyValue);
        }

        if (!parsedStep.url) {
            throw new Error('apiCall: URL segment is required.');
        }

        const request = {
            method: parsedStep.method,
            url: parsedStep.url,
            query,
            headers,
            body: bodyValue,
            hasBody,
            mode: parsedStep.mode,
            protocol: parsedStep.protocol,
        };

        let response;
        const mode = String(parsedStep.mode || 'browser_session').toLowerCase();
        if (mode === 'session_http') {
            response = await this.executeApiCallWithSessionHttp(request);
        } else if (mode === 'auto') {
            const hasSession = await this.hasValidSession();
            if (hasSession) {
                response = await this.executeApiCallInBrowser(request);
            } else {
                response = await this.executeApiCallWithSessionHttp({
                    ...request,
                    mode: 'session_http',
                });
            }
            if (response?.error) {
                response = await this.executeApiCallWithSessionHttp({
                    ...request,
                    mode: 'session_http',
                });
            }
        } else {
            await this.ensureSessionOrThrow();
            response = await this.executeApiCallInBrowser(request);
        }

        if (response?.error) {
            throw new Error(`apiCall failed: ${response.error}`);
        }

        return JSON.stringify(response);
    };
    async getCookieValue(step) {
        try {

            // Get all cookies
            const cookies = await this.driver.manage().getCookies();
            // Find the cookie by name
            const cookie = cookies.find(c => c.name === step.value);
            if (cookie) {
                console.log(`Value of cookie '${step.value}':`, cookie.value);
                return cookie.value;
            } else {
                console.log(`Cookie '${step.value}' not found.`);
                return null;
            }
        } catch (error) {
            console.error('Error getting cookie value:', error);
            return null;
        }
    };
    async dragDrop(step) {
        //User will pass both xpath using locators on component
        const inputString = step.xPath;

        // Split the string using the delimiter '||'
        const parts = inputString.split('||');

        try {
            const sourceElement = await this.findElement(parts[0], step);
            const targetElement = await this.findElement(parts[1], step);
            // Perform drag and drop
            await this.driver.actions({ bridge: true })
                .dragAndDrop(sourceElement, targetElement)
                .perform();
            console.log(`Dragged element from '${sourceElement}' to '${targetElement}' successfully.`);
        } catch (error) {
            console.error('Error performing drag and drop:', error);
        }
    };
    async switchToIframe(step) {
        try {
            //Input Param
            //Before or after step xpath switchToIframe=//*[@id='frame1']
            //Revert to default content (Do not Pass Parameter)

            const value = String(step?.value || '').trim();
            if (!value) {
                throw new Error('switchToIframe: missing iframe selector');
            }
            console.log('[switchToIframe] start', { value });
            console.log(`Switched to iframe: ${value}`);
            if (value === 'default') {
                await this.driver.switchTo().defaultContent();
                console.log('Switched to default content');
                return `switched back to default context`;
            } else {
                const frameSelectors = value
                    .split('>>')
                    .map(part => String(part || '').trim())
                    .filter(Boolean);
                if (!frameSelectors.length) {
                    throw new Error('switchToIframe: missing iframe selector');
                }
                for (const frameSelector of frameSelectors) {
                    const el = await this.findElement(frameSelector, { ...step, xPath: frameSelector, highlight: false });
                    await this.driver.switchTo().frame(el);
                    try {
                        await this.driver.wait(
                            async () => {
                                const state = await this.driver.executeScript('return document.readyState');
                                return state === 'complete' || state === 'interactive';
                            },
                            1500,
                        );
                    } catch (_) {}
                }
                try {
                    await this.driver.wait(
                        async () => {
                            const state = await this.driver.executeScript('return document.readyState');
                            return state === 'complete' || state === 'interactive';
                        },
                        3000,
                    );
                } catch (_) {}
                try {
                    const frameContext = await this.driver.executeScript(() => ({
                        href: window.location.href,
                        title: document.title,
                        readyState: document.readyState,
                    }));
                    console.log('[switchToIframe] frame-context', frameContext);
                } catch (error) {
                    console.log('[switchToIframe] frame-context unavailable', error?.message || error);
                }
                console.log(`Switched to iframe: ${value}`);
                return `Switched to iframe: ${value}`;
            }
        } catch (error) {
            console.log(`Failed to switch to iframe: ${step?.value}`);
            console.error(error);
            throw error;
        }
    };
    async switchToDom(step) {
        try {
            const raw = String(step?.value || '').trim();
            if (!raw) {
                throw new Error('switchToDom: traversal string is required.');
            }
            if (raw.toLowerCase() === 'default') {
                await this.driver.switchTo().defaultContent();
                await this.driver.executeScript('window.__qaCurrentShadowRoot = null;');
                return 'Switched to default DOM context';
            }

            const parts = raw
                .split('->')
                .map(part => String(part || '').trim())
                .filter(Boolean);

            for (const part of parts) {
                if (part.toLowerCase() === 'iframe') {
                    const frames = await this.driver.findElements(By.css('iframe, frame'));
                    if (!frames[0]) {
                        throw new Error('switchToDom: iframe token found but no iframe is available.');
                    }
                    await this.driver.switchTo().frame(frames[0]);
                    await this.driver.executeScript('window.__qaCurrentShadowRoot = null;');
                    continue;
                }

                const iframeDepthMatch = part.match(/^iframe-depth:(\d+)$/i);
                if (iframeDepthMatch) {
                    const depth = Number(iframeDepthMatch[1]);
                    for (let i = 0; i < depth; i += 1) {
                        const frames = await this.driver.findElements(By.css('iframe, frame'));
                        if (!frames[0]) {
                            throw new Error(`switchToDom: missing iframe while traversing depth ${depth}.`);
                        }
                        await this.driver.switchTo().frame(frames[0]);
                        await this.driver.executeScript('window.__qaCurrentShadowRoot = null;');
                    }
                    continue;
                }

                const iframeSelectorMatch = part.match(/^iframe\(selector=(.+)\)$/i);
                if (iframeSelectorMatch) {
                    const selector = iframeSelectorMatch[1].trim();
                    await this.driver.executeScript('window.__qaCurrentShadowRoot = null;');
                    const frame = await this.findElement(selector, { ...step, xPath: selector, highlight: false });
                    await this.driver.switchTo().frame(frame);
                    await this.driver.executeScript('window.__qaCurrentShadowRoot = null;');
                    continue;
                }

                const shadowMatch = part.match(/^shadow\(host=(.+)\)$/i);
                if (shadowMatch) {
                    const selector = shadowMatch[1].trim();
                    const result = await this.driver.executeScript(function (rawSelector) {
                        const selector = String(rawSelector || '').trim();
                        const root = window.__qaCurrentShadowRoot || document;
                        const normalize = value => {
                            const text = String(value ?? '').trim();
                            return text.replace(/^["']|["']$/g, '');
                        };
                        const strategy = (() => {
                            if (/^id=/.test(selector)) return 'id';
                            if (/^name=/.test(selector)) return 'name';
                            if (/^css=/.test(selector)) return 'css';
                            return 'xPath';
                        })();
                        const body = /^id=|^name=|^css=/i.test(selector)
                            ? selector.slice(selector.indexOf('=') + 1).trim()
                            : selector;
                        let host = null;
                        if (strategy === 'id') {
                            const id = normalize(body);
                            host = root instanceof ShadowRoot ? root.querySelector(`#${CSS.escape(id)}`) : document.getElementById(id);
                        } else if (strategy === 'name') {
                            const name = normalize(body);
                            host = root.querySelector?.(`[name="${CSS.escape(name)}"]`) || null;
                        } else if (strategy === 'css') {
                            host = root.querySelector?.(body) || null;
                        } else {
                            const doc = root instanceof ShadowRoot ? root.ownerDocument : document;
                            host = doc.evaluate(
                                body,
                                root,
                                null,
                                XPathResult.FIRST_ORDERED_NODE_TYPE,
                                null,
                            ).singleNodeValue;
                        }
                        if (!host) {
                            return { ok: false, error: `switchToDom: shadow host not found for selector ${selector}` };
                        }
                        if (!host.shadowRoot) {
                            return { ok: false, error: `switchToDom: shadow root unavailable for selector ${selector}` };
                        }
                        window.__qaCurrentShadowRoot = host.shadowRoot;
                        return { ok: true };
                    }, selector);
                    if (!result?.ok) {
                        throw new Error(result?.error || `switchToDom: shadow host not found for selector ${selector}`);
                    }
                    continue;
                }

                const directShadowChain = part
                    .split('>>')
                    .map(token => token.trim())
                    .filter(Boolean);
                if (directShadowChain.length > 1) {
                    for (const token of directShadowChain) {
                        const selector = token.trim();
                        if (!selector) {
                            continue;
                        }
                        const result = await this.driver.executeScript(function (rawSelector) {
                            const selector = String(rawSelector || '').trim();
                            const root = window.__qaCurrentShadowRoot || document;
                            let host = null;
                            try {
                                host = root.querySelector?.(selector) || null;
                            } catch (_) {}
                            if (!host) {
                                return { ok: false, error: `switchToDom: shadow host not found for selector ${selector}` };
                            }
                            if (!host.shadowRoot) {
                                return { ok: false, error: `switchToDom: shadow root unavailable for selector ${selector}` };
                            }
                            window.__qaCurrentShadowRoot = host.shadowRoot;
                            return { ok: true };
                        }, selector);
                        if (!result?.ok) {
                            throw new Error(result?.error || `switchToDom: shadow host not found for selector ${selector}`);
                        }
                    }
                    continue;
                }

                throw new Error(`switchToDom: unsupported traversal token '${part}'`);
            }

            return `Switched DOM context using traversal: ${raw}`;
        } catch (error) {
            console.log(`Failed to switch DOM context: ${step?.value}`);
            console.error(error);
            throw error;
        }
    };
    async hoverElement(step) {
        // Sample step.value: //*[text="Click Me"]
        try {
            const elementToHover = await this.findElement(step.xPath, step);
            try {
                // Wait until the element is visible
                await this.driver.wait(until.elementIsVisible(elementToHover), 10000);
                // Perform the hover action using the actions method on the driver instance
                const actions = this.driver.actions({ bridge: true });
                await actions.move({ origin: elementToHover }).perform();

                console.log(`Hovered over element: ${step.xPath}`);
                return `Hovered over element: ${step.xPath}`;
            } catch (visibilityError) {
                console.log(`Element found but not visible: ${step.xPath}`);
                throw new Error(`Element found but not visible: ${step.xPath}`);
            }
        } catch (locateError) {
            console.log(`Failed to locate element: ${step.xPath}`);
            throw new Error(`Failed to locate element: ${step.xPath}`);
        }
    };
    async select(step) {
        // Sample step.value: "value=1"
        // Sample step.value: "text=Green"
        // Sample step.value: "index=2"
        // Sample step.value: "Green"
        try {
            // Wait for the element to be located
            const el = await this.findElement(step.xPath, step);

            const select = new Select(el);
            const config = resolveSelectConfig(step?.value);
            let method = config.method;
            let value = config.value;
            if (!value) {
                throw new Error('Select value is empty.');
            }
            method = method.toLowerCase();
            switch (method) {
                case 'value':
                    await select.selectByValue(value);
                    break;
                case 'index':
                    await select.selectByIndex(parseInt(value, 10));
                    break;
                case 'text':
                    await select.selectByVisibleText(value);
                    break;
                case 'multiple':
                    await selectMultipleByVisibleText(select, value);
                    break;
                default:
                    await select.selectByVisibleText(value);
                    break;
            }
            await this.applyInFunctionWait(step);

            console.log(`Selected option using ${method} with value: ${value}`);
        } catch (error) {
            console.error(`Failed to select option using ${method} with value: ${value}`);
            console.error(error);
        }
    };
    async rightClick(step) {
        try {
            const element = await this.findElement(step.xPath, step);

            await this.driver.wait(until.elementIsVisible(element), 10000);

            // Create a new action sequence and move the mouse to the element
            const actions = this.driver.actions({ bridge: true });
            await actions.move({ origin: element }).perform();
            console.log(`Moved to element: ${step.xPath}`);

            await actions.contextClick(element).perform();
            console.log(`Right Clicked on element: ${step.xPath}`);
            return `Move to Element and Right Clicked on element: ${step.xPath}`;
        } catch (error) {
            console.error(`Failed to right-click on element: ${step.xPath}`);
            console.error(error);
            throw error;
        }
    };
    async doubleClick(step) {
        try {
            const element = await this.findElement(step.xPath, step);
            await this.driver.wait(until.elementIsVisible(element), 10000);

            // Create a new action sequence and move the mouse to the element
            const actions = this.driver.actions({ bridge: true });
            await actions.doubleClick(element).perform();
            console.log(`Double Clicked on element: ${step.xPath}`);
            return `Double Clicked on element: ${step.xPath}`;
        } catch (error) {
            console.error(`Failed to Double-click on element: ${step.xPath}`);
            throw error;
        }
    };
    async verifyTextOnAlert(step) {
        try {
            await this.driver.wait(until.alertIsPresent(), 5000);
            const alert = await this.driver.switchTo().alert();
            const alertText = await alert.getText();
            console.log('Alert text:', alertText);
            if (alertText === step.value) {
                console.log(`Alert text "${step.value}" matches the expected text.`);
                return `${alertText} value matched! Value Passed: ${step.value} | Value Found: ${alertText}`;
            }
            throw new Error(`Alert text "${alertText}" does not match expected "${step.value}"`);
        } catch (error) {
            console.error('Error verifying text on alert:', error);
            throw error;
        }
    };
    normalizeElementValidationValue(value) {
        return String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\n\r]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    };
    parseElementValidationRule(rawValue, contains = false) {
        const rawText = String(rawValue ?? '');
        const modeMatch = rawText.match(/^\s*(contains)\s*:(.*)$/is);
        const normalizedText = modeMatch ? modeMatch[2] : rawText;
        const separatorIndex = normalizedText.indexOf('=');
        const attr = separatorIndex >= 0 ? normalizedText.slice(0, separatorIndex).trim() : 'innerText';
        const expectedRaw = separatorIndex >= 0 ? normalizedText.slice(separatorIndex + 1) : normalizedText;
        const expectedValue = String(expectedRaw ?? '').trim().toLowerCase() === 'null'
            ? ''
            : expectedRaw;
        return {
            attr,
            attrKey: attr.toLowerCase(),
            expected: this.normalizeElementValidationValue(expectedValue),
            contains: contains || Boolean(modeMatch),
        };
    };
    resolveElementValidationContains(step, options = {}) {
        if (typeof options?.contains === 'boolean') {
            return options.contains;
        }
        if (String(step?.__validationMode || '').toLowerCase() === 'contains') {
            return true;
        }
        const keywordName = String(step?.keyword?.name || step?.keyword || step?.keyword_name || step?.keywordName || '').trim().toLowerCase();
        return keywordName === 'existvalidatecontains';
    };
    async readElementValidationValue(el, rule) {
        switch (rule.attrKey) {
            case 'isselected':
                return await el.isSelected();
            case 'isenabled':
                return await el.isEnabled();
            case 'isdisplayed':
                return await el.isDisplayed();
            case 'gettext':
            case 'innertext':
            case 'text':
                return await el.getText();
            case 'selection':
                return await el.findElement(By.css('option:checked')).getText();
            default:
                return await el.getAttribute(rule.attr);
        }
    };
    async validateElement(step, options = {}) {
        const contains = this.resolveElementValidationContains(step, options);
        const el = await this.findElement(step.xPath, step);
        const rule = this.parseElementValidationRule(step.value, contains);
        const rawActualValue = await this.readElementValidationValue(el, rule);

        if (rawActualValue === null || rawActualValue === undefined) {
            throw new Error(`Attribute "${rule.attr}" was not found on ${step?.xPath || 'the target element'}`);
        }

        const actual = this.normalizeElementValidationValue(rawActualValue);
        const matched = rule.contains ? actual.includes(rule.expected) : actual === rule.expected;

        if (!matched) {
            const comparison = rule.contains ? 'did not contain' : 'did not match';
            throw new Error(`${rule.attr} value ${comparison}. Expected: "${rule.expected}" | Actual: "${actual}"`);
        }

        const comparison = rule.contains ? 'contained' : 'matched';
        return `${rule.attr} value ${comparison}! Value Passed: ${rule.expected} | Value Found: ${actual}`;
    };
    async digitalSignature(step) {
        try {
            // Find the element using the locator
            const el = await this.findElement(step.xPath, step);
            // Create an Actions instance
            const actions = this.driver.actions({ bridge: true });
            // Perform the actions: move to element, click and hold, move by offset, release
            await actions.move({ origin: el })
                .press()
                .move({ x: 10, y: 50 })
                .release()
                .perform();
            // Wait for 1 second
            await this.driver.sleep(1000);
        } catch (error) {
            if (error.name === 'NoSuchElementError') {
                console.error('Element not found:', step?.xPath);
            } else {
                console.error('Error performing digital signature:', error);
            }
        }
    };
    async getElementValue(step) {
        try {
            const el = await this.findElement(step.xPath, step);

            const mainStr = 'isselected isenabled isdisplayed gettext'; // lookup string
            let attr = step.value;

            if (mainStr.includes(attr.toLowerCase())) { // if value in passed to function matches one of the substrings in mainStr then
                attr = attr.toLowerCase();
            }

            let attrValue;
            switch (attr) {
                case 'isselected':
                    attrValue = await el.isSelected();
                    break;
                case 'isenabled':
                    attrValue = await el.isEnabled();
                    break;
                case 'isdisplayed':
                    attrValue = await el.isDisplayed();
                    break;
                case 'gettext':
                    attrValue = await el.getText();
                    break;
                case 'selection':
                    attrValue = await el.findElement(By.css('option:checked')).getText();
                    break;
                default:
                    attrValue = await el.getAttribute(attr);
                    if (attrValue !== null && attrValue !== undefined && attrValue.includes('\n')) {
                        attrValue = attrValue.replace(/[\n\r]/g, ''); // Remove newline characters
                    }
            }
            console.log({ attrValue });
            return attrValue;
        } catch (error) {
            console.error(`Error capturing attribute value: ${error.message}`);
            return null; // Return null or handle the error as needed
        }
    };


    async focusOut(step) {
        console.log(`Value is :  '${step.value}' `);
        const xpathLiteral = value => {
            const text = String(value || '');
            if (!text.includes("'")) {
                return `'${text}'`;
            }
            if (!text.includes('"')) {
                return `"${text}"`;
            }
            const parts = text.split("'");
            const quoted = parts.map(part => `'${part}'`).join(`, "'", `);
            return `concat(${quoted})`;
        };
        const vXpath = `//*[contains(text(),${xpathLiteral(step.value)})]`;
        console.log(`xpath is :  '${vXpath}' `);
        // Find the element using the correct XPath
        const el = await this.findElement(vXpath, step);
        // Click a neutral element to blur the input
        await el.click();
        // Send ESC to ensure overlays like date pickers close
        try {
            const actions = this.driver.actions({ async: true });
            await actions.sendKeys(Key.ESCAPE).perform();
        } catch (err) {
            console.log('focusOut ESC failed (ignored)', err?.message || err);
        }
    };

    async visitXPathRecorderContexts(visitor) {
        if (!this.driver) {
            return;
        }
        const manage = this.driver?.manage?.();
        let previousTimeouts = null;
        try {
            if (manage?.getTimeouts) {
                previousTimeouts = await manage.getTimeouts();
            }
        } catch (_) {
            previousTimeouts = null;
        }
        try {
            if (manage?.setTimeouts) {
                await manage.setTimeouts({ implicit: 0 });
            }
        } catch (_) {}

        try {
            const walk = async (depth, iframeChain) => {
                await visitor(depth, iframeChain);
                let frames = [];
                try {
                    frames = await this.driver.findElements(By.css('iframe, frame'));
                } catch (_) {
                    frames = [];
                }
                for (let index = 0; index < frames.length; index++) {
                    let entered = false;
                    try {
                        const currentFrames = await this.driver.findElements(By.css('iframe, frame'));
                        if (index >= currentFrames.length) {
                            break;
                        }
                        const frameDescriptor = await this.driver.executeScript(function (frameElement, frameIndex) {
                            const quoteXpath = value => {
                                const text = String(value ?? '');
                                if (!text.includes("'")) return `'${text}'`;
                                if (!text.includes('"')) return `"${text}"`;
                                return `concat('${text.split("'").join(`', "'", '`)}')`;
                            };
                            const cssEscape = value =>
                                String(value ?? '').replace(/([ !\"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
                            const buildCss = element => {
                                if (element.id) return `#${cssEscape(element.id)}`;
                                const name = String(element.getAttribute?.('name') || '').trim();
                                if (name) return `${element.tagName.toLowerCase()}[name=\"${cssEscape(name)}\"]`;
                                const classes = Array.from(element.classList || []).filter(Boolean).slice(0, 2);
                                let part = String(element.tagName || '').toLowerCase();
                                if (classes.length) {
                                    part += `.${classes.map(cssEscape).join('.')}`;
                                }
                                return part || `iframe:nth-of-type(${frameIndex + 1})`;
                            };
                        const id = String(frameElement?.id || '').trim();
                        if (id) {
                            return { label: `Iframe ${frameIndex + 1}`, kind: 'xpath', selector: `//*[@id=${quoteXpath(id)}]` };
                        }
                        const name = String(frameElement?.getAttribute?.('name') || '').trim();
                        if (name) {
                            return { label: `Iframe ${frameIndex + 1}`, kind: 'xpath', selector: `//*[@name=${quoteXpath(name)}]` };
                        }
                        return { label: `Iframe ${frameIndex + 1}`, kind: 'css', selector: buildCss(frameElement) };
                    }, currentFrames[index], index);
                        await this.driver.switchTo().frame(currentFrames[index]);
                        entered = true;
                        await walk(depth + 1, [...iframeChain, frameDescriptor]);
                    } catch (_) {
                        // ignore unavailable frame contexts
                    } finally {
                        if (entered) {
                            try {
                                await this.driver.switchTo().parentFrame();
                            } catch (_) {
                                try {
                                    await this.driver.switchTo().defaultContent();
                                } catch (_) {}
                            }
                        }
                    }
                }
            };

            await this.driver.switchTo().defaultContent();
            await walk(0, []);
            await this.driver.switchTo().defaultContent();
        } finally {
            try {
                if (manage?.setTimeouts) {
                    const fallbackImplicit = 10000;
                    const implicit = Number.isFinite(Number(previousTimeouts?.implicit))
                        ? Number(previousTimeouts.implicit)
                        : fallbackImplicit;
                    await manage.setTimeouts({ implicit });
                }
            } catch (_) {}
        }
    }

    async injectXPathRecorderHooks(depth, iframeChain = [], runId = 0) {
        await this.driver.executeScript(injectXPathRecorderHooksScript, depth, iframeChain, runId);
    }

    async injectAdvancedSpyHooks(depth, iframeChain = []) {
        await this.driver.executeScript(injectAdvancedSpyHooksScript, depth, iframeChain);
    }

    async syncAdvancedSpyHooks() {
        const walk = async (depth, iframeChain) => {
            if (!this.advancedSpyActive) return;
            await this.injectAdvancedSpyHooks(depth, iframeChain);
            if (!this.advancedSpyActive) return;
            let frames = [];
            try {
                frames = await this.driver.findElements(By.css('iframe, frame'));
            } catch (_) {
                frames = [];
            }
            for (let index = 0; index < frames.length; index++) {
                if (!this.advancedSpyActive) break;
                let entered = false;
                try {
                    const currentFrames = await this.driver.findElements(By.css('iframe, frame'));
                    if (index >= currentFrames.length) {
                        break;
                    }
                    const frameDescriptor = await this.driver.executeScript(function (frameElement, frameIndex) {
                        const quoteXpath = value => {
                            const text = String(value ?? '');
                            if (!text.includes("'")) return `'${text}'`;
                            if (!text.includes('"')) return `"${text}"`;
                            return `concat('${text.split("'").join(`', "'", '`)}')`;
                        };
                        const cssEscape = value =>
                            String(value ?? '').replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
                        const buildCss = element => {
                            if (element.id) return `#${cssEscape(element.id)}`;
                            const name = String(element.getAttribute?.('name') || '').trim();
                            if (name) return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
                            const classes = Array.from(element.classList || []).filter(Boolean).slice(0, 2);
                            let part = String(element.tagName || '').toLowerCase();
                            if (classes.length) {
                                part += `.${classes.map(cssEscape).join('.')}`;
                            }
                            return part || `iframe:nth-of-type(${frameIndex + 1})`;
                        };
                        const id = String(frameElement?.id || '').trim();
                        if (id) {
                            return {
                                label: `Iframe ${frameIndex + 1}`,
                                kind: 'xpath',
                                selector: `//*[@id=${quoteXpath(id)}]`,
                            };
                        }
                        const name = String(frameElement?.getAttribute?.('name') || '').trim();
                        if (name) {
                            return {
                                label: `Iframe ${frameIndex + 1}`,
                                kind: 'xpath',
                                selector: `//*[@name=${quoteXpath(name)}]`,
                            };
                        }
                        return {
                            label: `Iframe ${frameIndex + 1}`,
                            kind: 'css',
                            selector: buildCss(frameElement),
                        };
                    }, currentFrames[index], index);
                    await this.driver.switchTo().frame(currentFrames[index]);
                    entered = true;
                    await walk(depth + 1, [...iframeChain, frameDescriptor]);
                } catch (_) {
                    // ignore unavailable frame contexts
                } finally {
                    if (entered) {
                        try {
                            await this.driver.switchTo().parentFrame();
                        } catch (_) {
                            try {
                                await this.driver.switchTo().defaultContent();
                            } catch (_) {}
                        }
                    }
                }
            }
        };

        await this.driver.switchTo().defaultContent();
        await walk(0, []);
        await this.driver.switchTo().defaultContent();
    }

    async syncXPathRecorderHooks() {
        const activeRunId = Number(this.recorderRunId || 0);
        await this.visitXPathRecorderContexts(async (depth, iframeChain) => {
            await this.injectXPathRecorderHooks(depth, iframeChain, activeRunId);
        });
    }

    cancelDeferredRecorderCleanup() {
        if (this.recorderDeferredCleanupTimer) {
            clearTimeout(this.recorderDeferredCleanupTimer);
            this.recorderDeferredCleanupTimer = null;
        }
    }

    scheduleDeferredRecorderCleanup(stopSeq, delayMs = 800) {
        this.cancelDeferredRecorderCleanup();
        this.recorderDeferredCleanupTimer = setTimeout(async () => {
            try {
                if (this.recorderActive || this.recorderLifecycleSeq !== stopSeq) {
                    return;
                }
                const driverRef = this.driver;
                if (!driverRef) {
                    return;
                }
                const hasSession = await this.hasValidSession();
                if (!hasSession) {
                    return;
                }
                if (this.driver !== driverRef) {
                    return;
                }
                await this.visitXPathRecorderContexts(async () => {
                    if (!this.driver || this.driver !== driverRef) {
                        return;
                    }
                    await this.driver.executeScript(function () {
                        const state = window.__qaSelectorSpy;
                        if (!state || state.active === true) return;
                        const listenerRoots = Array.isArray(state.listenerRoots) && state.listenerRoots.length
                            ? state.listenerRoots
                            : [document];
                        listenerRoots.forEach(root => {
                            try {
                                if (state.onMove) root.removeEventListener('pointermove', state.onMove, true);
                                if (state.onLeave) root.removeEventListener('pointerleave', state.onLeave, true);
                                if (state.onPointerDown) root.removeEventListener('pointerdown', state.onPointerDown, true);
                            } catch (_) {}
                        });
                        state.listenerRoots = [];
                        state.queue = [];
                        state.hover = null;
                        state.selected = null;
                        state.lastTarget = null;
                        document.getElementById('qa-selectorhub-overlay')?.remove();
                        document.getElementById('qa-selectorhub-tip')?.remove();
                    });
                });
            } catch (error) {
                if (!isIgnorableDriverShutdownError(error)) {
                    console.error('Error in deferred XPath recorder cleanup:', error);
                }
            } finally {
                this.recorderDeferredCleanupTimer = null;
            }
        }, delayMs);
    }

    scheduleXPathRecorderSyncLoop() {
        if (this.recorderSyncTimer) {
            clearTimeout(this.recorderSyncTimer);
            this.recorderSyncTimer = null;
        }
        const run = async () => {
            if (!this.recorderActive) {
                this.recorderSyncTimer = null;
                return;
            }
            if (this.recorderLifecycleBusy) {
                this.recorderSyncTimer = setTimeout(run, 250);
                return;
            }
            const idleSinceFetchMs = Date.now() - Number(this.recorderLastFetchAt || 0);
            if (idleSinceFetchMs < 1200) {
                this.recorderSyncTimer = setTimeout(run, 400);
                return;
            }
            if (this.recorderFetchInFlight || this.recorderSyncInFlight) {
                this.recorderSyncTimer = setTimeout(run, 250);
                return;
            }
            try {
                this.recorderSyncInFlight = true;
                await this.syncXPathRecorderHooks();
            } catch (error) {
                if (!isIgnorableDriverShutdownError(error)) {
                    console.error('Error syncing XPath recorder frame hooks:', error);
                }
            } finally {
                this.recorderSyncInFlight = false;
                if (this.recorderActive) {
                    this.recorderSyncTimer = setTimeout(run, 2200);
                } else {
                    this.recorderSyncTimer = null;
                }
            }
        };
        this.recorderSyncTimer = setTimeout(run, 1800);
    }

    enqueueRecorderLifecycleOp(task) {
        const run = async () => {
            this.recorderLifecycleBusy = true;
            try {
                return await task();
            } finally {
                this.recorderLifecycleBusy = false;
            }
        };
        const chain = this.recorderLifecycleChain || Promise.resolve();
        const next = chain.then(run, run);
        this.recorderLifecycleChain = next.catch(() => {});
        return next;
    }

    async startXPathRecorder() {
        return this.enqueueRecorderLifecycleOp(async () => {
            try {
                lastWebActionsInstance = this;
                console.log('[spy-recorder] start requested');
                this.recorderLifecycleSeq += 1;
                this.recorderRunId += 1;
                this.cancelDeferredRecorderCleanup();
                this.recorderActive = true;
                if (this.recorderSyncTimer) {
                    clearTimeout(this.recorderSyncTimer);
                    this.recorderSyncTimer = null;
                }
                await this.driver.switchTo().defaultContent();
                await this.driver.executeScript(function () {
                    const state = window.__qaSelectorSpy;
                    if (state) {
                        state.active = false;
                        const listenerRoots = Array.isArray(state.listenerRoots) && state.listenerRoots.length
                            ? state.listenerRoots
                            : [document];
                        listenerRoots.forEach(root => {
                            try {
                                if (state.onMove) root.removeEventListener('pointermove', state.onMove, true);
                                if (state.onLeave) root.removeEventListener('pointerleave', state.onLeave, true);
                                if (state.onPointerDown) root.removeEventListener('pointerdown', state.onPointerDown, true);
                            } catch (_) {}
                        });
                        state.listenerRoots = [];
                        state.queue = [];
                        state.hover = null;
                        state.selected = null;
                        state.lastTarget = null;
                    }
                    window.__qaSelectorSpyPending = null;
                    window.__qaSelectorSpyLive = null;
                    document.getElementById('qa-selectorhub-overlay')?.remove();
                    document.getElementById('qa-selectorhub-tip')?.remove();
                });
                await this.injectXPathRecorderHooks(0, [], this.recorderRunId);
                // Ensure iframe contexts are hooked immediately so first interaction inside frames is captured.
                await this.syncXPathRecorderHooks();
                this.scheduleXPathRecorderSyncLoop();
                console.log('[spy-recorder] start armed');
            } catch (error) {
                console.error('Error starting XPath recorder:', error);
            }
        });
    }

    async stopXPathRecorder() {
        return this.enqueueRecorderLifecycleOp(async () => {
            console.log('[spy-recorder] stop requested');
            const stopSeq = ++this.recorderLifecycleSeq;
            this.cancelDeferredRecorderCleanup();
            this.recorderActive = false;
            if (this.recorderSyncTimer) {
                clearTimeout(this.recorderSyncTimer);
                this.recorderSyncTimer = null;
            }
            const hasSession = await this.hasValidSession();
            if (!hasSession) {
                console.log('[spy-recorder] stop complete');
                return;
            }
            try {
                // Fast local teardown for immediate UI response.
                await this.driver.switchTo().defaultContent();
                await this.driver.executeScript(function () {
                    const state = window.__qaSelectorSpy;
                    if (state) {
                        state.active = false;
                        state.hover = null;
                        state.lastTarget = null;
                        state.selected = null;
                        const listenerRoots = Array.isArray(state.listenerRoots) && state.listenerRoots.length
                            ? state.listenerRoots
                            : [document];
                        listenerRoots.forEach(root => {
                            try {
                                if (state.onMove) root.removeEventListener('pointermove', state.onMove, true);
                                if (state.onLeave) root.removeEventListener('pointerleave', state.onLeave, true);
                                if (state.onPointerDown) root.removeEventListener('pointerdown', state.onPointerDown, true);
                            } catch (_) {}
                        });
                        state.listenerRoots = [];
                    }
                    window.__qaSelectorSpyPending = null;
                    window.__qaSelectorSpyLive = null;
                    document.getElementById('qa-selectorhub-overlay')?.remove();
                    document.getElementById('qa-selectorhub-tip')?.remove();
                });
                // Defer deep cross-frame cleanup so stop returns quickly.
                this.scheduleDeferredRecorderCleanup(stopSeq, 800);
            } catch (error) {
                // swallow unexpected alerts so normal steps keep running
                if (error?.name === 'UnexpectedAlertOpenError' || (error?.message || '').includes('unexpected alert open')) {
                    try {
                        const alert = await this.driver.switchTo().alert();
                        await alert.dismiss().catch(async () => await alert.accept());
                    } catch (_) {
                        // ignore if no alert or dismiss/accept failed
                    }
                } else if (
                    error?.name === 'NoSuchSessionError'
                    || (error?.message || '').includes('ECONNREFUSED')
                    || (error?.message || '').includes('invalid session ID')
                    || (error?.message || '').includes('This driver instance does not have a valid session ID')
                ) {
                    // ignore dead-session recorder cleanup during browser shutdown
                } else {
                    console.error('Error stopping XPath recorder:', error);
                }
            } finally {
                console.log('[spy-recorder] stop complete');
            }
        });
    }

    async fetchRecordedXPath() {
        if (this.recorderFetchInFlight) {
            return { paths: [], locator: '', value: '', locatorKind: '', iframeChain: [], shadowChain: [], tip: '', source: 'none', capturedAt: null };
        }
        return this.enqueueRecorderLifecycleOp(async () => {
            this.recorderLastFetchAt = Date.now();
            this.recorderFetchInFlight = true;
            try {
                const expectedRunId = Number(this.recorderRunId || 0);
                const hasSession = await this.hasValidSession();
                if (!hasSession) {
                    this.recorderActive = false;
                    return { paths: [], locator: '', tip: '', source: 'inactive' };
                }
            const clearSpyUiInAllContexts = async () => {
                await this.visitXPathRecorderContexts(async () => {
                    await this.driver.executeScript(function () {
                        const state = window.__qaSelectorSpy;
                        if (state) {
                            state.active = false;
                            state.hover = null;
                            state.lastTarget = null;
                            if (state.onMove) document.removeEventListener('pointermove', state.onMove, true);
                            if (state.onLeave) document.removeEventListener('pointerleave', state.onLeave, true);
                            if (state.onPointerDown) document.removeEventListener('pointerdown', state.onPointerDown, true);
                        }
                        const overlay = document.getElementById('qa-selectorhub-overlay');
                        const tip = document.getElementById('qa-selectorhub-tip');
                        if (overlay) {
                            overlay.style.opacity = '0';
                            overlay.style.width = '0px';
                            overlay.style.height = '0px';
                        }
                        if (tip) {
                            tip.style.opacity = '0';
                            tip.textContent = '';
                        }
                    });
                });
            };
            await this.driver.switchTo().defaultContent();
            const topLevelSpyState = await this.driver.executeScript(function (activeRunId) {
                const readPending = win => {
                    try {
                        const pending = win.__qaSelectorSpyPending;
                        if (pending?.locator) {
                            const pendingRunId = Number(pending.runId || 0);
                            if (pendingRunId === Number(activeRunId || 0)) {
                                win.__qaSelectorSpyPending = null;
                                return pending;
                            }
                            win.__qaSelectorSpyPending = null;
                        }
                    } catch (_) {}
                    return null;
                };
                const readLive = win => {
                    try {
                        const live = win.__qaSelectorSpyLive;
                        if (live?.locator) {
                            const liveRunId = Number(live.runId || 0);
                            if (liveRunId === Number(activeRunId || 0)) {
                                return live;
                            }
                        }
                    } catch (_) {}
                    return null;
                };
                const rootWindow = window.top || window;
                return {
                    pending: readPending(rootWindow) || readPending(window),
                    live: readLive(rootWindow) || readLive(window),
                };
            }, expectedRunId);
            const pendingSelection = topLevelSpyState?.pending || null;
            if (pendingSelection?.locator) {
                const captureAgeMs = Number.isFinite(Number(pendingSelection.capturedAt))
                    ? Math.max(0, Date.now() - Number(pendingSelection.capturedAt))
                    : null;
                console.log('[spy-recorder] fetch click', {
                    locator: pendingSelection.locator || '',
                    value: pendingSelection.value || '',
                    captureAgeMs,
                });
                return {
                    paths: Array.isArray(pendingSelection.paths) ? pendingSelection.paths : [],
                    locator: pendingSelection.locator || '',
                    value: pendingSelection.value || '',
                    locatorKind: pendingSelection.locatorKind || '',
                    iframeChain: Array.isArray(pendingSelection.iframeChain) ? pendingSelection.iframeChain : [],
                    shadowChain: Array.isArray(pendingSelection.shadowChain) ? pendingSelection.shadowChain : [],
                    tip: pendingSelection.tip || '',
                    source: 'click',
                    capturedAt: pendingSelection.capturedAt || null,
                    captureAgeMs,
                };
            }
            // Do not return top-window live hover directly.
            // We resolve hover from all accessible contexts below and prefer the deepest one.
            const snapshot = await this.driver.executeScript(function (activeRunId) {
                const empty = { depth: -1, paths: [], locator: '', value: '', locatorKind: '', iframeChain: [], shadowChain: [], tip: '', capturedAt: null };
                const clonePayload = payload => ({
                    depth: Number.isFinite(payload?.depth) ? payload.depth : -1,
                    paths: Array.isArray(payload?.paths) ? payload.paths : [],
                    locator: payload?.locator || '',
                    value: payload?.value || '',
                    locatorKind: payload?.locatorKind || '',
                    iframeChain: Array.isArray(payload?.iframeChain) ? payload.iframeChain : [],
                    shadowChain: Array.isArray(payload?.shadowChain) ? payload.shadowChain : [],
                    tip: payload?.tip || '',
                    runId: Number(payload?.runId || 0),
                    capturedAt: payload?.capturedAt || null,
                });
                const best = {
                    selected: { ...empty },
                    hover: { ...empty },
                    queue: { ...empty },
                };
                const windowsByDepth = [];
                const visited = new Set();

                const visit = (win, depth) => {
                    if (!win || visited.has(win)) return;
                    visited.add(win);
                    let state = null;
                    try {
                        state = win.__qaSelectorSpy || null;
                    } catch (_) {
                        state = null;
                    }
                    windowsByDepth.push({ win, depth });
                    if (state) {
                        const selected = clonePayload(state.selected);
                        const hover = clonePayload(state.hover);
                        const queued = clonePayload(Array.isArray(state.queue) && state.queue.length ? state.queue.shift() : null);
                        if (selected.locator && selected.runId === Number(activeRunId || 0) && depth >= best.selected.depth) {
                            best.selected = { ...selected, depth };
                        }
                        if (hover.locator && hover.runId === Number(activeRunId || 0) && depth >= best.hover.depth) {
                            best.hover = { ...hover, depth };
                        }
                        if (queued.locator && queued.runId === Number(activeRunId || 0) && depth >= best.queue.depth) {
                            best.queue = { ...queued, depth };
                        }
                        if (!state.active && selected.locator && selected.runId === Number(activeRunId || 0) && depth >= best.queue.depth) {
                            best.queue = { ...selected, depth };
                        }
                    }
                    try {
                        const frames = Array.from(win.document?.querySelectorAll?.('iframe, frame') || []);
                        frames.forEach(frame => {
                            try {
                                if (frame.contentWindow) {
                                    visit(frame.contentWindow, depth + 1);
                                }
                            } catch (_) {}
                        });
                    } catch (_) {}
                };

                let rootWindow = window;
                while (true) {
                    let parentWindow = null;
                    try {
                        parentWindow = rootWindow.parent;
                    } catch (_) {
                        break;
                    }
                    if (!parentWindow || parentWindow === rootWindow) break;
                    rootWindow = parentWindow;
                }
                visit(rootWindow, 0);

                const activeDepth = best.queue.locator
                    ? best.queue.depth
                    : best.hover.locator
                        ? best.hover.depth
                        : best.selected.depth;

                if (activeDepth >= 0) {
                    windowsByDepth.forEach(({ win, depth }) => {
                        if (depth === activeDepth) return;
                        try {
                            const state = win.__qaSelectorSpy;
                            if (state) {
                                state.hover = null;
                                state.lastTarget = null;
                            }
                            const overlay = win.document.getElementById('qa-selectorhub-overlay');
                            const tip = win.document.getElementById('qa-selectorhub-tip');
                            if (overlay) {
                                overlay.style.opacity = '0';
                                overlay.style.width = '0px';
                                overlay.style.height = '0px';
                            }
                            if (tip) {
                                tip.style.opacity = '0';
                                tip.textContent = '';
                            }
                        } catch (_) {}
                    });
                }

                return best;
            }, expectedRunId);
            const bestQueue = snapshot?.queue || { depth: -1, paths: [], locator: '', tip: '' };
            const bestHover = snapshot?.hover || { depth: -1, paths: [], locator: '', tip: '' };
            const bestSelected = snapshot?.selected || { depth: -1, paths: [], locator: '', tip: '' };
            if (bestQueue.locator) {
                const captureAgeMs = Number.isFinite(Number(bestQueue.capturedAt))
                    ? Math.max(0, Date.now() - Number(bestQueue.capturedAt))
                    : null;
                return {
                    paths: bestQueue.paths,
                    locator: bestQueue.locator,
                    value: bestQueue.value || '',
                    locatorKind: bestQueue.locatorKind || '',
                    iframeChain: Array.isArray(bestQueue.iframeChain) ? bestQueue.iframeChain : [],
                    shadowChain: Array.isArray(bestQueue.shadowChain) ? bestQueue.shadowChain : [],
                    tip: bestQueue.tip,
                    source: 'click',
                    capturedAt: bestQueue.capturedAt || null,
                    captureAgeMs,
                };
            }
            if (bestHover.locator) {
                const captureAgeMs = Number.isFinite(Number(bestHover.capturedAt))
                    ? Math.max(0, Date.now() - Number(bestHover.capturedAt))
                    : null;
                return {
                    paths: bestHover.paths,
                    locator: bestHover.locator,
                    value: bestHover.value || '',
                    locatorKind: bestHover.locatorKind || '',
                    iframeChain: Array.isArray(bestHover.iframeChain) ? bestHover.iframeChain : [],
                    shadowChain: Array.isArray(bestHover.shadowChain) ? bestHover.shadowChain : [],
                    tip: bestHover.tip,
                    source: 'hover',
                    capturedAt: bestHover.capturedAt || null,
                    captureAgeMs,
                };
            }
            if (bestSelected.locator) {
                return {
                    paths: bestSelected.paths,
                    locator: bestSelected.locator,
                    value: bestSelected.value || '',
                    locatorKind: bestSelected.locatorKind || '',
                    iframeChain: Array.isArray(bestSelected.iframeChain) ? bestSelected.iframeChain : [],
                    shadowChain: Array.isArray(bestSelected.shadowChain) ? bestSelected.shadowChain : [],
                    tip: bestSelected.tip,
                    source: 'selected',
                    capturedAt: bestSelected.capturedAt || null,
                };
            }
            return { paths: [], locator: '', value: '', locatorKind: '', iframeChain: [], shadowChain: [], tip: '', source: 'none', capturedAt: null };
        } catch (error) {
            if (!isIgnorableDriverShutdownError(error)) {
                console.error('Error fetching recorded XPath:', error);
            }
            return { paths: [], locator: '', value: '', locatorKind: '', iframeChain: [], shadowChain: [], tip: '', source: 'error', capturedAt: null };
        } finally {
            this.recorderFetchInFlight = false;
        }
        });
    }

    async startAdvancedSpy() {
        try {
            lastWebActionsInstance = this;
            this.advancedSpyActive = true;
            await this.driver.switchTo().defaultContent();
            await this.injectAdvancedSpyHooks(0, []);
            Promise.resolve().then(async () => {
                try {
                    if (!this.advancedSpyActive) return;
                    await this.syncAdvancedSpyHooks();
                } catch (error) {
                    if (!isIgnorableDriverShutdownError(error)) {
                        console.error('Error syncing Advanced Spy frame hooks:', error);
                    }
                }
            });
        } catch (error) {
            console.error('Error starting Advanced Spy:', error);
        }
    }

    async stopAdvancedSpy() {
        this.advancedSpyActive = false;
        const hasSession = await this.hasValidSession();
        if (!hasSession) return;
        try {
            await this.visitXPathRecorderContexts(async () => {
                await this.driver.executeScript(function () {
                    try {
                        window.__qaAdvancedSpyStopToken = Number(window.__qaAdvancedSpyStopToken || 0) + 1;
                    } catch (_) {}
                    const state = window.__qaAdvancedSpy;
                    if (state) {
                        state.active = false;
                        if (state.onMove) document.removeEventListener('pointermove', state.onMove, true);
                        if (state.onLeave) document.removeEventListener('pointerleave', state.onLeave, true);
                        if (state.onPointerDown) document.removeEventListener('pointerdown', state.onPointerDown, true);
                        if (state.onClick) document.removeEventListener('click', state.onClick, true);
                        if (state.onMessage) window.removeEventListener('message', state.onMessage, true);
                        state.selected = null;
                        state.lastTarget = null;
                    }
                    document.getElementById('qa-advanced-spy-overlay')?.remove();
                    document.getElementById('qa-advanced-spy-tip')?.remove();
                });
            });
        } catch (error) {
            if (error?.name === 'UnexpectedAlertOpenError' || (error?.message || '').includes('unexpected alert open')) {
                try {
                    const alert = await this.driver.switchTo().alert();
                    await alert.dismiss().catch(async () => await alert.accept());
                } catch (_) {}
            } else if (!isIgnorableDriverShutdownError(error)) {
                console.error('Error stopping Advanced Spy:', error);
            }
        }
    }

    async fetchAdvancedSpyCapture() {
        try {
            const hasSession = await this.hasValidSession();
            if (!hasSession) {
                this.advancedSpyActive = false;
                return { active: false, source: 'inactive', message: 'Advanced Spy session is inactive.' };
            }
            await this.driver.switchTo().defaultContent();
            const payload = await this.driver.executeScript(function () {
                const readPending = win => {
                    try {
                        const pending = win.__qaAdvancedSpyPending;
                        if (pending?.contract) {
                            win.__qaAdvancedSpyPending = null;
                            return pending;
                        }
                    } catch (_) {}
                    return null;
                };
                const rootWindow = window.top || window;
                return readPending(rootWindow) || readPending(window) || null;
            });
            if (payload?.contract) {
                this.advancedSpyActive = false;
                return {
                    ...payload,
                    active: false,
                    message: 'Advanced Spy capture ready.',
                };
            }
            return {
                active: this.advancedSpyActive === true,
                source: 'none',
                message: 'Waiting for an Advanced Spy click capture.',
            };
        } catch (error) {
            if (!isIgnorableDriverShutdownError(error)) {
                console.error('Error fetching Advanced Spy payload:', error);
            }
            return { active: false, source: 'error', message: 'Advanced Spy payload fetch failed.' };
        }
    }

}

module.exports = {
    WebActions,
    activeWebDrivers,
    getLastWebActionsInstance: () => lastWebActionsInstance,
    clearLastWebActionsInstance,
    removeActiveWebDriver,
    quitWithTimeout,
}



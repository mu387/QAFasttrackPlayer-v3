const fs = require('fs');
const path = require('path');
const { By } = require('selenium-webdriver');
const { WebActions } = require('../src/ui/automation/webActions');

const BASE_URL = process.env.XPATH_PARITY_URL || 'https://beta-ui.qafasttrack.com/qapractice/index.html';
const FIXTURE_PATH = process.env.XPATH_PARITY_FIXTURE || path.join(__dirname, 'fixtures', 'xpath_parity_targets.json');
const REPORT_PATH = process.env.XPATH_PARITY_REPORT || path.join(__dirname, 'reports', 'xpath_parity_report.json');
const FETCH_TIMEOUT_MS = Number(process.env.XPATH_PARITY_FETCH_TIMEOUT_MS || 5000);
const FETCH_POLL_MS = Number(process.env.XPATH_PARITY_FETCH_POLL_MS || 70);
const INTERACTION_PAUSE_MS = Number(process.env.XPATH_PARITY_INTERACTION_PAUSE_MS || 150);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const normalizeXpath = value =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .toLowerCase();

const parseFixture = fixturePath => {
  const absolute = path.resolve(fixturePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Fixture file not found: ${absolute}`);
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  const json = JSON.parse(raw);
  if (!Array.isArray(json?.cases)) {
    throw new Error('Fixture format invalid: expected { "cases": [ ... ] }');
  }
  return { absolute, cases: json.cases };
};

const findElement = async (driver, target) => {
  if (!target?.by || !target?.value) {
    throw new Error('Target must include "by" and "value".');
  }
  if (target.by === 'xpath') return driver.findElement(By.xpath(target.value));
  if (target.by === 'css') return driver.findElement(By.css(target.value));
  if (target.by === 'id') return driver.findElement(By.id(target.value));
  if (target.by === 'name') return driver.findElement(By.name(target.value));
  throw new Error(`Unsupported target by="${target.by}"`);
};

const runPreSteps = async (wa, steps = []) => {
  for (const step of steps) {
    const action = String(step?.action || '').trim();
    if (!action) continue;
    if (action === 'navigate') {
      await wa.navigate({ value: String(step.value || BASE_URL) });
      continue;
    }
    if (action === 'sleep') {
      await sleep(Number(step.ms || 200));
      continue;
    }
    if (action === 'switchDefault') {
      await wa.driver.switchTo().defaultContent();
      continue;
    }
    if (action === 'switchIframe') {
      await wa.switchToIframe({ value: String(step.value || ''), xPath: '', highlight: false });
      continue;
    }
    if (action === 'click') {
      const el = await findElement(wa.driver, { by: step.by, value: step.value });
      await wa.driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });", el);
      await sleep(50);
      await el.click();
      await sleep(Number(step.postWaitMs || 150));
      continue;
    }
    throw new Error(`Unsupported preStep action="${action}"`);
  }
};

const findElementWithRetry = async (driver, target, attempts = 20, delayMs = 120) => {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await findElement(driver, target);
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw lastError || new Error('Unable to locate target element.');
};

const waitForClickPayload = async wa => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < FETCH_TIMEOUT_MS) {
    last = await wa.fetchRecordedXPath();
    if (last?.source === 'click' && last?.locator) {
      return { ok: true, payload: last, elapsedMs: Date.now() - started };
    }
    await sleep(FETCH_POLL_MS);
  }
  return { ok: false, payload: last, elapsedMs: Date.now() - started };
};

const checkUniqueInCapturedContext = async (wa, payload, xpath) => {
  if (!xpath) return { unique: false, count: null };
  try {
    await wa.driver.switchTo().defaultContent();
    if (payload?.value) {
      await wa.switchToIframe({ value: payload.value, xPath: '', highlight: false });
    }
    const elements = await wa.driver.findElements(By.xpath(xpath));
    await wa.driver.switchTo().defaultContent();
    return { unique: elements.length === 1, count: elements.length };
  } catch (_) {
    try {
      await wa.driver.switchTo().defaultContent();
    } catch (_) {}
    return { unique: false, count: null };
  }
};

const compareAgainstSelectorHub = (captured, reference) => {
  const refPrimary = String(reference?.primary || '');
  const refFallbacks = Array.isArray(reference?.fallbacks) ? reference.fallbacks.map(String) : [];
  const refAll = [refPrimary, ...refFallbacks].filter(Boolean);
  const currentPrimary = String(captured?.locator || '');
  const currentFallbacks = Array.isArray(captured?.paths) ? captured.paths.map(String) : [];
  const currentAll = [currentPrimary, ...currentFallbacks].filter(Boolean);

  const nCurrentPrimary = normalizeXpath(currentPrimary);
  const nRefPrimary = normalizeXpath(refPrimary);
  const nRefAll = new Set(refAll.map(normalizeXpath));
  const nCurrentAll = new Set(currentAll.map(normalizeXpath));

  const overlap = [...nCurrentAll].filter(item => nRefAll.has(item)).length;
  const primaryExact = nCurrentPrimary !== '' && nCurrentPrimary === nRefPrimary;
  const primaryInRefSet = nCurrentPrimary !== '' && nRefAll.has(nCurrentPrimary);
  const valueExact = normalizeXpath(captured?.value || '') === normalizeXpath(reference?.value || '');

  return {
    primaryExact,
    primaryInRefSet,
    fallbackOverlapCount: overlap,
    fallbackOverlapRatio: nRefAll.size ? Number((overlap / nRefAll.size).toFixed(3)) : 0,
    valueExact,
  };
};

async function run() {
  const wa = new WebActions();
  const { absolute: resolvedFixturePath, cases } = parseFixture(FIXTURE_PATH);
  const report = {
    generated_at: new Date().toISOString(),
    fixture_path: resolvedFixturePath,
    base_url: BASE_URL,
    totals: {
      cases: cases.length,
      passed_capture: 0,
      failed_capture: 0,
      compared_with_reference: 0,
      primary_exact_matches: 0,
    },
    results: [],
  };

  try {
    await wa.launchBrowser({ value: 'chrome', forceCleanup: true });

    for (let i = 0; i < cases.length; i += 1) {
      const testCase = cases[i];
      const caseName = String(testCase?.name || `case_${i + 1}`);
      const result = {
        index: i + 1,
        name: caseName,
        status: 'failed_capture',
        captured: null,
        reference: testCase?.selectorhub || null,
        comparison: null,
        uniqueness: null,
        error: null,
      };

      try {
        await wa.navigate({ value: String(testCase?.url || BASE_URL) });
        await runPreSteps(wa, testCase?.preSteps || []);
        await wa.startXPathRecorder();
        try {
          await runPreSteps(wa, testCase?.postStartSteps || []);
          const target = await findElementWithRetry(wa.driver, testCase?.target || {}, Number(testCase?.targetRetryAttempts || 25), 120);
          await wa.driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'center' });", target);
          await sleep(INTERACTION_PAUSE_MS);
          await wa.driver.actions({ async: true }).move({ origin: target }).pause(25).click().perform();
          const click = await waitForClickPayload(wa);
          if (!click.ok) {
            throw new Error(`No click payload captured within timeout. Last payload=${JSON.stringify(click.payload || {})}`);
          }
          result.captured = click.payload;
          result.status = 'captured';
          report.totals.passed_capture += 1;

          const uniqueness = await checkUniqueInCapturedContext(wa, click.payload, click.payload?.locator);
          result.uniqueness = uniqueness;

          if (testCase?.selectorhub && testCase.selectorhub.primary) {
            result.comparison = compareAgainstSelectorHub(click.payload, testCase.selectorhub);
            report.totals.compared_with_reference += 1;
            if (result.comparison.primaryExact) {
              report.totals.primary_exact_matches += 1;
            }
          }
        } finally {
          await wa.stopXPathRecorder();
        }
      } catch (error) {
        result.error = error?.message || String(error);
        report.totals.failed_capture += 1;
      }

      report.results.push(result);
      console.log(`[parity] ${result.index}/${cases.length} ${caseName} -> ${result.status}`);
    }
  } finally {
    try {
      await wa.closeBrowser();
    } catch (_) {}
  }

  const reportDir = path.dirname(REPORT_PATH);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`[parity] report written: ${REPORT_PATH}`);
  console.log(
    `[parity] compared=${report.totals.compared_with_reference} primary_exact=${report.totals.primary_exact_matches}/${report.totals.compared_with_reference}`,
  );
}

run().catch(error => {
  console.error('[parity] fatal error', error);
  process.exitCode = 1;
});

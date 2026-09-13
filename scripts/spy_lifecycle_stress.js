const { By } = require('selenium-webdriver');
const { WebActions } = require('../src/ui/automation/webActions');

const TEST_URL = process.env.SPY_TEST_URL || 'https://beta-ui.qafasttrack.com/qapractice/index.html';
const CYCLES = Number(process.env.SPY_TEST_CYCLES || 20);
const HOVER_TIMEOUT_MS = Number(process.env.SPY_HOVER_TIMEOUT_MS || 4000);
const CLICK_TIMEOUT_MS = Number(process.env.SPY_CLICK_TIMEOUT_MS || 4000);
const FETCH_POLL_MS = Number(process.env.SPY_FETCH_POLL_MS || 70);

const TARGETS = [
  "//*[@id='fullName']",
  "//*[@id='email']",
  "//*[@id='currentAddress']",
  "//*[@id='permanentAddress']",
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const expectedIdFromXpath = xpath => {
  const match = String(xpath || '').match(/@id=['"]([^'"]+)['"]/i);
  return match ? match[1] : '';
};

const locatorMatchesExpected = (locator, expectedId) => {
  if (!locator) return false;
  if (!expectedId) return true;
  return String(locator).includes(expectedId);
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
};

const waitForFetch = async (wa, wantedSource, timeoutMs, matcher = null) => {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await wa.fetchRecordedXPath();
    if (last?.source === wantedSource && last?.locator && (!matcher || matcher(last))) {
      return { ok: true, payload: last, elapsedMs: Date.now() - startedAt };
    }
    await sleep(FETCH_POLL_MS);
  }
  return {
    ok: false,
    payload: last,
    elapsedMs: Date.now() - startedAt,
    reason: `${wantedSource} timeout`,
  };
};

const switchToContentFrameIfPresent = async wa => {
  await wa.driver.switchTo().defaultContent();
  const frames = await wa.driver.findElements(By.css('iframe#contentFrame, frame#contentFrame, iframe, frame'));
  if (!frames.length) return false;
  await wa.driver.switchTo().frame(frames[0]);
  return true;
};

const waitForElementInCurrentContext = async (wa, targetXpath, attempts = 16, sleepMs = 120) => {
  for (let i = 0; i < attempts; i += 1) {
    const elements = await wa.driver.findElements(By.xpath(targetXpath));
    if (elements.length > 0) return elements[0];
    await sleep(sleepMs);
  }
  return null;
};

const ensureTargetContext = async (wa, targetXpath, attempts = 8) => {
  await wa.navigate({ value: TEST_URL });
  try {
    const textBoxLinks = await wa.driver.findElements(By.css("a[data-page='pages/elements/textbox.html']"));
    if (textBoxLinks.length > 0) {
      await wa.driver.executeScript(
        "arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });",
        textBoxLinks[0],
      );
      await textBoxLinks[0].click();
      await sleep(220);
    }
  } catch (_) {}
  await switchToContentFrameIfPresent(wa);
  const target = await waitForElementInCurrentContext(wa, targetXpath, attempts, 120);
  return !!target;
};

const startRecorderForTarget = async (wa, expectedId, maxAttempts = 3) => {
  let lastStartMs = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startTs = Date.now();
    await wa.startXPathRecorder();
    lastStartMs = Date.now() - startTs;

    // Guard window: detect accidental click capture before target interaction.
    const guardStartedAt = Date.now();
    let strayClick = false;
    while (Date.now() - guardStartedAt < 350) {
      const snap = await wa.fetchRecordedXPath();
      if (snap?.source === 'click' && !locatorMatchesExpected(snap?.locator, expectedId)) {
        strayClick = true;
        break;
      }
      await sleep(35);
    }
    if (!strayClick) {
      return { ok: true, startMs: lastStartMs, attempts: attempt };
    }
    try {
      await wa.stopXPathRecorder();
    } catch (_) {}
    await sleep(80);
  }
  return { ok: false, startMs: lastStartMs, attempts: maxAttempts };
};

async function run() {
  const wa = new WebActions();
  const stats = {
    startMs: [],
    hoverFetchMs: [],
    clickFetchMs: [],
    clickTotalMs: [],
    stopMs: [],
    failures: [],
  };

  try {
    await wa.launchBrowser({ value: 'chrome', forceCleanup: true });
    await wa.navigate({ value: TEST_URL });
    await sleep(500);
    // Warmup cycle to clear any initial page-level noise before measurement cycles.
    await wa.startXPathRecorder();
    await sleep(150);
    await wa.stopXPathRecorder();
    await sleep(120);

    for (let i = 0; i < CYCLES; i += 1) {
      const targetXpath = TARGETS[i % TARGETS.length];
      const expectedId = expectedIdFromXpath(targetXpath);
      const cycleId = i + 1;
      const cycleStart = Date.now();

      try {
        const contextReady = await ensureTargetContext(wa, targetXpath, 10);
        if (!contextReady) {
          throw new Error(`target not ready in context: ${targetXpath}`);
        }

        const arm = await startRecorderForTarget(wa, expectedId, 3);
        if (!arm.ok) {
          throw new Error(`failed to arm recorder for target ${targetXpath} after ${arm.attempts} attempts`);
        }
        const startMs = arm.startMs;
        stats.startMs.push(startMs);

        await switchToContentFrameIfPresent(wa);
        const element = await waitForElementInCurrentContext(wa, targetXpath, 20, 120);
        if (!element) {
          throw new Error(`target missing after recorder arm: ${targetXpath}`);
        }
        await wa.driver.executeScript(
          "arguments[0].scrollIntoView({ block: 'center', inline: 'center' });",
          element,
        );
        await sleep(60);
        await wa.driver
          .actions({ async: true })
          .move({ origin: element })
          .pause(20)
          .perform();

        const hoverResult = await waitForFetch(
          wa,
          'hover',
          HOVER_TIMEOUT_MS,
          payload => locatorMatchesExpected(payload?.locator, expectedId),
        );
        if (!hoverResult.ok) {
          throw new Error(
            `hover capture failed (${hoverResult.reason}) target=${targetXpath} last=${JSON.stringify(
              hoverResult.payload || {},
            )}`,
          );
        }
        stats.hoverFetchMs.push(hoverResult.elapsedMs);

        const clickWaitStart = Date.now();
        await element.click();
        const clickResult = await waitForFetch(
          wa,
          'click',
          CLICK_TIMEOUT_MS,
          payload => locatorMatchesExpected(payload?.locator, expectedId),
        );
        if (!clickResult.ok) {
          throw new Error(
            `click capture failed (${clickResult.reason}) target=${targetXpath} last=${JSON.stringify(
              clickResult.payload || {},
            )}`,
          );
        }
        stats.clickFetchMs.push(clickResult.elapsedMs);
        stats.clickTotalMs.push(Date.now() - clickWaitStart);

        const stopTs = Date.now();
        await wa.stopXPathRecorder();
        stats.stopMs.push(Date.now() - stopTs);

        console.log(
          `[cycle ${cycleId}] ok start=${startMs}ms fetchHover=${hoverResult.elapsedMs}ms fetchClick=${clickResult.elapsedMs}ms clickTotal=${Date.now() - clickWaitStart}ms stop=${stats.stopMs[stats.stopMs.length - 1]}ms locator=${clickResult.payload?.locator || ''}`,
        );
      } catch (error) {
        stats.failures.push({
          cycle: cycleId,
          target: targetXpath,
          message: error?.message || String(error),
        });
        try {
          await wa.stopXPathRecorder();
        } catch (_) {}
        console.log(`[cycle ${cycleId}] fail target=${targetXpath} error=${error?.message || error}`);
      }

      const cycleElapsed = Date.now() - cycleStart;
      const coolDownMs = Math.max(10, 120 - cycleElapsed);
      await sleep(coolDownMs);
    }

    const summary = {
      url: TEST_URL,
      cycles: CYCLES,
      pass: CYCLES - stats.failures.length,
      fail: stats.failures.length,
      start: {
        avgMs: Math.round((stats.startMs.reduce((a, b) => a + b, 0) || 0) / Math.max(1, stats.startMs.length)),
        p95Ms: percentile(stats.startMs, 95),
        maxMs: Math.max(0, ...stats.startMs),
      },
      fetchHover: {
        avgMs: Math.round((stats.hoverFetchMs.reduce((a, b) => a + b, 0) || 0) / Math.max(1, stats.hoverFetchMs.length)),
        p95Ms: percentile(stats.hoverFetchMs, 95),
        maxMs: Math.max(0, ...stats.hoverFetchMs),
      },
      fetchClick: {
        avgMs: Math.round((stats.clickFetchMs.reduce((a, b) => a + b, 0) || 0) / Math.max(1, stats.clickFetchMs.length)),
        p95Ms: percentile(stats.clickFetchMs, 95),
        maxMs: Math.max(0, ...stats.clickFetchMs),
      },
      clickTotal: {
        avgMs: Math.round((stats.clickTotalMs.reduce((a, b) => a + b, 0) || 0) / Math.max(1, stats.clickTotalMs.length)),
        p95Ms: percentile(stats.clickTotalMs, 95),
        maxMs: Math.max(0, ...stats.clickTotalMs),
      },
      stop: {
        avgMs: Math.round((stats.stopMs.reduce((a, b) => a + b, 0) || 0) / Math.max(1, stats.stopMs.length)),
        p95Ms: percentile(stats.stopMs, 95),
        maxMs: Math.max(0, ...stats.stopMs),
      },
      failures: stats.failures,
    };

    console.log('SPY_STRESS_SUMMARY', JSON.stringify(summary, null, 2));
    process.exitCode = stats.failures.length ? 1 : 0;
  } catch (error) {
    console.error('SPY_STRESS_FATAL', error);
    process.exitCode = 2;
  } finally {
    try {
      await wa.destroyTrackedDrivers();
    } catch (_) {}
  }
}

run();

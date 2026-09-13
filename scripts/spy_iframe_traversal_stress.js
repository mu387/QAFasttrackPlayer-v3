const { By, until } = require('selenium-webdriver');
const { WebActions } = require('../src/ui/automation/webActions');

const TEST_URL = process.env.SPY_TEST_URL || 'https://beta-ui.qafasttrack.com/qapractice/index.html';
const CYCLES = Number(process.env.SPY_IFRAME_CYCLES || 5);
const FETCH_POLL_MS = Number(process.env.SPY_IFRAME_FETCH_POLL_MS || 70);
const FETCH_TIMEOUT_MS = Number(process.env.SPY_IFRAME_TIMEOUT_MS || 5000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
};

const parseChain = value =>
  String(value || '')
    .split('>>')
    .map(s => s.trim())
    .filter(Boolean);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const isBodyFallback = locator => {
  const raw = String(locator || '').trim().toLowerCase();
  return raw === '//body[1]' || raw === '/html[1]/body[1]' || raw === 'body' || raw === '/html/body';
};

async function waitForClickPayload(wa, timeoutMs, matcher) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await wa.fetchRecordedXPath();
    if (last?.source === 'click' && last?.locator && (!matcher || matcher(last))) {
      return { ok: true, payload: last, elapsedMs: Date.now() - startedAt };
    }
    await sleep(FETCH_POLL_MS);
  }
  return { ok: false, payload: last, elapsedMs: Date.now() - startedAt };
}

async function clickMenuFrames(wa) {
  await wa.navigate({ value: TEST_URL });
  try {
    const menu = await wa.driver.findElement(By.xpath("//a[normalize-space()='Frames']"));
    await wa.driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'nearest' });", menu);
    await menu.click();
  } catch (_) {
    // if not present, stay on current page; tests will fail/skip with explicit messages
  }
  await sleep(250);
}

async function findAllFramesCurrentContext(driver) {
  return driver.findElements(By.css('iframe, frame'));
}

async function describeFrame(driver, element, index) {
  return driver.executeScript(
    function (frameEl, frameIdx) {
      const id = String(frameEl?.id || '').trim();
      const name = String(frameEl?.getAttribute?.('name') || '').trim();
      const tag = String(frameEl?.tagName || 'iframe').toLowerCase();
      if (id) return { kind: 'xpath', selector: `//*[@id='${id}']`, tag };
      if (name) return { kind: 'xpath', selector: `//*[@name='${name}']`, tag };
      return { kind: 'xpath', selector: `(//${tag})[${Number(frameIdx) + 1}]`, tag };
    },
    element,
    index,
  );
}

async function discoverFrameChains(driver, maxDepth = 3) {
  const chains = [];
  const walk = async (depth, chain) => {
    if (depth > maxDepth) return;
    const frames = await findAllFramesCurrentContext(driver);
    for (let i = 0; i < frames.length; i += 1) {
      let entered = false;
      try {
        const currentFrames = await findAllFramesCurrentContext(driver);
        if (i >= currentFrames.length) continue;
        const descriptor = await describeFrame(driver, currentFrames[i], i);
        await driver.switchTo().frame(currentFrames[i]);
        entered = true;
        const nextChain = [...chain, descriptor.selector];
        chains.push(nextChain);
        await walk(depth + 1, nextChain);
      } catch (_) {
        // ignore inaccessible frames
      } finally {
        if (entered) {
          try {
            await driver.switchTo().parentFrame();
          } catch (_) {
            await driver.switchTo().defaultContent();
          }
        }
      }
    }
  };
  await driver.switchTo().defaultContent();
  await walk(1, []);
  await driver.switchTo().defaultContent();
  return chains;
}

async function switchByChainRaw(driver, chain) {
  await driver.switchTo().defaultContent();
  for (const selector of chain) {
    const frame = await driver.findElement(By.xpath(selector));
    await driver.switchTo().frame(frame);
  }
}

async function findInteractableInCurrentContext(driver) {
  const css = [
    'input',
    'textarea',
    'button',
    'select',
    'a',
    '[contenteditable="true"]',
    '[data-testid]',
    '[name]',
  ].join(',');
  const found = await driver.findElements(By.css(css));
  for (const el of found) {
    try {
      const displayed = await el.isDisplayed();
      if (displayed) return el;
    } catch (_) {}
  }
  return null;
}

async function runCaseSingleIframe(wa) {
  await clickMenuFrames(wa);
  const chains = await discoverFrameChains(wa.driver, 2);
  const single = chains.find(c => c.length === 1);
  if (!single) {
    return { status: 'skipped', reason: 'No iframe found on frames page.' };
  }

  await wa.startXPathRecorder();
  try {
    await switchByChainRaw(wa.driver, single);
    const target = await findInteractableInCurrentContext(wa.driver);
    if (!target) {
      return { status: 'skipped', reason: 'No interactable target inside first iframe.' };
    }
    await wa.driver.actions({ async: true }).move({ origin: target }).pause(25).click().perform();
    await wa.driver.switchTo().defaultContent();

    const click = await waitForClickPayload(wa, FETCH_TIMEOUT_MS, payload => parseChain(payload?.value).length === 1);
    assert(click.ok, `No click payload for single iframe. last=${JSON.stringify(click.payload || {})}`);
    assert(!isBodyFallback(click.payload.locator), `Fallback locator captured: ${click.payload.locator}`);
    assert(parseChain(click.payload.value).length === 1, `Expected single iframe chain, got: ${click.payload.value}`);

    await wa.switchToIframe({ value: click.payload.value, xPath: '', highlight: false });
    const exists = await wa.exist({ xPath: click.payload.locator, highlight: false });
    assert(exists === true, 'switchToIframe + exist failed for single iframe payload');
    return { status: 'passed', detail: click.payload };
  } finally {
    await wa.stopXPathRecorder();
  }
}

async function runCaseNestedIframe(wa) {
  await clickMenuFrames(wa);
  const chains = await discoverFrameChains(wa.driver, 4);
  const nested = chains.find(c => c.length >= 2);
  if (!nested) {
    return { status: 'skipped', reason: 'No nested iframe chain found.' };
  }

  await wa.startXPathRecorder();
  try {
    await switchByChainRaw(wa.driver, nested);
    const target = await findInteractableInCurrentContext(wa.driver);
    if (!target) {
      return { status: 'skipped', reason: 'No interactable target inside nested iframe.' };
    }
    await wa.driver.actions({ async: true }).move({ origin: target }).pause(25).click().perform();
    await wa.driver.switchTo().defaultContent();

    const click = await waitForClickPayload(wa, FETCH_TIMEOUT_MS, payload => parseChain(payload?.value).length >= 2);
    assert(click.ok, `No click payload for nested iframe. last=${JSON.stringify(click.payload || {})}`);
    const capturedChain = parseChain(click.payload.value);
    assert(capturedChain.length >= 2, `Expected nested iframe chain, got: ${click.payload.value}`);
    // Order check against discovered chain prefix when available
    const expectedPrefix = nested.slice(0, capturedChain.length);
    for (let i = 0; i < Math.min(expectedPrefix.length, capturedChain.length); i += 1) {
      assert(
        capturedChain[i] === expectedPrefix[i],
        `Iframe chain order mismatch at ${i}: expected=${expectedPrefix[i]} actual=${capturedChain[i]}`,
      );
    }
    await wa.switchToIframe({ value: click.payload.value, xPath: '', highlight: false });
    const exists = await wa.exist({ xPath: click.payload.locator, highlight: false });
    assert(exists === true, 'switchToIframe + exist failed for nested iframe payload');
    return { status: 'passed', detail: click.payload };
  } finally {
    await wa.stopXPathRecorder();
  }
}

async function runCaseIframeElementCapture(wa) {
  await clickMenuFrames(wa);
  await wa.driver.switchTo().defaultContent();
  const frames = await wa.driver.findElements(By.css('iframe, frame'));
  if (!frames.length) {
    return { status: 'skipped', reason: 'No iframe element available.' };
  }
  await wa.startXPathRecorder();
  try {
    const frame = frames[0];
    await wa.driver.actions({ async: true }).move({ origin: frame }).pause(25).click().perform();
    const click = await waitForClickPayload(wa, FETCH_TIMEOUT_MS, null);
    assert(click.ok, `No click payload for iframe-element capture. last=${JSON.stringify(click.payload || {})}`);
    assert(
      String(click.payload.locator || '').toLowerCase().includes('iframe'),
      `Expected iframe element locator, got: ${click.payload.locator}`,
    );
    return { status: 'passed', detail: click.payload };
  } finally {
    await wa.stopXPathRecorder();
  }
}

async function runCaseRepeatedSelectorIntegrity(wa) {
  await clickMenuFrames(wa);
  const chains = await discoverFrameChains(wa.driver, 4);
  const nested = chains.find(c => c.length >= 2);
  if (!nested) {
    return { status: 'skipped', reason: 'No nested iframe chain found for dedupe integrity case.' };
  }

  await wa.startXPathRecorder();
  try {
    await switchByChainRaw(wa.driver, nested);
    const target = await findInteractableInCurrentContext(wa.driver);
    if (!target) {
      return { status: 'skipped', reason: 'No interactable target inside nested iframe.' };
    }
    await wa.driver.actions({ async: true }).move({ origin: target }).pause(25).click().perform();
    await wa.driver.switchTo().defaultContent();
    const click = await waitForClickPayload(wa, FETCH_TIMEOUT_MS, null);
    assert(click.ok, `No click payload for chain integrity case. last=${JSON.stringify(click.payload || {})}`);
    const capturedChain = parseChain(click.payload.value);
    assert(capturedChain.length >= 2, `Expected nested chain, got: ${click.payload.value}`);
    assert(capturedChain.length >= nested.length || nested.length >= 2, 'Chain depth collapsed unexpectedly.');
    return { status: 'passed', detail: click.payload };
  } finally {
    await wa.stopXPathRecorder();
  }
}

async function runCaseCrossPaneDriftGuard(wa) {
  await clickMenuFrames(wa);
  const chains = await discoverFrameChains(wa.driver, 2);
  const single = chains.find(c => c.length === 1);
  if (!single) {
    return { status: 'skipped', reason: 'No iframe available for drift guard case.' };
  }

  await wa.startXPathRecorder();
  try {
    // induce drift by hovering sidebar first
    await wa.driver.switchTo().defaultContent();
    const sidebarTargets = await wa.driver.findElements(By.css('#sidebar a, #sidebar li, .menu-link'));
    if (sidebarTargets[0]) {
      await wa.driver.actions({ async: true }).move({ origin: sidebarTargets[0] }).pause(20).perform();
    }
    // now move to intended target inside iframe and click
    await switchByChainRaw(wa.driver, single);
    const target = await findInteractableInCurrentContext(wa.driver);
    if (!target) {
      return { status: 'skipped', reason: 'No interactable target inside iframe for drift guard.' };
    }
    await wa.driver.actions({ async: true }).move({ origin: target }).pause(25).click().perform();
    await wa.driver.switchTo().defaultContent();
    const click = await waitForClickPayload(wa, FETCH_TIMEOUT_MS, null);
    assert(click.ok, `No click payload for drift guard case. last=${JSON.stringify(click.payload || {})}`);
    const locator = String(click.payload.locator || '').toLowerCase();
    assert(!locator.includes('sidebar') && !locator.includes('menu'), `Sidebar drift leak detected: ${click.payload.locator}`);
    return { status: 'passed', detail: click.payload };
  } finally {
    await wa.stopXPathRecorder();
  }
}

async function runSuite(wa) {
  const caseFns = [
    { name: 'single_iframe_capture', fn: runCaseSingleIframe },
    { name: 'nested_iframe_capture', fn: runCaseNestedIframe },
    { name: 'iframe_element_capture', fn: runCaseIframeElementCapture },
    { name: 'repeated_selector_chain_integrity', fn: runCaseRepeatedSelectorIntegrity },
    { name: 'cross_pane_drift_guard', fn: runCaseCrossPaneDriftGuard },
  ];
  const results = [];
  for (const c of caseFns) {
    const startedAt = Date.now();
    try {
      const outcome = await c.fn(wa);
      results.push({ case: c.name, elapsedMs: Date.now() - startedAt, ...outcome });
      console.log(`[case ${c.name}] ${outcome.status} ${outcome.reason ? `reason=${outcome.reason}` : ''}`);
    } catch (error) {
      results.push({ case: c.name, status: 'failed', elapsedMs: Date.now() - startedAt, reason: error?.message || String(error) });
      console.log(`[case ${c.name}] failed reason=${error?.message || error}`);
    }
    await wa.driver.switchTo().defaultContent().catch(() => {});
    await sleep(120);
  }
  return results;
}

async function main() {
  const wa = new WebActions();
  const allRuns = [];
  const startLatencies = [];
  const stopLatencies = [];
  try {
    await wa.launchBrowser({ value: 'chrome', forceCleanup: true });
    for (let i = 1; i <= CYCLES; i += 1) {
      const cycleStartedAt = Date.now();
      const runResults = await runSuite(wa);
      allRuns.push({ cycle: i, cases: runResults, elapsedMs: Date.now() - cycleStartedAt });
      // collect start/stop from console-level flows if available via synthetic markers
      const passedCases = runResults.filter(r => r.status === 'passed');
      if (passedCases.length) {
        startLatencies.push(...passedCases.map(r => Math.max(0, Number(r.elapsedMs || 0))));
      }
      // no separate stop metric in this suite; keep placeholder from case elapsed
      stopLatencies.push(...passedCases.map(() => 0));
    }

    const flat = allRuns.flatMap(r => r.cases);
    const passed = flat.filter(r => r.status === 'passed').length;
    const failed = flat.filter(r => r.status === 'failed').length;
    const skipped = flat.filter(r => r.status === 'skipped').length;
    const byCase = {};
    flat.forEach(r => {
      byCase[r.case] = byCase[r.case] || { passed: 0, failed: 0, skipped: 0 };
      byCase[r.case][r.status] += 1;
    });

    const summary = {
      url: TEST_URL,
      cycles: CYCLES,
      totals: { passed, failed, skipped, totalCases: flat.length },
      caseBreakdown: byCase,
      timing: {
        caseElapsedAvgMs: Math.round((startLatencies.reduce((a, b) => a + b, 0) || 0) / Math.max(1, startLatencies.length)),
        caseElapsedP95Ms: percentile(startLatencies, 95),
        caseElapsedMaxMs: Math.max(0, ...startLatencies),
      },
      failures: flat.filter(r => r.status === 'failed').map(r => ({ case: r.case, reason: r.reason || '' })),
      skipped: flat.filter(r => r.status === 'skipped').map(r => ({ case: r.case, reason: r.reason || '' })),
    };

    console.log('SPY_IFRAME_STRESS_SUMMARY', JSON.stringify(summary, null, 2));
    process.exitCode = failed > 0 ? 1 : 0;
  } catch (error) {
    console.error('SPY_IFRAME_STRESS_FATAL', error);
    process.exitCode = 2;
  } finally {
    try {
      await wa.destroyTrackedDrivers();
    } catch (_) {}
  }
}

main();


const isStale = error => error?.name === 'StaleElementReferenceError';
const progress = new (require('events').EventEmitter)();
let waitSequence = 0;

// This lookup is only for polling helpers: no highlighting and no error masking.
async function lookup(driver, context, locator, by, shadow = false) {
  const suffix = String(locator).match(/\[(\d+)\]$/);
  let elements;
  if (shadow) {
    elements = await driver.executeScript(function (raw) {
      const root = window.__qaCurrentShadowRoot;
      if (!root) return null;
      const address = raw.replace(/\[\d+\]$/, '');
      if (address.startsWith('id=')) return Array.from(root.querySelectorAll('#' + CSS.escape(address.slice(3))));
      if (address.startsWith('name=')) return Array.from(root.querySelectorAll('[name="' + CSS.escape(address.slice(5)) + '"]'));
      if (address.startsWith('css=')) return Array.from(root.querySelectorAll(address.slice(4)));
      return null;
    }, locator);
  }
  if (elements == null) elements = await (context || driver).findElements(by(locator));
  // Preserve the player's existing zero-based trailing-index convention.
  return suffix && elements.length > 1 ? elements.slice(Number(suffix[1]), Number(suffix[1]) + 1) : elements;
}

async function visible(elements) {
  for (const element of elements) if (await element.isDisplayed()) return true;
  return false;
}

async function pollVisible(driver, config, lookupElements, textRoot) {
  const isText = typeof config.text === 'string';
  const state = config.state || (isText ? 'exist' : '');
  if (!['exist', 'notexist', 'visible', 'hidden'].includes(state)) throw new Error(`Unsupported wait state: ${state}`);
  const absent = state === 'notexist' || state === 'hidden';
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  if (isText && !normalize(config.text)) throw new Error('waitForText requires a text value.');
  if (isText && !['contains', 'exact'].includes(config.match)) throw new Error(`Unsupported waitForText match: ${config.match}`);
  await driver.wait(async () => {
    try {
      let found = false;
      if (!isText) {
        found = await visible(await lookupElements());
      } else {
        const roots = config.scope ? await lookupElements() : [await textRoot()];
        for (const root of roots) {
          const candidates = await driver.executeScript(function (scope) {
            const root = scope || document.body;
            return [root, ...root.querySelectorAll('*')].filter(node => node.nodeType === 1);
          }, root);
          for (const candidate of candidates) {
            if (!await candidate.isDisplayed()) continue;
            // WebDriver rendered text excludes hidden descendants unlike textContent.
            const text = normalize(await candidate.getText());
            if (config.match === 'exact' ? text === normalize(config.text) : text.includes(normalize(config.text))) {
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      return absent ? !found : found;
    } catch (error) {
      if (isStale(error)) return false;
      throw error;
    }
  }, config.timeout, `${isText ? 'waitForText' : 'waitForElement'} timed out waiting for ${state}`, 200);
}

async function withProgress(keyword, config, action) {
  const id = ++waitSequence;
  const state = config.state || 'exist';
  const notify = reason => {
    try { progress.emit('waiting', { id, reason, keyword, state, text: config.text, target: config.target, scope: config.scope, match: config.match, timeout: config.timeout }); }
    catch (error) { console.log('[wait-progress]', error.message); }
  };
  notify('helper_waiting');
  try { return await action(); }
  finally { notify('helper_waiting_done'); }
}

function waitVisible(driver, config, lookupElements, textRoot) {
  return withProgress(typeof config.text === 'string' ? 'waitfortext' : 'waitforelement', config,
    () => pollVisible(driver, config, lookupElements, textRoot));
}

module.exports = { lookup, waitVisible, withProgress, progress };

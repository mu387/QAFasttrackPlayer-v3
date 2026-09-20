const visibleWait = require('./visibleWait');
const { PDFDocument } = require('pdf-lib');
const axios = require('axios');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse'); // Make sure this line is present
const path = require('path');
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
const { WebActions } = require('../ui/automation/webActions');

const launchBrowser = async (step,implicitWait=10000) => {
  // Browser.CHROME
  // Browser.FIREFOX
  // Browser.EDGE
  // Browser.INTERNET_EXPLORER
  // Browser.SAFARI
  console.log(step.value);
  driver = await new Builder()
    .forBrowser(Browser[step.value.toUpperCase()])
    .build();
  driver.manage().window().maximize();
  await driver.manage().setTimeouts({ implicit: implicitWait });
  return driver;
};

const launchDebugBrowser = async (step) => {
  const webActions = new WebActions();
  await webActions.launchDebugBrowser(step);
  return webActions.driver;
};

const connectBrowser = async (step) => {
  const webActions = new WebActions();
  await webActions.connectBrowser(step);
  return webActions.driver;
};

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

const normalizeWhitespace = value => String(value || '').replace(/\s+/g, ' ').trim();

const navigate = async (driver, step) => {
  await driver.get(step.value);
};

const findStrategy = path => {
  if (/^id=(.*)(\[\d+\])?$/.test(path)) {
    return 'id';
  } else if (/^name=(.*)(\[\d+\])?$/.test(path)) {
    return 'name';
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
const findElementBy = path => {
  const strategy = findStrategy(path);
  // console.log({ strategy, path });

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

const findElement = async (driver, path) => {
  try {
    const elements = await driver.findElements(findElementBy(path));
    let element;

    if (Array.isArray(elements) && elements.length > 1) {
      const parts = path.match(/(.*)(\[\d+\])$/);
      element = elements[parseInt(parts[2].replace('[', '').replace(']', ''))];
    } else if (elements[0]) {
      element = elements[0];
    } else {
      throw new Error('Element not found');
    }
 await driver.executeScript(function (target) {
  if (!target) return;

  const chooseHighlightTarget = node => {
    if (!node || !(node instanceof Element)) return node;
    const minArea = 24 * 24;
    const minDimension = 18;
    const interactiveSelector = [
      'button',
      'a',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[data-testid]',
      '[aria-label]',
    ].join(',');

    let candidate = node;
    let current = node;
    let depth = 0;

    while (current && current instanceof Element && depth < 5) {
      const rect = current.getBoundingClientRect();
      const area = rect.width * rect.height;
      const qualifies =
        rect.width >= minDimension &&
        rect.height >= minDimension &&
        area >= minArea;
      const isInteractive = current.matches(interactiveSelector);

      if (isInteractive || qualifies) {
        candidate = current;
      }

      if (isInteractive && qualifies) {
        break;
      }

      current = current.parentElement;
      depth += 1;
    }

    return candidate;
  };

  const highlightTarget = chooseHighlightTarget(target);

  const existing = document.getElementById('__qaRuntimeHighlightOverlay');
  if (existing) {
    existing.remove();
  }

  const rect = highlightTarget.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) {
    highlightTarget.style.outline = '3px solid #ef4444';
    highlightTarget.style.outlineOffset = '2px';
    highlightTarget.dataset.qaRuntimeOutline = 'true';
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = '__qaRuntimeHighlightOverlay';
  overlay.style.position = 'fixed';
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.style.border = '3px solid #ef4444';
  overlay.style.background = 'rgba(239, 68, 68, 0.08)';
  overlay.style.boxSizing = 'border-box';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2147483647';
  overlay.style.borderRadius = '4px';
  overlay.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.9), 0 0 12px rgba(239,68,68,0.45)';
  document.body.appendChild(overlay);

  if (highlightTarget !== target) {
    target.dataset.qaRuntimeHighlightTargetPromoted = 'true';
  }
  highlightTarget.dataset.qaRuntimeHighlightTarget = 'true';
 }, element);

 await driver.sleep(200);

 await driver.executeScript(function (target) {
  const overlay = document.getElementById('__qaRuntimeHighlightOverlay');
  if (overlay) {
    overlay.remove();
  }
  const highlighted = target?.dataset?.qaRuntimeHighlightTarget === 'true'
    ? target
    : target?.closest?.('[data-qa-runtime-highlight-target="true"]');
  if (highlighted?.dataset?.qaRuntimeOutline === 'true') {
    highlighted.style.outline = '';
    highlighted.style.outlineOffset = '';
    delete highlighted.dataset.qaRuntimeOutline;
  }
  if (highlighted?.dataset?.qaRuntimeHighlightTarget === 'true') {
    delete highlighted.dataset.qaRuntimeHighlightTarget;
  }
  if (target?.dataset?.qaRuntimeHighlightTargetPromoted === 'true') {
    delete target.dataset.qaRuntimeHighlightTargetPromoted;
  }
 }, element);

 return element;


  } catch (error) {
    console.log(`Element not found using expression '${path}'`.bgRed);
    throw new Error('Element not found');
  }
};


const sendKeys = async (driver, step) => {
  const el = await findElement(driver, step.xPath);
  return await el.sendKeys(step.value);
};

const sendKey = async (driver, step) => {
  const config = resolveSendKeyConfig(step);
  const scopedStep = config.target && config.target !== String(step?.xPath || '').trim()
    ? { ...step, xPath: config.target }
    : step;

  switch (config.action) {
      case 'selectall':
        await selectAll(driver, scopedStep);
        break;
      case 'tab': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.sendKeys(Key.TAB);
        break;
      }
      case 'clear':
        await clearInput(driver, scopedStep);
        break;
      case 'escape':
      case 'esc': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.sendKeys(Key.ESCAPE);
        break;
      }
      case 'home': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.sendKeys(Key.HOME);
        break;
      }
      case 'backspace': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.sendKeys(Key.BACK_SPACE);
        break;
      }
      case 'enter': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.sendKeys(Key.ENTER);
        break;
      }
      case 'keyup':
      case 'arrowup': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.sendKeys(Key.ARROW_UP);
        break;
      }
      case 'keydown':
      case 'arrowdown': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.sendKeys(Key.ARROW_DOWN);
        break;
      }
      case 'click': {
        const el = await findElement(driver, scopedStep.xPath);
        await el.click();
        break;
      }
      case 'focusout': {
        const webActions = new WebActions();
        webActions.driver = driver;
        await webActions.focusOut(scopedStep);
        break;
      }
      case 'dismissalert':
        await alertDismiss(driver);
        break;
      case 'acceptalert':
        await alertAccept(driver);
        break;
      case 'hover':
        await hoverElement(driver, scopedStep);
        break;
      default:
        throw new Error(`Unknown sendkey action: ${step?.value}`);
  }
};

const selectAll = async (driver, step) => {
  const el = await findElement(driver, step.xPath);
  await el.click(); // Ensure the element is focused
  return await el.sendKeys(Key.chord(Key.CONTROL, 'a'));
};

const copy = async (driver, step) => {
  const el = await findElement(driver, step.xPath);
  return await el.sendKeys(Key.chord(Key.CONTROL, 'c'));
};

const paste = async (driver, step) => {
  const el = await findElement(driver, step.xPath);
  return await el.sendKeys(Key.chord(Key.CONTROL, 'v'));
};

const click = async (driver, step) => {
  const el = await findElement(driver, step.xPath);
  await el.click();
};

const setSecure = async (driver, step) => {
  return setText(driver, step);
};

const wait = async (driver, step) => {
  await driver.sleep(step.value);
};

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

const waitForElement = async (driver, step) => {
  const config = resolveWaitForElementConfig(step);
  const target = String(config.target || '').trim();
  const state = String(config.state || '').trim().toLowerCase();

  if (!target) {
    throw new Error('waitForElement requires a target XPath or the step XPath.');
  }

  if (!state) {
    throw new Error('waitForElement requires a state value.');
  }

  if (['exist', 'notexist', 'visible', 'hidden'].includes(state)) {
    return visibleWait.waitVisible(driver, config, () => visibleWait.lookup(driver, driver, target, findElementBy));
  }
  return visibleWait.withProgress('waitforelement', config, () => driver.wait(async () => {
    const elements = await driver.findElements(findElementBy(target));

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
  }, config.timeout, `waitForElement timed out waiting for ${state} on ${target}`, 200));
};

const resolveWaitForTextConfig = step => {
  const entries = parseNamedHelperValue(step?.value);
  const config = {
    text: '',
    scope: '',
    match: 'contains',
    state: 'exist',
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
      case 'state':
        config.state = entry.value.toLowerCase();
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

const waitForText = async (driver, step) => {
  const config = resolveWaitForTextConfig(step);
  if (!['exist', 'notexist'].includes(config.state)) throw new Error('Unsupported waitForText state: ' + config.state);
  return visibleWait.waitVisible(driver, config,
    () => visibleWait.lookup(driver, driver, config.scope, findElementBy).then(elements => elements.slice(0, 1)), async () => null);
};

const exist = async (driver, step) => {
 return await findElement(driver, step.xPath);
};

const maxBrowser = async driver => {
  await driver.manage().window().maximize();
};

const minBrowser = async driver => {
  await driver.manage().window().minimize();
};

const openTab = async (driver, step) => {
  await driver.switchTo().newWindow('tab');
  //if no value then just opens the new tab
  if ((step.value ?? '') !== '' && isValidUrl(step.value)) {
    await navigate(driver, step);
  }
};
const closeTab = async (driver, step) => {
  //if no value then closes  the current tab
  console.log(step.value.bgRed);
  if (step.value ?? '' !== '') {
    const windows = await driver.getAllWindowHandles();
    console.log(windows);
    await driver.switchTo().window(windows[parseInt(step.value)]);
    await driver.close();
    const updatedWindows = await driver.getAllWindowHandles();
    console.log(updatedWindows);
    if (updatedWindows.length >= 1) {
      console.log('in condition');
      console.log(updatedWindows[updatedWindows.length - 1]);
      await driver.switchTo().window(updatedWindows[updatedWindows.length - 1]);
      return;
    }
    return;
  }

  await driver.close();
};
const openWindow = async (driver, step) => {
  await driver.switchTo().newWindow('window');
  console.log(await driver.getAllWindowHandles());
  //if no value then just opens the new window
  if ((step.value ?? '') !== '' && isValidUrl(step.value)) {
    await navigate(driver, step);
  }
};

const closeBrowser = async (driver, step) => {
  console.log(step.value.bgRed);
  if (step.value ?? '' !== '') {
    const windows = await driver.getAllWindowHandles();
    await driver.switchTo().window(windows[parseInt(step.value) - 1]);
  }
  await driver.close();
};
const switchBrowser = async (driver, step) => {
  const windows = await driver.getAllWindowHandles();
  await driver.switchTo().window(windows[parseInt(step.value) - 1]);
};

const alertAccept = async driver => {
  await driver.wait(until.alertIsPresent());
  let alert = await driver.switchTo().alert();
  await alert.accept();
};

const alertDismiss = async driver => {
  await driver.wait(until.alertIsPresent());
  let alert = await driver.switchTo().alert();
  await alert.dismiss();
};

const alertSetText= async (driver, step) => {
  console.log('aha shampoo');
  await driver.wait(until.alertIsPresent(), 10000); // Timeout of 10 seconds

  let alert = await driver.switchTo().alert();
  console.log(step.value);
 
  await alert.sendKeys(step.value);
  await alert.accept();
};


const clearInput = async (driver, step) => {
  const el = await findElement(driver, step.xPath);
  await el.clear();
};

const scrollToElement = async (driver, step) => {
  const el = await findElement(driver, step.xPath);
  await driver.actions().scroll(0, 0, 0, 0, el).perform();
};

const scrollToText = async (driver, step) => {
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
    await driver.executeScript(scrollToTextScript);
}




const isValidUrl = str => {
  try {
    new URL(str);
    return true;
  } catch (err) {
    console.log('isValidUrl', err);
    return false;
  }
};

//Added/Updated by Ayaz
//Not Tested
// Function to execute an SQL statement
async function executeSQL(step) {
  // Parse step.value to get connectionConfigString and sqlStatement
  const [connectionConfigStr, sqlStatementStr] = step.value.split('||').map(part => part.trim());
  // Parse the connection configuration string into an object
  const connectionConfig = JSON.parse(connectionConfigStr);
  // Create a MySQL connection with the parsed configuration
  const connection = mysql.createConnection(connectionConfig);
  return new Promise((resolve, reject) => {
      // Connect to the database
      connection.connect(err => {
          if (err) {
              reject(err);
              return;
          }
          console.log('Connected to database successfully.');
          // Execute SQL statement
          connection.query(sqlStatementStr, error => {
              // Close the connection
              connection.end();
              if (error) {
                  reject(error);
              } else {
                  resolve();
              }
          });
      });
  });
};


//Added/Updated by Ayaz
//Tested
// Function to connect to a PDF and load its content into memory
async function connectPDF(driver, step) {
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


//Added/Updated by Ayaz
//Tested
// Function to verify text in the loaded PDF (using the module-level pdfText variable)
async function verifyPDFText(driver,step) {
  try {
    let textToVerify=step.value;
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




//Added/Updated by Ayaz
//Tested
// Function to disconnect the PDF connection and optionally reconnect to a new PDF
async function disconnectPDF(driver, step) {
  // Clear the reference to the PDF document to allow for garbage collection
  pdfText = null;
  console.log('PDF connection disconnected and object destroyed.');
  // Reconnect to the new PDF if step parameter is provided
  if (driver && step) {
    console.log('Pdf disconnected');    
    await connectPDF(driver, step);
  }
  return `PDF Connection Disconnected`;
};



//Added/Updated by Ayaz
//Tested
// Function to delete a PDF file
async function deletePDFFile(driver, step) {
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

//Added/Updated by Ayaz
//Not Tested
// Function to get database value based on SQL query
async function getDBValue(step) {
  // Parse step.value to get connectionConfigString and sqlStatement
  const [connectionConfigStr, sqlStatementStr] = step.value.split('||').map(part => part.trim());
  console.log(`Connection string. ${connectionConfigStr}`);
  console.log(`Connection string. ${sqlStatementStr}`);
  // Parse the connection configuration string into an object
  const connectionConfig = JSON.parse(connectionConfigStr);
  // Create a MySQL connection with the parsed configuration
  const connection = mysql.createConnection(connectionConfig);
  return new Promise((resolve, reject) => {
      // Connect to the database
      connection.connect(err => {
          if (err) {
              reject(err);
              return;
          }
          console.log('Connected to database successfully.');

          // Execute SQL query
          connection.query(sqlStatementStr, (error, results) => {
              // Close the connection
              connection.end();

              if (error) {
                  reject(error);
              } else {
                  resolve(results);
              }
          });
      });
  });
};

async function apiCall(driver, step) {
  const apiBridge = new WebActions();
  apiBridge.driver = driver;
  return await apiBridge.apiCall(step);
}




//Added/Updated by Ayaz
//Tested
async function getCookieValue(driver, step) {
  try {

      // Get all cookies
      const cookies = await driver.manage().getCookies();
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
async function removeCookie(driver, step) {
  try {
      // Delete the cookie by name
      await driver.manage().deleteCookie(step.value);
      console.log(`Cookie '${step.value}' removed successfully.`);
  } catch (error) {
      console.error('Error removing cookie:', error);
  }
};
//Added/Updated by Ayaz
//NOT Tested
// Check with Alize Ahmed if xpath splitting assumptions change
//https://demoqa.com/droppable#google_vignette
//Test Data : //div[@id='draggable']||//div[@id='simpleDropContainer']//div[@id='droppable']

async function dragDrop(driver, step) {
  //User will pass both xpath using locators on component
  const inputString = step.xPath;

  // Split the string using the delimiter '||'
  const parts = inputString.split('||');

  try {
    const sourceElement = await findElement(driver, parts[0]);
    const targetElement = await findElement(driver, parts[1]);
    // Perform drag and drop
    await driver.actions({ bridge: true })
      .dragAndDrop(sourceElement, targetElement)
      .perform();
    console.log(`Dragged element from '${sourceElement}' to '${targetElement}' successfully.`);
  } catch (error) {
    console.error('Error performing drag and drop:', error);
  }
};


//Added/Updated by Ayaz\
//Tested
const switchToIframe = async (driver, step) => {
  try {
    //Input Param
    //Before or after step xpath switchToIframe=//*[@id='frame1']
    //Revert to default content (Do not Pass Parameter)

    step.value=step.value.trim();
    console.log(`Switched to iframe: ${step.value}`);
    if (step.value === 'default') {
      await driver.switchTo().defaultContent();
      console.log('Switched to default content');
      return `switched back to default context`;
      } else {
      await driver.switchTo().defaultContent();
      const frameSelectors = String(step.value || '')
        .split('>>')
        .map(part => String(part || '').trim())
        .filter(Boolean);
      if (!frameSelectors.length) {
        throw new Error('switchToIframe: missing iframe selector');
      }
      for (const frameSelector of frameSelectors) {
        const el = await findElement(driver, frameSelector);
        await driver.switchTo().frame(el);
        try {
          await driver.wait(
            async () => {
              const state = await driver.executeScript('return document.readyState');
              return state === 'complete' || state === 'interactive';
            },
            1500,
          );
        } catch (_) {}
      }
      console.log(`Switched to iframe: ${step.value}`);
      return `Switched to iframe: ${step.value}`;
    }
  } catch (error) {
    console.log(`Failed to switch to iframe: ${step.value}`);
    console.error(error);
    throw error;
  }
};

const switchToDom = async (driver, step) => {
  try {
    const raw = String(step?.value || '').trim();
    if (!raw) {
      throw new Error('switchToDom: traversal string is required.');
    }
    if (raw.toLowerCase() === 'default') {
      await driver.switchTo().defaultContent();
      return 'Switched to default DOM context';
    }

    const parts = raw
      .split('->')
      .map(part => String(part || '').trim())
      .filter(Boolean);

    await driver.switchTo().defaultContent();
    await driver.executeScript('window.__qaCurrentShadowRoot = null;');

    for (const part of parts) {
      if (part.toLowerCase() === 'iframe') {
        const frames = await driver.findElements(By.css('iframe, frame'));
        if (!frames[0]) {
          throw new Error('switchToDom: iframe token found but no iframe is available.');
        }
        await driver.switchTo().frame(frames[0]);
        await driver.executeScript('window.__qaCurrentShadowRoot = null;');
        continue;
      }

      const iframeDepthMatch = part.match(/^iframe-depth:(\d+)$/i);
      if (iframeDepthMatch) {
        const depth = Number(iframeDepthMatch[1]);
        for (let i = 0; i < depth; i += 1) {
          const frames = await driver.findElements(By.css('iframe, frame'));
          if (!frames[0]) {
            throw new Error(`switchToDom: missing iframe while traversing depth ${depth}.`);
          }
          await driver.switchTo().frame(frames[0]);
          await driver.executeScript('window.__qaCurrentShadowRoot = null;');
        }
        continue;
      }

      const iframeSelectorMatch = part.match(/^iframe\(selector=(.+)\)$/i);
      if (iframeSelectorMatch) {
        const selector = iframeSelectorMatch[1].trim();
        await driver.executeScript('window.__qaCurrentShadowRoot = null;');
        const strategy = selector.startsWith('css=') ? By.css(selector.slice(4)) : selector.startsWith('id=') ? By.id(selector.slice(3)) : selector.startsWith('name=') ? By.name(selector.slice(5)) : By.xpath(selector);
        const elements = await driver.findElements(strategy);
        if (!elements[0]) {
          throw new Error(`switchToDom: iframe not found for selector ${selector}`);
        }
        await driver.switchTo().frame(elements[0]);
        await driver.executeScript('window.__qaCurrentShadowRoot = null;');
        continue;
      }

      const shadowMatch = part.match(/^shadow\(host=(.+)\)$/i);
      if (shadowMatch) {
        const hostSelector = shadowMatch[1].trim();
        const result = await driver.executeScript(function (rawSelector) {
          const selector = String(rawSelector || '').trim();
          const root = window.__qaCurrentShadowRoot || document;
          const normalize = value => String(value ?? '').trim().replace(/^["']|["']$/g, '');
          let host = null;
          if (/^id=/.test(selector)) {
            const id = normalize(selector.slice(3));
            host = root instanceof ShadowRoot ? root.querySelector(`#${CSS.escape(id)}`) : document.getElementById(id);
          } else if (/^name=/.test(selector)) {
            const name = normalize(selector.slice(5));
            host = root.querySelector?.(`[name="${CSS.escape(name)}"]`) || null;
          } else if (/^css=/.test(selector)) {
            host = root.querySelector?.(selector.slice(4).trim()) || null;
          } else {
            const doc = root instanceof ShadowRoot ? root.ownerDocument : document;
            host = doc.evaluate(selector, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          }
          if (!host) {
            return { ok: false, error: `switchToDom: shadow host not found for selector ${selector}` };
          }
          if (!host.shadowRoot) {
            return { ok: false, error: `switchToDom: shadow root unavailable for selector ${selector}` };
          }
          window.__qaCurrentShadowRoot = host.shadowRoot;
          return { ok: true };
        }, hostSelector);
        if (!result?.ok) {
          throw new Error(result?.error || `switchToDom: shadow host not found for selector ${hostSelector}`);
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
          const result = await driver.executeScript(function (rawSelector) {
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

// Legacy helper path note:
// This file is not the active player execution path and should not be used as the source of truth
// for runtime behavior decisions. We will remove this dead code in a future cleanup.
const hoverElement = async (driver, step) => {
  // Sample step.value: //*[text="Click Me"]
  try {
    // Wait until the element is located
    const elementToHover = await driver.wait(until.elementLocated(By.xpath(step.xPath)), 10000);
    try {
        // Wait until the element is visible
      await driver.wait(until.elementIsVisible(elementToHover), 10000);
      // Perform the hover action using the actions method on the driver instance
      const actions = driver.actions({ bridge: true });
      await actions.move({ origin: elementToHover }).perform();
      
      console.log(`Hovered over element: ${step.xPath}`);
      return `Hovered over element: ${step.xPath}`;
    } catch (visibilityError) {
      console.log(`Element found but not visible: ${step.xPath}`);
      return `Element found but not visible: ${step.xPath}`;
      console.error(visibilityError);
    }
  } catch (locateError) {
    console.log(`Failed to locate element: ${step.xPath}`);    
    return `Failed to locate element: ${step.xPath}`;
    console.error(locateError);
  }
};



//Added/Updated by Ayaz
//Tested
const selectold = async (driver, step) => {
  // Sample step.value: "value=1"
  // Sample step.value: "text=Green"
  // Sample step.value: "index=2"

try {
  // Wait for the element to be located
  const el = await findElement(driver, step.xPath);
  // Wait for the element to be visible
  //await driver.wait(until.elementIsVisible(el), 10000);

  const select = new Select(el);
  // Extract selection method and value from step.value
  let method, value;
  if (step.value.includes('=')) {
    [method, value] = step.value.split('=');
     method = method.toLowerCase(); // Convert method to lowercase
  } else {
    // Default to index if no method is specified
    method = 'index';
    value = step.value;
  }
  
  switch (method) {
    case 'value':
      await select.selectByValue(value);
      break;
    case 'text':
      await select.selectByVisibleText(value);
      break;
    case 'index':
      await select.selectByIndex(parseInt(value, 10));
      break;
    default:
      await select.selectByIndex(parseInt(value, 10));
      break;
  }

  console.log(`Selected option using ${method} with value: ${value}`);
} catch (error) {
  console.error(`Failed to select option using ${method} with value: ${value}`);
  console.error(error);
}
};

const select = async (driver, step) => {
  // Sample step.value: "value=1"
  // Sample step.value: "text=Green"
  // Sample step.value: "index=2"
  // Sample step.value: "Green"
try {
  // Wait for the element to be located
  const el = await findElement(driver, step.xPath);

  const select = new Select(el);
  let method, value;

  if (step.value.includes('=')) {
    [method, value] = step.value.split('=');
    method = method.toLowerCase(); // Convert method to lowercase
  } else {
    // Default to text if no method is specified
    method = 'text';
    value = step.value;
  }
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
    default:
      await select.selectByVisibleText(value);
      break;
  }

  console.log(`Selected option using ${method} with value: ${value}`);
} catch (error) {
  console.error(`Failed to select option using ${method} with value: ${value}`);
  console.error(error);
}
};


//Added/Updated by Ayaz
//Tested
const rightClick = async (driver, step) => {
  try {
    const element = await findElement(driver, step.xPath);

    await driver.wait(until.elementIsVisible(element), 10000);

    // Create a new action sequence and move the mouse to the element
    const actions = driver.actions({ bridge: true });
    await actions.move({ origin: element }).perform();
    console.log(`Moved to element: ${step.xPath}`);
    
    await actions.contextClick(element).perform();
    console.log(`Right Clicked on element: ${step.xPath}`);
    return `Move to Element and Right Clicked on element: ${step.xPath}`;
  } catch (error) {
    console.error(`Failed to right-click on element: ${step.xPath}`);
    console.error(error);
  }
};

//Added/Updated by Ayaz
//Tested
const doubleClick = async (driver, step) => {
  try {
    const element = await findElement(driver, step.xPath);
    await driver.wait(until.elementIsVisible(element), 10000);

    // Create a new action sequence and move the mouse to the element
    const actions = driver.actions({ bridge: true });
    await actions.doubleClick(element).perform();
    console.log(`Double Clicked on element: ${step.xPath}`);
    return `Double Clicked on element: ${step.xPath}`;
  } catch (error) {
    console.error(`Failed to Double-click on element: ${step.xPath}`);
    return `Failed to Double Clicked on element: ${step.xPath}`;
    console.error(error);
  }
};

//Added/Updated by Ayaz
//Tested
async function verifyTextOnAlert(driver, step) {
  try {     
      // Switch to the alert
      const alert = await driver.switchTo().alert();
      // Get the text from the alert
      const alertText = await alert.getText();
      console.log('Alert text:', alertText);
      // Compare the alert text with the expected text
      if (alertText === step.value) {
          console.log(`Alert text "${step.value}" matches the expected text.`);
          return `${alertText} value matched! Value Passed: ${step.value} | Value Found: ${alertText}`;        
      } else {
          console.log(`Alert text "${alertText}" does not match the expected text "${step.value}".`);
      }
      // Dismiss the alert (optional, depends on your test scenario)
      await alert.dismiss();
 
  } catch (error) {
      console.error('Error verifying text on alert:', error);
  }
};



//Added/Updated by Ayaz
//Tested
const validateElementold = async (driver, step) => {

  // Sample step.value: "isSelected=true"
  // Sample step.value: "isEnabled=true"
  // Sample step.value: "isDisplayed=true"
  // Sample step.value: "getText=Expected Text"
  // Sample step.value: "attributeName=attributeValue"

const el = await findElement(driver, step.xPath);
let [attr, ...valueArr] = step.value.split('=') || [];  
const value = valueArr.join('=');
 

const mainStr = 'isselected isenabled isdisplayed gettext'; // lookup string
if (mainStr.includes(attr.toLowerCase())) { // if value in passed to function matches one of the substrings in mainStr then
  attr = attr.toLowerCase(); 
}

let attrValue;
switch(attr) {
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
    default:
        attrValue = await el.getAttribute(attr);
        if (attrValue !== null && attrValue !== undefined && attrValue.includes('\n')) {
          attrValue = attrValue.replace(/[\n\r]/g, ''); // Remove newline characters
        }
}
attrValue = attrValue.toString(); // Convert result to string for comparison
console.log({ attrValue });
console.log(attrValue, value);
if (attrValue !== value) {
    console.log(`${attr} value not matched`);
    throw new Error(`${attr} value not matched`);
} else {
    console.log(`${attr} value matched`);
    return `${attr} value matched! Value Passed: ${value} | Value Found: ${attrValue}`;
}
};

const validateElement = async (driver, step) => {
  // Sample step.value: "isSelected=true"
  // Sample step.value: "isEnabled=true"
  // Sample step.value: "isDisplayed=true"
  // Sample step.value: "getText=Expected Text"
  // Sample step.value: "attributeName=attributeValue"
  // Sample step.value: "Expected Text" (assumed to be innerText)

  const el = await findElement(driver, step.xPath);
  let [attr, ...valueArr] = step.value.includes('=') ? step.value.split('=') : ['innerText', step.value];  
  const value = valueArr.join('=');

  let attrValue;
  switch(attr) {
    case 'isSelected':
        attrValue = await el.isSelected();
        break;
    case 'isEnabled':
        attrValue = await el.isEnabled();
        break;
    case 'isDisplayed':
        attrValue = await el.isDisplayed();
        break;
    case 'getText':
        attrValue = await el.getText();
        break;
    default:
        attrValue = await el.getAttribute(attr);
        if (attrValue !== null && attrValue !== undefined && attrValue.includes('\n')) {
          attrValue = attrValue.replace(/[\n\r]/g, ''); // Remove newline characters
        }
  }
  attrValue = attrValue.toString(); // Convert result to string for comparison
  console.log({ attrValue });
  console.log(attrValue, value);
  if (attrValue !== value) {
      console.log(`${attr} value not matched`);
      throw new Error(`${attr} value not matched`);
  } else {
      console.log(`${attr} value matched`);
      return `${attr} value matched! Value Passed: ${value} | Value Found: ${attrValue}`;
  }
};

//Added/Updated by Ayaz
//Tested
const digitalSignature = async (driver, step) => {
  try {
      // Find the element using the locator
      const el = await findElement(driver, step.xPath);
      // Create an Actions instance
      const actions = driver.actions({bridge: true});
      // Perform the actions: move to element, click and hold, move by offset, release
      await actions.move({origin: el})
          .press()
          .move({x: 10, y: 50})
          .release()
          .perform();
      // Wait for 1 second
      await driver.sleep(1000);
  } catch (error) {
      if (error.name === 'NoSuchElementError') {
          console.error('Element not found:', locator);
      } else {
          console.error('Error performing digital signature:', error);
      }
  }
};





//Added/Updated by Ayaz
//Tested
const getElementValue = async (driver, step) => {
  try {
    const el = await findElement(driver, step.xPath);

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
module.exports = {
  launchBrowser,
  launchDebugBrowser,
  connectBrowser,
  navigate,
  findElementBy,
  findElement,
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
  switchBrowser,
  alertAccept,
  alertDismiss,
  alertSetText,
  validateElement,
  clearInput,
  getElementValue,
  scrollToElement,
  scrollToText,
  selectAll,
  copy,
  paste,
  hoverElement,
  executeSQL,
  verifyPDFText,
  connectPDF,
  disconnectPDF,
  deletePDFFile,
  getDBValue,
  apiCall,
  getCookieValue,
  removeCookie,
  dragDrop,
  switchToIframe,
  switchToDom,
  verifyTextOnAlert,
  digitalSignature  
};

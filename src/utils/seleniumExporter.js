const { Browser } = require('selenium-webdriver');

const sanitize = (val, fallback = 'suite') =>
    (val || fallback)
        .toString()
        .trim()
        .replace(/[^a-z0-9-_]+/gi, '_')
        .replace(/^_+|_+$/g, '') || fallback;

const inferBrowser = configuration => {
    const vars = Array.isArray(configuration?.configuration_variables)
        ? configuration.configuration_variables
        : [];
    const browserVar = vars.find(v => (v?.variable?.name || '').toLowerCase() === 'browser');
    const name = browserVar?.value?.name || browserVar?.value || '';
    const key = name.toString().trim().toUpperCase();
    return Browser[key] ? key : 'CHROME';
};

const mapStepToCode = step => {
    const kw = (step?.keyword?.name || '').toLowerCase();
    const xp = step?.xPath || step?.xpath || '';
    const val = step?.value ?? '';

    switch (kw) {
        case 'launchbrowser':
            return null; // handled in header
        case 'navigate':
            return `  await driver.get(${JSON.stringify(val)});`;
        case 'click':
            return `  {\n    const el = await driver.wait(until.elementLocated(By.xpath(${JSON.stringify(xp)})), 10000);\n    await driver.wait(until.elementIsVisible(el), 10000);\n    await driver.wait(until.elementIsEnabled(el), 10000).catch(() => {});\n    await el.click();\n  }`;
        case 'sendkeys':
        case 'settext':
            return `  {\n    const el = await driver.wait(until.elementLocated(By.xpath(${JSON.stringify(xp)})), 10000);\n    await driver.wait(until.elementIsVisible(el), 10000);\n    await el.sendKeys(${JSON.stringify(val)});\n  }`;
        case 'selectall':
            return `  {\n    const el = await driver.wait(until.elementLocated(By.xpath(${JSON.stringify(xp)})), 10000);\n    await driver.wait(until.elementIsVisible(el), 10000);\n    await el.sendKeys(Key.CONTROL, 'a');\n  }`;
        case 'copy':
            return `  {\n    const el = await driver.wait(until.elementLocated(By.xpath(${JSON.stringify(xp)})), 10000);\n    await driver.wait(until.elementIsVisible(el), 10000);\n    await el.sendKeys(Key.CONTROL, 'c');\n  }`;
        case 'paste':
            return `  {\n    const el = await driver.wait(until.elementLocated(By.xpath(${JSON.stringify(xp)})), 10000);\n    await driver.wait(until.elementIsVisible(el), 10000);\n    await el.sendKeys(Key.CONTROL, 'v');\n  }`;
        case 'multiKeyboardActions'.toLowerCase():
            return `  // TODO: multiKeyboardActions not expanded; value=${JSON.stringify(val)}`;
        case 'wait': {
            const ms = Number(val) || 0;
            return `  await driver.sleep(${ms});`;
        }
        case 'exist':
            return `  await driver.wait(until.elementLocated(By.xpath(${JSON.stringify(xp)})), 10000);`;
        case 'validateelement':
            return `  await validateElement(driver, ${JSON.stringify(xp)}, ${JSON.stringify(val)});`;
        case 'select': {
            let method = 'text';
            let value = val;
            if (typeof val === 'string' && val.includes('=')) {
                const [m, ...rest] = val.split('=');
                method = m.toLowerCase();
                value = rest.join('=');
            }
            return `  {\n    const el = await driver.findElement(By.xpath(${JSON.stringify(xp)}));\n    const select = new (require('selenium-webdriver')).Select(el);\n    ${method === 'value'
        ? `await select.selectByValue(${JSON.stringify(value)});`
        : method === 'index'
            ? `await select.selectByIndex(${Number(value) || 0});`
            : `await select.selectByVisibleText(${JSON.stringify(value)});`
    }\n  }`;
        }
        case 'scrolltoelement':
            return `  await driver.executeScript('arguments[0].scrollIntoView({behavior:\"smooth\",block:\"center\"});', await driver.findElement(By.xpath(${JSON.stringify(xp)})));`;
        case 'scrolltotext':
            return `  await driver.executeScript(\n    'const t=\"' + ${JSON.stringify(val)} + '\";const el=[...document.querySelectorAll(\"body,body *\")].find(e=>e.textContent.trim()===t);if(el){el.scrollIntoView({behavior:\"smooth\",block:\"center\"});}',\n  );`;
        case 'alertaccept':
            return `  await driver.wait(until.alertIsPresent());\n  await driver.switchTo().alert().accept();`;
        case 'alertdismiss':
            return `  await driver.wait(until.alertIsPresent());\n  await driver.switchTo().alert().dismiss();`;
        case 'alertsettext':
            return `  await driver.wait(until.alertIsPresent());\n  await driver.switchTo().alert().sendKeys(${JSON.stringify(val)});`;
        case 'switchbrowser':
            return `  // TODO: switchBrowser requires multiple windows; index=${val}`;
        case 'openwindow':
            return `  await driver.switchTo().newWindow('window');`;
        case 'opentab':
            return `  await driver.switchTo().newWindow('tab');`;
        case 'closetab':
            return `  await driver.close();`;
        case 'closebrowser':
            return `  await driver.quit();\n  driver = null;`;
        default:
            return `  // TODO: unsupported keyword "${kw}" (value=${JSON.stringify(val)}, xpath=${JSON.stringify(xp)})`;
    }
};

const buildScript = (runner, idx) => {
    const browserKey = inferBrowser(runner?.test_suite?.configuration);
    const suiteName = sanitize(runner?.test_suite?.name, `suite_${idx + 1}`);
    const steps = Array.isArray(runner?.steps) ? runner.steps.filter(s => s?.actual_step !== false) : [];
    if (!steps.length) return null;

    const lines = [];
    lines.push(`// Auto-generated from last run for ${suiteName}`);
    lines.push(`const { Builder, By, Key, until, Browser } = require('selenium-webdriver');`);
    lines.push('');
    lines.push(`async function validateElement(driver, xpath, rawValue) {`);
    lines.push(`  const el = await driver.findElement(By.xpath(xpath));`);
    lines.push(`  let attr = 'innerText';`);
    lines.push(`  let expected = rawValue ?? '';`);
    lines.push(`  if (typeof rawValue === 'string' && rawValue.includes('=')) {`);
    lines.push(`    const idx = rawValue.indexOf('=');`);
    lines.push(`    attr = rawValue.slice(0, idx);`);
    lines.push(`    expected = rawValue.slice(idx + 1);`);
    lines.push(`  }`);
    lines.push(`  let actual;`);
    lines.push(`  switch (attr) {`);
    lines.push(`    case 'isSelected': actual = await el.isSelected(); break;`);
    lines.push(`    case 'isEnabled': actual = await el.isEnabled(); break;`);
    lines.push(`    case 'isDisplayed': actual = await el.isDisplayed(); break;`);
    lines.push(`    case 'getText': actual = await el.getText(); break;`);
    lines.push(`    case 'selection': {`);
    lines.push(`      const opt = await el.findElement(By.css('option:checked'));`);
    lines.push(`      actual = await opt.getText();`);
    lines.push(`      break;`);
    lines.push(`    }`);
    lines.push(`    default:`);
    lines.push(`      actual = await el.getAttribute(attr);`);
    lines.push(`      break;`);
    lines.push(`  }`);
    lines.push(`  let actualStr = (actual ?? '').toString();`);
    lines.push(`  if (actualStr.includes('\\\\n') || actualStr.includes('\\\\r')) {`);
    lines.push(`    actualStr = actualStr.replace(/[\\\\n\\\\r]/g, '');`);
    lines.push(`  }`);
    lines.push(`  const expectedStr = (expected ?? '').toString();`);
    lines.push(`  if (actualStr !== expectedStr) {`);
    lines.push(`    throw new Error(\`Validation failed for \${attr}: expected "\${expectedStr}" got "\${actualStr}"\`);`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
    lines.push(`async function main() {`);
    lines.push(`  let driver;`);
    lines.push(`  try {`);
    lines.push(`    driver = await new Builder().forBrowser(Browser.${browserKey}).build();`);
    lines.push(`    // Set a default implicit wait if desired`);
    lines.push(`    await driver.manage().setTimeouts({ implicit: 10000 });`);
    steps.forEach(step => {
        const code = mapStepToCode(step);
        if (!code) return;
        lines.push(code);
    });
    lines.push(`  } finally {`);
    lines.push(`    if (driver) {`);
    lines.push(`      try { await driver.quit(); } catch (_) {}`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(`\nmain().catch(err => { console.error('Test failed', err); process.exitCode = 1; });`);

    const filename = `${suiteName || 'suite'}-${idx + 1}-selenium.js`;
    return { filename, content: lines.join('\n') };
};

const mapStepToJava = step => {
    const kw = (step?.keyword?.name || '').toLowerCase();
    const xp = step?.xPath || step?.xpath || '';
    const val = step?.value ?? '';
    switch (kw) {
        case 'launchbrowser':
            return null; // handled in setup
        case 'navigate':
            return `    driver.get(${JSON.stringify(val)});`;
        case 'click':
            return `    new WebDriverWait(driver, Duration.ofSeconds(10)).until(ExpectedConditions.elementToBeClickable(By.xpath(${JSON.stringify(xp)}))).click();`;
        case 'sendkeys':
        case 'settext':
            return `    find(${JSON.stringify(xp)}).sendKeys(${JSON.stringify(val)});`;
        case 'selectall':
            return `    find(${JSON.stringify(xp)}).sendKeys(Keys.chord(Keys.CONTROL, "a"));`;
        case 'copy':
            return `    find(${JSON.stringify(xp)}).sendKeys(Keys.chord(Keys.CONTROL, "c"));`;
        case 'paste':
            return `    find(${JSON.stringify(xp)}).sendKeys(Keys.chord(Keys.CONTROL, "v"));`;
        case 'wait': {
            const ms = Number(val) || 0;
            return `    Thread.sleep(${ms});`;
        }
        case 'exist':
            return `    new WebDriverWait(driver, Duration.ofSeconds(10)).until(ExpectedConditions.presenceOfElementLocated(By.xpath(${JSON.stringify(xp)})));`;
        case 'validateelement':
            return `    validateElement(${JSON.stringify(xp)}, ${JSON.stringify(val)});`;
        case 'select': {
            let method = 'text';
            let value = val;
            if (typeof val === 'string' && val.includes('=')) {
                const [m, ...rest] = val.split('=');
                method = m.toLowerCase();
                value = rest.join('=');
            }
            const selVar = 'select';
            if (method === 'value') {
                return `    {\n      Select ${selVar} = new Select(find(${JSON.stringify(xp)}));\n      ${selVar}.selectByValue(${JSON.stringify(value)});\n    }`;
            }
            if (method === 'index') {
                return `    {\n      Select ${selVar} = new Select(find(${JSON.stringify(xp)}));\n      ${selVar}.selectByIndex(${Number(value) || 0});\n    }`;
            }
            return `    {\n      Select ${selVar} = new Select(find(${JSON.stringify(xp)}));\n      ${selVar}.selectByVisibleText(${JSON.stringify(value)});\n    }`;
        }
        case 'scrolltoelement':
            return `    ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView({behavior:'smooth',block:'center'});", find(${JSON.stringify(xp)}));`;
        case 'scrolltotext':
            return `    ((JavascriptExecutor) driver).executeScript("const t = ${JSON.stringify(val)}; const el = Array.from(document.querySelectorAll('body, body *')).find(e => e.textContent.trim() === t); if (el) { el.scrollIntoView({behavior:'smooth',block:'center'}); }");`;
        case 'alertaccept':
            return `    new WebDriverWait(driver, Duration.ofSeconds(10)).until(ExpectedConditions.alertIsPresent());\n    driver.switchTo().alert().accept();`;
        case 'alertdismiss':
            return `    new WebDriverWait(driver, Duration.ofSeconds(10)).until(ExpectedConditions.alertIsPresent());\n    driver.switchTo().alert().dismiss();`;
        case 'alertsettext':
            return `    new WebDriverWait(driver, Duration.ofSeconds(10)).until(ExpectedConditions.alertIsPresent());\n    driver.switchTo().alert().sendKeys(${JSON.stringify(val)});`;
        case 'openwindow':
            return `    driver.switchTo().newWindow(WindowType.WINDOW);`;
        case 'opentab':
            return `    driver.switchTo().newWindow(WindowType.TAB);`;
        case 'closetab':
            return `    driver.close();`;
        case 'closebrowser':
            return `    if (driver != null) driver.quit();`;
        default:
            return `    // TODO: unsupported keyword "${kw}" (value=${JSON.stringify(val)}, xpath=${JSON.stringify(xp)})`;
    }
};

const toClassName = name => {
    const base = sanitize(name, 'Suite');
    const capped = base.charAt(0).toUpperCase() + base.slice(1);
    return capped.match(/^[A-Za-z_]/) ? capped : `Suite${capped}`;
};

const buildJavaTestNG = (runner, idx) => {
    const browserKey = inferBrowser(runner?.test_suite?.configuration);
    const className = toClassName(runner?.test_suite?.name || `suite_${idx + 1}`);
    const steps = Array.isArray(runner?.steps) ? runner.steps.filter(s => s?.actual_step !== false) : [];
    if (!steps.length) return null;

    const lines = [];
    lines.push(`// Auto-generated from last run for ${className}`);
    lines.push(`import org.openqa.selenium.*;`);
    lines.push(`import org.openqa.selenium.chrome.ChromeDriver;`);
    lines.push(`import org.openqa.selenium.edge.EdgeDriver;`);
    lines.push(`import org.openqa.selenium.firefox.FirefoxDriver;`);
    lines.push(`import org.openqa.selenium.support.ui.*;`);
    lines.push(`import org.openqa.selenium.WindowType;`);
    lines.push(`import org.testng.annotations.*;`);
    lines.push(`import java.time.Duration;`);
    lines.push(`import static org.testng.Assert.*;`);
    lines.push('');
    lines.push(`public class ${className} {`);
    lines.push(`  private WebDriver driver;`);
    lines.push('');
    lines.push(`  @BeforeClass`);
    lines.push(`  public void setUp() {`);
    lines.push(`    switch ("${browserKey}") {`);
    lines.push(`      case "FIREFOX": driver = new FirefoxDriver(); break;`);
    lines.push(`      case "EDGE": driver = new EdgeDriver(); break;`);
    lines.push(`      default: driver = new ChromeDriver();`);
    lines.push(`    }`);
    lines.push(`    driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  @AfterClass`);
    lines.push(`  public void tearDown() {`);
    lines.push(`    if (driver != null) {`);
    lines.push(`      try { driver.quit(); } catch (Exception ignored) {}`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  @Test`);
    lines.push(`  public void runTest() throws Exception {`);
    steps.forEach(step => {
        const code = mapStepToJava(step);
        if (!code) return;
        lines.push(code);
    });
    lines.push(`  }`);
    lines.push('');
    lines.push(`  private WebElement find(String xpath) {`);
    lines.push(`    return driver.findElement(By.xpath(xpath));`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  private void validateElement(String xpath, String rawValue) {`);
    lines.push(`    WebElement el = find(xpath);`);
    lines.push(`    String attr = "innerText";`);
    lines.push(`    String expected = rawValue == null ? "" : rawValue;`);
    lines.push(`    if (rawValue != null && rawValue.contains("=")) {`);
    lines.push(`      int idx = rawValue.indexOf("=");`);
    lines.push(`      attr = rawValue.substring(0, idx);`);
    lines.push(`      expected = rawValue.substring(idx + 1);`);
    lines.push(`    }`);
    lines.push(`    Object actual;`);
    lines.push(`    switch (attr) {`);
    lines.push(`      case "isSelected": actual = el.isSelected(); break;`);
    lines.push(`      case "isEnabled": actual = el.isEnabled(); break;`);
    lines.push(`      case "isDisplayed": actual = el.isDisplayed(); break;`);
    lines.push(`      case "getText": actual = el.getText(); break;`);
    lines.push(`      case "selection":`);
    lines.push(`        WebElement opt = el.findElement(By.cssSelector("option:checked"));`);
    lines.push(`        actual = opt.getText();`);
    lines.push(`        break;`);
    lines.push(`      default:`);
    lines.push(`        actual = el.getAttribute(attr);`);
    lines.push(`    }`);
    lines.push(`    String actualStr = actual == null ? "" : actual.toString();`);
    lines.push(`    if (actualStr.contains("\\n") || actualStr.contains("\\r")) {`);
    lines.push(`      actualStr = actualStr.replace("\\n", "").replace("\\r", "");`);
    lines.push(`    }`);
    lines.push(`    String expectedStr = expected == null ? "" : expected;`);
    lines.push(`    if (!actualStr.equals(expectedStr)) {`);
    lines.push(`      throw new AssertionError("Validation failed for " + attr + ": expected '" + expectedStr + "' got '" + actualStr + "'");`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`}`);

    const filename = `${className}-${idx + 1}-selenium.java`;
    return { filename, content: lines.join('\n') };
};

const generateSeleniumScripts = (testRunnerSteps = [], { language = 'js' } = {}) => {
    if (!Array.isArray(testRunnerSteps)) return [];
    const lang = (language || 'js').toString().toLowerCase();
    const builder = lang.startsWith('java') ? buildJavaTestNG : buildScript;
    return testRunnerSteps
        .map((runner, idx) => builder(runner, idx))
        .filter(Boolean);
};

module.exports = { generateSeleniumScripts };

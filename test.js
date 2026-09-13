colors = require('colors');
(async () => {
  const {
    Builder,
    Browser,
    By,
    Key,
    until,
    Select,
  } = require('selenium-webdriver');
  driver = await new Builder().forBrowser(Browser.CHROME).build();
  driver.manage().window().maximize();
  await driver.get('https://www.w3schools.com/tags/tryit.asp?filename=tryhtml5_input_type_checkbox');
  console.log('||||||||||||||||||||'.bgRed);
  // const el = (await driver.findElements(By.className('css-2b097c-container')))[0]
  // console.log((await el.getAttribute('id')).toString().bgGreen)
  const el = await driver.findElement(By.xpath('//*[@id="vehicle2"]'));
  console.log(el);
  // console.log(await el.getAttribute('class'))

  // console.log(await el.getAttribute('id'))

  const classNameRegex = /^className=(["'].*["'])(\[\d+\])?$/;
  //               /^id=(["'].*["'])(\[\d+\])?$/;
  //             /^name=(["'].*["'])(\[\d+\])?$/;
  //         /^linkText=(["'].*["'])(\[\d+\])?$/;
  //  /^partialLinkText=(["'].*["'])(\[\d+\])?$/;
  //          /^tagName=(["'].*["'])(\[\d+\])?$/;

  console.log(classNameRegex.test('className="abc{{var}}[1]'));
})();

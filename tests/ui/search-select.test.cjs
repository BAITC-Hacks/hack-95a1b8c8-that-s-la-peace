// Isolated native-select component checks with synthetic options, no API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/search-select.mjs'), 'utf8');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {channel: 'msedge'})});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, locale: 'ru-RU'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<form><fieldset><label for="category">Категория</label><select id="category" name="category" aria-describedby="hint"><option value="">Выберите</option><option value="host" selected>Ведущий</option><option value="photo">Фотограф</option><optgroup label="Места"><option value="hall">Банкетный зал</option><option value="closed" disabled>Закрытый зал</option></optgroup><option value="tree">Ёлка</option></select><p id="hint">Подсказка</p><button type="submit">Отправить</button></fieldset></form>');
    await page.evaluate(async text => {
      const url = URL.createObjectURL(new Blob([text], {type: 'text/javascript'}));
      const {enhanceSelect} = await import(url);
      URL.revokeObjectURL(url);
      window.renders = 0;
      window.component = enhanceSelect(document.querySelector('select'), {
        getSearchText: option => `${option.label} ${{host: 'Presenter', photo: 'Photographer', hall: 'Hall'}[option.value] || ''}`,
        onRender: () => {
          window.renders++;
          // The callback can update already-rendered UI labels safely.
          document.querySelector('.select-search-status').dataset.rendered = 'yes';
        }
      });
      window.events = {input: 0, change: 0, submit: 0};
      const form = document.querySelector('form');
      for (const name of Object.keys(window.events)) form.addEventListener(name, event => {window.events[name]++; if (name === 'submit') event.preventDefault();});
    }, source);
    const search = page.getByRole('searchbox');
    const select = page.locator('select');
    const values = () => select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.deepEqual(await values(), ['', 'host', 'photo', 'hall', 'closed', 'tree']);
    assert.equal(await select.inputValue(), 'host');
    assert.match(await search.getAttribute('aria-controls'), /category/);
    assert.match(await select.getAttribute('aria-describedby'), /^hint select-search-/);
    assert.equal(await page.locator('[role=status]').getAttribute('data-rendered'), 'yes');
    const initialRenders = await page.evaluate(() => window.renders);
    await search.fill('PHOTOGRAPHER');
    assert.deepEqual(await values(), ['', 'host', 'photo']);
    assert.equal(await select.inputValue(), 'host');
    assert.ok(await page.evaluate(() => window.renders) > initialRenders);
    await page.getByRole('button', {name: 'Показать весь список'}).click();

    await search.fill('ФОТО');
    assert.deepEqual(await values(), ['', 'host', 'photo']);
    assert.equal(await select.inputValue(), 'host');
    assert.match(await page.locator('[role=status]').textContent(), /Найдено: 1.*Выбранное значение сохранено/);
    assert.deepEqual(await page.evaluate(() => window.events), {input: 0, change: 0, submit: 0});
    await search.press('Enter');
    assert.equal(await select.evaluate(node => document.activeElement === node), true);
    assert.equal(await page.evaluate(() => window.events.submit), 0);
    await select.selectOption('photo');
    assert.equal(await select.inputValue(), 'photo');
    assert.deepEqual(await values(), ['', 'photo']);
    assert.equal(await page.evaluate(() => window.events.change), 1);
    assert.equal(await page.evaluate(() => new FormData(document.querySelector('form')).get('category')), 'photo');

    await search.fill('нет совпадения');
    assert.deepEqual(await values(), ['', 'photo']);
    assert.match(await page.locator('[role=status]').textContent(), /Нет вариантов.*Выбранное значение сохранено/);
    await page.evaluate(() => window.component.refresh());
    await page.getByRole('button', {name: 'Показать весь список'}).click();
    assert.deepEqual(await values(), ['', 'host', 'photo', 'hall', 'closed', 'tree']);
    assert.equal(await select.inputValue(), 'photo');
    assert.equal(await page.locator('option[value=closed]').isDisabled(), true);
    await search.fill('елка');
    assert.deepEqual(await values(), ['', 'photo', 'tree']);
    await search.press('Escape');
    assert.equal(await search.inputValue(), '');
    assert.equal((await values()).length, 6);
    await search.fill('зал');
    await search.press('ArrowDown');
    assert.equal(await select.evaluate(node => document.activeElement === node), true);
    assert.equal(await select.inputValue(), 'photo');
    await page.evaluate(() => document.querySelector('form').reset());
    assert.equal(await select.inputValue(), 'host');
    assert.equal((await values()).length, 6);

    await select.evaluate(node => {node.disabled = true;});
    await page.waitForFunction(() => document.querySelector('.select-search-input').disabled);
    assert.equal(await search.isDisabled(), true);
    await select.evaluate(node => {node.disabled = false;});
    await page.waitForFunction(() => !document.querySelector('.select-search-input').disabled);
    await page.locator('fieldset').evaluate(node => {node.disabled = true;});
    assert.equal(await search.isDisabled(), true);
    await page.locator('fieldset').evaluate(node => {node.disabled = false;});

    await search.fill('нов');
    await select.evaluate(node => {node.replaceChildren(new Option('Выберите', ''), new Option('Новый вариант', 'new'), new Option('<script>bad()</script>', 'literal'));});
    await page.evaluate(() => window.component.refresh());
    assert.deepEqual(await values(), ['', 'new']);
    assert.equal(await select.inputValue(), '');
    await page.getByRole('button', {name: 'Показать весь список'}).click();
    assert.deepEqual(await values(), ['', 'new', 'literal']);
    assert.equal(await select.locator('script').count(), 0);
    await select.selectOption('new');
    await search.fill('nothing');
    await page.evaluate(() => window.component.destroy());
    assert.deepEqual(await values(), ['', 'new', 'literal']);
    assert.equal(await select.inputValue(), 'new');
    assert.equal(await page.locator('.select-search').count(), 0);
    assert.equal(await select.getAttribute('aria-describedby'), 'hint');
    assert.deepEqual(errors, []);
    console.log('PASS search-select: native value/order/disabled, empty and case-insensitive search, selected retention, keyboard/no-submit, refresh/reset/destroy, text-only options. Synthetic component data only; no API or integrated acceptance.');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});

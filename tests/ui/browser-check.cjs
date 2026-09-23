// Browser checks use only explicitly synthetic fixtures intercepted in an
// isolated browser context. They do not verify real recommendations or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.argv[2] || 'http://127.0.0.1:4173';
const output = process.env.UI_CHECK_OUTPUT;
const meta = {api_version: 1, dataset_version: 'a'.repeat(64), cities: ['Алматы', 'Астана', 'Зарубежье'], categories: ['Ведущий', 'Флорист', 'Банкетный зал'], event_types: ['корпоратив', 'свадьба'], languages: ['русский', 'казахский'], dataset_count: 66, date_range: {min: '2026-09-23', max: '2026-12-31'}};
const card = (id, name, explanation) => ({id, name, explanation, category: 'Ведущий', city: 'Алматы', price_from_kzt: 250000, synthetic: true, city_imputed: false, price_imputed: true, languages: ['русский'], max_hours: 4, description_excerpt: 'Синтетический тестовый фрагмент.', source: 'provided'});
const cards = [card('fixture-z', 'Тестовый ведущий A', 'Тестовые данные: ведёт корпоративы на русском, включает музыкальную программу.'), card('fixture-a', 'Тестовый ведущий B', 'Тестовые данные: специализируется на камерных событиях и интерактивах.')];
const matched = {api_version: 1, dataset_version: 'a'.repeat(64), explanation_mode: 'deterministic', suggestions: [], status: 'matched', message: 'Тестовый ответ: два профиля подходят по условиям.', cards, total_in_city_category: 3, eligible_count: 2, exclusions: {busy: 1, budget: 0, event_type: 0, language: 0, duration: 0}};

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {channel: 'msedge'})});
  console.log(`Browser: ${await browser.version()}; FIXTURES ONLY`);
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}, locale: 'ru-RU'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let mode = 'matched';
  let requests = [];
  let metaUnavailable = false;
  let holdResponse = false;
  let releaseResponse;
  const responseGate = new Promise(resolve => {releaseResponse = resolve;});
  await page.route('**/api/meta', route => route.fulfill({status: metaUnavailable ? 503 : 200, contentType: 'application/json', body: JSON.stringify(metaUnavailable ? {error: {code: 'service_unavailable'}} : meta)}));
  await page.route('**/api/recommendations', async route => {
    requests.push(route.request().postDataJSON());
    const currentMode = mode;
    if (holdResponse) await responseGate;
    await new Promise(resolve => setTimeout(resolve, 120));
    let body = matched, status = 200;
    if (currentMode === 'no_category_in_city') body = {...matched, status: currentMode, message: 'Тест: в этом городе нет категории.', cards: [], total_in_city_category: 0, eligible_count: 0, exclusions: {busy: 0, budget: 0, event_type: 0, language: 0, duration: 0}};
    if (currentMode === 'no_matches') body = {...matched, status: currentMode, message: 'Тест: кандидаты заняты на дату.', cards: [], eligible_count: 0};
    if (currentMode === 'validation') {status = 422; body = {error: {code: 'invalid_request', message: 'Тест: проверьте язык.', fields: {language: 'Тестовая ошибка поля.'}}};}
    if (currentMode === 'unavailable') {status = 503; body = {error: {code: 'service_unavailable', message: 'internal detail must not appear'}};}
    if (currentMode === 'malformed') body = {...matched, cards: [...cards, card('3', 'Тест3', 'Тест.'), card('4', 'Тест4', 'Тест.')], eligible_count: 4, total_in_city_category: 4};
    if (currentMode === 'one') body = {...matched, cards: [cards[0]], eligible_count: 1};
    if (currentMode === 'three') body = {...matched, cards: [...cards, card('fixture-c', 'Тестовый ведущий C', 'Тестовый факт C.')], eligible_count: 4, total_in_city_category: 4};
    if (currentMode === 'xss') body = {...matched, cards: [{...cards[0], name: '<img src=x onerror="window.fixtureXss=1">', explanation: '<script>window.fixtureXss=1</script>'}, cards[1]]};
    if (currentMode === 'facts') body = {...matched, explanation_mode: 'deterministic_fallback', cards: [cards[0], {...cards[1], max_hours: null, source: 'team_added'}]};
    if (currentMode === 'suggest_date' || currentMode === 'suggest_budget') {
      const incoming = route.request().postDataJSON();
      const kind = currentMode === 'suggest_date' ? 'change_date' : 'increase_budget';
      const request = {...incoming, ...(kind === 'change_date' ? {event_date: '2026-10-20'} : {budget_kzt: incoming.budget_kzt + 50000})};
      body = {...matched, status: 'no_matches', cards: [], eligible_count: 0,
        suggestions: [{kind, message: 'Тестовое проверенное изменение одного условия.', request, eligible_count: 1}]};
    }
    await route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
  });
  const state = async value => page.locator(`[data-state="${value}"]`).waitFor();
  const submit = async value => {await page.getByRole('button', {name: 'Подобрать варианты'}).click(); await state(value);};
  try {
    await page.goto(baseUrl);
    await state('idle');
    assert.equal(await page.locator('[name=event_date]').getAttribute('min'), '2026-09-23');
    assert.equal(await page.locator('[name=event_date]').getAttribute('max'), '2026-12-31');
    await submit('invalid');
    assert.equal(requests.length, 0);
    assert.equal(await page.locator('[aria-invalid=true]').count(), 5);
    console.log('PASS required fields and calendar bounds');

    await page.getByLabel('Город', {exact: true}).selectOption('Алматы');
    await page.getByLabel('Дата события').fill('2026-10-15');
    await page.getByLabel('Формат мероприятия').selectOption('корпоратив');
    await page.getByLabel('Кого или что ищем').selectOption('Ведущий');
    await page.getByLabel('Бюджет, ₸').fill('1000000');
    holdResponse = true;
    await page.getByRole('button', {name: 'Подобрать варианты'}).click();
    await state('loading');
    assert.equal(await page.locator('button[type=submit]').isDisabled(), true);
    holdResponse = false;
    releaseResponse();
    await state('matched');
    assert.deepEqual(requests.at(-1), {city: 'Алматы', event_date: '2026-10-15', event_type: 'корпоратив', category: 'Ведущий', budget_kzt: 1000000, duration_hours: null, language: null});
    const ids = () => page.locator('[data-profile-id]').evaluateAll(nodes => nodes.map(node => node.dataset.profileId));
    assert.deepEqual(await ids(), ['fixture-z', 'fixture-a']);
    assert.equal(await page.getByText('Синтетический профиль в каталоге', {exact: true}).count(), 2);
    assert.match(await page.locator('.card-price').first().innerText(), /^от /);
    await submit('matched');
    assert.deepEqual(await ids(), ['fixture-z', 'fixture-a']);
    console.log('PASS JSON request, optional nulls, backend order, labels, repeat');
    if (output) {fs.mkdirSync(output, {recursive: true}); await page.screenshot({path: path.join(output, 'desktop-fixtures.png'), fullPage: true});}
    mode = 'one'; await submit('matched'); assert.equal(await page.locator('[data-profile-id]').count(), 1);
    mode = 'three'; await submit('matched'); assert.equal(await page.locator('[data-profile-id]').count(), 3);
    console.log('PASS loading disables form; one, two and three cards');

    await page.getByLabel('Дата события').fill('2026-10-16');
    await state('edited');
    assert.equal(await page.locator('[data-profile-id]').count(), 0);
    for (const outcome of ['no_category_in_city', 'no_matches']) {mode = outcome; await submit(outcome); assert.equal(await page.locator('[data-profile-id]').count(), 0);}
    console.log('PASS stale-result clearing and distinct empty states');

    mode = 'validation'; await submit('invalid');
    assert.equal(await page.locator('[name=language]').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('details').getAttribute('open'), '');
    mode = 'unavailable'; await submit('error');
    assert.equal((await page.locator('body').innerText()).includes('internal detail'), false);
    assert.equal(await page.getByLabel('Бюджет, ₸').inputValue(), '1000000');
    mode = 'matched'; await page.getByRole('button', {name: 'Попробовать ещё раз'}).click(); await state('matched');
    mode = 'malformed'; await submit('error');
    assert.equal(await page.locator('[data-profile-id]').count(), 0);
    mode = 'xss'; await submit('matched');
    assert.equal(await page.locator('.contractor-card img, .contractor-card script').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
    console.log('PASS 422, service failure/retry, malformed response and XSS-safe text');

    const beforeInvalid = requests.length;
    await page.getByLabel('Дата события').fill('2027-01-01'); await submit('invalid');
    assert.equal(requests.length, beforeInvalid);
    await page.getByLabel('Дата события').fill('2026-10-15');
    await page.getByLabel('Длительность, ч').fill('0'); await submit('invalid');
    assert.equal(requests.length, beforeInvalid);
    await page.getByLabel('Длительность, ч').fill('2');
    await page.getByLabel('Язык', {exact: true}).selectOption('русский');
    mode = 'matched'; await submit('matched');
    assert.equal(requests.at(-1).duration_hours, 2); assert.equal(requests.at(-1).language, 'русский');
    console.log('PASS out-of-window date, duration validation and optional values');
    const beforeFraction = requests.length;
    await page.getByLabel('Бюджет, ₸').fill('1.5'); await submit('invalid');
    assert.equal(requests.length, beforeFraction);
    await page.getByLabel('Бюджет, ₸').fill('1000000');
    mode = 'facts'; await submit('matched');
    assert.equal(await page.locator('[data-explanation-mode=deterministic_fallback]').count(), 1);
    assert.equal(await page.locator('.profile-languages').count(), 2);
    assert.match(await page.locator('.profile-duration').nth(1).innerText(), /неприменимо/);
    assert.match(await page.locator('.data-source').nth(1).innerText(), /команд/);
    assert.equal(await page.locator('.profile-excerpt > p').count(), 2);
    console.log('PASS integer budget, profile facts, source and honest fallback label');
    for (const kind of ['change_date', 'increase_budget']) {
      mode = kind === 'change_date' ? 'suggest_date' : 'suggest_budget';
      const oldDate = await page.getByLabel('Дата события').inputValue();
      const oldBudget = await page.getByLabel('Бюджет, ₸').inputValue();
      await submit('no_matches');
      const beforeClick = requests.length;
      assert.equal(await page.getByLabel('Дата события').inputValue(), oldDate);
      assert.equal(await page.getByLabel('Бюджет, ₸').inputValue(), oldBudget);
      assert.equal(requests.length, beforeClick);
      mode = 'matched';
      await page.locator(`button[data-suggestion-kind="${kind}"]`).click(); await state('matched');
      assert.equal(requests.length, beforeClick + 1);
      assert.equal(requests.at(-1).event_date, kind === 'change_date' ? '2026-10-20' : oldDate);
      assert.equal(requests.at(-1).budget_kzt, Number(oldBudget) + (kind === 'increase_budget' ? 50000 : 0));
      assert.equal(requests.at(-1).duration_hours, 2);
      assert.equal(requests.at(-1).language, 'русский');
    }
    console.log('PASS both suggestions require explicit click and preserve other conditions');
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (output) await page.screenshot({path: path.join(output, 'mobile-fixtures.png'), fullPage: true});
    console.log('PASS mobile width 390, no horizontal overflow');

    metaUnavailable = true;
    await page.reload(); await state('unavailable');
    assert.equal(await page.getByRole('button', {name: 'Подобрать варианты'}).isDisabled(), true);
    metaUnavailable = false;
    await page.getByRole('button', {name: 'Попробовать ещё раз'}).click(); await state('idle');
    assert.deepEqual(errors, []);
    console.log('PASS metadata failure/recovery and no browser exceptions');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});

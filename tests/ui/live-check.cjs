// Real browser/API compatibility checks. No request interception or fixtures.
// This does not establish clean acceptance of an integrated remote commit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseUrl = process.argv[2] || 'http://127.0.0.1:4175';
const parsedUrl = new URL(baseUrl);
if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
  throw new Error('Use an HTTP(S) base URL without credentials.');
}
const output = process.env.UI_CHECK_OUTPUT;
const sourceDataset = '6a724b6b7dfb5973343e68ba18dadb60fc807d87e3d78f03ee86fb26cb089f7d';
const keys = ['city', 'event_date', 'event_type', 'category', 'budget_kzt', 'duration_hours', 'language'];
const baseRequest = {city: 'Алматы', event_date: '2026-10-15', event_type: 'корпоратив', category: 'Ведущий', budget_kzt: 1000000, duration_hours: null, language: null};
const report = {
  scope: 'two-SHA frontend/backend compatibility; not merged remote acceptance',
  fixtures: false,
  started_at: new Date().toISOString(),
  base_url: parsedUrl.href,
  declared_frontend_sha: process.env.UI_FRONTEND_SHA || 'fb54b42',
  declared_backend_sha: process.env.UI_BACKEND_SHA || 'a0918c8',
  source_identity_note: 'SHAs are supplied by the runner; HTTP alone cannot verify the serving process checkout.',
  checks: [], runs: [], page_errors: []
};

function endpoint(url, pathname) {
  try {return new URL(url).pathname === pathname;} catch {return false;}
}

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {channel: 'msedge'})});
  report.browser = await browser.version();
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}, locale: 'ru-RU'});
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const posted = [];
  page.on('pageerror', error => report.page_errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && endpoint(request.url(), '/api/recommendations')) posted.push(request.postDataJSON());
  });

  async function check(name, fn) {
    try {
      const result = await fn();
      report.checks.push({name, status: 'PASS'});
      return result;
    } catch (error) {
      report.checks.push({name, status: 'FAIL', error: error.message});
      return null;
    }
  }

  async function formValues() {
    return page.locator('[name]').evaluateAll(nodes => Object.fromEntries(nodes.filter(node => ['INPUT', 'SELECT'].includes(node.tagName)).map(node => [node.name, node.name === 'budget_kzt' ? node.value.replace(/\s/g, '') : node.value])));
  }

  async function fillForm(request) {
    const before = posted.length;
    await page.getByLabel('Город', {exact: true}).selectOption(request.city);
    await page.getByLabel('Дата события').fill(request.event_date);
    await page.getByLabel('Формат мероприятия', {exact: true}).selectOption(request.event_type);
    await page.getByLabel('Кого или что ищем', {exact: true}).selectOption(request.category);
    await page.getByLabel('Бюджет, ₸').fill(String(request.budget_kzt));
    const optional = page.locator('details.optional-fields');
    if (await optional.getAttribute('open') === null) await optional.locator('summary').click();
    await page.getByLabel('Язык', {exact: true}).selectOption(request.language || '');
    await page.getByLabel('Длительность, ч').fill(request.duration_hours === null ? '' : String(request.duration_hours));
    assert.equal(posted.length, before, 'Editing the form must not submit automatically.');
  }

  async function run(id, request, expected, options = {}) {
    const record = {id, request, status: 'NOT VERIFIED'};
    report.runs.push(record);
    try {
      if (options.fill !== false) await fillForm(request);
      const before = posted.length;
      const started = performance.now();
      const waiting = page.waitForResponse(response => response.request().method() === 'POST' && endpoint(response.url(), '/api/recommendations'));
      await (options.click ? options.click() : page.getByRole('button', {name: 'Подобрать варианты', exact: true}).click());
      const response = await waiting;
      record.http_status = response.status();
      assert.equal(response.status(), 200, `${id}: the live service should return HTTP 200.`);
      const data = await response.json();
      assert.deepEqual(response.request().postDataJSON(), request, `${id}: outgoing JSON must match the requested parameters.`);
      assert.equal(posted.length, before + 1, `${id}: one explicit action must send one request.`);
      assert.equal(data.api_version, 1, `${id}: API version.`);
      assert.equal(data.dataset_version, sourceDataset, `${id}: expected source dataset version.`);
      assert.equal(data.status, expected.status, `${id}: outcome.`);
      assert.equal(data.total_in_city_category, expected.total, `${id}: city/category group count.`);
      assert.equal(data.eligible_count, expected.eligible, `${id}: eligible count from CSV or verified suggestion.`);
      assert.equal(data.cards.length, Math.min(3, expected.eligible), `${id}: top-three size.`);
      assert.ok(typeof data.message === 'string' && data.message.trim(), `${id}: a meaningful result message is required.`);
      const ids = data.cards.map(card => card.id);
      assert.equal(new Set(ids).size, ids.length, `${id}: duplicate IDs are not allowed.`);
      await page.locator(`[data-state="${data.status}"]`).waitFor({state: 'visible'});
      await page.waitForFunction(wanted => JSON.stringify([...document.querySelectorAll('[data-profile-id]')].map(node => node.dataset.profileId)) === JSON.stringify(wanted), ids);
      await page.waitForFunction(() => !document.querySelector('.picker-fieldset').disabled);
      const visibleIds = await page.locator('[data-profile-id]').evaluateAll(nodes => nodes.map(node => node.dataset.profileId));
      assert.deepEqual(visibleIds, ids, `${id}: UI must preserve server order.`);
      assert.ok((await page.locator('.results-summary > p').first().textContent()) === data.message, `${id}: UI must show the server explanation of the outcome.`);
      assert.equal(await page.locator(`[data-explanation-mode="${data.explanation_mode}"]`).count(), 1, `${id}: explanation mode must be disclosed.`);
      for (let i = 0; i < data.cards.length; i++) {
        const card = data.cards[i];
        assert.equal(card.city, request.city, `${id}: city filter.`);
        assert.equal(card.category, request.category, `${id}: requested category.`);
        assert.ok(card.price_from_kzt <= request.budget_kzt, `${id}: starting price exceeds budget.`);
        assert.ok(typeof card.explanation === 'string' && card.explanation.trim(), `${id}: explanation is missing.`);
        if (request.language) assert.ok(card.languages.includes(request.language), `${id}: requested language is missing.`);
        if (request.duration_hours !== null) assert.ok(card.max_hours === null || card.max_hours >= request.duration_hours, `${id}: requested duration exceeds the profile limit.`);
        const item = page.locator('[data-profile-id]').nth(i);
        assert.match(await item.locator('.card-price').innerText(), /^от /, `${id}: price must be labelled as a starting price.`);
        assert.ok((await item.locator('.explanation p').last().textContent()) === card.explanation, `${id}: UI explanation must equal the actual API text.`);
        assert.ok((await item.locator('.profile-excerpt > p').textContent()) === card.description_excerpt, `${id}: description excerpt must match the API.`);
        if (card.max_hours === null) assert.match(await item.locator('.profile-duration').innerText(), /неприменимо/, `${id}: null duration is not zero.`);
      }
      const withoutNames = data.cards.map(card => card.explanation.split(card.name).join('').replace(/\s+/g, ' ').trim());
      assert.equal(new Set(withoutNames).size, withoutNames.length, `${id}: explanations should remain distinct after removing names.`);
      record.status = 'PASS';
      record.outcome = data.status;
      record.api_ids = ids;
      record.visible_ids = visibleIds;
      record.total_in_city_category = data.total_in_city_category;
      record.eligible_count = data.eligible_count;
      record.exclusions = data.exclusions;
      record.explanation_mode = data.explanation_mode;
      record.suggestion_kinds = data.suggestions.map(suggestion => suggestion.kind);
      record.elapsed_ms = Math.round(performance.now() - started);
      record.within_10s_target = record.elapsed_ms <= 10000;
      return {data, request, ids};
    } catch (error) {
      record.status = 'FAIL';
      record.error = error.message;
      throw error;
    }
  }

  async function applySuggestion(source, kind, id) {
    assert.ok(source, `${id}: prerequisite live response was not verified.`);
    const suggestion = source.data.suggestions.find(item => item.kind === kind);
    assert.ok(suggestion, `${id}: service returned no ${kind} suggestion; this workflow is not verified.`);
    const before = await formValues();
    for (const key of keys) assert.equal(before[key], source.request[key] === null ? '' : String(source.request[key]), `${id}: a suggestion must not auto-change the form.`);
    const changed = keys.filter(key => suggestion.request[key] !== source.request[key]);
    assert.deepEqual(changed, [kind === 'change_date' ? 'event_date' : 'budget_kzt'], `${id}: a suggestion must change exactly one permitted field.`);
    assert.ok(suggestion.eligible_count > 0, `${id}: suggestion must have a verified positive count.`);
    if (kind === 'increase_budget') assert.ok(suggestion.request.budget_kzt > source.request.budget_kzt, `${id}: suggested budget must increase.`);
    const result = await run(id, suggestion.request, {status: 'matched', total: source.data.total_in_city_category, eligible: suggestion.eligible_count}, {
      fill: false,
      click: () => page.locator(`button.suggestion-button[data-suggestion-kind="${kind}"]`).click()
    });
    assert.equal(result.data.eligible_count, suggestion.eligible_count, `${id}: actual result must match the server suggestion count.`);
    return result;
  }

  try {
    const metaWait = page.waitForResponse(response => endpoint(response.url(), '/api/meta'));
    await page.goto(baseUrl, {waitUntil: 'domcontentloaded'});
    const metaResponse = await metaWait;
    assert.equal(metaResponse.status(), 200, 'Real metadata endpoint must be ready.');
    const meta = await metaResponse.json();
    assert.equal(meta.dataset_version, sourceDataset, 'This test baseline requires the original CSV.');
    assert.equal(meta.dataset_count, 66, 'This test baseline requires 66 profiles.');
    report.dataset_version = meta.dataset_version;
    await page.locator('[data-state="idle"]').waitFor();
    await page.locator('.auto-toggle input').uncheck();
    await page.locator('.compatibility-toggle').waitFor({state: 'visible'});
    await page.locator('.compatibility-toggle input').uncheck(); // Exercise the complete catalog, including the absent city/category outcome.
    report.checks.push({name: 'Real metadata and source dataset', status: 'PASS'});

    const d1 = await check('D1 dense category', () => run('D1', {...baseRequest}, {status: 'matched', total: 10, eligible: 6}));
    const repeated = await check('D1 repeat', () => run('D1-repeat', {...baseRequest}, {status: 'matched', total: 10, eligible: 6}, {fill: false}));
    await check('Stable repeated ID order', () => {assert.ok(d1 && repeated, 'Both runs must pass.'); assert.deepEqual(d1.ids, repeated.ids);});
    if (output && d1) {
      fs.mkdirSync(output, {recursive: true});
      await page.screenshot({path: path.join(output, 'desktop-live.png'), fullPage: true});
    }
    const d2 = await check('D2 changed date', () => run('D2', {...baseRequest, event_date: '2026-10-16'}, {status: 'matched', total: 10, eligible: 4}));
    await check('D1/D2 visible top-three changes', () => {assert.ok(d1 && d2, 'Both runs must pass.'); assert.notDeepEqual(d1.ids, d2.ids);});
    const florist = {...baseRequest, category: 'Флорист', event_type: 'свадьба'};
    await check('D3 rare category has two cards', () => run('D3', florist, {status: 'matched', total: 2, eligible: 2}));
    const d4 = await check('D4 sole florist is booked', () => run('D4', {...florist, city: 'Астана'}, {status: 'no_matches', total: 1, eligible: 0}));
    await check('D4 busy exclusion', () => {assert.ok(d4, 'D4 must pass.'); assert.equal(d4.data.exclusions.busy, 1);});
    await check('Explicit server date suggestion', () => applySuggestion(d4, 'change_date', 'S-date'));
    const d5 = await check('D5 budget one tenge', () => run('D5', {...baseRequest, budget_kzt: 1}, {status: 'no_matches', total: 10, eligible: 0}));
    await check('D5 budget exclusions', () => {assert.ok(d5, 'D5 must pass.'); assert.equal(d5.data.exclusions.budget, 10);});
    await check('Explicit server budget suggestion', () => applySuggestion(d5, 'increase_budget', 'S-budget'));
    await check('D6 category absent in city', () => run('D6', {...baseRequest, city: 'Зарубежье'}, {status: 'no_category_in_city', total: 0, eligible: 0}));

    const venue = {...baseRequest, category: 'Банкетный зал', event_date: '2026-11-14', budget_kzt: 6000000};
    const v1 = await check('V1 venue calendar, two available', () => run('V1', venue, {status: 'matched', total: 7, eligible: 2}));
    const v2 = await check('V2 venue calendar, four eligible', () => run('V2', {...venue, event_date: '2026-11-15'}, {status: 'matched', total: 7, eligible: 4}));
    await check('Venue IDs and visible change', () => {
      assert.ok(v1 && v2, 'Both venue runs must pass.');
      assert.deepEqual([...v1.ids].sort(), ['HK-64395', 'HK-90011']);
      assert.equal(v1.ids.length, 2); assert.equal(v2.ids.length, 3);
      assert.equal(v2.ids.includes('HK-90011'), false, 'The venue booked on 15 November must disappear.');
      assert.ok(v2.ids.every(id => ['HK-64395', 'HK-72785', 'HK-99701', 'HK-69010'].includes(id)), 'V2 must contain only CSV-eligible venues.');
    });

    await check('Optional English and six hours', () => run('O-language-duration', {...baseRequest, language: 'английский', duration_hours: 6}, {status: 'matched', total: 10, eligible: 2}));
    const long = await check('Duration excludes all hosts', () => run('O-too-long', {...baseRequest, duration_hours: 13}, {status: 'no_matches', total: 10, eligible: 0}));
    await check('Duration exclusion count', () => {assert.ok(long, 'Duration run must pass.'); assert.equal(long.data.exclusions.duration, 10);});
    await check('Null max_hours is not zero', () => run('O-florist-no-hour-limit', {...florist, duration_hours: 24}, {status: 'matched', total: 2, eligible: 2}));

    await check('Mobile 390px has no horizontal overflow', async () => {
      await page.setViewportSize({width: 390, height: 844});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout overflows horizontally.');
      if (output) {
        fs.mkdirSync(output, {recursive: true});
        await page.screenshot({path: path.join(output, 'mobile-live.png'), fullPage: true});
      }
    });
    await check('No browser runtime errors', () => assert.deepEqual(report.page_errors, []));
    report.posted_request_count = posted.length;
  } catch (error) {
    report.checks.push({name: 'Setup or unhandled run error', status: 'FAIL', error: error.message});
  } finally {
    report.completed_at = new Date().toISOString();
    report.status = report.checks.some(item => item.status === 'FAIL') || report.runs.some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS';
    if (report.page_errors.length) report.status = 'FAIL';
    if (output) {
      fs.mkdirSync(output, {recursive: true});
      fs.writeFileSync(path.join(output, 'live-check.json'), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'PASS') process.exitCode = 1;
    await browser.close();
  }
})().catch(error => {
  report.completed_at = new Date().toISOString();
  report.status = 'FAIL';
  report.checks.push({name: 'Browser launch/runtime failure', status: 'FAIL', error: error.message});
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});

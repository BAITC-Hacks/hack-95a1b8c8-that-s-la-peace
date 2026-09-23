// Live integration only: no mocked routes, fixtures or substituted API responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseUrl = process.argv[2] || 'http://127.0.0.1:8002';
const origin = new URL(baseUrl).origin;
const output = process.env.UI_CHECK_OUTPUT;
const catalogPath = path.resolve(__dirname, '../../data/contractors.csv');
const catalogVersion = crypto.createHash('sha256').update(fs.readFileSync(catalogPath)).digest('hex');
const baseQuery = {
  city: 'Алматы', event_date: '2026-10-15', event_type: 'корпоратив',
  category: 'Ведущий', budget_kzt: 1000000, duration_hours: null, language: null,
};

(async () => {
  if (output) fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {channel: 'msedge'})});
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}, locale: 'ru-RU'});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  const browserErrors = [];
  const externalRequests = [];
  const scenarios = [];
  const capturedRequests = [];
  const screenshots = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      externalRequests.push({method: request.method(), url: request.url()});
    }
    if (url.origin === origin && url.pathname === '/api/recommendations' && request.method() === 'POST') {
      capturedRequests.push(request.postDataJSON());
    }
  });
  const isRecommendation = response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === '/api/recommendations'
      && response.request().method() === 'POST';
  };
  const state = value => page.locator('[data-state="' + value + '"]').waitFor({state: 'visible'});
  const domIds = () => page.locator('[data-profile-id]').evaluateAll(nodes => nodes.map(node => node.dataset.profileId));

  async function fill(request) {
    await page.getByLabel('Город', {exact: true}).selectOption(request.city);
    await page.getByLabel('Дата события').fill(request.event_date);
    await page.getByLabel('Формат мероприятия').selectOption(request.event_type);
    await page.getByLabel('Кого или что ищем').selectOption(request.category);
    await page.getByLabel('Бюджет, ₸').fill(String(request.budget_kzt));
    const optional = page.locator('details.optional-fields');
    if (!(await optional.getAttribute('open') !== null)) await optional.locator('summary').click();
    await page.getByLabel('Язык', {exact: true}).selectOption(request.language || '');
    await page.getByLabel('Длительность, ч').fill(request.duration_hours === null ? '' : String(request.duration_hours));
  }

  async function checkCards(body) {
    const expectedIds = body.cards.map(card => card.id);
    await page.waitForFunction(expected => {
      const actual = Array.from(document.querySelectorAll('[data-profile-id]'), node => node.dataset.profileId);
      return JSON.stringify(actual) === JSON.stringify(expected);
    }, expectedIds);
    assert.deepEqual(await domIds(), expectedIds, 'DOM must preserve the real API order.');
    assert.equal(new Set(expectedIds).size, expectedIds.length);
    assert.equal(body.dataset_version, catalogVersion, 'Response must use the provided CSV.');
    assert.equal(body.api_version, 1);
    assert.equal(body.cards.length, Math.min(3, body.eligible_count));
    await page.getByText(body.message, {exact: true}).waitFor({state: 'visible'});
    const domCards = page.locator('[data-profile-id]');
    for (let index = 0; index < body.cards.length; index += 1) {
      const card = body.cards[index];
      assert.equal(card.source, 'provided');
      assert.ok(card.explanation.trim());
      assert.ok(card.description_excerpt.trim());
      if (card.explanation.includes('Из описания:')) {
        assert.ok(card.explanation.includes(card.description_excerpt), 'Quoted reason must preserve the source excerpt.');
      } else {
        const presence = card.max_hours === null
          ? 'работа не привязана к присутствию по часам'
          : `на площадке до ${card.max_hours} ч`;
        assert.ok(card.explanation.includes(`В профиле: языки — ${card.languages.join(', ')}; ${presence}`),
          'Sparse descriptions must use actual structured facts, not a fabricated quote.');
      }
      assert.equal(await domCards.nth(index).locator('.profile-excerpt > p').textContent(), card.description_excerpt);
      const text = await domCards.nth(index).innerText();
      assert.ok(text.includes(card.name), 'Source name must be visible.');
      assert.ok(text.includes(card.explanation), 'The full server explanation must be visible.');
      assert.match(await domCards.nth(index).locator('.card-price').innerText(), /^от /);
      assert.equal(await domCards.nth(index).locator('.data-source').innerText(), 'Исходный каталог');
    }
  }

  async function act(label, request, action) {
    const responsePromise = page.waitForResponse(isRecommendation);
    const started = performance.now();
    await action();
    const response = await responsePromise;
    assert.equal(response.status(), 200, label + ': expected real API success.');
    assert.deepEqual(response.request().postDataJSON(), request, label + ': submitted JSON differs.');
    const body = await response.json();
    await state(body.status);
    await checkCards(body);
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 10000, label + ': submit-to-render exceeded 10 seconds: ' + elapsedMs);
    scenarios.push({label, request, status: body.status, eligible_count: body.eligible_count,
      ids: body.cards.map(card => card.id), elapsed_ms: Math.round(elapsedMs)});
    console.log('PASS ' + label + ': ' + body.status + ', eligible=' + body.eligible_count
      + ', cards=' + body.cards.length + ', submit-to-render=' + Math.round(elapsedMs) + 'ms');
    return body;
  }

  async function submit(label, request) {
    await fill(request);
    return act(label, request, () => page.getByRole('button', {name: 'Подобрать варианты'}).click());
  }

  async function applySuggestion(label, body, kind) {
    const suggestion = body.suggestions.find(item => item.kind === kind);
    assert.ok(suggestion, 'Expected a verified ' + kind + ' suggestion.');
    const previousRequest = capturedRequests.at(-1);
    const changed = Object.keys(previousRequest).filter(key => previousRequest[key] !== suggestion.request[key]);
    assert.deepEqual(changed, [kind === 'change_date' ? 'event_date' : 'budget_kzt']);
    // An available suggestion must not silently change the form or issue a request.
    assert.equal(await page.getByLabel('Дата события').inputValue(), previousRequest.event_date);
    assert.equal(await page.getByLabel('Бюджет, ₸').inputValue(), String(previousRequest.budget_kzt));
    const countBefore = capturedRequests.length;
    const result = await act(label, suggestion.request,
      () => page.locator('button[data-suggestion-kind="' + kind + '"]').click());
    assert.equal(capturedRequests.length, countBefore + 1);
    assert.equal(result.status, 'matched');
    assert.equal(result.eligible_count, suggestion.eligible_count);
    assert.equal(await page.getByLabel('Дата события').inputValue(), suggestion.request.event_date);
    assert.equal(await page.getByLabel('Бюджет, ₸').inputValue(), String(suggestion.request.budget_kzt));
    return result;
  }

  async function screenshot(name) {
    if (!output) return;
    const target = path.resolve(output, name);
    await page.screenshot({path: target, fullPage: true});
    screenshots.push(target);
  }

  try {
    const metaPromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === '/api/meta' && response.request().method() === 'GET';
    });
    const navigation = await page.goto(baseUrl);
    assert.ok(navigation);
    assert.equal(navigation.status(), 200);
    const metaResponse = await metaPromise;
    assert.equal(metaResponse.status(), 200);
    const meta = await metaResponse.json();
    assert.equal(meta.dataset_count, 66);
    assert.equal(meta.dataset_version, catalogVersion);
    assert.deepEqual(meta.date_range, {min: '2026-09-23', max: '2026-12-31'});
    await state('idle');
    assert.equal(await page.locator('[name=event_date]').getAttribute('min'), meta.date_range.min);
    assert.equal(await page.locator('[name=event_date]').getAttribute('max'), meta.date_range.max);

    const first = await submit('dense category: October 15', baseQuery);
    assert.equal(first.status, 'matched');
    assert.equal(first.eligible_count, 6);
    assert.equal(first.cards.length, 3);
    await screenshot('desktop-live.png');

    const repeated = await act('identical request preserves visible order', baseQuery,
      () => page.getByRole('button', {name: 'Подобрать варианты'}).click());
    assert.deepEqual(repeated.cards.map(card => card.id), first.cards.map(card => card.id));

    const nextDate = await submit('October 16 changes visible top three',
      {...baseQuery, event_date: '2026-10-16'});
    assert.equal(nextDate.eligible_count, 4);
    assert.equal(nextDate.cards.length, 3);
    assert.notDeepEqual(nextDate.cards.map(card => card.id), first.cards.map(card => card.id));

    const floristQuery = {...baseQuery, category: 'Флорист', event_type: 'свадьба'};
    const rare = await submit('rare category: two Almaty florists', floristQuery);
    assert.equal(rare.status, 'matched');
    assert.equal(rare.eligible_count, 2);
    assert.equal(rare.cards.length, 2);

    const busy = await submit('Astana florist is busy', {...floristQuery, city: 'Астана'});
    assert.equal(busy.status, 'no_matches');
    assert.equal(busy.total_in_city_category, 1);
    assert.equal(busy.eligible_count, 0);
    assert.equal(busy.exclusions.busy, 1);
    const changedDate = await applySuggestion('explicit date suggestion finds one florist', busy, 'change_date');
    assert.equal(changedDate.eligible_count, 1);
    assert.equal(changedDate.cards.length, 1);

    const absent = await submit('category does not exist in city', {...baseQuery, city: 'Зарубежье'});
    assert.equal(absent.status, 'no_category_in_city');
    assert.equal(absent.total_in_city_category, 0);
    assert.deepEqual(absent.suggestions, []);
    assert.equal(await page.locator('button[data-suggestion-kind]').count(), 0);

    const lowBudget = await submit('budget of one tenge has no matches', {...baseQuery, budget_kzt: 1});
    assert.equal(lowBudget.status, 'no_matches');
    assert.equal(lowBudget.eligible_count, 0);
    const changedBudget = await applySuggestion('explicit budget suggestion finds candidates', lowBudget, 'increase_budget');
    assert.ok(changedBudget.eligible_count >= 1);
    assert.ok(capturedRequests.at(-1).budget_kzt > 1);

    const bands = await submit('live bands show distinct source facts', {...baseQuery, category: 'Лайв-бэнд', event_type: 'свадьба', budget_kzt: 1500000});
    assert.deepEqual(bands.cards.map(c => c.id), ['HK-23752', 'HK-83709', 'HK-57480']);
    assert.ok(bands.cards[0].description_excerpt.includes('два вокалиста'));
    assert.ok(bands.cards[1].description_excerpt.includes('4 вокалиста'));
    assert.ok(bands.cards[1].description_excerpt.includes('струнный квартет'));
    assert.ok(bands.cards.every(c => !c.description_excerpt.includes('идеально впишется')));

    const lineupResponse = await submit('B01 complete lineup and qualified starting price', {...baseQuery,
      category: 'Лайв-бэнд', event_date: '2026-10-16', budget_kzt: 1150000});
    const lineup = lineupResponse.cards.find(card => card.id === 'HK-31819');
    assert.ok(lineup);
    assert.ok(lineup.description_excerpt.startsWith('Большой состав'));
    assert.ok(!lineup.description_excerpt.includes('Репертуар: от'));
    assert.ok(lineup.explanation.includes('стоимость этого состава нужно уточнить'));
    const sparseResponse = await submit('B02 factual reason instead of advertising', {...baseQuery,
      category: 'Лайв-бэнд', event_date: '2026-10-17', budget_kzt: 1500000});
    const sparse = sparseResponse.cards.find(card => card.id === 'HK-25279');
    assert.ok(sparse);
    assert.ok(!sparse.explanation.includes('сверкаем'));
    assert.ok(sparse.explanation.includes('В профиле: языки — русский; на площадке до 5 ч'));

    const venueQuery = {...baseQuery, category: 'Банкетный зал', event_date: '2026-11-14', budget_kzt: 6000000};
    const venues = await submit('venue calendar November 14', venueQuery);
    assert.equal(venues.eligible_count, 2);
    assert.deepEqual(venues.cards.map(c => c.id).sort(), ['HK-64395', 'HK-90011']);
    const venuesRepeated = await act('venue repeat preserves order', venueQuery,
      () => page.getByRole('button', {name: 'Подобрать варианты'}).click());
    assert.deepEqual(venuesRepeated.cards.map(c => c.id), venues.cards.map(c => c.id));
    const venuesNext = await submit('venue calendar November 15 excludes busy venue', {...venueQuery, event_date: '2026-11-15'});
    assert.equal(venuesNext.eligible_count, 4);
    assert.equal(venuesNext.cards.length, 3);
    assert.ok(!venuesNext.cards.some(c => c.id === 'HK-90011'));
    const optional = await submit('real language and duration filters', {...baseQuery, language: 'русский', duration_hours: 2});
    assert.equal(optional.status, 'matched');
    for (const card of optional.cards) {
      assert.ok(card.languages.includes('русский'));
      assert.ok(card.max_hours === null || card.max_hours >= 2);
    }

    await page.setViewportSize({width: 390, height: 844});
    const mobile = await submit('real request at mobile width 390', baseQuery);
    assert.deepEqual(mobile.cards.map(card => card.id), first.cards.map(card => card.id));
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.equal(dimensions.viewport, 390);
    assert.ok(dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport,
      'Mobile horizontal overflow: ' + JSON.stringify(dimensions));
    await screenshot('mobile-live.png');

    assert.deepEqual(browserErrors, [], 'No uncaught browser errors.');
    assert.deepEqual(externalRequests, [], 'Application must not fetch external resources.');
    const report = {
      checked_at: new Date().toISOString(),
      base_url: baseUrl,
      browser: await browser.version(),
      dataset_count: 66,
      dataset_version: catalogVersion,
      real_api_only: true,
      scenarios,
      mobile_dimensions: dimensions,
      browser_errors: browserErrors,
      external_requests: externalRequests,
      screenshots,
    };
    if (output) fs.writeFileSync(path.join(output, 'browser-live-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS live integration: ' + scenarios.length + ' real submissions, no browser errors or external requests.');
    if (output) console.log('Artifacts: ' + path.resolve(output));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

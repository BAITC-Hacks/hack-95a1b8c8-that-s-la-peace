// Real API before/after an offline simulation in this isolated browser context.
// No fixtures, service shutdowns, or changes to the host/network configuration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.argv[2] || 'http://127.0.0.1:8000';
const report = {started_at: new Date().toISOString(), base_url: baseUrl,
  scope: 'real API with isolated browser offline simulation; not backend failure injection',
  source_sha: process.env.UI_SOURCE_SHA || 'NOT VERIFIED by this script', checks: []};

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {channel: 'msedge'})});
  const context = await browser.newContext({locale: 'ru-RU'});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const values = () => page.locator('input[name],select[name]').evaluateAll(nodes =>
    Object.fromEntries(nodes.map(node => [node.name, node.value])));
  const ids = () => page.locator('[data-profile-id]').evaluateAll(nodes => nodes.map(node => node.dataset.profileId));
  const state = value => page.locator(`[data-state="${value}"]`).waitFor({state: 'visible'});
  const actualReply = () => page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/recommendations' && response.request().method() === 'POST');
  try {
    await page.goto(baseUrl);
    await state('idle');
    await page.getByRole('checkbox', {name: 'Обновлять варианты автоматически'}).uncheck();
    await page.getByLabel('Город', {exact: true}).selectOption('Алматы');
    await page.getByLabel('Дата события').fill('2026-10-15');
    await page.getByLabel('Формат мероприятия', {exact: true}).selectOption('корпоратив');
    await page.getByLabel('Кого или что ищем', {exact: true}).selectOption('Ведущий');
    await page.getByLabel('Бюджет, ₸').fill('1000000');
    const initialReply = actualReply();
    await page.getByRole('button', {name: 'Подобрать варианты', exact: true}).click();
    assert.equal((await initialReply).status(), 200);
    await state('matched');
    const firstIds = await ids();
    assert.equal(firstIds.length, 3);
    report.checks.push('Initial real result: three cards');

    await page.getByLabel('Дата события').fill('2026-10-16');
    await state('edited');
    assert.deepEqual(await ids(), [], 'Editing must remove stale cards.');
    const before = await values();
    await context.setOffline(true);
    await page.getByRole('button', {name: 'Подобрать варианты', exact: true}).click();
    await state('error');
    assert.deepEqual(await ids(), [], 'A network error must not display old or invented cards.');
    assert.deepEqual(await values(), before, 'Parameters must survive a failed request.');
    assert.equal(await page.locator('.picker-fieldset').isEnabled(), true);
    report.checks.push('Offline submission: explicit error, no cards, preserved parameters');

    // Repeating while still offline must remain a failure, never a cached success.
    await page.getByRole('button', {name: 'Попробовать ещё раз', exact: true}).click();
    await state('error');
    assert.deepEqual(await ids(), []);
    assert.deepEqual(await values(), before);
    report.checks.push('Retry while offline: still an honest error');

    await context.setOffline(false);
    const restoredReply = actualReply();
    await page.getByRole('button', {name: 'Попробовать ещё раз', exact: true}).click();
    const response = await restoredReply;
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.equal(data.status, 'matched');
    assert.equal(data.eligible_count, 4);
    await state('matched');
    const restoredIds = await ids();
    assert.deepEqual(restoredIds, data.cards.map(card => card.id));
    assert.notDeepEqual(restoredIds, firstIds, 'The changed date must produce a new real result.');
    assert.deepEqual(await values(), before);
    report.checks.push('Connectivity restored: retry uses saved new date and actual API order');
    assert.deepEqual(errors, []);
    report.checks.push('No JavaScript runtime errors');
    report.initial_ids = firstIds;
    report.restored_ids = restoredIds;
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    await context.setOffline(false).catch(() => {});
    report.completed_at = new Date().toISOString();
    report.browser = browser.version();
    if (process.env.UI_CHECK_OUTPUT) {
      fs.mkdirSync(process.env.UI_CHECK_OUTPUT, {recursive: true});
      fs.writeFileSync(path.join(process.env.UI_CHECK_OUTPUT, 'network-recovery.json'), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => {console.error(error.message); process.exitCode = 1;});

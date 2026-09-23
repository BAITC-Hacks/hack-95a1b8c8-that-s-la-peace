// Real UI/API UX checks. The optional stale-response check delays a real API
// response without changing its body; this is labelled as an ordering simulation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.argv[2] || 'http://127.0.0.1:8007';
const url = new URL(baseUrl);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without credentials.');
const output = process.env.UI_CHECK_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'hackalem-ux-'));
const dataset = '6a724b6b7dfb5973343e68ba18dadb60fc807d87e3d78f03ee86fb26cb089f7d';
const d1 = {city:'Алматы', event_date:'2026-10-15', event_type:'корпоратив', category:'Ведущий', budget_kzt:1000000, duration_hours:null, language:null};
const report = {
  scope:'UX of the served candidate with real API; not proof of merged remote acceptance',
  started_at:new Date().toISOString(), base_url:url.href, fixtures:false,
  declared_source_sha:process.env.UI_SOURCE_SHA || process.env.UI_FRONTEND_SHA || null,
  declared_backend_sha:process.env.UI_BACKEND_SHA || null,
  source_note:'SHA values are supplied by the runner; HTTP alone does not identify the serving checkout.',
  checks:[], runs:[], page_errors:[], simulations:[]
};
const endpoint = (value, ending) => new URL(value).pathname.endsWith(ending);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms=12000) {
  let timer;
  try {return await Promise.race([promise, new Promise((_, reject) => {timer=setTimeout(()=>reject(new Error('Timed out waiting for real response coordination')),ms);})]);}
  finally {clearTimeout(timer);}
}

(async () => {
  let browser, context;
  try {
    fs.mkdirSync(output,{recursive:true});
    browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {channel:'msedge'})});
    report.browser = await browser.version();
    context = await browser.newContext({viewport:{width:1440,height:1100}, locale:'ru-RU', reducedMotion:'reduce'});
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error=>report.page_errors.push(error.message));
    const posted=[];
    page.on('request', request=>{
      if (request.method()==='POST' && endpoint(request.url(),'/api/recommendations')) posted.push({request:request.postDataJSON(), at:performance.now()});
    });
    const field = name => page.locator(`[name="${name}"]`);
    const auto = page.locator('.auto-toggle input[type=checkbox]');
    const ids = () => page.locator('[data-profile-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.profileId));
    const values = () => page.locator('form [name]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.name,node.value])));
    const categories = () => field('category').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean));
    const responseFor = predicate => page.waitForResponse(response=>response.request().method()==='POST' && endpoint(response.url(),'/api/recommendations') && predicate(response.request().postDataJSON()));
    async function check(name, fn) {
      try {const details=await fn();report.checks.push({name,status:'PASS',...(details?{details}: {})});}
      catch(error) {report.checks.push({name,status:'FAIL',error:error.message});throw error;}
    }
    async function consume(id,response,expected) {
      assert.equal(response.status(),200,`${id}: real API status`);
      const data=await response.json(), request=response.request().postDataJSON();
      assert.deepEqual(request,expected,`${id}: canonical request`);
      assert.equal(data.dataset_version,dataset);
      assert.equal(data.status,'matched');
      assert.equal(data.cards.length,3);
      assert.equal(data.eligible_count,expected.event_date==='2026-10-15'?6:4);
      const expectedIds=data.cards.map(card=>card.id);
      await page.waitForFunction(wanted=>JSON.stringify(Array.from(document.querySelectorAll('[data-profile-id]'),n=>n.dataset.profileId))===JSON.stringify(wanted),expectedIds);
      assert.match(await page.locator('.results-summary .request-summary').textContent(),expected.event_date==='2026-10-15'?/15\.10\.2026/:/16\.10\.2026/);
      const started=posted.findLast(item=>JSON.stringify(item.request)===JSON.stringify(request))?.at;
      const record={id,request,http_status:response.status(),eligible_count:data.eligible_count,shown:data.cards.length,ids:expectedIds,request_to_visible_ms:started===undefined?null:Math.round(performance.now()-started)};
      report.runs.push(record);
      return data;
    }
    async function manual(id,request) {
      const pending=responseFor(body=>body.event_date===request.event_date && body.budget_kzt===request.budget_kzt);
      await page.locator('.submit-button').click();
      return consume(id,await pending,request);
    }

    const metaPending=page.waitForResponse(response=>endpoint(response.url(),'/api/meta'));
    const guidePending=page.waitForResponse(response=>endpoint(response.url(),'/catalog-guide.json'));
    await page.goto(url.href,{waitUntil:'domcontentloaded'});
    const metaResponse=await metaPending, guideResponse=await guidePending;
    assert.equal(metaResponse.status(),200);assert.equal(guideResponse.status(),200);
    const meta=await metaResponse.json(),guide=await guideResponse.json();
    assert.equal(meta.dataset_version,dataset);assert.equal(guide.dataset_version,dataset);
    await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);
    assert.equal(await auto.isChecked(),true,'Automatic update must initially be enabled.');

    await check('Catalog guide: city 50, group 9, date 7; no budget or request yet',async()=>{
      await field('city').selectOption('Алматы');
      await page.locator('.city-count').waitFor();
      assert.equal(guide.city_counts['Алматы'],50);
      assert.match(await page.locator('.city-count').textContent(),/50/);
      await field('category').selectOption('Ведущий');
      await field('event_type').selectOption('корпоратив');
      const group=guide.groups.find(g=>g.city==='Алматы'&&g.category==='Ведущий'&&g.event_type==='корпоратив');
      assert.ok(group);assert.equal(group.total,9);assert.equal(group.dates['2026-10-15'].available,7);
      assert.match(await page.locator('.guide-count').textContent(),/9/);
      await field('event_date').fill('2026-10-15');
      assert.match(await page.locator('.guide-count').textContent(),/7.*9/);
      assert.equal(await field('budget_kzt').inputValue(),'');
      await sleep(800);assert.equal(posted.length,0,'Incomplete form must not auto-submit.');
      return {city:50,group:9,available_before_budget:7};
    });

    let dense;
    await check('Five fields trigger one debounced real request; budget separators normalize',async()=>{
      const pending=responseFor(body=>body.event_date===d1.event_date && body.budget_kzt===d1.budget_kzt);
      const start=performance.now();
      await field('budget_kzt').fill('1.000.000');
      assert.equal(await field('budget_kzt').inputValue(),'1 000 000');
      await sleep(250);assert.equal(posted.length,0,'Auto-submit must be debounced, not immediate.');
      dense=await consume('AUTO-D1',await pending,d1);
      assert.equal(posted.length,1);assert.ok(Number.isInteger(posted[0].request.budget_kzt));
      const elapsed=posted[0].at-start;assert.ok(elapsed>=500 && elapsed<10000,`Observed debounce ${elapsed}ms`);
      return {request_delay_ms:Math.round(elapsed),cards:dense.cards.length};
    });

    await check('Search text and show-all do not submit or discard current results',async()=>{
      const before=posted.length,beforeIds=await ids();
      const wrap=page.locator('.field:has(select[name="city"])');
      await wrap.locator('.select-search-input').fill('аст');
      assert.equal(await field('city').inputValue(),'Алматы');
      await sleep(900);
      assert.equal(posted.length,before);assert.deepEqual(await ids(),beforeIds);
      await wrap.locator('.select-search-all').click();
      assert.deepEqual(await field('city').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean)),meta.cities);
      assert.deepEqual(await ids(),beforeIds);
    });

    await check('Text date becomes ISO and automatically requests the new date',async()=>{
      const pending=responseFor(body=>body.event_date==='2026-10-16');
      await field('event_date_text').fill('16.10.2026');
      assert.equal(await field('event_date').inputValue(),'2026-10-16');
      const changed=await consume('TEXT-D2',await pending,{...d1,event_date:'2026-10-16'});
      assert.notDeepEqual(changed.cards.map(card=>card.id),dense.cards.map(card=>card.id));
    });
    await auto.uncheck();

    await check('Compatible category/format subsets come from the guide; full catalog and current choices remain available',async()=>{
      const toggle=page.locator('.compatibility-toggle input[type=checkbox]');
      assert.equal(await toggle.isVisible(),true);assert.equal(await toggle.isChecked(),true);
      const chosen=await values(),beforePosts=posted.length;
      const expectedCategories=meta.categories.filter(value=>value===chosen.category || guide.groups.some(group=>group.city===chosen.city&&group.event_type===chosen.event_type&&group.category===value));
      const expectedFormats=meta.event_types.filter(value=>value===chosen.event_type || guide.groups.some(group=>group.city===chosen.city&&group.category===chosen.category&&group.event_type===value));
      assert.deepEqual(await categories(),expectedCategories);
      assert.deepEqual(await field('event_type').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean)),expectedFormats);
      // This city has no hosts: retaining the explicit selection keeps the
      // distinct no_category_in_city path reachable rather than rewriting it.
      await field('city').selectOption('Зарубежье');
      assert.equal(await field('category').inputValue(),chosen.category);
      assert.equal(await field('event_type').inputValue(),chosen.event_type);
      assert.ok((await categories()).includes(chosen.category));
      await toggle.uncheck();
      assert.deepEqual(await categories(),meta.categories);
      assert.deepEqual(await field('event_type').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean)),meta.event_types);
      await field('city').selectOption(chosen.city);
      assert.deepEqual(await values(),chosen);assert.equal(posted.length,beforePosts);
      return {compatible_categories:expectedCategories.length,compatible_formats:expectedFormats.length,full_categories:meta.categories.length};
    });

    await check('Category groups retain the complete catalog category set',async()=>{
      const before=posted.length,all=await categories();
      assert.deepEqual([...all].sort(),[...meta.categories].sort());
      await page.locator('[data-category-mode=services]').click();
      const services=await categories();assert.ok(services.includes('Банкетный зал'));assert.ok(!services.includes('Ведущий'));
      await page.locator('[data-category-mode=people]').click();
      const people=await categories();assert.ok(people.includes('Ведущий'));assert.ok(!people.includes('Банкетный зал'));
      assert.deepEqual([...new Set([...people,...services])].sort(),[...all].sort());
      await page.locator('[data-category-mode=all]').click();
      assert.deepEqual(await categories(),all);
      await field('category').selectOption('Ведущий');
      assert.equal(posted.length,before,'Manual mode must not auto-submit category changes.');
      return {all:all.length,people:people.length,services:services.length};
    });
    await manual('GROUP-RESTORED',{...d1,event_date:'2026-10-16'});

    await check('RU → EN → KK → RU preserves canonical fields and Russian source explanations',async()=>{
      const before=await values(),beforeIds=await ids(),beforePosts=posted.length;
      const explanations=await page.locator('.explanation [data-catalog-text]').allTextContents();
      assert.equal(explanations.length,3);
      for(const [locale,label] of [['en','City'],['kk','Қала'],['ru','Город']]) {
        await page.locator('.locale-switch select').selectOption(locale);
        assert.equal(await page.locator('html').getAttribute('lang'),locale);
        assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'Алматы');
        assert.deepEqual(await values(),before);assert.deepEqual(await ids(),beforeIds);
        assert.deepEqual(await page.locator('.explanation [data-catalog-text]').allTextContents(),explanations);
        assert.ok(await page.locator('.explanation [data-catalog-text]').evaluateAll(nodes=>nodes.every(node=>node.lang==='ru')));
        if(locale==='en') assert.equal(await page.getByText('Catalog descriptions and explanations are provided in Russian.',{exact:true}).isVisible(),true);
        if(locale==='kk') assert.equal(await page.getByText('Каталог сипаттамалары мен түсіндірмелері орыс тілінде берілген.',{exact:true}).isVisible(),true);
      }
      assert.equal(posted.length,beforePosts,'Interface locale is not an API filter.');
      // A fresh mount must keep Russian source labels independently of the
      // previously persisted English UI; translated DOM must not become source.
      await page.locator('.locale-switch select').selectOption('en');
      const reloaded=await context.newPage();
      try {
        await reloaded.goto(url.href,{waitUntil:'domcontentloaded'});
        await reloaded.waitForFunction(()=>document.querySelector('.select-search-input'));
        await reloaded.reload({waitUntil:'domcontentloaded'});
        await reloaded.waitForFunction(()=>document.querySelector('.select-search-input'));
        assert.equal(await reloaded.locator('html').getAttribute('lang'),'en');
        await reloaded.locator('.locale-switch select').selectOption('ru');
        const citySearch=reloaded.locator('.field:has(select[name="city"])');
        assert.equal(await citySearch.locator('.select-search-label').textContent(),'Поиск в списке: Город');
        await citySearch.locator('.select-search-input').fill('аст');
        assert.equal(await citySearch.locator('.select-search-label').textContent(),'Поиск в списке: Город');
      } finally {await reloaded.close();await page.locator('.locale-switch select').selectOption('ru');}
    });

    await check('Guide calendar contains all 100 covered days and sets the chosen date',async()=>{
      assert.equal(await page.locator('.calendar-day').count(),100);
      const dates=await page.locator('.calendar-day').evaluateAll(nodes=>nodes.map(node=>node.dataset.date));
      assert.equal(dates[0],'2026-09-23');assert.equal(dates.at(-1),'2026-12-31');assert.equal(new Set(dates).size,100);
      const calendar=page.locator('.availability-note');
      if(await calendar.getAttribute('open')===null) await calendar.locator('summary').click();
      await page.locator('.calendar-day[data-date="2026-10-15"]').click();
      assert.equal(await field('event_date').inputValue(),'2026-10-15');
      assert.equal(await field('event_date_text').inputValue(),'15.10.2026');
      assert.equal(await page.locator('.calendar-day[data-date="2026-10-15"]').getAttribute('aria-pressed'),'true');
      await manual('CALENDAR-D1',d1);
    });

    await check('Incomplete numeric hours do not submit or disappear; clearing restores automatic selection',async()=>{
      const initial=responseFor(body=>body.event_date==='2026-10-15' && body.duration_hours===null);
      await auto.check();await consume('AUTO-RESUME-D1',await initial,d1);
      const optional=page.locator('.optional-fields');
      if(await optional.getAttribute('open')===null) await optional.locator('summary').click();
      const hours=field('duration_hours'),before=posted.length;
      await hours.pressSequentially('1e');
      assert.equal(await hours.evaluate(node=>node.validity.badInput),true,'The browser must retain the unfinished number buffer.');
      await sleep(800);assert.equal(posted.length,before,'Invalid partial hours must not be treated as optional null.');
      await page.locator('.submit-button').click();
      await page.locator('[data-state=invalid]').waitFor();
      assert.equal(await hours.getAttribute('aria-invalid'),'true');
      assert.equal(await hours.evaluate(node=>node.validity.badInput),true,'Validation must not erase the unfinished number.');
      assert.equal(posted.length,before);
      const resumed=responseFor(body=>body.duration_hours===null);
      await hours.fill('');await consume('HOURS-CLEARED-D1',await resumed,d1);
      await auto.uncheck();
    });

    await check('Mobile 360/390px with an expanded calendar has no horizontal overflow',async()=>{
      const result=[];
      for(const width of [360,390]) {
        await page.setViewportSize({width,height:844});
        const calendar=page.locator('.availability-note');
        if(await calendar.getAttribute('open')===null) await calendar.locator('summary').click();
        const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
        if(process.env.UI_CHECK_OUTPUT) await page.screenshot({path:path.join(output,`ux-mobile-${width}.png`),fullPage:true});
        if(size.document>width || size.body>width) {
          size.overflowing=await page.locator('body *').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,class:node.className,rect:node.getBoundingClientRect()})).filter(({rect})=>rect.width&&rect.right>innerWidth+1).slice(0,20).map(({tag,class:className,rect})=>({tag,class:className,width:Math.round(rect.width),right:Math.round(rect.right)})));
        }
        assert.ok(size.document<=width && size.body<=width,JSON.stringify(size));result.push(size);
      }
      return result;
    });
    await check('Reduced-motion preference disables animations and transitions',async()=>{
      assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
      const moving=await page.locator('body *').evaluateAll(nodes=>nodes.flatMap(node=>['','::before','::after'].map(pseudo=>({node:node.tagName,pseudo,style:getComputedStyle(node,pseudo||null)}))).filter(({style})=>style.animationName!=='none'||style.transitionDuration.split(',').some(v=>parseFloat(v)>0)).map(({node,pseudo})=>({node,pseudo})));
      assert.deepEqual(moving,[]);
    });

    if(process.env.UI_CHECK_STALE!=='0') await check('Late real response cannot overwrite a newer result (ordering simulation)',async()=>{
      report.simulations.push('Delay delivery of one genuine /api/recommendations response; response bytes and actual backend content remain unchanged.');
      let release,ready,done,heldError,first=true,heldData;
      const gate=new Promise(resolve=>{release=resolve;});
      const heldReady=new Promise(resolve=>{ready=resolve;});
      const heldDone=new Promise(resolve=>{done=resolve;});
      const routePattern='**/api/recommendations';
      const handler=async route=>{
        if(!first || route.request().method()!=='POST') {await route.continue();return;}
        first=false;
        try {
          const actual=await route.fetch();assert.equal(actual.status(),200);heldData=await actual.json();ready();
          await gate;await route.fulfill({response:actual});
        } catch(error) {heldError=error;ready();} finally {done();}
      };
      await page.route(routePattern,handler);
      try {
        await page.locator('.submit-button').click();await bounded(heldReady);if(heldError) throw heldError;
        await field('event_date_text').fill('16.10.2026');
        const latest=await manual('STALE-NEWER-D2',{...d1,event_date:'2026-10-16'});
        assert.notDeepEqual(heldData.cards.map(card=>card.id),latest.cards.map(card=>card.id));
        release();await bounded(heldDone);if(heldError) throw heldError;
        await sleep(300);
        assert.equal(await field('event_date').inputValue(),'2026-10-16');
        assert.deepEqual(await ids(),latest.cards.map(card=>card.id));
        assert.match(await page.locator('.results-summary .request-summary').textContent(),/16\.10\.2026/);
        return {delayed_ids:heldData.cards.map(card=>card.id),retained_ids:latest.cards.map(card=>card.id)};
      } finally {release();await page.unroute(routePattern,handler);}
    });
    for(const mode of ['wrong-sha','unavailable']) await check(`Optional reference fault (${mode}) hides guide and filters while real recommendations work`,async()=>{
      report.simulations.push(mode==='wrong-sha'
        ? 'Reference fault simulation: fetch the real catalog-guide.json and change only dataset_version to an intentionally mismatching SHA; recommendation traffic is untouched.'
        : 'Reference fault simulation: abort only catalog-guide.json; recommendation traffic is untouched.');
      const faultContext=await browser.newContext({viewport:{width:1440,height:1100},locale:'ru-RU'});
      const faultPage=await faultContext.newPage();faultPage.setDefaultTimeout(15000);
      let settle,routeError,posts=0;
      const settled=new Promise(resolve=>{settle=resolve;});
      faultPage.on('pageerror',error=>report.page_errors.push(`${mode}: ${error.message}`));
      faultPage.on('request',request=>{if(request.method()==='POST'&&endpoint(request.url(),'/api/recommendations')) posts++;});
      await faultPage.route('**/catalog-guide.json',async route=>{
        try {
          if(mode==='unavailable') await route.abort('failed');
          else {
            const actual=await route.fetch();assert.equal(actual.status(),200);
            const reference=await actual.json();assert.equal(reference.dataset_version,dataset);
            await route.fulfill({response:actual,json:{...reference,dataset_version:'f'.repeat(64)}});
          }
        } catch(error) {routeError=error;} finally {settle();}
      });
      try {
        await faultPage.goto(url.href,{waitUntil:'domcontentloaded'});
        await bounded(settled);if(routeError) throw routeError;
        await faultPage.waitForFunction(()=>document.querySelector('fieldset')&&!document.querySelector('fieldset').disabled);
        const faultField=name=>faultPage.locator(`[name="${name}"]`);
        await faultField('city').selectOption('Алматы');
        await faultField('category').selectOption('Ведущий');
        await faultField('event_type').selectOption('корпоратив');
        await faultField('event_date').fill('2026-10-15');
        const pending=faultPage.waitForResponse(response=>response.request().method()==='POST'&&endpoint(response.url(),'/api/recommendations'));
        const start=performance.now();await faultField('budget_kzt').fill('1000000');
        const response=await pending;assert.equal(response.status(),200);
        assert.deepEqual(response.request().postDataJSON(),d1);
        const data=await response.json();assert.equal(data.dataset_version,dataset);assert.equal(data.status,'matched');assert.equal(data.eligible_count,6);assert.equal(data.cards.length,3);
        await faultPage.locator('[data-state=matched]').waitFor();
        assert.deepEqual(await faultPage.locator('[data-profile-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.profileId)),data.cards.map(card=>card.id));
        assert.equal(await faultPage.locator('.price-guide').textContent(),'');
        assert.equal(await faultPage.locator('.calendar-day').count(),0);
        assert.equal(await faultPage.locator('.availability-note').isVisible(),false);
        assert.equal(await faultPage.locator('.compatibility-toggle').isVisible(),false);
        assert.deepEqual(await faultField('category').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value).filter(Boolean)),meta.categories);
        assert.equal(posts,1);
        report.reference_fault_post_count=(report.reference_fault_post_count||0)+posts;
        report.runs.push({id:`REFERENCE-${mode}`,request:d1,http_status:response.status(),eligible_count:data.eligible_count,shown:data.cards.length,ids:data.cards.map(card=>card.id),input_to_visible_ms:Math.round(performance.now()-start),simulation:'reference only; real recommendation response'});
      } finally {await faultContext.close();}
    });
    await check('No page runtime errors',()=>assert.deepEqual(report.page_errors,[]));
    report.posted_request_count=posted.length+(report.reference_fault_post_count||0);
    report.status='PASS';
  } catch(error) {
    report.status='FAIL';report.failure=error.message;process.exitCode=1;
  } finally {
    report.completed_at=new Date().toISOString();
    fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'ux-check.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,evidence:path.join(output,'ux-check.json')},null,2));
    await context?.close();await browser?.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

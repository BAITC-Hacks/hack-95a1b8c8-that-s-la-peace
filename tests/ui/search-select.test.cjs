// Isolated editable-combobox checks. Synthetic option data, no API or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/search-select.mjs'), 'utf8');
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'msedge'})});
  const context = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',hasTouch:true});
  const page = await context.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.setContent('<form><fieldset><label for="category">Категория</label><select id="category" name="category" aria-describedby="hint" required><option value="">Выберите</option><option value="host" selected>Ведущий</option><option value="photo">Фотограф</option><optgroup label="Места"><option value="hall">Банкетный зал</option><option value="closed" disabled>Закрытый зал</option></optgroup><option value="tree">Ёлка</option></select><p id="hint">Подсказка</p><button type="submit">Отправить</button><button type="button" id="outside">Вне списка</button></fieldset></form>');
    await page.evaluate(async text=>{
      const url=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));
      const {enhanceSelect}=await import(url);URL.revokeObjectURL(url);
      window.locale='ru';window.renders=0;
      const en={host:'Presenter',photo:'Photography',hall:'Banquet hall',tree:'Tree','':'Choose'};
      const kk={host:'Жүргізуші',photo:'Фотосурет',hall:'Банкет залы',tree:'Шырша','':'Таңдаңыз'};
      window.component=enhanceSelect(document.querySelector('select'),{
        getSearchText:option=>`${option.label} ${en[option.value]||''} ${kk[option.value]||''}`,
        getDisplayText:option=>window.locale==='en'?(en[option.value]||option.label):window.locale==='kk'?(kk[option.value]||option.label):option.label,
        getGroupText:group=>window.locale==='en'?'Venues':group.label,
        onRender:()=>{window.renders++;window.component?.refreshLanguage();}
      });
      window.events={input:0,change:0,submit:0};
      for(const key of Object.keys(window.events)) document.querySelector('form').addEventListener(key,event=>{window.events[key]++;if(key==='submit')event.preventDefault();});
    },source);
    const input=page.getByRole('combobox'),native=page.locator('select'),list=page.getByRole('listbox');
    const option=value=>page.locator(`.combobox-option[data-value="${value}"]`);
    const nativeValues=()=>native.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
    const shown=()=>page.locator('.combobox-option').evaluateAll(nodes=>nodes.map(node=>node.dataset.value));
    assert.equal(await native.isVisible(),false);assert.equal(await input.inputValue(),'Ведущий');
    assert.equal(await page.getByRole('combobox',{name:'Категория',exact:true}).getAttribute('role'),'combobox');
    assert.match(await input.getAttribute('aria-describedby'),/^hint /);assert.equal(await input.getAttribute('aria-required'),'true');
    await input.click();assert.equal(await list.isVisible(),true);
    assert.deepEqual(await shown(),['','host','photo','hall','closed','tree']);
    assert.equal(await page.locator('.combobox-group').textContent(),'Места');
    await input.press('Enter');assert.equal(await native.inputValue(),'host');
    assert.deepEqual(await page.evaluate(()=>window.events),{input:0,change:0,submit:0});

    await input.fill('PHOTOGRAPH');assert.deepEqual(await shown(),['photo']);
    assert.deepEqual(await nativeValues(),['','host','photo','hall','closed','tree']);
    assert.equal(await native.inputValue(),'host');assert.equal(await input.getAttribute('aria-activedescendant'),null);
    await input.press('Enter');assert.equal(await native.inputValue(),'host');
    await input.press('ArrowDown');assert.ok(await input.getAttribute('aria-activedescendant'));
    await input.press('Enter');assert.equal(await native.inputValue(),'photo');assert.equal(await list.isVisible(),false);
    assert.equal(await input.inputValue(),'Фотограф');assert.deepEqual(await page.evaluate(()=>window.events),{input:1,change:1,submit:0});
    assert.equal(await page.evaluate(()=>new FormData(document.querySelector('form')).get('category')),'photo');

    await input.click();await input.fill('nothing');assert.equal(await page.getByRole('status').textContent(),'Нет вариантов');
    assert.equal(await page.locator('.combobox-option').count(),0);await input.press('Escape');
    assert.equal(await input.inputValue(),'Фотограф');assert.equal(await list.isVisible(),false);
    await input.click();await input.fill('tree');await input.press('Tab');assert.equal(await input.inputValue(),'Фотограф');
    assert.equal(await native.inputValue(),'photo');assert.equal(await list.isVisible(),false);
    await input.click();await input.fill('tree');await page.locator('#outside').click();assert.equal(await input.inputValue(),'Фотограф');
    await input.click();await input.fill('tree');await page.locator('.combobox-toggle').click();
    assert.deepEqual(await shown(),['','host','photo','hall','closed','tree']);
    await option('hall').click();assert.equal(await native.inputValue(),'hall');assert.equal(await input.inputValue(),'Банкетный зал');
    await input.click();assert.equal(await option('closed').getAttribute('aria-disabled'),'true');
    await option('closed').click({force:true});assert.equal(await native.inputValue(),'hall');
    await input.fill('зал');await input.press('ArrowUp');assert.equal(await page.locator('.combobox-option.is-active').getAttribute('data-value'),'hall');
    await input.press('Enter');assert.equal(await native.inputValue(),'hall');
    assert.deepEqual(await page.evaluate(()=>window.events),{input:2,change:2,submit:0});

    await input.click();await option('').click();assert.equal(await native.inputValue(),'');assert.equal(await input.inputValue(),'');
    assert.equal(await input.getAttribute('placeholder'),'Выберите');
    assert.deepEqual(await page.evaluate(()=>window.events),{input:3,change:3,submit:0});
    await page.locator('#outside').click();await page.locator('.combobox-toggle').tap();
    assert.equal(await list.isVisible(),true);assert.equal(await input.evaluate(node=>document.activeElement===node),false);
    await option('host').tap();assert.equal(await native.inputValue(),'host');
    assert.equal(await input.evaluate(node=>document.activeElement===node),false,'Arrow-only mobile selection must not focus the text keyboard.');
    await page.locator('.combobox-toggle').tap();
    await option('photo').dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',clientX:5,clientY:5});
    await option('photo').dispatchEvent('pointermove',{pointerId:7,pointerType:'touch',clientX:5,clientY:35});
    await option('photo').dispatchEvent('pointerup',{pointerId:7,pointerType:'touch',clientX:5,clientY:35});
    await option('photo').dispatchEvent('click');
    assert.equal(await native.inputValue(),'host','A dragged touch and its compatibility click must not commit.');
    await input.press('Escape');
    await page.evaluate(()=>document.querySelector('form').reset());assert.equal(await input.inputValue(),'Ведущий');

    await native.evaluate(node=>{node.setAttribute('aria-invalid','true');node.setAttribute('aria-describedby','hint extra');node.disabled=true;});
    await page.waitForFunction(()=>document.querySelector('.combobox-input').disabled);
    assert.equal(await input.getAttribute('aria-invalid'),'true');assert.match(await input.getAttribute('aria-describedby'),/^hint extra /);
    await native.evaluate(node=>{node.disabled=false;node.removeAttribute('aria-invalid');});
    await page.waitForFunction(()=>!document.querySelector('.combobox-input').disabled);
    await page.locator('fieldset').evaluate(node=>{node.disabled=true;});assert.equal(await input.isDisabled(),true);
    await page.locator('fieldset').evaluate(node=>{node.disabled=false;});await page.waitForFunction(()=>!document.querySelector('.combobox-input').disabled);
    await page.evaluate(()=>window.component.focus());assert.equal(await input.evaluate(node=>document.activeElement===node),true);
    await input.press('Escape');

    for(const [locale,display] of [['en','Presenter'],['kk','Жүргізуші'],['ru','Ведущий']]) {
      const count=await page.evaluate(()=>window.renders);
      await page.evaluate(value=>{window.locale=value;window.component.refreshLanguage();},locale);
      assert.equal(await input.inputValue(),display);assert.equal(await native.inputValue(),'host');
      assert.equal(await page.evaluate(()=>window.renders),count,'Localization refresh must not recursively notify the host.');
    }
    await page.evaluate(()=>{window.locale='en';window.component.refreshLanguage();});await input.click();
    assert.equal(await page.locator('.combobox-group').textContent(),'Venues');
    await input.fill('ФОТО');assert.deepEqual(await shown(),['photo']);await option('photo').tap();
    assert.equal(await input.inputValue(),'Photography');assert.equal(await native.inputValue(),'photo');

    await native.evaluate(node=>{node.replaceChildren(new Option('Без предпочтений',''),new Option('Новый вариант','new'),new Option('<script>bad()</script>','literal'));node.value='new';node.required=false;});
    await page.evaluate(()=>window.component.refresh());assert.equal(await native.inputValue(),'new');assert.equal(await input.inputValue(),'Новый вариант');
    assert.equal(await input.getAttribute('aria-required'),'false');
    await input.click();assert.deepEqual(await shown(),['','new','literal']);assert.equal(await list.locator('script').count(),0);
    await option('').click();assert.equal(await native.inputValue(),'');
    await native.evaluate(node=>{node.value='new';node.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await input.inputValue(),'Новый вариант');
    await page.evaluate(()=>window.component.destroy());
    assert.equal(await native.isVisible(),true);assert.equal(await native.inputValue(),'new');
    assert.deepEqual(await nativeValues(),['','new','literal']);assert.equal(await page.locator('.select-combobox').count(),0);
    assert.equal(await page.locator('label').getAttribute('for'),'category');assert.equal(await native.getAttribute('aria-describedby'),'hint extra');
    assert.deepEqual(errors,[]);
    console.log('PASS editable combobox: complete list/groups, canonical selection, pointer/touch/keyboard, explicit commit once, no-submit typing/cancel/empty, clear, disabled/invalid/labels, locale refresh, metadata/reset/destroy. Synthetic component data only.');
  } finally {await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

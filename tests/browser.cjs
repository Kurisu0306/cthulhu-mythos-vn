// Chrome, Firefox, WebKit 可通过 TEST_BROWSER 选择；生产网页本身没有运行依赖。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const playwright = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(source);
const sandbox = {};
vm.runInNewContext(source.replace('  var SAVE_KEY =', '  globalThis.data={CODEX,CH}; return;\n  var SAVE_KEY ='), sandbox);
const {CODEX,CH} = sandbox.data;
const ids = new Set(CODEX.map(e=>e.id));
assert.equal(ids.size, CODEX.length, '档案 ID 必须唯一');
const referenced = CH.flatMap(c=>[...c.lines,...(c.choices||[])]).flatMap(l=>l.unlock||[]);
assert(referenced.every(id=>ids.has(id)), '所有解锁引用都必须存在');
assert(CODEX.every(e=>referenced.includes(e.id)), '所有档案都有解锁入口');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8768';
const output = process.env.TEST_OUTPUT_DIR || path.join(__dirname, '../test-results');
const storageKey = 'miskatonic-lecture-v1';
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const engine = process.env.TEST_BROWSER || 'chromium';
  const launchOptions = {headless:true};
  if(engine==='chromium')launchOptions.channel=process.env.TEST_CHROME_CHANNEL||'chrome';
  if(process.env.TEST_PROXY)launchOptions.proxy={server:process.env.TEST_PROXY};
  const browser = await playwright[engine].launch(launchOptions);
  let checks = 0;
  const errors = [];
  const report = [];
  async function session(options={}) {
    const ctx = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',...options});
    // Fonts 被阻断，确保正文和交互可在断网时使用。
    await ctx.route('https://fonts.googleapis.com/**',r=>r.abort());
    await ctx.route('https://fonts.gstatic.com/**',r=>r.abort());
    const page = await ctx.newPage();page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror',e=>errors.push(e.message));
    const response = await page.goto(base,{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200);
    return {ctx,page};
  }
  async function saveData(page) {return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);}
  async function installSave(page,d) {await page.evaluate(({key,d})=>localStorage.setItem(key,JSON.stringify(d)),{key:storageKey,d});await page.reload();}
  async function chapterReady(page) {await page.waitForFunction(()=>document.getElementById('card').hidden && !document.getElementById('box').hidden);}
  try {
    const main = await session(); const page=main.page;
    const metadata = await page.evaluate(()=>({charset:document.characterSet,doctype:!!document.doctype,lang:document.documentElement.lang,viewport:!!document.querySelector('meta[name=viewport]'),hidden:['endScreen','codex','toc','choices'].every(id=>getComputedStyle(document.getElementById(id)).display==='none')}));
    assert.deepEqual(metadata,{charset:'UTF-8',doctype:true,lang:'zh-CN',viewport:true,hidden:true});checks++;
    await page.screenshot({path:path.join(output,'desktop-start.png')});
    await page.locator('#btnStart').click();
    const initial=await saveData(page);
    for(let i=0;i<10;i++)await page.keyboard.press('ArrowRight');
    assert.deepEqual(await saveData(page),initial,'章节卡期间不能跳对白或扣分');
    await chapterReady(page);checks++;
    // 目录键盘激活必须打开目录，焦点受限且 Escape 返回触发按钮。
    await page.locator('#tocBtn').focus();await page.keyboard.press('Enter');assert(await page.locator('#toc').isVisible());
    assert.equal(await page.locator('#tocClose').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.tocitem:not(:disabled)').last().evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#tocBtn').evaluate(el=>el===document.activeElement),true);checks++;
    // 新旧存档恢复不能再次结算当前行；奇数行也必须保存扣分结果。
    const legacy={ch:3,li:2,san:80,unlocked:{azathoth:1},visited:{3:1}};
    await installSave(page,legacy);await page.locator('#btnResume').click();assert.equal(await page.locator('#sanNum').innerText(),'80');
    await page.locator('#nextBtn').click();assert.equal(await page.locator('#sanNum').innerText(),'78');
    const v2=await saveData(page);assert.equal(v2.li,3);assert.equal(v2.san,78);assert.equal(v2.version,2);
    for(let i=0;i<3;i++){await page.reload();await page.locator('#btnResume').click();assert.equal(await page.locator('#sanNum').innerText(),'78');}checks++;
    // 重读、章节卡期间导航和旧计时器不能重复结算。
    await page.locator('#tocBtn').click();await page.locator('.tocitem[data-i="3"]').click();
    for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#sanNum').innerText(),'78');await chapterReady(page);
    for(let i=0;i<3;i++)await page.locator('#nextBtn').click();assert.equal(await page.locator('#sanNum').innerText(),'78');checks++;
    // 新格式在章节卡或换行前保存的未结算行，恢复时应结算一次。
    await installSave(page,{version:2,ch:3,li:2,san:80,unlocked:{},visited:{3:1},applied:{},choices:{}});
    await page.locator('#btnResume').click();assert.equal(await page.locator('#sanNum').innerText(),'78');
    assert.equal((await saveData(page)).applied['3:2'],1);
    await page.reload();await page.locator('#btnResume').click();assert.equal(await page.locator('#sanNum').innerText(),'78');checks++;
    for(const bad of ['{bad',JSON.stringify({ch:-1,li:0,san:80}),JSON.stringify({ch:0.5,li:0,san:80}),JSON.stringify({ch:0,li:-1,san:80}),JSON.stringify({ch:0,li:0,san:'80'}),JSON.stringify({version:999,ch:0,li:0,san:80})]) {
      await page.evaluate(({key,bad})=>localStorage.setItem(key,bad),{key:storageKey,bad});await page.reload();assert(await page.locator('#btnResume').isHidden());
    }checks++;
    const sourcesResponse=await page.goto(new URL('sources.html',base).href);
    assert.equal(sourcesResponse.status(),200);assert.equal(await page.locator('h1').innerText(),'内容核查与来源');checks++;
    await main.ctx.close();
    // 字体服务长时间无响应也不能阻塞应用启动。
    const fontCtx=await browser.newContext({reducedMotion:'reduce'});
    await fontCtx.route('https://fonts.googleapis.com/**',()=>{});
    const fontPage=await fontCtx.newPage();fontPage.on('pageerror',e=>errors.push(e.message));
    await fontPage.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
    await fontPage.locator('#btnStart').click({timeout:5000});await chapterReady(fontPage);
    assert((await fontPage.locator('#text').innerText()).includes('档案室'));await fontCtx.close();checks++;
    // 两次选择的四种组合逐行通读；检查选择处和结语处重载。
    const endings = [];
    for(const route of [[0,0],[0,1],[1,0],[1,1]]) {
      const {ctx,page}=await session();await page.locator('#btnStart').click();await chapterReady(page);let pick=0;
      for(let ci=0;ci<CH.length;ci++) {
        for(let li=0;li<CH[ci].lines.length;li++)await page.locator('#nextBtn').click();
        if(CH[ci].choices){
          assert(await page.locator('#choices').isVisible());
          const before=await saveData(page);assert.equal(before.li,CH[ci].lines.length);
          await page.reload();await page.locator('#btnResume').click();assert(await page.locator('#choices').isVisible());assert.equal((await saveData(page)).san,before.san);
          await page.locator('#choices button').nth(route[pick++]).focus();await page.keyboard.press('Enter');
        }
        if(ci<CH.length-1)await chapterReady(page);
      }
      assert(await page.locator('#endScreen').isVisible());
      const final=await saveData(page);assert(final.finished);assert.equal(Object.keys(final.unlocked).length,CODEX.length);
      assert.equal(Object.keys(final.applied).length,CH.reduce((n,c)=>n+c.lines.length,0));
      assert.equal(Object.keys(final.choices).length,2);assert.equal(Object.keys(final.visited).length,CH.length);
      const text=await page.locator('#endText').innerText();endings.push(text);report.push({route,san:final.san,archives:Object.keys(final.unlocked).length});
      await page.locator('#btnCodexEnd').click();assert(await page.locator('#codex').isVisible());assert(await page.locator('#codexClose').evaluate(el=>document.elementFromPoint(el.getBoundingClientRect().x+5,el.getBoundingClientRect().y+5)===el));
      await page.keyboard.press('Escape');await page.reload();await page.locator('#btnResume').click();assert.equal(await page.locator('#endText').innerText(),text);assert.equal((await saveData(page)).san,final.san);
      if(route[0]===0&&route[1]===0)await page.screenshot({path:path.join(output,'desktop-ending.png')});
      await page.locator('#btnAgain').click();assert.equal((await saveData(page)).san,100);assert.equal(Object.keys((await saveData(page)).unlocked).length,0);
      await ctx.close();checks++;
    }
    assert.equal(new Set(endings).size,4,'四种结局均可正常触发');checks++;
    for(const size of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
      const {ctx,page}=await session({viewport:size,isMobile:engine!=='firefox',deviceScaleFactor:1});
      assert.equal(await page.evaluate(()=>innerWidth),size.width);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('#btnStart').scrollIntoViewIfNeeded();await page.locator('#btnStart').click();await chapterReady(page);
      await page.locator('#nextBtn').click();
      const bounds=await page.locator('#box').boundingBox();assert(bounds.y>=0&&bounds.y+bounds.height<=size.height);
      await page.locator('#codexBtn').click();await page.locator('#codexClose').click();
      await page.screenshot({path:path.join(output,`mobile-${size.width}x${size.height}.png`)});
      await ctx.close();checks++;
    }
    // 普通动画模式下，打字跳过、场景切换以及切换系统减少动画设置。
    const animated=await session({reducedMotion:'no-preference',colorScheme:'dark'});
    await animated.page.locator('#btnStart').click();await chapterReady(animated.page);
    await animated.page.locator('#nextBtn').click();assert.equal((await saveData(animated.page)).li,0,'第一次点击只补完当前文字');
    await animated.page.locator('#nextBtn').click();assert.equal((await saveData(animated.page)).li,1);
    await animated.page.emulateMedia({reducedMotion:'reduce',colorScheme:'light'});
    await animated.page.locator('#nextBtn').click();assert.equal((await saveData(animated.page)).li,2);await animated.ctx.close();checks++;
    assert.deepEqual(errors,[],'浏览器无脚本异常');
    console.log(JSON.stringify({status:'passed',browser:engine,checks,chapters:CH.length,lines:CH.reduce((n,c)=>n+c.lines.length,0),archives:CODEX.length,routes:report,screenshots:output},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

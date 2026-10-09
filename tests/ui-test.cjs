/* Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
 * Uses real local API flows and an isolated temporary SQLite database.
 * No customer database, platform credentials or external services are used. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {createServer} = require('node:net');
const {DatabaseSync} = require('node:sqlite');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname,'..');
const artifactDir = path.join(root,'artifacts','ui');
const pages = ['/', '/ship','/track','/rates','/history','/profile','/support','/contact','/admin','/login','/register','/forgot-password','/reset-password','/privacy','/terms'];
let browser;
const results=[];
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function visibleText(page,selector,text){await page.locator(selector).filter({hasText:text}).first().waitFor();}
async function checkLayout(page,label,width){
  const problems=await page.evaluate(()=>{
    const overflow=document.documentElement.scrollWidth>innerWidth+1;
    const clipped=[...document.querySelectorAll('input,select,textarea,button,.button')].filter(e=>{
      const r=e.getBoundingClientRect();return r.width && r.height && (r.left < -1 || r.right > innerWidth+1);
    }).map(e=>e.name||e.textContent.trim().slice(0,30));
    return {overflow,clipped};
  });
  assert.equal(problems.overflow,false,`${label} at ${width}: horizontal overflow`);
  assert.deepEqual(problems.clipped,[],`${label} at ${width}: clipped controls`);
}
async function run(width){
  console.log(`Starting browser checks at ${width}px`);
  const dataDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'swift-ui-'));
  const port=await freePort();const base=`http://127.0.0.1:${port}`;
  const startServer=()=>spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataDirectory,SUPABASE_URL:'',SUPABASE_ANON_KEY:''},stdio:'pipe'});
  let server=startServer();
  async function restart(){
    if(server.exitCode===null){server.kill();await once(server,'exit');}
    server=startServer();
    for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
    throw new Error('Isolated test server did not restart.');
  }
  let context;
  try{
    for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();
    const errors=[],failedAssets=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',msg=>{if(msg.type()==='error' && !msg.text().includes('Failed to load resource'))errors.push(msg.text());});
    page.on('response',r=>{if(r.status()>=400 && /\.(css|js|png)(\?|$)/.test(r.url()))failedAssets.push(`${r.status()} ${r.url()}`);});
    await page.goto(base);await page.locator('.hero-tracker').waitFor();
    if(width<1001){await page.locator('.nav-toggle').click();await page.locator('.nav-signin').waitFor();await checkLayout(page,'open mobile navigation',width);await page.keyboard.press('Escape');}
    await checkLayout(page,'home',width);await page.screenshot({path:path.join(artifactDir,`home-${width}.png`),fullPage:true});
    await page.goto(`${base}/admin`);await visibleText(page,'#admin-message','Staff access is required');assert.equal(await page.locator('.status-form').count(),0);
    await page.goto(`${base}/ship`);
    for(const [name,value] of Object.entries({senderName:'Visitor',senderEmail:'visitor@example.test',origin:'Lagos',recipientName:'Recipient',recipientPhone:'08000000000',destination:'Abuja',contents:'Clothing',weight:'1'})) await page.locator(`[name=${name}]`).fill(value);
    await page.locator('[name=terms]').check();await page.locator('#shipment-form button[type=submit]').click();
    await visibleText(page,'#shipment-message','Sign in');assert.equal(await page.locator('#shipment-message a').getAttribute('href'),'/login');
    assert.equal(await page.evaluate(()=>localStorage.getItem('swift-logistics-shipments')),null,'Rejected booking must not create local shipment');
    await page.goto(`${base}/register`);
    await page.locator('[name=name]').fill('Alex Morgan');await page.locator('[name=email]').fill(`customer-${width}@example.test`);await page.locator('[name=password]').fill('ui-test-password');await page.locator('#register-form button').click();
    await page.waitForURL('**/history#overview');await visibleText(page,'h1','Welcome back, Alex Morgan');await visibleText(page,'.empty-state','Your first shipment');
    if(width===1440){
      await restart();
      const legacy=[{id:'SWF-FAKE1234',origin:'Lagos',destination:'Abuja',status:'Shipment created',service:'Priority',createdAt:'2026-09-30T10:00:00Z',events:[{title:'Shipment created',detail:'Old browser-only record',time:'2026-09-30T10:00:00Z'}]}];
      await page.evaluate(value=>localStorage.setItem('swift-logistics-shipments',JSON.stringify(value)),legacy);
      await page.goto(`${base}/ship`);
      for(const [name,value]of Object.entries({senderName:'Retained Customer',senderEmail:'customer@example.test',origin:'Lagos',recipientName:'Recipient',recipientPhone:'08000000000',destination:'Abuja',contents:'Clothing',weight:'2'}))await page.locator(`[name=${name}]`).fill(value);
      await page.locator('[name=terms]').check();
      for(const failure of [401,403,400,422,500,'network','malformed','unexpected']){
        await page.route('**/api/shipments',async route=>{
          if(route.request().method()!=='POST')return route.continue();
          if(failure==='network')return route.abort('failed');
          await route.fulfill({status:typeof failure==='number'?failure:201,contentType:'application/json',body:failure==='malformed'?'{':failure==='unexpected'?'{"id":"SWF-FAKE1234"}':'{"error":"PRIVATE SQL DETAILS"}'});
        });
        await page.locator('#shipment-form button[type=submit]').click();
        await page.waitForFunction(()=>!document.querySelector('#shipment-form button[type=submit]').disabled && document.querySelector('#shipment-message').textContent.length>0);
        const text=await page.locator('#shipment-message').textContent();assert.ok(!text.includes('Shipment created.'));assert.ok(!text.includes('PRIVATE'));
        assert.equal(await page.locator('[name=senderName]').inputValue(),'Retained Customer');
        assert.equal(await page.evaluate(()=>localStorage.getItem('swift-logistics-shipments')),JSON.stringify(legacy));
        await page.unroute('**/api/shipments');
      }
      let release,arrived,requests=0;const intercepted=new Promise(resolve=>{arrived=resolve;});
      await page.route('**/api/shipments',async route=>{if(route.request().method()!=='POST')return route.continue();requests++;await new Promise(resolve=>{release=resolve;arrived();});await route.fulfill({status:500,contentType:'application/json',body:'{}'});});
      await page.evaluate(()=>{const form=document.querySelector('#shipment-form');for(let i=0;i<3;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
      await intercepted;assert.equal(requests,1);assert.equal(await page.locator('#shipment-form button[type=submit]').isDisabled(),true);release();
      await visibleText(page,'#shipment-message','could not be confirmed');await page.unroute('**/api/shipments');
      await page.goto(`${base}/history#shipments`);await visibleText(page,'.empty-state','Your first shipment');assert.equal(await page.locator('.summary-card strong').first().textContent(),'0');
      await page.goto(`${base}/track?number=SWF-FAKE1234`);await visibleText(page,'#tracking-message','could not');assert.equal(await page.locator('#tracking-result').isVisible(),false);
      await restart();
      console.log('PASS browser failure matrix: 8 failures, stale local records excluded, pending-submit guard');
    }
    await page.goto(`${base}/ship`);await page.locator('.workspace-sidebar').waitFor();
    const fields={senderName:'Alex Morgan',senderEmail:`customer-${width}@example.test`,origin:'Ikeja, Lagos, Nigeria',recipientName:'Jamie Taylor',recipientPhone:'08000000000',destination:'Abuja, Nigeria',contents:'Clothing',weight:'2.5'};
    for(const [name,value]of Object.entries(fields))await page.locator(`[name=${name}]`).fill(value);
    await page.locator('#review-shipment').click();await visibleText(page,'#shipment-review','Jamie Taylor');await checkLayout(page,'shipment review',width);
    await page.screenshot({path:path.join(artifactDir,`ship-${width}.png`),fullPage:true});
    await page.locator('[name=terms]').check();await page.locator('#shipment-form button[type=submit]').click();await visibleText(page,'#shipment-message','Shipment created.');
    const tracking=(await page.locator('#shipment-message strong').textContent()).trim();assert.match(tracking,/^SWF-/);
    await page.goto(`${base}/history#shipments`);await visibleText(page,'.shipment-table',tracking);await page.locator('#shipment-search').fill('no-matching-record');await visibleText(page,'#shipment-rows','No matching shipments');await page.locator('#shipment-search').fill('');await page.locator('#shipment-filter').selectOption('Shipment created');await visibleText(page,'.shipment-table',tracking);
    await checkLayout(page,'customer dashboard',width);await page.screenshot({path:path.join(artifactDir,`dashboard-${width}.png`),fullPage:true});
    await page.locator('.track-link').click();await visibleText(page,'#tracking-result',tracking);await checkLayout(page,'tracking',width);assert.equal(await page.locator('progress').getAttribute('value'),'0');
    await page.goto(`${base}/rates`);await page.locator('[name=origin]').fill('Lagos');await page.locator('[name=destination]').fill('Abuja');await page.locator('[name=weight]').fill('2');await page.locator('#quote-form button').click();await page.locator('.quote-card').first().waitFor();assert.equal(await page.locator('.quote-card').count(),3);await checkLayout(page,'quote results',width);
    await page.goto(`${base}/contact`);await page.locator('[name=name]').fill('Alex Morgan');await page.locator('[name=email]').fill(`customer-${width}@example.test`);await page.locator('[name=message]').fill(`Please check shipment ${tracking}.`);await page.locator('#support-form button').click();await visibleText(page,'#support-message','Message received.');
    await page.goto(`${base}/admin`);await visibleText(page,'#admin-message','Staff access is required');assert.equal(await page.locator('.status-form').count(),0);
    // Promote only the isolated test account to exercise the existing staff UI/API.
    const db=new DatabaseSync(path.join(dataDirectory,'swift-logistics.db'));db.prepare("UPDATE users SET role='staff' WHERE email=?").run(`customer-${width}@example.test`);db.close();
    await page.reload();await page.locator('.status-form').waitFor();assert.equal(await page.locator('.status-form').count(),1,'Only the genuine booking appears in staff operations');await page.locator('#admin-shipment-form').waitFor();await page.locator('#admin-search').fill(tracking);await checkLayout(page,'staff console',width);
    const statusForm=page.locator('.status-form').first();await statusForm.locator('[name=status]').selectOption('In transit');await statusForm.locator('[name=progress]').fill('55');await statusForm.locator('[name=country]').fill('Nigeria');await statusForm.locator('[name=state]').fill('FCT');await statusForm.locator('[name=city]').fill('Abuja');await statusForm.locator('[name=expectedDelivery]').fill('2026-10-05');await statusForm.locator('[name=detail]').fill('Arrived at facility');
    await Promise.all([page.waitForEvent('load'),statusForm.locator('button').click()]);await page.locator('.status-form').waitFor();await visibleText(page,'#admin-list .status','In transit');
    const adminForm=page.locator('#admin-shipment-form');
    for(const [name,value]of Object.entries({senderName:'Operations Desk',senderEmail:'operations@example.test',origin:'Lagos, Nigeria',recipientName:'Public Tracking Recipient',recipientPhone:'08000000002',destination:'Kano, Nigeria',contents:'Prototype parcel',weight:'3',initialProgress:'10',expectedDelivery:'2026-10-08'}))await adminForm.locator(`[name=${name}]`).fill(value);
    await adminForm.locator('[name=initialStatus]').selectOption('Picked up');await adminForm.locator('button[type=submit]').click();await visibleText(page,'#admin-shipment-message','Shipment');const adminTracking=(await page.locator('#admin-shipment-message strong').textContent()).trim();assert.match(adminTracking,/^SWF-/);await page.waitForTimeout(1100);await page.locator('.status-form').first().waitFor();await visibleText(page,'#admin-list',adminTracking);await checkLayout(page,'staff shipment creation',width);
    await page.screenshot({path:path.join(artifactDir,`staff-${width}.png`),fullPage:true});
    const ticket=page.locator('.ticket-form').first();await ticket.locator('select').selectOption('Resolved');await Promise.all([page.waitForEvent('load'),ticket.locator('button').click()]);await page.locator('.ticket-form').waitFor();assert.equal(await page.locator('.ticket-form select').first().inputValue(),'Resolved');
    await page.goto(`${base}/track?number=${tracking}`);await visibleText(page,'#tracking-result','In transit');assert.equal(await page.locator('progress').getAttribute('value'),'55');await visibleText(page,'.tracking-facts','Abuja, FCT, Nigeria');await checkLayout(page,'tracking with events',width);await page.screenshot({path:path.join(artifactDir,`tracking-${width}.png`),fullPage:true});
    await page.goto(`${base}/history`);await page.locator('.summary-card').first().waitFor();assert.equal(await page.locator('.summary-card strong').nth(1).textContent(),'2');
    await restart();
    for(const route of pages){const response=await page.goto(`${base}${route}`);assert.equal(response.status(),200,`${route}: page response`);await page.waitForLoadState('networkidle');await checkLayout(page,route,width);assert.equal(await page.locator('main').count(),1,`${route}: main`);assert.equal(await page.locator('.site-header').count(),1,`${route}: header`);}
    await restart();
    await page.goto(`${base}/history`);await page.locator('.nav-logout').waitFor({state:'attached'});if(width<1001)await page.locator('.nav-toggle').click();await page.locator('.nav-logout').click();await page.waitForURL(base+'/');
    await restart();
    for(const route of pages){const response=await page.goto(`${base}${route}`);assert.equal(response.status(),200,`${route}: logged-out response`);await page.waitForLoadState('networkidle');await checkLayout(page,`${route} logged out`,width);assert.equal(await page.locator('.status-form').count(),0,'No staff update controls when logged out');}
    await page.goto(`${base}/login`);await page.locator('[name=email]').fill(`customer-${width}@example.test`);await page.locator('[name=password]').fill('ui-test-password');await page.locator('#login-form button').click();await page.waitForURL('**/history#overview');await visibleText(page,'h1','Welcome back');
    assert.deepEqual(errors,[],`browser errors at ${width}`);assert.deepEqual(failedAssets,[],`broken assets at ${width}`);
    results.push({width,flows:'registration, customer dashboard, shipment creation/review, search/filter, tracking, estimates, support, staff updates, ticket resolution, logout/login',pagesChecked:pages.length,statesChecked:['logged out','staff','customer core flows'],consoleErrors:errors,failedAssets});
    console.log(`PASS ${width}px: all flows and ${pages.length} page layouts`);
  }finally{
    await context?.close();if(server.exitCode===null){server.kill();await once(server,'exit');}
    const resolved=path.resolve(dataDirectory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('swift-ui-'));await fs.rm(resolved,{recursive:true,force:true});
  }
}
(async()=>{await fs.mkdir(artifactDir,{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});for(const width of (process.env.UI_WIDTH ? [Number(process.env.UI_WIDTH)] : [375,768,1440]))await run(width);await fs.writeFile(path.join(artifactDir,'results.json'),JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});

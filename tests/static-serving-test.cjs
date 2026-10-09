const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { requestPath } = require('../public-files');

const sourceRoot = path.resolve(__dirname, '..');
const sentinel = 'HARMLESS-PRIVATE-STATIC-TEST-SENTINEL';
const pageNames = ['index','ship','rates','track','history','support','contact','login','register','forgot-password','reset-password','profile','admin','privacy','terms'];
const assets = [
  ['css/style.css', 'text/css'], ['css/carrier.css', 'text/css'],
  ['css/operations.css', 'text/css'], ['js/app.js', 'text/javascript'],
  ['js/workspace.js', 'text/javascript'], ['assets/swift-logistics-van.png', 'image/png'],
];
const privateFiles = [
  '.env', '.env.local', '.env.production', 'data/private.db', 'data/private.sqlite',
  'data/swift-logistics.db', '.git/config', '.github/workflows/ci.yml',
  'supabase/schema.sql', 'supabase/003_operations_location_fields.sql',
  'scripts/private.js', 'tests/private.js', 'README.md', 'CHATGPT_HANDOFF.md',
  'UI_REDESIGN_REPORT.md', 'Dockerfile', 'compose.yaml', 'vercel.json',
  'package.json', 'package-lock.json', 'private-sentinel.txt', 'private.js',
  'private.html', 'css/private.css', 'js/private.js', 'assets/private.png',
  'assets/.env.local', 'assets/private.db', 'api/[...path].js',
];
const invalidPaths = [
  '/../private-sentinel.txt', '/css/../private-sentinel.txt', '/css/../js/app.js',
  '/%2e%2e/private-sentinel.txt', '/css/%2e%2e/private-sentinel.txt',
  '/%2E%2E%2Fapp-private/private-sentinel.txt', '/css/%2e%2e%5cprivate.js',
  '/%252e%252e%252fprivate-sentinel.txt', '/%252e%252e/private-sentinel.txt',
  '/..\\private-sentinel.txt', '/css\\..\\server.js', '/css%5cstyle.css',
  '/css%2fstyle.css', '/css//style.css', '//app-private/private-sentinel.txt',
  '/../app-private/private-sentinel.txt', '/%2e%2e/app-private/private-sentinel.txt',
  '/C:/Windows/win.ini', '/js/app.js:private', '/js/app.js%3Aprivate',
  '/js/app.js%00', '/js/app.js%20', '/%FF', '/%', '/%2', '/%GG',
  '/css/./style.css', '/css/%2e/style.css', '/js/app.js.', '/JS/APP.JS',
  '/js/app.js/', '/server%2ejs', '/api%2findex.js', '/api/%69ndex.js',
  '/api/../server.js', '/api/%2e%2e/server.js', '/css/style.css%3Fprivate',
  '/css/style.css%23private', '/css/style.css%0a',
];

// Raw http.request preserves traversal targets that fetch/new URL would normalize.
function request(port, target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({host:'127.0.0.1', port, path:target, method, agent:false}, res => {
      const chunks = [];
      res.on('data', part => chunks.push(part));
      res.on('end', () => resolve({status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks)}));
    });
    req.on('error', reject); req.end();
  });
}

async function freePort() {
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}

async function write(root, relative, content) {
  const target = path.resolve(root, relative);
  assert.ok(target.startsWith(root + path.sep), 'Fixture must remain inside its temporary root');
  await fs.mkdir(path.dirname(target), {recursive:true}); await fs.writeFile(target, content);
}

async function stop(child) {
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
}

async function exercise(entry, fixture, port) {
  // The local server uses only its temporary database. The serverless API stub
  // verifies delegation without reading environment values or contacting Supabase.
  const child = spawn(process.execPath, [entry === 'server.js' ? entry : 'handler-host.cjs'], {
    cwd:fixture, env:{...process.env, PORT:String(port), DATA_DIR:path.join(fixture,'runtime'), SUPABASE_URL:'', SUPABASE_ANON_KEY:''}, stdio:'pipe',
  });
  let checks = 0;
  async function denied(target, method) {
    const result = await request(port, target, method);
    assert.equal(result.status, 404, `${entry} must reject ${target}`);
    assert.ok(!result.body.includes(sentinel), `${entry} leaked a test sentinel`); checks++;
  }
  try {
    let ready = false;
    for (let i=0;i<100;i++) {
      try { if ((await request(port,'/api/health')).status === 200) {ready=true;break;} } catch {}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(ready, `${entry} started`);
    for (const name of pageNames) {
      const route = name === 'index' ? '/' : `/${name}`;
      const result = await request(port,route);
      assert.equal(result.status,200,`${entry} public page ${route}`);
      assert.match(result.headers['content-type'],/^text\/html/);
      assert.ok(result.body.equals(await fs.readFile(path.join(sourceRoot,`${name}.html`))), 'Public page must be unchanged'); checks++;
      const legacy = await request(port,`/${name}.html`);
      assert.equal(legacy.status,308); assert.equal(legacy.headers.location,route); checks++;
    }
    for (const [file,type] of assets) {
      const result = await request(port,`/${file}`);
      assert.equal(result.status,200,`${entry} public asset ${file}`);
      assert.ok(result.headers['content-type'].startsWith(type));
      assert.ok(result.body.equals(await fs.readFile(path.join(sourceRoot,file))), 'Asset bytes must be unchanged'); checks++;
    }
    for (const target of ['/','/track?number=SWF-TEST1234','/css/style.css?v=1','/js/app.js']) {
      const result = await request(port,target,'HEAD'); assert.equal(result.status,200); assert.equal(result.body.length,0); checks++;
    }
    assert.equal((await request(port,'/%73hip')).status,200); checks++;
    for (const file of [...privateFiles,'server.js','index.js','public-files.js','booking.js','api/index.js','handler-host.cjs']) await denied(`/${file}`);
    for (const target of invalidPaths) await denied(target);
    for (const target of ['/unknown','/missing.html','/assets/missing.png','/js/missing.js','/css/missing.css','/assets/','/server.js?download=1']) await denied(target);
    await denied('/js/app.js','POST'); await denied('/private-sentinel.txt','HEAD');

    // Replace only a copied fixture directory with a junction/symlink. This tests
    // both an in-project private target and a sibling sharing the root prefix.
    const assetDirectory = path.join(fixture,'assets');
    const savedDirectory = path.join(fixture,'saved-assets');
    for (const target of [path.join(fixture,'private-assets'), `${fixture}-private`]) {
      assert.ok(assetDirectory.startsWith(fixture+path.sep) && savedDirectory.startsWith(fixture+path.sep));
      await fs.rename(assetDirectory,savedDirectory);
      try {
        await fs.symlink(target,assetDirectory,process.platform === 'win32' ? 'junction' : 'dir');
        await denied('/assets/swift-logistics-van.png');
      } finally {
        const info=await fs.lstat(assetDirectory).catch(()=>null);
        if(info?.isSymbolicLink()) await fs.unlink(assetDirectory);
        await fs.rename(savedDirectory,assetDirectory);
      }
    }
    console.log(`PASS ${entry}: ${checks} public-file, denial, traversal, HEAD, redirect and junction checks`);
  } finally { await stop(child); }
}

(async()=>{
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'swift-static-security-'));
  const fixture = path.join(temporary,'app');
  try {
    await fs.mkdir(path.join(fixture,'runtime'),{recursive:true});
    // Copy only known non-secret code and public content. Never read .env or data.
    for(const file of ['server.js','index.js','public-files.js','booking.js',...pageNames.map(n=>`${n}.html`),...assets.map(([f])=>f)]) {
      await write(fixture,file,await fs.readFile(path.join(sourceRoot,file)));
    }
    for(const file of privateFiles) await write(fixture,file,sentinel);
    // package.json must be valid so Node can load the isolated CommonJS fixture.
    await write(fixture,'package.json',JSON.stringify({private:true,description:sentinel}));
    await write(fixture,'api/index.js',`// ${sentinel}\nmodule.exports=(req,res)=>{res.writeHead(req.url==='/api/health'?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify({testApi:true}));};`);
    await write(fixture,'handler-host.cjs',"const http=require('node:http');const handler=require('./index');http.createServer((req,res)=>Promise.resolve(handler(req,res)).catch(()=>{res.writeHead(500);res.end('Test handler error');})).listen(Number(process.env.PORT),'127.0.0.1');");
    await write(fixture,'private-assets/swift-logistics-van.png',sentinel);
    await fs.mkdir(`${fixture}-private`,{recursive:true});
    await write(`${fixture}-private`,'swift-logistics-van.png',sentinel);
    await write(`${fixture}-private`,'private-sentinel.txt',sentinel);
    for(const target of [undefined,'','https://example.test/','//host/file','/path\u0000','/path\r\n','/path#fragment','/css\\style.css']) assert.equal(requestPath(target),null,'Malformed request target must be rejected');
    await exercise('server.js',fixture,await freePort());
    await exercise('index.js',fixture,await freePort());
  } finally {
    const resolved=path.resolve(temporary);
    assert.ok(path.dirname(resolved)===path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('swift-static-security-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

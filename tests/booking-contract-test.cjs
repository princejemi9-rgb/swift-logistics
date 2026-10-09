const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {Readable} = require('node:stream');
const root = path.resolve(__dirname,'..');
const input = {senderName:'Customer A',senderEmail:'a@example.test',origin:'Lagos',recipientName:'Recipient',recipientPhone:'08000000000',destination:'Abuja',contents:'Clothing',weight:2,service:'Priority'};
const persisted = {id:'SWF-1234ABCD',owner_id:'customer-a',sender_name:'Customer A',sender_email:'a@example.test',origin:'Lagos',recipient_name:'Recipient',recipient_phone:'08000000000',destination:'Abuja',contents:'Clothing',weight:2,service:'Priority',status:'Shipment created',progress:0,created_at:'2026-09-30T10:00:00Z',shipment_events:[{title:'Shipment created',detail:'Collection scheduled in Lagos',created_at:'2026-09-30T10:00:00Z'}]};
function harness({invalidToken=false,rpcStatus=200,rpcBody={shipment:persisted,replayed:false},role='customer'}={}) {
  const calls=[];
  const context={module:{exports:{}},require:name=>name==='../booking'?require('../booking'):require(name),URL,process:{env:{SUPABASE_URL:'https://isolated.invalid',SUPABASE_ANON_KEY:'not-a-secret-test-key'}},fetch:async(url,options={})=>{
    const route=new URL(url).pathname;calls.push({route,...options});
    if(route==='/auth/v1/user')return new Response(JSON.stringify(invalidToken?{error:'expired'}:{id:'customer-a'}),{status:invalidToken?401:200});
    if(route==='/rest/v1/profiles')return new Response(JSON.stringify([{id:'customer-a',name:'Customer A',role}]));
    if(route==='/rest/v1/shipments')return new Response(JSON.stringify([persisted]));
    if(route==='/rest/v1/shipment_events')return new Response(JSON.stringify([]));
    if(route==='/rest/v1/rpc/book_shipment')return new Response(JSON.stringify(rpcBody),{status:rpcStatus});
    if(route==='/rest/v1/rpc/track_shipment')return new Response(JSON.stringify([{...persisted,events:[]} ]));
    throw new Error('Unexpected external request: '+route);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(root,'api/index.js'),'utf8'),context);
  return {calls,async run({body=input,cookie='swift_session=test-user-token',method='POST',url='/api/shipments',key='11111111-1111-4111-8111-111111111111'}={}){
    const req=Readable.from([typeof body==='string'?body:JSON.stringify(body)]);req.method=method;req.url=url;req.headers={cookie,'idempotency-key':key};
    const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=value;},end(value){this.body=JSON.parse(value);}};
    await context.module.exports(req,res);return {status:res.statusCode,body:res.body,headers:res.headers};
  }};
}
test('anonymous and expired credentials cannot book or perform writes',async()=>{
  for(const config of [{cookie:''},{invalidToken:true}]){
    const h=harness(config);assert.equal((await h.run(config)).status,401);
    assert.equal(h.calls.filter(c=>c.route.includes('create_shipment')||c.route==='/rest/v1/shipments').length,0);
  }
});
test('one RPC uses user token; client ownership/operational fields never forwarded',async()=>{
  const h=harness();const result=await h.run({body:{...input,owner_id:'customer-b',id:'forged',status:'Delivered',progress:100}});
  assert.equal(result.status,201);const writes=h.calls.filter(c=>c.method==='POST');assert.equal(writes.length,1);
  assert.equal(writes[0].route,'/rest/v1/rpc/book_shipment');assert.equal(writes[0].headers.Authorization,'Bearer test-user-token');
  assert.deepEqual(JSON.parse(writes[0].body),{p_idempotency_key:'11111111-1111-4111-8111-111111111111',p_shipment:input});
  assert.equal(result.body.id,persisted.id);assert.equal(result.body.createdAt,persisted.created_at);
  assert.equal(result.body.events[0].time,persisted.shipment_events[0].created_at);assert.equal(result.body.senderEmail,undefined);
});
test('invalid fields and non-finite/invalid weights return 422 without a write',async()=>{
  for(const change of [{weight:'NaN'},{weight:'Infinity'},{weight:-1},{weight:0},{weight:true},{weight:1e9},{senderName:{}},{service:'invented'}]){
    const h=harness();assert.equal((await h.run({body:{...input,...change}})).status,422);assert.equal(h.calls.some(c=>c.method==='POST'),false);
  }
});
test('invalid JSON returns a safe 400',async()=>{const h=harness();assert.equal((await h.run({body:'{'})).status,400);});
test('database error classifications do not expose internal details or retry writes',async()=>{
  for(const [code,status]of [['22023',422],['28000',401],['42501',403],['23505',503],['P0001',503],['PT409',409]]){
    const h=harness({rpcStatus:400,rpcBody:{code,message:'PRIVATE DATABASE DETAIL',details:'SQL stack'}});
    const result=await h.run();assert.equal(result.status,status);assert.ok(!JSON.stringify(result.body).includes('PRIVATE'));
    assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
  }
});
test('replayed RPC result returns the persisted shipment and an explicit replay header',async()=>{
  const h=harness({rpcBody:{shipment:persisted,replayed:true}});const result=await h.run();
  assert.equal(result.status,201);assert.equal(result.body.id,persisted.id);assert.equal(result.headers['idempotency-replayed'],'true');
  assert.equal(h.calls.filter(call=>call.route==='/rest/v1/rpc/book_shipment').length,1);
});
test('malformed successful RPC data is treated as uncertain rather than a booking success',async()=>{
  for(const rpcBody of [{replayed:false},{shipment:persisted,replayed:'false'},{shipment:{id:'SWF-1234ABCD'},replayed:false}]){
    const h=harness({rpcBody});const result=await h.run();assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE/);
  }
});
test('public tracking still uses existing RPC and omits private data',async()=>{
  const h=harness();const result=await h.run({method:'GET',url:'/api/shipments/SWF-1234ABCD',cookie:''});
  assert.equal(result.status,200);assert.equal(result.body.senderEmail,undefined);assert.equal(result.body.senderName,undefined);assert.equal(result.body.contents,undefined);
  assert.equal(h.calls[0].route,'/rest/v1/rpc/track_shipment');
});
test('existing Supabase staff status writes still use staff token; customer cannot invoke them',async()=>{
  const options={method:'PUT',url:'/api/shipments/SWF-1234ABCD/status',body:{status:'In transit',detail:'Arrived',progress:50,country:'Nigeria',city:'Abuja'}};
  const customer=harness();assert.equal((await customer.run(options)).status,403);assert.equal(customer.calls.some(c=>c.method==='PATCH'),false);
  const staff=harness({role:'staff'});assert.equal((await staff.run(options)).status,200);
  assert.equal(staff.calls.filter(c=>c.method==='PATCH').length,1);
  const event=staff.calls.find(c=>c.route==='/rest/v1/shipment_events');assert.equal(event.headers.Authorization,'Bearer test-user-token');
});
test('idempotency migration has a per-owner unique claim, definer scope, and no public bypass',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/005_idempotent_shipment_booking.sql'),'utf8');
  assert.match(sql,/primary key \(owner_id, idempotency_key\)/);
  assert.match(sql,/caller uuid := auth\.uid\(\)/);assert.match(sql,/if caller is null/);
  assert.match(sql,/security definer\s+set search_path = ''/);
  assert.match(sql,/on conflict \(owner_id,idempotency_key\) do nothing/);
  assert.match(sql,/for update/);assert.match(sql,/saved\.request_payload <> normalized/);
  assert.match(sql,/revoke all on function public\.book_shipment\(uuid,jsonb\) from public, anon/);
  assert.match(sql,/grant execute on function public\.book_shipment\(uuid,jsonb\) to authenticated/);
  assert.doesNotMatch(sql,/disable row level security|create policy|service_role/i);
  assert.doesNotMatch(sql,/p_shipment\s*->>\s*'owner_id'/);
  // Structural evidence only: actual SQL execution is deliberately deferred to the local suite.
});
async function frontendRejection(status){
  let submit;let saved=0;const message={innerHTML:'',textContent:''},button={};
  const form={querySelector:()=>button,addEventListener:(event,fn)=>{if(event==='submit')submit=fn;},reset(){throw new Error('Rejected form must retain entered data');}};
  const context={Intl,URLSearchParams,AbortController,setTimeout,clearTimeout,location:{search:''},document:{querySelector:s=>s==='#shipment-form'?form:s==='#shipment-message'?message:null,querySelectorAll:()=>[]},
    fetch:async route=>new Response(JSON.stringify(route==='/api/auth/me'?{user:null}:{error:'Sign in required'}),{status:route==='/api/auth/me'?200:status}),
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},SwiftUI:{account(){}},FormData:class{*[Symbol.iterator](){yield*Object.entries(input);}},localStorage:{getItem:()=> '[]',setItem:()=>{saved++;}},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111',getRandomValues(){throw new Error('Authentication rejection generated tracking ID');}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/app.js'),'utf8'),context);
  await submit({preventDefault(){},currentTarget:form});assert.equal(saved,0);assert.match(message.innerHTML,/href="\/login"/);assert.equal(button.disabled,false);
}
test('frontend 401 cannot generate a local booking and offers sign in',()=>frontendRejection(401));
test('frontend 403 cannot generate a local booking and offers sign in',()=>frontendRejection(403));

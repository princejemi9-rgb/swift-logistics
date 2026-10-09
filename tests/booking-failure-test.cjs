const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8');
const fields = {senderName:'Customer',senderEmail:'customer@example.test',recipientName:'Recipient',recipientPhone:'08000000000',origin:'Lagos',destination:'Abuja',weight:'2',service:'Priority',contents:'Clothing'};
const shipment = {id:'SWF-AB12CD34',origin:'Lagos',destination:'Abuja',service:'Priority',status:'Shipment created',createdAt:'2026-09-30T10:00:00Z',events:[{title:'Shipment created',detail:'Collection scheduled in Lagos',time:'2026-09-30T10:00:00Z'}]};
function element(){let value='';return {hidden:true,get textContent(){return value;},set textContent(v){value=v;},get innerHTML(){return value;},set innerHTML(v){value=v;}};}
function harness(response, {tracking=false,dashboard=false,storage=new Map()}={}) {
  let submit,track,timer,reset=0,writes=0,reads=0,generated=0,calls=0,rendered=0,history,uuidCount=0,resetHandler; const keys=[];
  const message=element(),result=element(),trackingMessage=element(),button={};
  const form={querySelector:()=>button,addEventListener:(name,fn)=>{if(name==='submit')submit=fn;if(name==='reset')resetHandler=fn;},reset(){reset++;resetHandler?.({preventDefault(){}});}};
  const trackForm={addEventListener:(name,fn)=>{if(name==='submit')track=fn;}};
  const document={querySelector:s=>({'#shipment-form':form,'#shipment-message':message,'#tracking-form':tracking?trackForm:null,'#tracking-message':trackingMessage,'#tracking-result':tracking?result:null,'#customer-dashboard':dashboard?{}:null}[s]||null),querySelectorAll:()=>[]};
  const context={document,Intl,Date,TypeError,URLSearchParams,AbortController,location:{search:''},setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},
    FormData:class{*[Symbol.iterator](){yield*Object.entries(fields);}get(){return shipment.id;}},
    fetch:async(url,options={})=>{
      if(url==='/api/auth/me')return new Response(JSON.stringify({user:{id:'customer',name:'Customer'}}));
      if(url==='/api/shipments' && options.method==='POST'){calls++;keys.push(options.headers['Idempotency-Key']);return response(options);}
      if(url==='/api/shipments')return new Response('[]');
      return new Response(JSON.stringify({error:'Not found'}),{status:404});
    },
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    localStorage:{getItem(){reads++;return JSON.stringify([shipment]);},setItem(){writes++;}},crypto:{randomUUID:()=> '11111111-1111-4111-8111-'+String(++uuidCount).padStart(12,'0'),getRandomValues(){generated++;throw new Error('No client IDs allowed');}},
    SwiftUI:{account(){},dashboard(user,items){history=items;},denied(){},tracking(){rendered++;return 'tracked';}}
  };
  vm.runInNewContext(script,context);
  return {message,result,trackingMessage,button,submit:()=>submit({preventDefault(){},currentTarget:form}),track:()=>track({preventDefault(){},currentTarget:trackForm}),timeout:()=>timer(),resetForm:()=>form.reset(),stats:()=>({reset,writes,reads,generated,calls,rendered,history,keys,storage})};
}
function untouched(h){const s=h.stats();assert.equal(s.reset,0,'Keep entered data');assert.equal(s.writes,0);assert.equal(s.reads,0);assert.equal(s.generated,0);assert.equal(h.button.disabled,false);assert.doesNotMatch(h.message.innerHTML,/Shipment created\.|<strong>SWF-/);assert.doesNotMatch(h.message.innerHTML,/PRIVATE|SQL|token-secret|stack/);}
test('201 uses the persisted backend tracking ID and resets only after confirmation',async()=>{
  const h=harness(()=>new Response(JSON.stringify(shipment),{status:201}));await h.submit();
  assert.match(h.message.innerHTML,/SWF-AB12CD34/);assert.match(h.message.innerHTML,/Shipment created\./);assert.equal(h.stats().reset,1);assert.equal(h.stats().writes,0);assert.equal(h.stats().generated,0);
});
for(const status of [401,403,400,422,500,503])test(`${status} never creates a local shipment or exposes raw backend errors`,async()=>{
  const h=harness(()=>new Response(JSON.stringify({error:'PRIVATE SQL stack token-secret'}),{status}));await h.submit();untouched(h);
  assert.match(h.message.innerHTML,status===401||status===403?/href="\/login"/:status===400||status===422?/Check all required/:/Check your shipment history/);
});
test('network failure preserves form and directs reconciliation before retry',async()=>{
  const h=harness(()=>Promise.reject(new TypeError('PRIVATE connection details')));await h.submit();untouched(h);assert.match(h.message.innerHTML,/connection was interrupted/);assert.match(h.message.innerHTML,/before retrying/);
});
test('abort/timeout is uncertain, never success',async()=>{
  const h=harness(options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('PRIVATE timeout')))));
  const pending=h.submit();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.button.disabled,true);h.timeout();await pending;untouched(h);assert.match(h.message.innerHTML,/timed out/);
});
for(const [name,status,body]of [
  ['malformed JSON',201,'{'],['empty response',204,null],['unconfirmed 200',200,JSON.stringify(shipment)],['accepted 202',202,JSON.stringify(shipment)],
  ['null payload',201,'null'],['missing persisted fields',201,'{"id":"SWF-AB12CD34"}'],['missing initial event',201,JSON.stringify({...shipment,events:[]})],
  ['unsafe ID',201,JSON.stringify({...shipment,id:'<script>PRIVATE</script>'})],['invalid timestamp',201,JSON.stringify({...shipment,createdAt:'invalid'})]
])test(`${name} cannot produce booking success`,async()=>{const h=harness(()=>new Response(body,{status}));await h.submit();untouched(h);});
test('pending repeat submits issue only one POST; controls restore after failure',async()=>{
  let release;const h=harness(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.submit();await h.submit();await h.submit();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.stats().calls,1);assert.equal(h.button.disabled,true);
  release(new Response('{}',{status:500}));await pending;untouched(h);
});
test('explicit corrected retry after rejection can genuinely succeed',async()=>{
  let first=true;const h=harness(()=>{const response=first?new Response('{}',{status:422}):new Response(JSON.stringify(shipment),{status:201});first=false;return response;});
  await h.submit();untouched(h);await h.submit();assert.equal(h.stats().reset,1);assert.equal(h.stats().calls,2);assert.match(h.message.innerHTML,/SWF-AB12CD34/);
});
test('failed booking and stale local records never enter dashboard or tracking',async()=>{
  const h=harness(()=>new Response('{}',{status:500}),{tracking:true,dashboard:true});await h.submit();await h.track();await new Promise(resolve=>setImmediate(resolve));
  untouched(h);assert.equal(h.stats().history.length,0);assert.equal(h.stats().rendered,0);assert.equal(h.result.hidden,true);assert.match(h.trackingMessage.textContent,/could not find/);
});

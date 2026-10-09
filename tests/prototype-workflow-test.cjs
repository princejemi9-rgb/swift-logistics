const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {createServer} = require('node:net');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

const root=path.join(__dirname,'..');
let port,server,dataDirectory;
const booking={senderName:'Demo Customer',senderEmail:'demo@example.test',origin:'Lagos, Nigeria',recipientName:'Demo Recipient',recipientPhone:'08000000000',destination:'Abuja, Nigeria',contents:'Prototype documents',weight:2.5,service:'Priority'};
const adminBooking={...booking,senderName:'Operations Desk',senderEmail:'ops@example.test',recipientName:'Assigned Customer',recipientPhone:'08000000001',destination:'Kano, Nigeria',contents:'Staff-created prototype package',weight:4,service:'Express',initialStatus:'Picked up',initialProgress:20,expectedDelivery:'2026-10-05'};
const request=async(route,options={})=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,options);return {response,body:await response.json()};};
const cookie=response=>response.headers.get('set-cookie').split(';')[0];
async function portNumber(){const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const value=probe.address().port;await new Promise(resolve=>probe.close(resolve));return value;}
async function ready(){for(let i=0;i<100;i+=1){try{if((await request('/api/health')).response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Local server did not start.');}
const adminRequest=(body,key,cookieValue)=>request('/api/admin/shipments',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookieValue,'Idempotency-Key':key},body:JSON.stringify(body)});

(async()=>{
  port=await portNumber();dataDirectory=await mkdtemp(path.join(tmpdir(),'swift-prototype-'));
  server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataDirectory,SUPABASE_URL:'',SUPABASE_ANON_KEY:''}});await ready();
  let result=await request('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Demo Customer',email:booking.senderEmail,password:'prototype-password'})});
  assert.equal(result.response.status,201);const staffCookie=cookie(result.response);
  result=await request('/api/shipments',{method:'POST',headers:{'Content-Type':'application/json',Cookie:staffCookie,'Idempotency-Key':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},body:JSON.stringify(booking)});
  assert.equal(result.response.status,201);const customerShipment=result.body.id;assert.match(customerShipment,/^SWF-[A-Z0-9]{8}$/);
  result=await request('/api/support-tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Demo Customer',email:booking.senderEmail,topic:'Prototype question',message:'Please check this demonstration shipment.'})});assert.equal(result.response.status,201);const ticketId=result.body.id;
  result=await request('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Assigned Customer',email:'assigned@example.test',password:'prototype-password'})});
  assert.equal(result.response.status,201);const assignedCookie=cookie(result.response),assignedId=result.body.user.id;
  result=await adminRequest({...adminBooking,ownerId:assignedId},'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',assignedCookie);assert.equal(result.response.status,403,'normal customer cannot create staff shipments');
  const db=new DatabaseSync(path.join(dataDirectory,'swift-logistics.db'));db.prepare("UPDATE users SET role='staff' WHERE email=?").run(booking.senderEmail);db.close();
  result=await request('/api/customers',{headers:{Cookie:staffCookie}});assert.equal(result.response.status,200);assert.equal(result.body.some(customer=>customer.email==='assigned@example.test'),true);
  result=await adminRequest({...adminBooking,ownerId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},'cccccccc-cccc-4ccc-8ccc-cccccccccccc',staffCookie);assert.equal(result.response.status,422,'invalid customer is rejected');
  const assignedPayload={...adminBooking,ownerId:assignedId};
  result=await adminRequest(assignedPayload,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',staffCookie);assert.equal(result.response.status,201);const assignedShipment=result.body.id;assert.match(assignedShipment,/^SWF-[A-Z0-9]{8}$/);assert.notEqual(assignedShipment,customerShipment);assert.equal(result.body.status,'Picked up');assert.equal(result.body.progress,20);
  result=await adminRequest(assignedPayload,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',staffCookie);assert.equal(result.response.status,201);assert.equal(result.body.id,assignedShipment);assert.equal(result.response.headers.get('idempotency-replayed'),'true');
  result=await adminRequest({...assignedPayload,destination:'Ibadan, Nigeria'},'dddddddd-dddd-4ddd-8ddd-dddddddddddd',staffCookie);assert.equal(result.response.status,409,'staff idempotency key rejects a changed request');
  result=await request('/api/shipments',{headers:{Cookie:assignedCookie}});assert.equal(result.response.status,200);assert.equal(result.body.length,1);assert.equal(result.body[0].id,assignedShipment,'assigned shipment appears in customer history');
  result=await request(`/api/shipments/${assignedShipment}`);assert.equal(result.response.status,200);assert.equal(result.body.status,'Picked up');assert.equal(result.body.events[0].title,'Picked up','public tracking includes staff-created initial event');
  result=await adminRequest({...adminBooking,ownerId:null,recipientName:'Public Recipient'},'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',staffCookie);assert.equal(result.response.status,201);const publicShipment=result.body.id;
  result=await request('/api/shipments',{headers:{Cookie:assignedCookie}});assert.equal(result.body.some(item=>item.id===publicShipment),false,'unassigned shipment is not fabricated into customer history');
  result=await request(`/api/shipments/${publicShipment}`);assert.equal(result.response.status,200,'unassigned shipment is publicly trackable');
  const beforeFailure=new DatabaseSync(path.join(dataDirectory,'swift-logistics.db'));const countBefore=beforeFailure.prepare('SELECT COUNT(*) AS count FROM shipments').get().count;beforeFailure.exec("CREATE TRIGGER fail_admin_event BEFORE INSERT ON shipment_events WHEN NEW.detail='Created in the operations console.' BEGIN SELECT RAISE(FAIL, 'event failure'); END;");beforeFailure.close();
  result=await adminRequest({...adminBooking,ownerId:null,recipientName:'Atomic Failure'},'ffffffff-ffff-4fff-8fff-ffffffffffff',staffCookie);assert.equal(result.response.status,503,'event failure rejects the booking');
  const afterFailure=new DatabaseSync(path.join(dataDirectory,'swift-logistics.db'));assert.equal(afterFailure.prepare('SELECT COUNT(*) AS count FROM shipments').get().count,countBefore,'failed staff booking leaves no shipment record');afterFailure.exec('DROP TRIGGER fail_admin_event');afterFailure.close();
  result=await request(`/api/shipments/${assignedShipment}/status`,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:staffCookie},body:JSON.stringify({status:'In transit',detail:'Arrived at Abuja facility',progress:55,country:'Nigeria',state:'FCT',city:'Abuja',expectedDelivery:'2026-10-06'})});assert.equal(result.response.status,200);
  result=await request('/api/support-tickets',{headers:{Cookie:staffCookie}});assert.equal(result.response.status,200);assert.equal(result.body.some(ticket=>ticket.id===ticketId),true);
  result=await request(`/api/support-tickets/${ticketId}`,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:staffCookie},body:JSON.stringify({status:'Resolved'})});assert.equal(result.response.status,200);
  result=await request('/api/shipments',{headers:{Cookie:assignedCookie}});assert.equal(result.body[0].status,'In transit');assert.equal(result.body[0].currentCity,'Abuja');assert.equal(result.body[0].progress,55);assert.equal(result.body[0].expectedDelivery,'2026-10-06');
  result=await request(`/api/shipments/${assignedShipment}`);assert.equal(result.body.status,'In transit');assert.equal(result.body.currentCity,'Abuja');assert.equal(result.body.events[0].title,'In transit');
  const dbAfter=new DatabaseSync(path.join(dataDirectory,'swift-logistics.db'));dbAfter.prepare("UPDATE users SET role='customer' WHERE email=?").run(booking.senderEmail);dbAfter.close();
  result=await request('/api/customers',{headers:{Cookie:staffCookie}});assert.equal(result.response.status,403,'demoted account loses staff controls');
  console.log('Prototype workflow passed: customer booking, staff-created assigned/unassigned shipments, idempotency, atomic failure rollback, tracking updates, and staff authorization.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(server&&server.exitCode===null){server.kill();await once(server,'exit');}if(dataDirectory)await rm(dataDirectory,{recursive:true,force:true});});

const {validKey,normalizeBooking,normalizeAdminBooking} = require('../booking');
const { randomUUID } = require('node:crypto');

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.replace(/\/$/, '');
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const resendKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM_EMAIL || 'Swift Logistics <onboarding@resend.dev>';
const cookieName = 'swift_session';
const send = (res, status, body, headers = {}) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value)); res.end(JSON.stringify(body)); };
const read = req => new Promise((resolve, reject) => { let value=''; req.on('data', chunk => { value += chunk; if(value.length>100000) reject(new Error('Request body too large')); }); req.on('end', () => { try { resolve(value ? JSON.parse(value) : {}); } catch { reject(new Error('Send valid JSON.')); } }); });
const text = value => typeof value === 'string' && value.trim().length > 0;
const clean = value => String(value ?? '').trim();
const token = req => (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
async function request(path, options = {}, accessToken = key) { const response = await fetch(`${url}${path}`, { ...options, headers: { apikey:key, Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json', ...(options.headers || {}) } }); const body = await response.json().catch(() => null); if(!response.ok) { const error = new Error(body?.message || body?.msg || body?.error_description || body?.error || `Supabase request failed (${response.status}).`); error.code = body?.code; error.status = response.status; throw error; } return body; }
async function user(req) { const accessToken = token(req); if(!accessToken) return null; try { const account = await request('/auth/v1/user', {}, accessToken); const profiles = await request(`/rest/v1/profiles?id=eq.${account.id}&select=id,name,role`, {}, accessToken); return { ...account, profile:profiles[0], token:accessToken }; } catch { return null; } }
const safe = shipment => { const { sender_email, recipient_phone, shipment_events, ...rest } = shipment; return { id:rest.id, senderName:rest.sender_name, origin:rest.origin, recipientName:rest.recipient_name, destination:rest.destination, contents:rest.contents, weight:rest.weight, service:rest.service, status:rest.status, currentCountry:rest.current_country, currentState:rest.current_state, currentCity:rest.current_city, progress:rest.progress || 0, expectedDelivery:rest.expected_delivery, createdAt:rest.created_at, events:(shipment_events || []).map(event => ({ title:event.title, detail:event.detail, time:event.created_at })) }; };
const escapeEmail = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
async function emailShipment(to, subject, heading, lines) { if (!resendKey || !text(to)) return; const content = lines.map(line => `<p style="margin:0 0 12px">${escapeEmail(line)}</p>`).join(''); try { await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${resendKey}`, 'Content-Type':'application/json' }, body:JSON.stringify({ from:resendFrom, to:[clean(to)], subject, html:`<div style="max-width:560px;margin:auto;padding:32px;font-family:Arial,sans-serif;color:#112238"><p style="color:#ee6d22;font-weight:700;letter-spacing:1px">SWIFT LOGISTICS</p><h1 style="font-size:24px">${escapeEmail(heading)}</h1>${content}<p style="margin-top:24px;color:#607087;font-size:13px">Track your delivery at ${escapeEmail((process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://swift-logistics-alpha.vercel.app'))}/track</p></div>` }) }); } catch { /* Notification delivery must not prevent shipment operations. */ } }

module.exports = async (req, res) => {
  if (!url || !key) return send(res, 500, { error:'Supabase environment variables are not configured.' });
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { status:'ok', database:'supabase' });
    if (req.method === 'GET' && path === '/api/auth/me') { const account = await user(req); return send(res, 200, { user:account?.profile ? { id:account.id, name:account.profile.name, email:account.email, role:account.profile.role } : null }); }
    if (req.method === 'GET' && path === '/api/customers') { const account=await user(req); if(account?.profile?.role!=='staff') return send(res,403,{error:'Staff access is required.'}); const records=await request('/rest/v1/profiles?role=eq.customer&select=id,name,created_at,shipments(count)&order=created_at.desc',{},account.token); return send(res,200,records.map(record=>({id:record.id,name:record.name,createdAt:record.created_at,shipmentCount:Number(record.shipments?.[0]?.count || 0)}))); }
    if (req.method === 'POST' && path === '/api/auth/register') {
      const body=await read(req);
      if(!text(body.name)||!/^\S+@\S+\.\S+$/.test(clean(body.email))||String(body.password || '').length<8) return send(res,422,{error:'Enter your name, a valid email, and a password of at least 8 characters.'});
      const account=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email:clean(body.email),password:body.password,data:{name:clean(body.name)}})});
      // A session is issued only when Supabase Email/Confirm email is disabled.
      // Never synthesize a session or bypass the Supabase password flow.
      if(!account.access_token) return send(res,account.user?.identities?.length===0?409:503,{error:account.user?.identities?.length===0?'An account with that email already exists. Sign in instead.':'Registration could not start a secure session. Confirm email must be disabled in Supabase Authentication settings.'});
      const profiles=await request(`/rest/v1/profiles?id=eq.${account.user.id}&select=id,name,role`,{},account.access_token);
      const profile=profiles[0];
      // The Auth trigger is the sole profile creator; registration never accepts a role.
      if(!profile || profile.role!=='customer') return send(res,503,{error:'Your customer profile could not be initialized securely. Please try again.'});
      return send(res,201,{user:{id:account.user.id,name:profile.name,email:account.user.email,role:'customer'}},{'Set-Cookie':`${cookieName}=${account.access_token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`});
    }
    if (req.method === 'POST' && path === '/api/auth/login') {
      const body=await read(req), account=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:clean(body.email),password:body.password})});
      const profiles=await request(`/rest/v1/profiles?id=eq.${account.user.id}&select=id,name,role`,{},account.access_token), profile=profiles[0];
      if(!profile || !['customer','staff'].includes(profile.role)) return send(res,503,{error:'Your account profile is unavailable. Please try again.'});
      return send(res,200,{user:{id:account.user.id,name:profile.name,email:account.user.email,role:profile.role}},{'Set-Cookie':`${cookieName}=${account.access_token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${account.expires_in}`});
    }
    if (req.method === 'POST' && path === '/api/auth/forgot-password') { const body=await read(req); if(!/^\S+@\S+\.\S+$/.test(clean(body.email))) return send(res,422,{error:'Enter a valid email address.'}); await request('/auth/v1/recover',{method:'POST',body:JSON.stringify({email:clean(body.email),redirect_to:`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/reset-password`})}); return send(res,200,{message:'If that email has an account, a reset link has been sent.'}); }
    if (req.method === 'POST' && path === '/api/auth/reset-password') { const body=await read(req); if(String(body.password || '').length<8 || !text(body.accessToken)) return send(res,422,{error:'Use a valid recovery link and a password of at least 8 characters.'}); await request('/auth/v1/user',{method:'PUT',body:JSON.stringify({password:body.password})},clean(body.accessToken)); return send(res,200,{message:'Your password has been updated. You can now sign in.'}); }
    if (req.method === 'POST' && path === '/api/auth/logout') return send(res,200,{ok:true},{'Set-Cookie':`${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`});
    if (req.method === 'GET' && path === '/api/shipments') { const account=await user(req); if(!account?.profile) return send(res,401,{error:'Sign in to view your shipment history.'}); const records=await request('/rest/v1/shipments?select=*,shipment_events(*)&order=created_at.desc',{},account.token); return send(res,200,records.map(safe)); }
    if (req.method === 'GET' && path.startsWith('/api/shipments/')) { const id=decodeURIComponent(path.split('/').pop()).toUpperCase(); const records=await request('/rest/v1/rpc/track_shipment',{method:'POST',body:JSON.stringify({tracking_number:id})}); if(!records[0]) return send(res,404,{error:'Shipment not found.'}); const record=records[0]; return send(res,200,{id:record.id,origin:record.origin,destination:record.destination,service:record.service,status:record.status,currentCountry:record.current_country,currentState:record.current_state,currentCity:record.current_city,progress:record.progress,expectedDelivery:record.expected_delivery,createdAt:record.created_at,events:record.events || []}); }
    if (req.method === 'POST' && path === '/api/shipments') {
      const account = await user(req);
      if (!account?.profile) return send(res, 401, {error:'Sign in to create a shipment.'});
      let body;
      try { body = await read(req); }
      catch { return send(res, 400, {error:'Send valid shipment details.'}); }
      const bookingKey = req.headers['idempotency-key'];
      if (!validKey(bookingKey)) return send(res,400,{error:'A valid Idempotency-Key UUID header is required.'});
      const payload = normalizeBooking(body);
      if (!payload) return send(res,422,{error:'Complete all shipment fields with a valid weight and service.'});
      let record;
      try {
        record = await request('/rest/v1/rpc/book_shipment', {method:'POST', body:JSON.stringify({p_idempotency_key:bookingKey.toLowerCase(),p_shipment:payload})}, account.token);
      } catch (error) {
        if (error.code === '28000' || error.status === 401) return send(res, 401, {error:'Sign in to create a shipment.'});
        if (error.code === '42501') return send(res, 403, {error:'Your account is not permitted to create this shipment.'});
        if (error.code === 'PT409') return send(res,409,{error:'This booking key cannot be reused for these shipment details. Check your original booking.'});
        if (error.code === '22023') return send(res, 422, {error:'Check your shipment details, weight and service.'});
        return send(res, 503, {error:'Shipment creation could not be confirmed. Check your shipment history before trying again.'});
      }
      if (!record || Array.isArray(record) || typeof record !== 'object' || typeof record.replayed !== 'boolean' || !record.shipment || Array.isArray(record.shipment)) {
        return send(res, 503, {error:'Shipment creation could not be confirmed. Check your shipment history before trying again.'});
      }
      const replayed = record.replayed;
      record = record.shipment;
      if (!record.id || !record.created_at || !Array.isArray(record.shipment_events)) {
        return send(res, 503, {error:'Shipment creation could not be confirmed. Check your shipment history before trying again.'});
      }
      if (!replayed) await emailShipment(record.sender_email, 'Your Swift Logistics tracking number: ' + record.id, 'Your shipment is booked', ['Tracking number: ' + record.id, 'Route: ' + record.origin + ' to ' + record.destination, 'Service: ' + record.service, 'Keep this tracking number to follow every delivery update.']);
      return send(res, 201, safe(record), {'Idempotency-Replayed':String(replayed)});
    }
    if (req.method === 'POST' && path === '/api/admin/shipments') {
      const account = await user(req);
      if (account?.profile?.role !== 'staff') return send(res,403,{error:'Staff access is required.'});
      let body;
      try { body = await read(req); }
      catch { return send(res,400,{error:'Send valid shipment details.'}); }
      const bookingKey=req.headers['idempotency-key'];
      if (!validKey(bookingKey)) return send(res,400,{error:'A valid Idempotency-Key UUID header is required.'});
      const requestBody=normalizeAdminBooking(body);
      if (!requestBody) return send(res,422,{error:'Complete all shipment fields, choose a valid status and progress, and use a valid customer selection.'});
      let record;
      try {
        record=await request('/rest/v1/rpc/admin_book_shipment',{method:'POST',body:JSON.stringify({p_idempotency_key:bookingKey.toLowerCase(),p_owner_id:requestBody.ownerId,p_shipment:requestBody.payload})},account.token);
      } catch (error) {
        if (error.code === '42501') return send(res,403,{error:'Staff access is required.'});
        if (error.code === 'PT409') return send(res,409,{error:'This admin booking key cannot be reused for different shipment details.'});
        if (error.code === '22023') return send(res,422,{error:'Select an existing customer account and check the shipment details.'});
        return send(res,503,{error:'The staff shipment could not be confirmed. Retry with the same booking key.'});
      }
      if (!record || Array.isArray(record) || typeof record !== 'object' || typeof record.replayed !== 'boolean' || !record.shipment || Array.isArray(record.shipment) || !record.shipment.id || !Array.isArray(record.shipment.shipment_events)) return send(res,503,{error:'The staff shipment could not be confirmed. Retry with the same booking key.'});
      return send(res,201,safe(record.shipment),{'Idempotency-Replayed':String(record.replayed)});
    }
    if (req.method === 'PUT' && /^\/api\/shipments\/[^/]+\/status$/.test(path)) { const account=await user(req), body=await read(req), id=decodeURIComponent(path.split('/')[3]).toUpperCase(), progress=Number(body.progress); if(account?.profile?.role!=='staff') return send(res,403,{error:'Staff access is required.'}); if(!text(body.status)||!text(body.detail)||!Number.isInteger(progress)||progress<0||progress>100) return send(res,422,{error:'Provide a status, detail, and progress from 0 to 100.'}); const location=[clean(body.city),clean(body.state),clean(body.country)].filter(Boolean).join(', '); const records=await request(`/rest/v1/shipments?id=eq.${id}&select=sender_email,origin,destination`,{},account.token); await request(`/rest/v1/shipments?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:clean(body.status),current_country:clean(body.country)||null,current_state:clean(body.state)||null,current_city:clean(body.city)||null,progress,expected_delivery:clean(body.expectedDelivery)||null})},account.token); await request('/rest/v1/shipment_events',{method:'POST',body:JSON.stringify({shipment_id:id,title:clean(body.status),detail:`${clean(body.detail)}${location?` — ${location}`:''}`})},account.token); const shipment=records[0]; await emailShipment(shipment?.sender_email, `Shipment update: ${id} is ${clean(body.status)}`, 'Your shipment has a new update', [`Tracking number: ${id}`, `Status: ${clean(body.status)}`, clean(body.detail), location ? `Current location: ${location}` : `Route: ${shipment?.origin || ''} to ${shipment?.destination || ''}`]); return send(res,200,{id,status:clean(body.status)}); }
    if (req.method === 'POST' && path === '/api/support-tickets') { const account=await user(req), body=await read(req); if(['name','email','topic','message'].some(field=>!text(body[field]))) return send(res,422,{error:'Complete your name, email, topic, and message.'}); const id=`SUP-${randomUUID().replaceAll('-','').slice(0,8).toUpperCase()}`; await request('/rest/v1/support_tickets',{method:'POST',body:JSON.stringify({id,user_id:account?.id || null,name:clean(body.name),email:clean(body.email),topic:clean(body.topic),message:clean(body.message)})},account?.token || key); return send(res,201,{id,status:'Open'}); }
    if (req.method === 'GET' && path === '/api/support-tickets') { const account=await user(req); if(account?.profile?.role!=='staff') return send(res,403,{error:'Staff access is required.'}); return send(res,200,await request('/rest/v1/support_tickets?select=*&order=created_at.desc',{},account.token)); }
    if (req.method === 'PUT' && /^\/api\/support-tickets\/[^/]+$/.test(path)) { const account=await user(req), body=await read(req), id=decodeURIComponent(path.split('/').pop()).toUpperCase(); if(account?.profile?.role!=='staff') return send(res,403,{error:'Staff access is required.'}); if(!['Open','In progress','Resolved'].includes(body.status)) return send(res,422,{error:'Select a valid ticket status.'}); await request(`/rest/v1/support_tickets?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({status:body.status})},account.token); return send(res,200,{id,status:body.status}); }
    return send(res,404,{error:'Route not found.'});
  } catch(error) { return send(res,400,{error:error.message || 'Request failed.'}); }
};

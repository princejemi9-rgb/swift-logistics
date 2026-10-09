(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const apiRequest = async (path, options) => { const response = await fetch(path, options); const body = await response.json(); if (!response.ok) { const error = new Error(body.error || 'The service is unavailable.'); error.status = response.status; throw error; } return body; };

  const accountPromise = apiRequest('/api/auth/me');
  accountPromise.then(({user}) => SwiftUI.account(user, () => apiRequest('/api/auth/logout', {method:'POST'}))).catch(() => {});

  document.querySelector('.nav-toggle')?.addEventListener('click', event => { const menu = document.querySelector('.menu'); const open = menu.classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); });
  document.querySelector('#quote-form')?.addEventListener('submit', event => { event.preventDefault(); const data = new FormData(event.currentTarget); const weight = Number(data.get('weight')); const multiplier = { document: .8, parcel: 1, freight: 2.15 }[data.get('packageType')]; const services = [['Economy', 6, 18], ['Priority', 3, 30], ['Express', 1, 48]]; const result = document.querySelector('#quote-results'); result.hidden = false; result.innerHTML = `<div class="result-heading"><p class="eyebrow">Estimated options</p><h2>From ${escapeHtml(data.get('origin'))} to ${escapeHtml(data.get('destination'))}</h2></div><div class="quote-cards">${services.map(([name, days, base], index) => `<article class="quote-card ${index === 1 ? 'featured' : ''}"><h3>${name}</h3><p class="quote-price">${money.format((base + weight * 7.5) * multiplier)}</p><small>Estimated delivery in ${days} business day${days > 1 ? 's' : ''}</small></article>`).join('')}</div>`; result.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });

  // Only persisted backend responses can supply a shipment or tracking number.
  const validShipment = value => value && !Array.isArray(value) &&
    typeof value.id === 'string' && /^SWF-[A-Z0-9]{8}$/.test(value.id) &&
    ['origin','destination','service','status','createdAt'].every(key => typeof value[key] === 'string' && value[key].trim()) &&
    Number.isFinite(Date.parse(value.createdAt)) && Array.isArray(value.events) &&
    value.events.every(event => event && typeof event.title === 'string' && typeof event.detail === 'string' && typeof event.time === 'string' && Number.isFinite(Date.parse(event.time)));
  let bookingPending = false;
  // Retry metadata only: no shipment, tracking ID or form contents are stored.
  const attemptStorage = 'swift-booking-attempt-v1';
  let bookingAttempt = null;
  const clearBookingAttempt = () => {
    sessionStorage.removeItem(attemptStorage);
    bookingAttempt = null;
  };
  const newBookingKey = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // Safe compatibility fallback for browsers without crypto.randomUUID().
    // A booking is blocked rather than using a predictable identifier.
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') throw new Error('Secure booking IDs are not supported by this browser.');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  document.querySelector('#shipment-form')?.addEventListener('reset', event => {
    if (bookingPending) { event.preventDefault(); return; }
    clearBookingAttempt();
  });
  document.querySelector('#shipment-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (bookingPending) return;
    bookingPending = true;
    const form = event.currentTarget, message = document.querySelector('#shipment-message');
    const button = form.querySelector('button[type="submit"]');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    button.disabled = true; button.textContent = 'Creating shipment?'; message.textContent = '';
    try {
      const {user} = await Promise.race([accountPromise,new Promise((resolve,reject) => controller.signal.addEventListener('abort', () => reject(new Error('Account check timed out')), {once:true}))]);
      const owner = user?.id || 'signed-out';
      if (!bookingAttempt) {
        try { bookingAttempt = JSON.parse(sessionStorage.getItem(attemptStorage) || 'null'); }
        catch { bookingAttempt = null; }
      }
      if (!bookingAttempt || bookingAttempt.owner !== owner || typeof bookingAttempt.key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingAttempt.key)) {
        bookingAttempt = {owner,key:newBookingKey()};
      }
      // Persist before sending. If storage is unavailable, fail without a POST.
      sessionStorage.setItem(attemptStorage,JSON.stringify(bookingAttempt));
      const response = await fetch('/api/shipments', {
        method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':bookingAttempt.key},
        body:JSON.stringify(Object.fromEntries(new FormData(form))), signal:controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        message.innerHTML = 'Sign in with an authorized account to create a shipment. <a href="/login">Sign in</a>.';
        return;
      }
      if (response.status === 400 || response.status === 422) {
        message.textContent = 'Shipment not created. Check all required sender, recipient and address fields, package weight and shipping service, then try again. Your entries have been kept.';
        return;
      }
      if (response.status === 409) {
        message.innerHTML = 'This booking attempt is already associated with different details or an unavailable shipment. <a href="/history#shipments">Check your shipment history</a>. Restore the original details to retry, or deliberately start a new booking. <button type="button" class="button button-secondary" id="new-booking-attempt">Start a new booking</button>';
        document.querySelector('#new-booking-attempt')?.addEventListener('click', () => {
          if (confirm('A new booking uses a new key and can create another shipment. Have you checked your history?')) {
            form.reset(); message.textContent = 'New booking started. Enter your shipment details.';
          }
        });
        return;
      }
      if (response.status !== 201) throw new Error('Booking not confirmed');
      const shipment = await response.json();
      if (!validShipment(shipment) || shipment.events.length === 0) throw new Error('Unexpected booking response');
      message.innerHTML = 'Shipment created. Your tracking number is <strong>' + escapeHtml(shipment.id) + '</strong>. <a href="/track?number=' + encodeURIComponent(shipment.id) + '">Track it now</a>.';
      clearBookingAttempt();
      bookingPending = false;
      form.reset();
    } catch (error) {
      const reason = controller.signal.aborted ? 'The request timed out.' : error instanceof TypeError ? 'The connection was interrupted.' : 'The shipment could not be confirmed.';
      message.innerHTML = reason + ' The booking may have reached us, but this page did not receive a confirmed result. Your entries have been kept. <a href="/history#shipments">Check your shipment history</a> before retrying. Retrying unchanged details uses the same booking key, so it will return the original shipment instead of creating another one. Do not start a new booking for an uncertain request. You can also <a href="/contact">contact support</a>.';
    } finally {
      clearTimeout(timeout); bookingPending = false;
      button.disabled = false; button.textContent = 'Create shipment';
    }
  });

  const trackingForm = document.querySelector('#tracking-form');
  const renderTracking = shipment => { const result = document.querySelector('#tracking-result'); const html = SwiftUI.tracking(shipment); result.innerHTML = html; result.hidden = false; };
  const showTracking = async number => {
    const result = document.querySelector('#tracking-result'), message = document.querySelector('#tracking-message');
    const id = number.trim().toUpperCase();
    if (!result) { location.assign('/track?number=' + encodeURIComponent(id)); return; }
    message.textContent = 'Looking up shipment?'; result.hidden = true; result.innerHTML = '';
    try {
      const shipment = await apiRequest('/api/shipments/' + encodeURIComponent(id));
      if (!validShipment(shipment) || shipment.id !== id) throw new Error('Unexpected tracking response');
      renderTracking(shipment); message.textContent = '';
    } catch (error) {
      message.textContent = error.status === 404 ? 'We could not find that tracking number. Check it and try again.' : 'Tracking could not be retrieved. Check your connection and try again, or contact support.';
    }
  };
  trackingForm?.addEventListener('submit', event => { event.preventDefault(); showTracking(new FormData(event.currentTarget).get('tracking')); });
  const number = new URLSearchParams(location.search).get('number'); if (number && trackingForm) { trackingForm.elements.tracking.value = number; showTracking(number); }
  const dashboard = document.querySelector('#customer-dashboard');
  if (dashboard) accountPromise.then(async ({user}) => {
    if (!user) { SwiftUI.denied(dashboard); return; }
    SwiftUI.dashboard(user, await apiRequest('/api/shipments'));
  }).catch(error => SwiftUI.denied(dashboard, error.message || 'Your shipments are temporarily unavailable. Please try again.'));
  const profileSummary = document.querySelector('#profile-summary'); if (profileSummary) Promise.all([accountPromise, apiRequest('/api/shipments')]).then(([account, shipments]) => { if (!account.user) { location.assign('/login'); return; } const user=account.user, initials=user.name.split(' ').map(part=>part[0]).join('').slice(0,2).toUpperCase(); const delivered=shipments.filter(shipment=>shipment.status==='Delivered').length; profileSummary.innerHTML=`<article class="panel profile-card"><div class="profile-avatar">${escapeHtml(initials)}</div><h2>${escapeHtml(user.name)}</h2><p class="profile-meta">${escapeHtml(user.email)}</p><div class="profile-detail"><span>Account type</span><strong>${escapeHtml(user.role === 'staff' ? 'Operations staff' : 'Customer')}</strong></div><div class="profile-detail"><span>Member area</span><strong>Shipment management</strong></div><a class="button button-primary" href="/ship">Create a shipment</a></article><aside class="profile-stats"><article class="panel profile-stat"><strong>${shipments.length}</strong><span>Total shipments</span></article><article class="panel profile-stat"><strong>${delivered}</strong><span>Delivered shipments</span></article><article class="panel profile-stat"><strong>${shipments.filter(shipment=>shipment.status!=='Delivered').length}</strong><span>Active shipments</span></article></aside>`; }).catch(error => { profileSummary.innerHTML=`<article class="panel"><h2>Profile unavailable</h2><p>${escapeHtml(error.message || 'Please sign in again to access your profile.')}</p><a class="button button-primary" href="/login">Sign in</a></article>`; });
  const adminList = document.querySelector('#admin-list'); if (adminList) accountPromise.then(({user}) => { if (user?.role !== 'staff') { document.querySelector('.operations-toolbar').hidden = true; throw new Error('Staff access is required. Sign in with a staff account to use operations.'); } return apiRequest('/api/shipments'); }).then(shipments => { const message = document.querySelector('#admin-message'); message.textContent = shipments.length ? `${shipments.length} shipment${shipments.length === 1 ? '' : 's'} available.` : 'No shipments are currently available.'; adminList.innerHTML = shipments.map(shipment => `<article class="panel"><h2>${escapeHtml(shipment.id)}</h2><p>${escapeHtml(shipment.origin)} &rarr; ${escapeHtml(shipment.destination)} · ${escapeHtml(shipment.recipientName)}</p><p><span class="status">${escapeHtml(shipment.status)}</span></p><form class="status-form" data-shipment-id="${escapeHtml(shipment.id)}"><div class="form-row"><label>New status<select name="status">${[...new Set([shipment.status, "Picked up", "In transit", "At delivery facility", "Out for delivery", "Delivered", "Delivery exception"])].map(value => `<option ${value === shipment.status ? "selected" : ""}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Progress (%)<input name="progress" type="number" min="0" max="100" required value="${Number(shipment.progress || 0)}"></label></div><div class="form-row"><label>Country<input name="country" value="${escapeHtml(shipment.currentCountry || '')}" placeholder="Nigeria"></label><label>State / region<input name="state" value="${escapeHtml(shipment.currentState || '')}" placeholder="Lagos"></label><label>City / facility<input name="city" value="${escapeHtml(shipment.currentCity || '')}" placeholder="Ikeja"></label></div><label>Expected delivery<input name="expectedDelivery" type="date" value="${escapeHtml(shipment.expectedDelivery || '')}"></label><label>Update detail<input name="detail" required placeholder="e.g. Arrived at Abuja facility"></label><button class="button button-primary" type="submit">Save tracking update</button></form></article>`).join(''); }).catch(error => { document.querySelector('#admin-message').textContent = error.message || 'Sign in with a staff account to use operations.'; });
  adminList?.addEventListener('submit', async event => { if (!event.target.matches('.status-form')) return; event.preventDefault(); const form = event.target, button = form.querySelector('button'), message = document.querySelector('#admin-message'); button.disabled = true; try { const shipment = await apiRequest(`/api/shipments/${encodeURIComponent(form.dataset.shipmentId)}/status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) }); message.textContent = `${shipment.id} updated to ${shipment.status}.`; location.reload(); } catch(error) { message.textContent = error.message || 'Unable to save update.'; button.disabled = false; } });
  const ticketList = document.querySelector('#ticket-list'); if (ticketList) accountPromise.then(({user}) => { if (user?.role !== 'staff') throw new Error('Staff access is required.'); return apiRequest('/api/support-tickets'); }).then(tickets => { const message = document.querySelector('#ticket-message'); message.textContent = tickets.length ? `${tickets.length} support ticket${tickets.length === 1 ? '' : 's'} in the queue.` : 'No support tickets.'; ticketList.innerHTML = tickets.map(ticket => `<article class="panel"><h2>${escapeHtml(ticket.id)} · ${escapeHtml(ticket.topic)}</h2><p><strong>${escapeHtml(ticket.name)}</strong> (${escapeHtml(ticket.email)})</p><p>${escapeHtml(ticket.message)}</p><form class="ticket-form" data-ticket-id="${escapeHtml(ticket.id)}"><label>Ticket status<select name="status"><option ${ticket.status === 'Open' ? 'selected' : ''}>Open</option><option ${ticket.status === 'In progress' ? 'selected' : ''}>In progress</option><option ${ticket.status === 'Resolved' ? 'selected' : ''}>Resolved</option></select></label><button class="button button-primary" type="submit">Update ticket</button></form></article>`).join(''); }).catch(error => { document.querySelector('#ticket-message').textContent = error.message || 'Support queue unavailable.'; });
  ticketList?.addEventListener('submit', async event => { if (!event.target.matches('.ticket-form')) return; event.preventDefault(); const form = event.target, button = form.querySelector('button'), message = document.querySelector('#ticket-message'); button.disabled = true; try { const ticket = await apiRequest(`/api/support-tickets/${encodeURIComponent(form.dataset.ticketId)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) }); message.textContent = `${ticket.id} updated to ${ticket.status}.`; location.reload(); } catch(error) { message.textContent = error.message || 'Unable to update ticket.'; button.disabled = false; } });
  document.querySelector('#support-form')?.addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const message = document.querySelector('#support-message'); const button = form.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Sending…'; try { const ticket = await apiRequest('/api/support-tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); message.textContent = `Message received. Your support reference is ${ticket.id}.`; form.reset(); } catch (error) { message.textContent = error.message || 'Unable to send your message.'; } finally { button.disabled = false; button.textContent = 'Send message'; } });
  const authForm = document.querySelector('#login-form, #register-form'); if (authForm) authForm.addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget, message = document.querySelector('#auth-message'), button = form.querySelector('button[type="submit"]'); button.disabled = true; try { const route = form.id === 'login-form' ? '/api/auth/login' : '/api/auth/register'; const result = await apiRequest(route, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) }); if (result.message && !result.user) { message.textContent = result.message; } else { location.assign('/history#overview'); } } catch (error) { message.textContent = error.message || 'Unable to continue.'; } finally { button.disabled=false; } });
  const loginMessage = document.querySelector('#login-form #auth-message'); if (loginMessage) loginMessage.insertAdjacentHTML('afterend', '<p><a href="/forgot-password">Forgot your password?</a></p>');
  document.querySelector('#forgot-password-form')?.addEventListener('submit', async event => { event.preventDefault(); const form=event.currentTarget, message=document.querySelector('#auth-message'), button=form.querySelector('button'); button.disabled=true; try { const result=await apiRequest('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); message.textContent=result.message; } catch(error) { message.textContent=error.message || 'Unable to send the reset link.'; } finally { button.disabled=false; } });
  document.querySelector('#reset-password-form')?.addEventListener('submit', async event => { event.preventDefault(); const form=event.currentTarget, message=document.querySelector('#auth-message'), data=Object.fromEntries(new FormData(form)), button=form.querySelector('button'), accessToken=new URLSearchParams(location.hash.slice(1)).get('access_token'); if(data.password!==data.confirmPassword) { message.textContent='Passwords do not match.'; return; } if(!accessToken) { message.textContent='This recovery link is missing or has expired. Request another one.'; return; } button.disabled=true; try { const result=await apiRequest('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:data.password,accessToken})}); message.textContent=result.message; setTimeout(()=>location.assign('/login'),1200); } catch(error) { message.textContent=error.message || 'Unable to update password.'; } finally { button.disabled=false; } });
  const adminShipmentForm = document.querySelector('#admin-shipment-form');
  adminShipmentForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const form=event.currentTarget, message=document.querySelector('#admin-shipment-message'), button=form.querySelector('button[type="submit"]');
    const account=await accountPromise;
    if (account.user?.role !== 'staff') { message.textContent='Staff access is required.'; return; }
    const storageKey='swift-admin-booking-attempt-v1';
    let attempt;
    try { attempt=JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { attempt=null; }
    if (!attempt || attempt.owner !== account.user.id) attempt={owner:account.user.id,key:newBookingKey()};
    sessionStorage.setItem(storageKey,JSON.stringify(attempt));
    button.disabled=true; message.textContent='Creating shipment…';
    try {
      const shipment=await apiRequest('/api/admin/shipments',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':attempt.key},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      sessionStorage.removeItem(storageKey);
      message.innerHTML=`Shipment <strong>${escapeHtml(shipment.id)}</strong> created. It is ready for staff and public tracking.`;
      form.reset();
      setTimeout(()=>location.reload(),1000);
    } catch(error) { message.textContent=error.message || 'The shipment could not be created. Retry safely.'; button.disabled=false; }
  });
  const customerList = document.querySelector('#customer-list');
  if (customerList) accountPromise.then(({user}) => {
    if (user?.role !== 'staff') throw new Error('Staff access is required.');
    return apiRequest('/api/customers');
  }).then(customers => {
    const message = document.querySelector('#customer-message');
    message.textContent = customers.length ? `${customers.length} customer${customers.length === 1 ? '' : 's'} in this prototype workspace.` : 'No customer accounts yet.';
    const ownerSelect=document.querySelector('#admin-owner-id');
    if (ownerSelect) ownerSelect.insertAdjacentHTML('beforeend',customers.map(customer=>`<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}${customer.email ? ` — ${escapeHtml(customer.email)}` : ''}</option>`).join(''));
    customerList.innerHTML = customers.length ? customers.map(customer => `<article class="customer-card"><h3>${escapeHtml(customer.name)}</h3><p>${customer.email ? escapeHtml(customer.email) : 'Customer account'}</p><small>${Number(customer.shipmentCount)} shipment${Number(customer.shipmentCount) === 1 ? '' : 's'} · Joined ${escapeHtml(new Date(customer.createdAt).toLocaleDateString())}</small></article>`).join('') : '<div class="empty-state"><h2>No customers yet</h2><p>Customer accounts will appear here after registration.</p></div>';
  }).catch(error => {
    document.querySelector('#customer-message').textContent = error.message || 'Customer directory unavailable.';
  });
})();

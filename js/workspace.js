/* Presentation helpers only: all network requests remain in app.js. */
window.SwiftUI = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => {
    if (!value) return 'Not available';
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    return Number.isNaN(parsed.getTime()) ? 'Not available' : parsed.toLocaleDateString(undefined, {day:'numeric',month:'short',year:'numeric'});
  };
  const status = value => {
    const tone = value === 'Delivered' ? 'delivered' : value === 'Delivery exception' ? 'attention' : value === 'Shipment created' ? 'created' : 'transit';
    return `<span class="status status-${tone}">${escape(value || 'Status unavailable')}</span>`;
  };
  const page = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  document.querySelectorAll('.primary-nav a').forEach(link => {
    if (link.getAttribute('href') === page) link.setAttribute('aria-current','page');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      document.querySelector('.menu')?.classList.remove('open');
      document.querySelector('.nav-toggle')?.setAttribute('aria-expanded','false');
    }
  });
  const entries = [['/history#overview','Overview','▦'],['/ship','Ship','▣'],['/track','Track','⌖'],['/history#shipments','Shipments','▤'],['/rates','Get a Quote','≋'],['/support','Support','?'],['/profile','Profile / Account','○']];
  function markSidebar() {
    const current = page === '/history' ? `/history${location.hash === '#shipments' ? '#shipments' : '#overview'}` : page;
    document.querySelectorAll('.workspace-sidebar a').forEach(link => {
      if (link.getAttribute('href') === current) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }
  function account(user, logout) {
    if (!user) return;
    const accountNav = document.querySelector('.account-nav');
    accountNav.innerHTML = `<a href="/history#overview">Dashboard</a><a class="nav-account" href="/profile" title="${escape(user.name || 'My account')}">${escape(user.name || 'My account')}</a>${user.role === 'staff' ? '<a href="/admin">Staff Operations</a>' : ''}<button class="nav-logout" type="button">Logout</button>`;
    accountNav.querySelector('.nav-logout').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await logout(); location.assign('/'); }
      catch { event.currentTarget.disabled = false; event.currentTarget.textContent = 'Retry logout'; }
    });
    if (!['/history','/ship','/track','/rates','/support','/contact','/profile','/admin'].includes(page)) return;
    const main = document.querySelector('main');
    if (main.querySelector('.workspace-sidebar')) return;
    const content = document.createElement('div'); content.className = 'workspace-content';
    content.append(...main.childNodes); main.append(content); main.classList.add('account-layout');
    const sidebar = document.createElement('aside'); sidebar.className = 'workspace-sidebar';
    const links = page === '/admin' && user.role === 'staff' ? [['/admin','Shipments','▤'],['#support-queue','Support queue','?'],['/history','Customer dashboard','▦']] : entries;
    sidebar.innerHTML = `<p>${page === '/admin' ? 'OPERATIONS CONSOLE' : 'MY WORKSPACE'}</p><nav aria-label="${page === '/admin' ? 'Staff operations' : 'Account navigation'}">${links.map(([href,label,icon])=>`<a href="${href}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('')}</nav>`;
    main.prepend(sidebar); markSidebar();
    if (page === '/admin') document.body.classList.add('operations-page');
  }
  function tracking(shipment) {
    const progress = Math.max(0,Math.min(100,Number(shipment.progress) || 0));
    const location = [shipment.currentCity,shipment.currentState,shipment.currentCountry].filter(Boolean).join(', ');
    const events = [...(shipment.events || [])].sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0));
    return `<div class="tracking-overview"><div><p class="eyebrow">TRACKING NUMBER</p><h2>${escape(shipment.id)}</h2><p>${escape(shipment.service)} shipping</p></div><div>${status(shipment.status)}<p>Latest recorded shipment status</p></div></div><div class="tracking-body"><section class="delivery-indicator"><div><strong>Delivery progress</strong><span>${progress}%</span></div><progress value="${progress}" max="100" aria-label="Delivery progress">${progress}%</progress><dl class="tracking-facts">${[['Origin',shipment.origin],['Destination',shipment.destination],['Expected delivery',shipment.expectedDelivery ? date(shipment.expectedDelivery) : 'Not yet provided'],['Current location',location || 'Awaiting a location update']].map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl></section><section class="timeline-section"><h3>Shipment activity</h3>${events.length ? `<ol class="timeline">${events.map((event,index)=>`<li>${index===0?'<div class="event-current">LATEST UPDATE</div>':''}<strong>${escape(event.title)}</strong><span>${escape(event.detail)}</span><time>${escape(date(event.time))}${!Number.isNaN(Date.parse(event.time)) ? ` · ${escape(new Date(event.time).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}))}` : ''}</time></li>`).join('')}</ol>` : '<p class="muted">Tracking events will appear here when an update is recorded.</p>'}</section></div>`;
  }
  function table(shipments) {
    if (!shipments.length) return '<div class="empty-state"><h2>No matching shipments</h2><p>Try another tracking number or change the status filter.</p></div>';
    return `<table class="shipment-table"><caption class="sr-only">Your shipments and delivery status</caption><thead><tr>${['Tracking Number','Recipient / Destination','Ship Date','Expected Delivery','Status','Action'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${shipments.map(s=>`<tr><td data-label="Tracking number"><strong>${escape(s.id)}</strong><small>${escape(s.service)}</small></td><td data-label="Recipient / Destination">${escape(s.recipientName || s.destination)}<small>${s.recipientName ? escape(s.destination) : ''}</small></td><td data-label="Ship date">${escape(date(s.createdAt))}</td><td data-label="Expected delivery">${s.expectedDelivery ? escape(date(s.expectedDelivery)) : 'Not yet provided'}</td><td data-label="Status">${status(s.status)}</td><td data-label="Action"><a class="track-link" href="/track?number=${encodeURIComponent(s.id)}" aria-label="Track ${escape(s.id)}">Track →</a></td></tr>`).join('')}</tbody></table>`;
  }
  function dashboard(user, shipments) {
    const target = document.querySelector('#customer-dashboard');
    const transit = new Set(['Picked up','In transit','At delivery facility','Out for delivery']);
    const totals = [['Total Shipments',shipments.length,'All shipment records'],['In Transit',shipments.filter(s=>transit.has(s.status)).length,'Picked up through delivery'],['Delivered',shipments.filter(s=>s.status==='Delivered').length,'Completed deliveries'],['Action Required',shipments.filter(s=>s.status==='Delivery exception').length,'Delivery exceptions']];
    document.querySelector('.page-intro h1').textContent = `Welcome back, ${user.name || 'there'}`;
    target.innerHTML = `<div id="overview"><nav class="dashboard-actions" aria-label="Dashboard actions">${[['/ship','Create a Shipment','▣'],['/track','Track a Package','⌖'],['/rates','Get a Quote','≋']].map(([href,label,icon])=>`<a href="${href}"><span class="icon-tile" aria-hidden="true">${icon}</span>${label}<b aria-hidden="true">→</b></a>`).join('')}</nav><div class="summary-grid">${totals.map(([label,total,detail])=>`<article class="summary-card"><span>${label}</span><strong>${total}</strong><small>${detail}</small></article>`).join('')}</div></div><section id="shipments" class="shipment-panel"><div class="shipment-panel-header"><div><h2 id="shipment-heading">Recent shipments</h2><p>Delivery details, all in one place.</p></div><a href="/ship">+ Create shipment</a></div><div class="filter-bar"><label>Search shipments<input id="shipment-search" type="search" placeholder="Tracking number, recipient or destination"></label><label>Shipment status<select id="shipment-filter"><option value="">All statuses</option>${[...new Set(shipments.map(s=>s.status))].sort().map(s=>`<option value="${escape(s)}">${escape(s)}</option>`).join('')}</select></label></div><div id="shipment-rows"></div><div class="table-footer" id="shipment-count" role="status"></div></section><aside class="dashboard-help"><div><strong>Support for your next step.</strong><p>Questions about a delivery? We’re here to help.</p></div><a href="/support">Visit support centre →</a></aside>`;
    const sorted = [...shipments].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
    function render() {
      const query = document.querySelector('#shipment-search').value.trim().toLowerCase(), filter = document.querySelector('#shipment-filter').value;
      const filtered = sorted.filter(s=>(!filter || s.status===filter) && [s.id,s.recipientName,s.destination,s.origin].some(v=>String(v || '').toLowerCase().includes(query)));
      const all = location.hash === '#shipments' || query || filter;
      const visible = all ? filtered : filtered.slice(0,5);
      document.querySelector('#shipment-heading').textContent = all ? 'Your shipments' : 'Recent shipments';
      document.querySelector('#shipment-rows').innerHTML = shipments.length ? table(visible) : '<div class="empty-state"><h2>Your first shipment starts here.</h2><p>Once you create a shipment, its details and updates will appear in your workspace.</p><a class="button button-primary" href="/ship">Create a shipment</a></div>';
      document.querySelector('#shipment-count').textContent = `Showing ${visible.length} of ${filtered.length} shipments`;
      markSidebar();
    }
    document.querySelector('#shipment-search').addEventListener('input',render);
    document.querySelector('#shipment-filter').addEventListener('change',render);
    window.addEventListener('hashchange',render); render();
  }
  function denied(target, message='Sign in to view your shipments.') {
    target.innerHTML = `<div class="panel empty-state"><h2>Your shipping workspace</h2><p>${escape(message)}</p><a class="button button-primary" href="/login">Sign in</a></div>`;
  }
  const form = document.querySelector('#shipment-form');
  const review = document.querySelector('#shipment-review');
  function reviewShipment() {
    const fields = [['Sender','senderName'],['Email','senderEmail'],['Collection','origin'],['Recipient','recipientName'],['Phone','recipientPhone'],['Destination','destination'],['Contents','contents'],['Weight (kg)','weight'],['Service','service']];
    review.innerHTML = fields.map(([label,name])=>`<dt>${label}</dt><dd>${escape(form.elements[name].value || 'Not provided')}</dd>`).join('');
  }
  document.querySelector('#review-shipment')?.addEventListener('click',()=>{reviewShipment();review.hidden=false;});
  form?.addEventListener('input',()=>{if (!review.hidden) reviewShipment();});
  form?.addEventListener('reset',()=>{review.hidden=true;});
  document.querySelectorAll('form').forEach(form => form.addEventListener('invalid',event=>{
    const message = form.querySelector('.form-message');
    if (message) message.textContent = 'Please check the highlighted fields and complete all required information.';
    event.target.setAttribute('aria-invalid','true');
  },true));
  document.addEventListener('input',event=>{if(event.target.matches('input,textarea,select') && event.target.validity.valid) event.target.removeAttribute('aria-invalid');});
  document.querySelector('#admin-search')?.addEventListener('input',event=>{
    const query=event.target.value.toLowerCase().trim(); let visible=0;
    document.querySelectorAll('#admin-list>article').forEach(article=>{article.hidden=!article.textContent.toLowerCase().includes(query);if(!article.hidden)visible++;});
    const message=document.querySelector('#admin-message'); message.textContent=`${visible} matching shipment${visible===1?'':'s'}.`;
  });
  return {account,tracking,dashboard,denied};
})();

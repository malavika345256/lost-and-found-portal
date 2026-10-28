const api = async (url, options = {}) => {
  const response = await fetch(url, { credentials: 'include', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
};
const STUDENT_EMAIL_DOMAIN = 'ced.alliance.edu.in';
const isValidEmail = email => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(email || '').trim());
const isStudentEmail = email => isValidEmail(email) && String(email).trim().toLowerCase().endsWith(`@${STUDENT_EMAIL_DOMAIN}`);
const studentOnlyPages = new Set(['/index.html','/dashboard.html','/lost.html','/found.html','/search.html','/history.html','/contact.html','/map.html','/item.html','/matches.html']);
if (studentOnlyPages.has(location.pathname.toLowerCase())) {
  document.body.style.visibility = 'hidden';
  api('/api/auth/me').then(({ user }) => {
    if (user.role !== 'user') return location.replace('admin.html');
    addStudentNavigation();
    document.body.style.visibility = '';
  }).catch(() => location.replace('login.html'));
}
window.addEventListener('pageshow', event => {
  if (event.persisted && (studentOnlyPages.has(location.pathname.toLowerCase()) || location.pathname.toLowerCase().endsWith('/admin.html'))) location.reload();
});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusText = status => String(status || 'pending').replace(/^./, c => c.toUpperCase());
const claimStatusText = status => ({ pending: 'Pending Verification', approved: 'Approved', rejected: 'Rejected' }[status] || statusText(status));
const recoveryText = status => status ? statusText(status) : 'Unclassified';
const messageBox = (el, text, error = false) => { if (!el) return; el.textContent = text; el.style.display = 'block'; el.style.color = error ? '#b42323' : '#27753a'; };
function addStudentNavigation() {
  const nav = document.querySelector('nav');
  if (!nav) return;
  const links = [
    ['index.html', 'Home'], ['lost.html', 'Report Lost'], ['found.html', 'Report Found'],
    ['matches.html', 'Matches Found'], ['map.html', 'Campus Map'], ['contact.html', 'Contact']
  ];
  const currentPage = location.pathname.split('/').pop().toLowerCase();
  nav.replaceChildren(...links.map(([href, label]) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (href === currentPage) { link.classList.add('active'); link.setAttribute('aria-current', 'page'); }
    if (href === 'matches.html') {
      link.innerHTML = 'Matches Found <span id="notificationBadge" aria-live="polite" style="display:none;min-width:20px;height:20px;margin-left:5px;padding:1px 6px;border-radius:10px;background:#b42323;color:#fff;font-size:12px;font-weight:700;text-align:center;vertical-align:middle"></span>';
    }
    return link;
  }));
  if (!document.getElementById('logoutButton') && !document.getElementById('logoutNav')) {
    const logout = document.createElement('a'); logout.href = '#'; logout.id = 'logoutNav'; logout.className = 'login-btn'; logout.textContent = 'Logout';
    logout.addEventListener('click', async event => { event.preventDefault(); window.portalSocket?.disconnect(); try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.replace('login.html'); } });
    const headerActions = document.querySelector('.top-header .header-actions') || document.querySelector('.top-header') || document.querySelector('header');
    headerActions?.append(logout);
  }
  setupNotificationUI();
}

function setNotificationBadge(count) {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  const unread = Math.max(0, Number(count) || 0);
  badge.dataset.count = String(unread);
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.style.display = unread ? 'inline-block' : 'none';
  badge.parentElement?.setAttribute('aria-label', `Notifications, ${unread} unread`);
}

async function refreshNotificationBadge() {
  try {
    const { notifications, unreadCount } = await api('/api/notifications');
    setNotificationBadge(Number.isFinite(unreadCount) ? unreadCount : notifications.filter(notification => !notification.readAt).length);
  } catch { /* Keep the page usable if notifications cannot be fetched. */ }
}

async function markPortalNotificationRead(id) {
  try {
    const { notification } = await api(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
    const badge = document.getElementById('notificationBadge');
    if (badge) setNotificationBadge(Math.max(0, Number(badge.dataset.count) - 1));
    window.dispatchEvent(new CustomEvent('portal:notification-read', { detail: notification }));
    return notification;
  } catch { return null; }
}

function showNotificationToast(notification) {
  document.getElementById('portalNotificationToast')?.remove();
  const toast = document.createElement('aside');
  toast.id = 'portalNotificationToast';
  toast.setAttribute('role', 'status');
  Object.assign(toast.style, { position: 'fixed', right: '20px', top: '20px', zIndex: '2000', width: 'min(360px, calc(100vw - 32px))', padding: '16px', borderRadius: '10px', background: '#fff', color: '#173f6f', boxShadow: '0 8px 28px #1234', border: '1px solid #d8e0e8' });
  const message = document.createElement('p');
  message.textContent = notification.text || 'You have a new notification.';
  const link = document.createElement('a');
  link.href = notification.link || 'dashboard.html#notificationsPanel';
  link.textContent = notification.type === 'possible_match' ? 'View matching report' : 'View notifications';
  link.style.cssText = 'display:inline-block;margin-top:10px;color:#15558e;font-weight:bold';
  link.addEventListener('click', async event => {
    if (notification._id && !notification.readAt) {
      event.preventDefault();
      await markPortalNotificationRead(notification._id);
      location.assign(link.href);
    }
  });
  toast.append(message, link);
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 10000);
}

function setupNotificationUI() {
  if (window.portalNotificationsStarted) return;
  window.portalNotificationsStarted = true;
  refreshNotificationBadge();
  window.addEventListener('portal:notification-read', refreshNotificationBadge);
  const script = document.createElement('script');
  script.src = '/socket.io/socket.io.js';
  script.async = true;
  script.onload = () => {
    if (!window.io) return;
    const socket = window.io({ withCredentials: true });
    window.portalSocket = socket;
    socket.on('connect', refreshNotificationBadge);
    socket.on('notification', notification => {
      const badge = document.getElementById('notificationBadge');
      const current = badge && badge.style.display !== 'none' ? Number(badge.dataset.count) || 0 : 0;
      setNotificationBadge(current + 1);
      showNotificationToast(notification);
      window.dispatchEvent(new CustomEvent('portal:notification', { detail: notification }));
    });
  };
  script.onerror = () => refreshNotificationBadge();
  document.head.append(script);
}
const register = async () => {
  const name = document.getElementById('fullName').value.trim(), email = document.getElementById('email').value.trim().toLowerCase(), password = document.getElementById('password').value;
  const error = document.getElementById('emailError'), ok = document.getElementById('successMessage');
  if (!isValidEmail(email)) { messageBox(error, 'Enter a valid email address.', true); return; }
  if (!isStudentEmail(email)) { messageBox(error, 'Please use your Alliance University student email ending with @ced.alliance.edu.in.', true); return; }
  if (password !== document.getElementById('confirmPassword').value) { messageBox(document.getElementById('passwordError'), 'Passwords do not match.', true); return; }
  try { await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }); messageBox(ok, 'Account created. You can now log in.'); setTimeout(() => location.assign('login.html'), 900); }
  catch (e) { messageBox(error, e.message, true); }
};
if (document.getElementById('fullName')) window.registerUser = register;
window.togglePassword = (inputId) => { const input=document.getElementById(inputId);if(input)input.type=input.type==='password'?'text':'password'; };
document.getElementById('email')?.addEventListener('input', e => { if (!document.getElementById('emailError')) return; const value=e.target.value.trim();const valid=!value||isStudentEmail(value);document.getElementById('emailError').classList.toggle('show',!valid); });

const loginForm = document.getElementById('loginForm');
if (loginForm) loginForm.addEventListener('submit', async e => { e.preventDefault(); const box = document.getElementById('errorMessage'); const email=document.getElementById('email').value.trim().toLowerCase();if(!isValidEmail(email))return messageBox(box,'Enter a valid email address.',true);if(!isStudentEmail(email))return messageBox(box,'Use your official Alliance University student email ending in @ced.alliance.edu.in.',true);try { const { user } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: document.getElementById('password').value }) }); if (user.role !== 'user') return messageBox(box, 'This student account could not be authenticated.', true); location.assign('index.html'); } catch (err) { messageBox(box, err.message, true); } });

const MAX_REPORT_IMAGE_SIZE = 5 * 1024 * 1024;
const REPORT_IMAGE_TYPES = new Map([['jpg','image/jpeg'],['jpeg','image/jpeg'],['png','image/png'],['webp','image/webp']]);
function reportImageError(file) {
  if (!file) return '';
  const extension = file.name.split('.').pop().toLowerCase();
  const expectedType = REPORT_IMAGE_TYPES.get(extension);
  if (!expectedType || (file.type && file.type !== expectedType)) return 'Choose a JPG, JPEG, PNG, or WEBP image.';
  if (file.size > MAX_REPORT_IMAGE_SIZE) return 'Image must be 5 MB or smaller.';
  if (!file.size) return 'The selected image is empty. Choose another file.';
  return '';
}
function configureImageUpload(form) {
  const input = form.querySelector('#image, #itemImage');
  const preview = form.querySelector('#imagePreview'), filename = form.querySelector('#imageFilename');
  const image = form.querySelector('#imagePreviewImg'), error = form.querySelector('#imageError');
  if (!input || !preview || !filename || !image || !error) return;
  let previewUrl = '';
  const clearPreview = () => { preview.hidden = true; filename.textContent = ''; image.removeAttribute('src'); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; };
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    error.textContent = reportImageError(file);
    error.hidden = !error.textContent;
    clearPreview();
    if (!file || error.textContent) return;
    filename.textContent = file.name;
    previewUrl = URL.createObjectURL(file);
    image.src = previewUrl;
    preview.hidden = false;
  });
  form.addEventListener('reset', () => setTimeout(() => { clearPreview(); error.textContent = ''; error.hidden = true; }, 0));
}
async function fileData(file) {
  if (!file) return '';
  const error = reportImageError(file);
  if (error) throw new Error(error);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const mime = REPORT_IMAGE_TYPES.get(file.name.split('.').pop().toLowerCase()); resolve(String(reader.result).replace(/^data:[^,]*,/, `data:${mime};base64,`)); };
    reader.onerror = () => reject(new Error('Image could not be read.'));
    reader.readAsDataURL(file);
  });
}
function configureCardReport(form) {
  const category = form.querySelector('#category'), group = form.querySelector('#cardVerificationGroup');
  const image = form.querySelector('#image, #itemImage'), description = form.querySelector('#description');
  if (!category || !group) return;
  const normalDescription = description?.placeholder || 'Describe the item, colour, brand, identifying marks, etc.';
  const update = () => {
    const isCard = ['College ID Card', 'University Access Card'].includes(category.value);
    group.hidden = !isCard;
    if (image) { image.disabled = isCard; if (isCard && image.value) { image.value = ''; image.dispatchEvent(new Event('change')); } }
    if (description) description.placeholder = isCard ? 'Describe the card generally. Do not include a full ID number, barcode, or QR contents.' : normalDescription;
  };
  category.addEventListener('change', update);
  form.addEventListener('reset', () => setTimeout(update, 0));
  update();
}
async function submitReport(form, type) {
  type = form.dataset.reportType;
  if (!['lost', 'found'].includes(type)) { messageBox(document.getElementById('successMessage') || document.getElementById('message'), 'This report form is not configured correctly.', true); return; }
  const get = id => document.getElementById(id)?.value?.trim() || '';
  try {
    const imageInput = document.getElementById(type === 'lost' ? 'itemImage' : 'image');
    const file = imageInput?.files?.[0];
    const imageError = reportImageError(file);
    if (imageError) throw new Error(imageError);
    if (['College ID Card', 'University Access Card'].includes(get('category')) && file) throw new Error('For card privacy, do not upload an ID or access card image.');
    const me = await api('/api/auth/me');
    const body = { type, itemName: get('itemName'), category: get('category'), date: get(type === 'lost' ? 'dateLost' : 'date'), location: get(type === 'lost' ? 'locationLost' : 'location'), description: get('description'), privateVerification: get('privateVerification'), contactName: get('contactName') || me.user.name, contact: get('contact'), handover: get('handover'), image: await fileData(file) };
    await api(`/api/reports/${type}`, { method: 'POST', body: JSON.stringify(body) });
    messageBox(document.getElementById(type === 'lost' ? 'successMessage' : 'message'), `${type === 'lost' ? 'Lost' : 'Found'} item report submitted successfully.`);
    form.reset();
  } catch (err) { messageBox(document.getElementById(type === 'lost' ? 'successMessage' : 'message'), `${err.message}${/Authentication/.test(err.message) ? ' Please log in first.' : ''}`, true); }
}
const lostForm = document.getElementById('lostForm'); if (lostForm) lostForm.addEventListener('submit', e => { e.preventDefault(); submitReport(lostForm, 'lost'); });
const foundForm = document.getElementById('foundForm'); if (foundForm) foundForm.addEventListener('submit', e => { e.preventDefault(); submitReport(foundForm, 'found'); });
if (lostForm) configureImageUpload(lostForm);
if (foundForm) configureImageUpload(foundForm);
if (lostForm) configureCardReport(lostForm);
if (foundForm) configureCardReport(foundForm);

const resultsBody = document.getElementById('resultsBody');
async function searchItems() {
  const p = new URLSearchParams(); const q = document.getElementById('searchInput')?.value.trim(), category = document.getElementById('categoryFilter')?.value, type = document.getElementById('typeFilter')?.value, status = document.getElementById('statusFilter')?.value;
  if (q) p.set('q', q); if (category && category !== 'all') p.set('category', category); if (type && type !== 'all') p.set('type', type); if (status && status !== 'all') p.set('status', status); for (const key of ['dateFrom','dateTo']) { const value = document.getElementById(key)?.value; if (value) p.set(key, value); }
  try { const targetId = new URLSearchParams(location.search).get('item'); const items = targetId ? [(await api(`/api/items/${encodeURIComponent(targetId)}`)).item] : (await api(`/api/items?${p}`)).items; resultsBody.innerHTML = ''; document.getElementById('resultCount').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`; document.getElementById('noResults').style.display = items.length ? 'none' : 'block'; items.forEach(i => { const row = document.createElement('tr'); [i._id, i.itemName, i.category, i.location, new Date(i.date).toLocaleDateString(), i.type || 'Unclassified', `${statusText(i.status)} / ${recoveryText(i.recoveryStatus)}`].forEach((v, n) => { const cell = document.createElement('td'); cell.textContent = v || '-'; if (n === 5 && i.type) { const badge = document.createElement('span'); badge.className = `status ${i.type}`; badge.textContent = v; cell.textContent = ''; cell.appendChild(badge); } row.appendChild(cell); }); const action = document.createElement('td'); const view=document.createElement('a');view.className='details-link';view.href=`item.html?id=${encodeURIComponent(i._id)}&return=${encodeURIComponent(location.pathname+location.search)}`;view.textContent='View Details';action.append(view); const claim = document.createElement('button'); claim.type='button'; claim.textContent='Claim'; claim.disabled=i.type!=='found'||i.recoveryStatus==='returned'; claim.addEventListener('click',async()=>{const details=prompt('Describe private identifying details that only the owner would know:');if(!details)return;try{await api('/api/claims',{method:'POST',body:JSON.stringify({itemId:i._id,details})});alert('Claim submitted for review.');}catch(e){alert(e.message);}}); const chat=document.createElement('button'); chat.type='button';chat.textContent='Message';chat.addEventListener('click',async()=>{try{const {conversation}=await api('/api/conversations',{method:'POST',body:JSON.stringify({itemId:i._id})});location.assign(`history.html?conversation=${conversation._id}`);}catch(e){alert(e.message);}}); action.append(claim,chat);row.appendChild(action);resultsBody.appendChild(row); }); }
  catch (e) { document.getElementById('noResults').textContent = e.message; document.getElementById('noResults').style.display = 'block'; }
}
if (resultsBody) { window.searchItems = searchItems; searchItems(); document.getElementById('searchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchItems(); }); for (const id of ['categoryFilter','typeFilter','statusFilter','dateFrom','dateTo']) document.getElementById(id)?.addEventListener('change', searchItems); }

const reportTable = document.getElementById('reportTableBody');
async function loadHistory() {
  try { const { reports, claims, conversations } = await api('/api/dashboard'); const rows = reports; document.getElementById('totalReports').textContent = rows.length; document.getElementById('lostReports').textContent = rows.filter(r => r.type === 'lost').length; document.getElementById('foundReports').textContent = rows.filter(r => r.type === 'found').length; document.getElementById('pendingReports').textContent = rows.filter(r => r.status === 'pending').length;
    reportTable.innerHTML = ''; document.getElementById('emptyMessage').style.display = rows.length ? 'none' : 'block'; rows.forEach(r => { const tr = document.createElement('tr'); [r._id, r.itemName, r.category, r.location, new Date(r.date).toLocaleDateString(), r.type || 'Unclassified', `${statusText(r.status)} / ${recoveryText(r.recoveryStatus)}`].forEach(v => { const td = document.createElement('td'); td.textContent = v || '-'; tr.appendChild(td); }); const action=document.createElement('td');const view=document.createElement('a');view.className='details-link';view.href=`item.html?id=${encodeURIComponent(r._id)}&return=${encodeURIComponent(location.pathname+location.search)}`;view.textContent='View Details';action.append(view);const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.addEventListener('click',async()=>{if(!confirm('Delete this report?'))return;try{await api(`/api/items/${r._id}`,{method:'DELETE'});loadHistory();}catch(e){alert(e.message);}});action.append(remove);tr.appendChild(action);reportTable.appendChild(tr); });
    const claimsBody = document.getElementById('myClaimsBody');
    if (claimsBody) {
      claimsBody.innerHTML = '';
      const claimsEmpty = document.getElementById('myClaimsEmpty');
      claimsEmpty.style.display = claims.length ? 'none' : 'block';
      claims.forEach(c => {
        const tr = document.createElement('tr');
        [c.item?.itemName || 'Item', c.createdAt ? new Date(c.createdAt).toLocaleString() : '-', c.details || '-'].forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.append(td); });
        const statusCell = document.createElement('td');
        statusCell.textContent = claimStatusText(c.status);
        if (c.decidedAt) statusCell.textContent += ' on ' + new Date(c.decidedAt).toLocaleString();
        if (c.decisionReason) statusCell.textContent += ' | ' + c.decisionReason;
        if (c.proofRequest && c.status === 'pending') {
          statusCell.textContent += ' | Additional proof requested: ' + c.proofRequest + ' ';
          const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Provide proof';
          button.addEventListener('click', async () => { const proof = prompt('Enter the additional proof requested by the administrator:'); if (!proof) return; try { await api('/api/claims/' + c._id + '/proof', { method: 'PATCH', body: JSON.stringify({ proof }) }); loadHistory(); } catch (error) { alert(error.message); } });
          statusCell.append(button);
        }
        tr.append(statusCell); claimsBody.append(tr);
      });
    }
    if (!document.getElementById('chatPanel')) { const panel=document.createElement('section');panel.id='chatPanel';panel.className='section';panel.innerHTML='<h2>Item Conversations</h2><select id="conversationSelect"><option value="">Choose a conversation</option></select><div id="chatMessages" aria-live="polite"></div><form id="chatForm"><input id="chatText" required maxlength="4000" placeholder="Write a message"><button>Send</button></form>';document.querySelector('main')?.append(panel);const sel=panel.querySelector('#conversationSelect');conversations.forEach(c=>{const o=document.createElement('option');o.value=c._id;o.textContent=`${c.item?.itemName||'Item'} (${c.participants.map(p=>p.name).join(', ')})${c.unreadCount?` — ${c.unreadCount} unread`:''}`;sel.append(o);});const loadChat=async id=>{if(!id)return;const {messages}=await api(`/api/conversations/${id}/messages`);panel.querySelector('#chatMessages').innerHTML=messages.map(m=>`<p><strong>${esc(m.sender?.name)}:</strong> ${esc(m.body)} <small>${new Date(m.createdAt).toLocaleString()}</small></p>`).join('');};sel.value=new URLSearchParams(location.search).get('conversation')||'';sel.addEventListener('change',()=>loadChat(sel.value));if(sel.value)loadChat(sel.value);panel.querySelector('#chatForm').addEventListener('submit',async e=>{e.preventDefault();try{await api(`/api/conversations/${sel.value}/messages`,{method:'POST',body:JSON.stringify({body:panel.querySelector('#chatText').value})});panel.querySelector('#chatText').value='';await loadChat(sel.value);}catch(err){alert(err.message);}}); }
  } catch (e) { messageBox(document.getElementById('emptyMessage'), `${e.message} Please log in to view your history.`, true); }
}
if (reportTable) { window.loadReports = loadHistory; window.clearReports = loadHistory; loadHistory(); }

const adminForm = document.getElementById('adminLoginForm');
if (adminForm) {
  const loginScreen = document.getElementById('loginScreen'), dashboardScreen = document.getElementById('dashboardScreen');
  async function showAdmin() { try {
    const { user } = await api('/api/auth/me'); if (user.role !== 'admin') throw Error('Administrator access required.'); loginScreen.classList.add('hidden'); dashboardScreen.classList.remove('hidden');
    const counts = await api('/api/admin/dashboard'); document.getElementById('totalItems').textContent = counts.reports; document.getElementById('lostItems').textContent = counts.lost; document.getElementById('foundItems').textContent = counts.found;
    const { reports } = await api('/api/admin/reports'); const tbody = document.getElementById('reportsBody'); tbody.innerHTML = ''; document.getElementById('emptyMessage').style.display = reports.length ? 'none' : 'block';
    reports.slice(0, 50).forEach(r => {
      const tr = document.createElement('tr');
      [r._id, r.itemName, r.category, r.privateVerification || '-', r.location, r.type || 'Unclassified', `${statusText(r.status)} / ${recoveryText(r.recoveryStatus)}`].forEach((v, n) => {
        const cell = document.createElement('td'); cell.textContent = v || '-';
        if (n === 5) {
          const typeSelect = document.createElement('select'); typeSelect.setAttribute('aria-label', `Correct report type for ${r._id}`);
          const unknown = document.createElement('option'); unknown.value = ''; unknown.textContent = 'Choose type'; typeSelect.append(unknown);
          for (const type of ['lost', 'found']) { const option = document.createElement('option'); option.value = type; option.textContent = statusText(type); typeSelect.append(option); }
          typeSelect.value = r.type || '';
          typeSelect.addEventListener('change', async () => { if (!typeSelect.value) return; try { await api(`/api/items/${r._id}`, { method: 'PATCH', body: JSON.stringify({ type: typeSelect.value }) }); r.type = typeSelect.value; cell.firstChild.textContent = statusText(r.type); } catch (error) { alert(error.message); typeSelect.value = r.type || ''; } });
          cell.append(document.createElement('br'), typeSelect);
        }
        tr.appendChild(cell);
      });
      const td = document.createElement('td'); const select = document.createElement('select');
      ['pending','approved','resolved','rejected'].forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=statusText(s); select.append(o); });
      select.value=r.status; select.addEventListener('change', async () => { try { await api(`/api/items/${r._id}`, { method:'PATCH', body:JSON.stringify({status:select.value}) }); } catch(e) { alert(e.message); select.value=r.status; } }); td.append(select);
      const remove=document.createElement('button'); remove.type='button'; remove.textContent='Delete'; remove.addEventListener('click',async()=>{if(!confirm('Delete this report?'))return;try{await api(`/api/items/${r._id}`,{method:'DELETE'});showAdmin();}catch(e){alert(e.message);}}); td.append(remove); tr.append(td); tbody.appendChild(tr);
    });
    const { claims } = await api('/api/admin/claims');
    const cb = document.getElementById('claimsBody'); cb.innerHTML = '';
    document.getElementById('claimsEmpty').style.display = claims.length ? 'none' : 'block';
    claims.forEach(c => {
      const tr = document.createElement('tr');
      const item = c.item || {};
      const itemText = [item.itemName, item.category, item.location, item.date ? new Date(item.date).toLocaleDateString() : ''].filter(Boolean).join(' / ') || 'Item unavailable';
      const itemCell = document.createElement('td'); itemCell.textContent = itemText; tr.append(itemCell);
      const countCell = document.createElement('td'); countCell.textContent = String(c.claimantCount || 1); tr.append(countCell);
      const claimantCell = document.createElement('td'); claimantCell.textContent = [c.claimant?.name, c.claimant?.email].filter(Boolean).join(' / ') || 'Unknown claimant'; tr.append(claimantCell);
      const reasonCell = document.createElement('td'); reasonCell.textContent = c.details || '-'; tr.append(reasonCell);
      const proofCell = document.createElement('td'); proofCell.textContent = c.proof || c.proofRequest || '-'; tr.append(proofCell);
      const submittedCell = document.createElement('td'); submittedCell.textContent = c.createdAt ? new Date(c.createdAt).toLocaleString() : '-'; tr.append(submittedCell);
      const decisionCell = document.createElement('td');
      decisionCell.textContent = claimStatusText(c.status);
      if (c.decisionReason) decisionCell.textContent += ' | ' + c.decisionReason;
      if (c.decidedAt) decisionCell.textContent += ' (' + new Date(c.decidedAt).toLocaleString() + (c.decisionBy?.name ? ', ' + c.decisionBy.name : '') + ')';
      if (c.status === 'pending') {
        const requestButton = document.createElement('button'); requestButton.type = 'button'; requestButton.textContent = 'Request proof';
        requestButton.addEventListener('click', async () => { const request = prompt('What additional proof should the claimant provide?'); if (!request) return; try { await api('/api/claims/' + c._id + '/request-proof', { method: 'PATCH', body: JSON.stringify({ request }) }); showAdmin(); } catch (error) { alert(error.message); } });
        decisionCell.append(requestButton);
        for (const decision of ['approved','rejected']) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = decision === 'approved' ? 'Approve' : 'Reject';
          button.addEventListener('click', async () => {
            const defaultReason = decision === 'approved' ? 'Approved after administrator verification.' : 'Rejected after administrator review.';
            const reason = prompt('Record the reason for this decision:', defaultReason); if (reason === null) return;
            try { await api('/api/claims/' + c._id + '/status', { method: 'PATCH', body: JSON.stringify({ status: decision, reason }) }); showAdmin(); }
            catch (error) { alert(error.message); }
          });
          decisionCell.append(button);
        }
      }
      tr.append(decisionCell); cb.append(tr);
    });
    const {users}=await api('/api/admin/users');const ub=document.getElementById('usersBody');ub.innerHTML='';users.forEach(u=>{const tr=document.createElement('tr');[u.name,u.email,u.role].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});const td=document.createElement('td');const select=document.createElement('select');['user','admin'].forEach(role=>{const o=document.createElement('option');o.value=role;o.textContent=role;select.append(o);});select.value=u.role;select.disabled=u.id===user.id;select.addEventListener('change',async()=>{try{await api(`/api/admin/users/${u.id}/role`,{method:'PATCH',body:JSON.stringify({role:select.value})});}catch(e){alert(e.message);select.value=u.role;}});td.append(select);tr.append(td);ub.append(tr);});
  } catch (e) { dashboardScreen.classList.add('hidden'); loginScreen.classList.remove('hidden'); } }
  adminForm.addEventListener('submit', async e => { e.preventDefault(); const box = document.getElementById('errorMessage'); try { const { user } = await api('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('adminEmail').value.trim(), password: document.getElementById('adminPassword').value }) }); if (user.role !== 'admin') throw Error('This account is not an administrator.'); box.style.display = 'none'; location.assign('admin.html'); } catch (err) { messageBox(box, err.message, true); } });
  document.getElementById('logoutBtn').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.replace('login.html'); } }); showAdmin();
}

const recent = document.getElementById('recentReportsBody');
if (recent) api('/api/items').then(({ items }) => { recent.innerHTML = ''; items.slice(0, 5).forEach(i => { const tr = document.createElement('tr'); [i.itemName, i.category, i.location, new Date(i.date).toLocaleDateString()].forEach(v => { const td = document.createElement('td'); td.textContent = v || '-'; tr.appendChild(td); }); const type = document.createElement('td'); if (i.type) { const badge=document.createElement('span');badge.className=`status ${esc(i.type)}`;badge.textContent=statusText(i.type);type.append(badge); } else type.textContent='Unclassified'; tr.appendChild(type); const action = document.createElement('td'); const link=document.createElement('a');link.className='details-link';link.href=`item.html?id=${encodeURIComponent(i._id)}&return=${encodeURIComponent('index.html')}`;link.textContent='View Details';action.append(link); tr.appendChild(action); recent.appendChild(tr); }); }).catch(() => {});

const itemDetails = document.getElementById('itemDetails');
if (itemDetails) {
  const params = new URLSearchParams(location.search), id = params.get('id');
  const back = document.getElementById('backButton');
  back?.addEventListener('click', () => {
    if (history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) history.back();
    else { const fallback=params.get('return'); location.assign(/^(?:index|search|history)\.html(?:\?.*)?$/.test(fallback || '') ? fallback : 'index.html'); }
  });
  (async()=>{
    const error=document.getElementById('itemError');
    if(!id){messageBox(error,'No item ID was provided. Return to the previous page and select an item.',true);return;}
    try {
      const {item:i}=await api(`/api/items/${encodeURIComponent(id)}`);
      const fields={itemName:i.itemName,category:i.category,type:statusText(i.type),date:new Date(i.date).toLocaleDateString(),location:i.location,description:i.description,status:`${statusText(i.status)} / ${recoveryText(i.recoveryStatus)}`};
      for(const [key,value] of Object.entries(fields)) document.getElementById(`detail-${key}`).textContent=value||'-';
      if(i.image){const img=document.getElementById('detail-image');img.src=i.image;img.hidden=false;img.alt=`Image of ${i.itemName}`;document.getElementById('imageUnavailable').hidden=true;}
      itemDetails.hidden=false;
    } catch(e) { messageBox(error,e.message==='Item not found.'?'This item is no longer available.':e.message,true); }
  })();
}

if (location.pathname.toLowerCase().endsWith('/index.html')) {
  api('/api/auth/me').then(({ user }) => {
    const profile = document.getElementById('studentProfile');
    if (profile) profile.textContent = 'Student Portal';
  }).catch(() => location.replace('login.html'));
  document.getElementById('logoutButton')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.replace('login.html'); }
  });
}

const contactForm = document.getElementById('contactForm');
if (contactForm) contactForm.addEventListener('submit', async e => { e.preventDefault();try{await api('/api/contact',{method:'POST',body:JSON.stringify({name:document.getElementById('name').value.trim(),email:document.getElementById('email').value.trim(),subject:document.getElementById('subject').value,message:document.getElementById('message').value.trim()})});messageBox(document.getElementById('successMessage'),'Thank you. Your message has been submitted.');contactForm.reset();}catch(err){messageBox(document.getElementById('successMessage'),err.message,true);} });

document.getElementById('studentButton')?.addEventListener('click', () => location.assign('login.html'));

if (location.pathname.endsWith('/dashboard.html')) {
  const renderDashboardNotification = (notification, prepend = false) => {
    const list = document.getElementById('notificationList');
    if (!list || list.querySelector(`[data-notification-id="${CSS.escape(String(notification._id))}"]`)) return;
    if (list.querySelector('[data-empty-notifications]')) list.replaceChildren();
    const row = document.createElement('article');
    row.dataset.notificationId = notification._id;
    row.dataset.unread = notification.readAt ? 'false' : 'true';
    row.style.cssText = 'padding:12px 0;border-bottom:1px solid #e3e8ef';
    const message = document.createElement('p');
    message.textContent = `${notification.readAt ? '' : 'New: '}${notification.text} — ${new Date(notification.createdAt).toLocaleString()}`;
    row.append(message);
    if (notification.link) {
      const link = document.createElement('a');
      link.className = 'details-link';
      link.href = notification.link;
      link.textContent = notification.type === 'possible_match' ? 'View matching report and contact student' : 'View details';
      link.addEventListener('click', async event => {
        if (!notification.readAt) {
          event.preventDefault();
          await markPortalNotificationRead(notification._id);
          location.assign(link.href);
        }
      });
      row.append(link);
    }
    if (!notification.readAt) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Mark read';
      button.style.cssText = 'margin-left:10px;padding:6px 10px';
      button.addEventListener('click', async () => {
        const updated = await markPortalNotificationRead(notification._id);
        if (!updated) return;
        message.textContent = `${notification.text} — ${new Date(notification.createdAt).toLocaleString()}`;
        button.remove();
      });
      row.append(button);
    }
    prepend ? list.prepend(row) : list.append(row);
    const title = document.querySelector('#notificationsPanel h2');
    if (title) title.textContent = `Notifications (${list.querySelectorAll('[data-unread="true"]').length} unread)`;
  };
  window.addEventListener('portal:notification', event => {
    if (!document.getElementById('notificationList')) {
      window.portalPendingNotifications = window.portalPendingNotifications || [];
      window.portalPendingNotifications.push(event.detail);
      return;
    }
    renderDashboardNotification(event.detail, true);
  });
  window.addEventListener('portal:notification-read', event => {
    const row = document.querySelector(`[data-notification-id="${CSS.escape(String(event.detail._id))}"]`);
    const message = row?.querySelector('p');
    if (message) message.textContent = `${event.detail.text} — ${new Date(event.detail.createdAt).toLocaleString()}`;
    if (row) row.dataset.unread = 'false';
    row?.querySelector('button')?.remove();
    const list = document.getElementById('notificationList');
    const title = document.querySelector('#notificationsPanel h2');
    if (list && title) title.textContent = `Notifications (${list.querySelectorAll('[data-unread="true"]').length} unread)`;
  });
  api('/api/dashboard').then(async ({ reports, claims, conversations, notifications }) => {
    const { user } = await api('/api/auth/me'); const box=document.getElementById('dashboardSummary');
    box.textContent=`Email: ${user.email}. You have ${reports.length} reports, ${claims.length} claims, ${conversations.length} conversations, and ${notifications.filter(n => !n.readAt).length} unread notifications.`;
    const heading=document.querySelector('main h1');heading.textContent='My Dashboard';
    const notice = document.createElement('section');
    notice.className = 'panel'; notice.style.marginTop = '20px'; notice.id = 'notificationsPanel';
    const header = document.createElement('div'); header.className = 'panel-header';
    const title = document.createElement('h2'); title.textContent = 'Notifications'; header.append(title);
    const list = document.createElement('div'); list.className = 'panel-body'; list.id = 'notificationList';
    notice.append(header, list);
    document.querySelector('main')?.append(notice);
    if (!notifications.length) { const empty = document.createElement('p'); empty.dataset.emptyNotifications = 'true'; empty.textContent = 'No notifications yet.'; list.append(empty); }
    notifications.forEach(notification => renderDashboardNotification(notification));
    (window.portalPendingNotifications || []).forEach(notification => renderDashboardNotification(notification, true));
    window.portalPendingNotifications = [];
    title.textContent = `Notifications (${list.querySelectorAll('[data-unread="true"]').length} unread)`;
  }).catch(e => { const box=document.getElementById('dashboardError');messageBox(box,`${e.message} Please log in to see your dashboard.`,true);setTimeout(()=>location.assign('login.html'),1600); });
  document.getElementById('logoutButton')?.addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});location.replace('login.html');});
}

if (location.pathname.toLowerCase().endsWith('/matches.html')) {
  const matchesList = document.getElementById('matchesList');
  const matchesLoading = document.getElementById('matchesLoading');
  const matchesError = document.getElementById('matchesError');
  const matchesEmpty = document.getElementById('matchesEmpty');
  const dateLabel = value => value ? new Date(value).toLocaleDateString() : 'Not provided';
  const appendField = (list, label, value) => {
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = value || 'Not provided';
    list.append(term, description);
  };
  const renderMatchedItem = (item, type) => {
    const section = document.createElement('section'); section.className = 'match-item';
    const title = document.createElement('h3'); title.textContent = `${type} item`; section.append(title);
    const fields = document.createElement('dl');
    appendField(fields, 'Name', item.itemName);
    appendField(fields, 'Category', item.category);
    appendField(fields, 'Description', item.description);
    appendField(fields, 'Location', item.location);
    appendField(fields, 'Date', dateLabel(item.date));
    appendField(fields, 'Report status', statusText(item.status));
    section.append(fields);
    const detail = document.createElement('a'); detail.className = 'secondary'; detail.href = `item.html?id=${encodeURIComponent(item._id)}`; detail.textContent = 'View item details';
    const actions = document.createElement('div'); actions.className = 'match-actions'; actions.append(detail);
    section.append(actions);
    return section;
  };
  const renderMatch = match => {
    if (!matchesList || matchesList.querySelector(`[data-match-id="${CSS.escape(String(match._id))}"]`)) return;
    const card = document.createElement('article'); card.className = 'match-card'; card.dataset.matchId = match._id;
    const heading = document.createElement('div'); heading.className = 'match-heading';
    const title = document.createElement('h2'); title.textContent = 'Possible lost and found match'; title.style.fontSize = '19px';
    const status = document.createElement('span'); status.className = `match-status ${String(match.status).toLowerCase().replace(/[^a-z]+/g, '-')}`; status.textContent = match.status;
    heading.append(title, status);
    const pair = document.createElement('div'); pair.className = 'match-items';
    pair.append(renderMatchedItem(match.lostItem, 'Lost'), renderMatchedItem(match.foundItem, 'Found'));
    card.append(heading, pair);
    if (match.contactItemId) {
      const actions = document.createElement('div'); actions.className = 'match-actions';
      const contact = document.createElement('button'); contact.type = 'button'; contact.textContent = 'Contact the other student';
      contact.addEventListener('click', async () => {
        contact.disabled = true;
        try {
          const { conversation } = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ itemId: match.contactItemId }) });
          location.assign(`history.html?conversation=${encodeURIComponent(conversation._id)}`);
        } catch (error) { contact.disabled = false; alert(error.message); }
      });
      actions.append(contact); card.append(actions);
    }
    matchesList.append(card);
  };
  let matchRequest = null;
  const loadMatches = async (refreshAfterActiveRequest = false) => {
    if (matchRequest) return refreshAfterActiveRequest ? matchRequest.then(() => loadMatches()) : matchRequest;
    matchesLoading.hidden = false; matchesError.hidden = true;
    matchRequest = api('/api/matches').then(({ matches }) => {
      matchesList.replaceChildren();
      matchesEmpty.hidden = matches.length > 0;
      matches.forEach(renderMatch);
    }).catch(error => { matchesError.textContent = error.message; matchesError.hidden = false; })
      .finally(() => { matchesLoading.hidden = true; matchRequest = null; });
    return matchRequest;
  };
  const notificationsList = document.getElementById('matchesNotifications');
  const renderMatchNotification = notification => {
    if (!notification._id || notificationsList.querySelector(`[data-notification-id="${CSS.escape(String(notification._id))}"]`)) return;
    document.getElementById('notificationsEmpty')?.remove();
    const row = document.createElement('article'); row.className = 'match-notification'; row.dataset.notificationId = notification._id;
    const text = document.createElement('p'); text.textContent = `${notification.readAt ? '' : 'New: '}${notification.text} — ${new Date(notification.createdAt).toLocaleString()}`;
    row.append(text);
    if (notification.link) {
      const link = document.createElement('a'); link.href = notification.link; link.textContent = 'View matching report';
      link.addEventListener('click', async event => { if (!notification.readAt) { event.preventDefault(); await markPortalNotificationRead(notification._id); location.assign(link.href); } });
      row.append(link);
    }
    if (!notification.readAt) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Mark read';
      button.addEventListener('click', async () => { if (await markPortalNotificationRead(notification._id)) { text.textContent = `${notification.text} — ${new Date(notification.createdAt).toLocaleString()}`; button.remove(); } });
      row.append(button);
    }
    notificationsList.prepend(row);
  };
  api('/api/notifications').then(({ notifications }) => {
    document.getElementById('notificationsEmpty')?.remove();
    notifications.forEach(renderMatchNotification);
    if (!notificationsList.querySelector('.match-notification')) { const empty = document.createElement('p'); empty.id = 'notificationsEmpty'; empty.textContent = 'No notifications yet.'; notificationsList.append(empty); }
  }).catch(() => { if (!notificationsList.querySelector('.match-notification')) notificationsList.textContent = 'Notifications could not be loaded right now.'; });
  window.addEventListener('portal:notification', event => {
    renderMatchNotification(event.detail);
    if (event.detail.type === 'possible_match') loadMatches(true);
  });
  window.addEventListener('portal:notification-read', event => {
    const row = notificationsList.querySelector(`[data-notification-id="${CSS.escape(String(event.detail._id))}"]`);
    const text = row?.querySelector('p');
    if (text) text.textContent = `${event.detail.text} — ${new Date(event.detail.createdAt).toLocaleString()}`;
    row?.querySelector('button')?.remove();
  });
  loadMatches();
}

if (document.getElementById('message') && !document.getElementById('foundForm')) { /* no-op */ }

if (studentOnlyPages.has(location.pathname.toLowerCase())) {
  const style=document.createElement('style');style.textContent=`#assistantToggle{position:fixed;right:22px;bottom:22px;z-index:1000;border:0;border-radius:999px;padding:14px 18px;background:#15558e;color:#fff;font-weight:700;box-shadow:0 4px 18px #1236;cursor:pointer}#assistantPanel{position:fixed;right:22px;bottom:84px;z-index:1001;width:min(380px,calc(100vw - 28px));height:min(560px,calc(100dvh - 110px));display:none;flex-direction:column;background:#fff;border:1px solid #cbd8e4;border-radius:12px;box-shadow:0 12px 40px #1234;color:#164579;font:14px Arial,sans-serif}#assistantPanel.open{display:flex}#assistantPanel header{display:flex;align-items:center;justify-content:space-between;background:#15558e;color:#fff;padding:12px 15px;border-radius:11px 11px 0 0}#assistantPanel header button{background:transparent;color:white;border:0;font-size:22px;cursor:pointer}#assistantMessages{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}#assistantMessages .botMessage,#assistantMessages .userMessage{max-width:90%;padding:10px 12px;border-radius:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}#assistantMessages .botMessage{align-self:flex-start;background:#eef5fb}#assistantMessages .userMessage{align-self:flex-end;background:#15558e;color:#fff}#assistantMessages a{display:inline-block;margin:8px 8px 0 0;color:#15558e;font-weight:bold}#assistantSuggestions{padding:0 10px 8px;display:flex;gap:6px;overflow-x:auto}#assistantSuggestions button{white-space:nowrap;border:1px solid #cbd8e4;border-radius:16px;background:#fff;color:#164579;padding:6px 9px;cursor:pointer;font-size:11px}#assistantForm{display:flex;gap:8px;padding:10px;border-top:1px solid #d8e3ed}#assistantInput{min-width:0;flex:1;padding:10px;border:1px solid #cbd8e4;border-radius:6px}#assistantForm button{background:#15558e;color:#fff;border:0;border-radius:6px;padding:0 14px;cursor:pointer}#assistantDisclaimer{font-size:11px;color:#607890;padding:0 12px 10px}@media(max-width:600px){#assistantToggle{right:14px;bottom:14px}#assistantPanel{right:10px;bottom:72px}}`;document.head.append(style);
  const toggle=document.createElement('button');toggle.id='assistantToggle';toggle.type='button';toggle.textContent='Lost & Found Assistant';toggle.setAttribute('aria-controls','assistantPanel');toggle.setAttribute('aria-expanded','false');
  const panel=document.createElement('section');panel.id='assistantPanel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Lost and Found Assistant');panel.setAttribute('aria-modal','false');
  panel.innerHTML='<header><strong>Lost &amp; Found Assistant</strong><button type="button" id="assistantClose" aria-label="Close assistant">−</button></header><div id="assistantMessages" aria-live="polite"></div><div id="assistantSuggestions"></div><div id="assistantDisclaimer">Guidance only. Official claim verification is still required.</div><form id="assistantForm"><input id="assistantInput" maxlength="1000" autocomplete="off" aria-label="Message the assistant" placeholder="Ask about a lost or found item"><button type="submit">Send</button></form>';
  document.body.append(toggle,panel);const messages=panel.querySelector('#assistantMessages'),input=panel.querySelector('#assistantInput'),suggestions=panel.querySelector('#assistantSuggestions');
  const addBubble=(text,kind='botMessage',links=[],items=[])=>{const bubble=document.createElement('div');bubble.className=kind;bubble.textContent=text;if(kind==='botMessage'){for(const link of links){if(!/^(?:[a-z-]+\.html)(?:\?|#|$)/i.test(link.href||''))continue;const a=document.createElement('a');a.href=link.href;a.textContent=link.label;bubble.append(document.createElement('br'),a);}for(const item of items){const row=document.createElement('div');row.style.marginTop='8px';row.textContent=`${item.type||'Unclassified'}: ${item.itemName} (${item.category}) — ${item.location}, ${new Date(item.date).toLocaleDateString()} — ${item.recoveryStatus||'open'}`;bubble.append(row);}}messages.append(bubble);messages.scrollTop=messages.scrollHeight;return bubble;};
  addBubble('Hello! I can help you report, search, and claim items around campus. What do you need?');
  ['How do I report a lost item?','I lost my College ID Card. What should I do?','How can I report a found item?','How do I check for matching items?','How do I claim my item?','How do I contact the administrator?'].forEach(q=>{const b=document.createElement('button');b.type='button';b.textContent=q;b.addEventListener('click',()=>{input.value=q;panel.querySelector('#assistantForm').requestSubmit();});suggestions.append(b);});
  const open=()=>{panel.classList.add('open');toggle.setAttribute('aria-expanded','true');input.focus();};const close=()=>{panel.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.focus();};toggle.addEventListener('click',()=>panel.classList.contains('open')?close():open());panel.querySelector('#assistantClose').addEventListener('click',close);
  panel.querySelector('#assistantForm').addEventListener('submit',async e=>{e.preventDefault();const message=input.value.trim();if(!message)return;input.value='';addBubble(message,'userMessage');const loading=addBubble('Thinking…');panel.querySelector('#assistantForm button').disabled=true;try{const data=await api('/api/chatbot/message',{method:'POST',body:JSON.stringify({message})});loading.remove();addBubble(data.answer,'botMessage',data.links||[],data.items||[]);}catch(error){loading.textContent=`I couldn't reach the assistant. Please try again, or use Search Items. (${error.message})`; }finally{panel.querySelector('#assistantForm button').disabled=false;input.focus();}});
}

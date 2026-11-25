import { sortRooms, relativeTime, expiresSoon } from './admin-view.js';

const $ = id => document.getElementById(id);
const rows = new Map();
let sdk, auth, provider, user, localKey = '', localMode = false;
let ready = false, loadBusy = false, mutationBusy = false, session = 0, pollTimer, toastTimer;
let createEnabled = false;

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}

function controls() {
  const busy = loadBusy || mutationBusy;
  for (const id of ['refresh', 'create-switch', 'create-room']) $(id).disabled = busy || !ready;
  for (const row of rows.values()) for (const button of row.actions.querySelectorAll('button')) button.disabled = busy;
  $('key-login').disabled = loadBusy;
}

function updateSwitch(value) {
  createEnabled = value;
  $('create-switch').setAttribute('aria-checked', String(value));
  $('switch-text').textContent = value ? 'เปิดอยู่' : 'ปิดอยู่';
}

function stopPolling() { clearInterval(pollTimer); pollTimer = undefined; }
function startPolling() {
  stopPolling();
  if (ready && document.visibilityState === 'visible') {
    pollTimer = setInterval(() => { if (!mutationBusy) void loadRooms(); }, 15_000);
  }
}

function clearSession() {
  session++;
  ready = false;
  loadBusy = false;
  mutationBusy = false;
  user = null;
  localKey = '';
  try { sessionStorage.removeItem('karaoke.admin'); } catch { /* Storage may be unavailable. */ }
  stopPolling();
  for (const row of rows.values()) row.dispose();
  rows.clear();
  $('rooms').replaceChildren();
  $('created-link').replaceChildren();
  $('created-link').hidden = true;
  $('dashboard').hidden = true;
  $('room-count').hidden = true;
  $('account').hidden = true;
  $('refresh').hidden = true;
  $('change-account').hidden = true;
  $('load-error').hidden = true;
  $('toast').hidden = true;
  $('email').textContent = '';
  $('admin-key').value = '';
  $('room-name').value = '';
  $('login').hidden = false;
  $('google-login').hidden = !auth;
  $('key-form').hidden = !localMode;
  $('auth-message').textContent = auth ? 'ใช้บัญชี Google ที่ได้รับสิทธิ์ผู้ดูแล' : 'ใส่กุญแจผู้ดูแลเพื่อเข้าใช้งาน';
  controls();
}

async function logout() {
  clearSession();
  if (auth) {
    try { await sdk.signOut(auth); } catch { notify('ออกจากระบบไม่สำเร็จ ลองอีกครั้ง'); }
  }
}

function showAccount() {
  $('email').textContent = user?.email || 'ผู้ดูแลบนเครื่อง';
  $('account').hidden = false;
  $('google-login').hidden = true;
  $('change-account').hidden = !user;
}

async function api(command) {
  let token;
  if (user) {
    try { token = await sdk.getIdToken(user); }
    catch { throw Object.assign(new Error('bad_admin_key'), { status: 401 }); }
  } else token = localKey;
  const response = await fetch('/api/admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(command), cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'request_failed'), { status: response.status });
  return result;
}

async function authFailure(error) {
  if (error.status === 401) {
    await logout();
    $('auth-message').textContent = localMode ? 'กุญแจผู้ดูแลไม่ถูกต้อง' : 'กรุณาเข้าสู่ระบบอีกครั้ง';
    return true;
  }
  if (error.status === 403 || (error.status === 503 && ['admin_disabled', 'not_configured'].includes(error.message))) {
    ready = false;
    stopPolling();
    $('dashboard').hidden = true;
    $('room-count').hidden = true;
    $('refresh').hidden = true;
    $('login').hidden = false;
    $('load-error').hidden = true;
    $('auth-message').textContent = error.status === 403
      ? `บัญชี ${user?.email || ''} ไม่มีสิทธิ์ผู้ดูแล` : 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าผู้ดูแล';
    $('change-account').hidden = !user;
    controls();
    return true;
  }
  return false;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showLink(container, url, rotated, id) {
  const box = element('div', 'link-box');
  const label = element('label', '', rotated ? 'ลิงก์เจ้าของใหม่' : 'ลิงก์เจ้าของห้อง');
  const input = element('input');
  input.id = id;
  input.type = 'text';
  input.readOnly = true;
  input.value = url;
  label.htmlFor = id;
  const copy = element('button', 'btn-glass', 'คัดลอก');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(input.value); notify('คัดลอกลิงก์แล้ว'); }
    catch { input.focus(); input.select(); notify('คัดลอกอัตโนมัติไม่ได้ เลือกคัดลอกลิงก์จากช่องนี้'); }
  });
  box.append(label, input, copy, element('p', '', 'ส่งลิงก์นี้ทางช่องทางส่วนตัวเท่านั้น'));
  if (rotated) box.append(element('p', '', 'ลิงก์เดิมใช้ไม่ได้แล้ว'));
  container.replaceChildren(box);
  container.hidden = false;
  input.focus();
  input.select();
}

async function mutate(command, success) {
  if (!ready || mutationBusy || loadBusy) return;
  const version = session;
  mutationBusy = true;
  controls();
  try {
    const result = await api(command);
    if (version !== session) return;
    await success(result);
  } catch (error) {
    if (version !== session) return;
    if (!await authFailure(error)) notify(error.message === 'bad_name' ? 'ใส่ชื่อห้อง 1–40 ตัวอักษร' : 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
  } finally {
    if (version === session) { mutationBusy = false; controls(); }
  }
}

function roomRow(room) {
  const node = element('li', 'glass room');
  const heading = element('div', 'section-heading');
  const name = element('h3');
  const warning = element('span', 'pill is-warn', 'ใกล้หมดอายุ');
  heading.append(name, warning);
  const id = element('span', 'room-id', room.roomId);
  const summary = element('div', 'room-summary');
  const queue = element('p');
  const current = element('p', 'muted');
  summary.append(queue, current);
  const times = element('div', 'room-times');
  const created = element('span'), updated = element('span');
  times.append(created, updated);
  const actions = element('div', 'room-actions');
  const link = element('div');
  link.hidden = true;
  const resets = [];
  for (const [action, label, confirm] of [
    ['rotateOwner', 'ออกลิงก์เจ้าของใหม่', 'ยืนยันออกลิงก์ใหม่ · ลิงก์เดิมจะใช้ไม่ได้'],
    ['delete', 'ปิดห้อง', 'ยืนยันปิดห้อง · ลบห้องและคิว'],
  ]) {
    const button = element('button', `btn-glass${action === 'delete' ? ' danger' : ''}`, label);
    button.type = 'button';
    let timer, armed = false;
    const reset = () => { clearTimeout(timer); armed = false; button.textContent = label; button.classList.remove('is-confirm'); };
    resets.push(reset);
    button.addEventListener('click', () => {
      if (!armed) {
        for (const cancel of resets) cancel();
        armed = true;
        button.textContent = confirm;
        button.classList.add('is-confirm');
        timer = setTimeout(reset, 4000);
        return;
      }
      reset();
      void mutate({ action, roomId: room.roomId }, async result => {
        if (action === 'rotateOwner') {
          showLink(link, result.ownerUrl, true, `owner-${room.roomId}`);
          notify('ออกลิงก์เจ้าของใหม่แล้ว ลิงก์เดิมใช้ไม่ได้แล้ว');
        } else {
          $('rooms-title').tabIndex = -1;
          $('rooms-title').focus();
          notify('ปิดห้องแล้ว');
        }
        await loadRooms();
      });
    });
    actions.append(button);
  }
  node.append(heading, id, summary, times, actions, link);
  return { node, actions, dispose: () => resets.forEach(reset => reset()), update(data, limits, at) {
    name.textContent = data.name;
    warning.hidden = !expiresSoon(data, limits, at);
    queue.textContent = `คิว ${data.queueLength} เพลง`;
    current.textContent = data.current ? `กำลังเล่น · ${data.current}` : 'ยังไม่มีเพลงที่กำลังเล่น';
    created.textContent = `สร้างเมื่อ ${relativeTime(data.createdAt, at)}`;
    updated.textContent = `ใช้ล่าสุด ${relativeTime(data.updatedAt, at)}`;
  } };
}

function render(data) {
  const at = Date.now();
  updateSwitch(data.createEnabled);
  $('room-count').textContent = `${data.rooms.length} / ${data.limits.maxRooms} ห้อง`;
  $('room-count').hidden = false;
  $('empty').hidden = data.rooms.length !== 0;
  const ids = new Set(data.rooms.map(room => room.roomId));
  for (const [id, row] of rows) if (!ids.has(id)) { row.dispose(); row.node.remove(); rows.delete(id); }
  // Keep existing controls, confirmation timers and owner links across polling.
  let previous = null;
  for (const room of sortRooms(data.rooms)) {
    if (!rows.has(room.roomId)) rows.set(room.roomId, roomRow(room));
    const row = rows.get(room.roomId);
    row.update(room, data.limits, at);
    const next = previous ? previous.nextElementSibling : $('rooms').firstElementChild;
    if (row.node !== next) $('rooms').insertBefore(row.node, next);
    previous = row.node;
  }
}

async function loadRooms() {
  if (loadBusy || (!user && !localKey)) return;
  const version = session;
  loadBusy = true;
  controls();
  try {
    const data = await api({ action: 'list' });
    if (version !== session) return;
    render(data);
    ready = true;
    $('dashboard').hidden = false;
    $('login').hidden = true;
    $('refresh').hidden = false;
    $('load-error').hidden = true;
    showAccount();
    startPolling();
  } catch (error) {
    if (version !== session) return;
    if (!await authFailure(error)) {
      $('load-error').textContent = 'โหลดรายการไม่ได้ จะลองใหม่';
      $('load-error').hidden = false;
      // Also retry an initial list failure while credentials remain available.
      stopPolling();
      if (document.visibilityState === 'visible') pollTimer = setInterval(() => { if (!mutationBusy) void loadRooms(); }, 15_000);
    }
  } finally {
    if (version === session) { loadBusy = false; controls(); }
  }
}

$('logout').addEventListener('click', () => { void logout(); });
$('change-account').addEventListener('click', () => { void logout(); });
$('refresh').addEventListener('click', () => { if (!mutationBusy) void loadRooms(); });
$('key-form').addEventListener('submit', event => {
  event.preventDefault();
  if (loadBusy) return;
  localKey = $('admin-key').value;
  try { sessionStorage.setItem('karaoke.admin', localKey); } catch { /* Keep working in memory. */ }
  showAccount();
  void loadRooms();
});
$('create-switch').addEventListener('click', () => {
  const before = createEnabled;
  void mutate({ action: 'setCreate', enabled: !before }, result => {
    updateSwitch(result.createEnabled);
    notify(result.createEnabled ? 'เปิดรับการสร้างห้องแล้ว' : 'ปิดรับการสร้างห้องแล้ว');
  });
});
$('create-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('room-name').value.trim();
  if (!name) { $('room-name').focus(); notify('กรุณาใส่ชื่อห้อง'); return; }
  void mutate({ action: 'create', name }, async result => {
    $('room-name').value = '';
    showLink($('created-link'), result.ownerUrl, false, 'created-owner');
    notify('สร้างห้องแล้ว');
    await loadRooms();
  });
});
document.addEventListener('visibilitychange', () => {
  stopPolling();
  if (document.visibilityState === 'visible' && (user || localKey) && (ready || !$('load-error').hidden)) {
    if (!mutationBusy) void loadRooms(); else startPolling();
  }
});

async function init() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok) {
      $('auth-message').textContent = response.status === 503 ? 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าผู้ดูแล' : 'โหลดระบบล็อกอินไม่ได้ ลองรีเฟรช';
      return;
    }
    if (config.firebase) {
      try {
        const [appSdk, authSdk] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js'),
        ]);
        sdk = authSdk;
        auth = sdk.getAuth(appSdk.initializeApp(config.firebase));
        provider = new sdk.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        $('google-login').addEventListener('click', () => {
          // Invoke synchronously inside the click handler so the popup keeps user activation.
          const signingIn = sdk.signInWithPopup(auth, provider);
          $('google-login').disabled = true;
          void signingIn.catch(error => {
            if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) return;
            $('auth-message').textContent = error.code === 'auth/popup-blocked'
              ? 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน อนุญาตป๊อปอัปแล้วลองใหม่'
              : error.code === 'auth/unauthorized-domain' ? 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase' : 'เข้าสู่ระบบไม่สำเร็จ';
          }).finally(() => { $('google-login').disabled = false; });
        });
        sdk.onAuthStateChanged(auth, nextUser => {
          clearSession();
          user = nextUser;
          if (user) { showAccount(); $('auth-message').textContent = 'กำลังตรวจสิทธิ์ผู้ดูแล…'; void loadRooms(); }
        });
      } catch { $('auth-message').textContent = 'โหลดระบบล็อกอินไม่ได้ ลองรีเฟรช'; }
    } else if (config.mode === 'local') {
      localMode = true;
      clearSessionForLocal();
    } else $('auth-message').textContent = 'ยังไม่ได้ตั้งค่าการล็อกอินของผู้ดูแล';
  } catch { $('auth-message').textContent = 'โหลดระบบล็อกอินไม่ได้ ลองรีเฟรช'; }
}

function clearSessionForLocal() {
  let saved = '';
  try { saved = sessionStorage.getItem('karaoke.admin') || ''; } catch { /* Optional persistence. */ }
  clearSession();
  if (saved) {
    localKey = saved;
    try { sessionStorage.setItem('karaoke.admin', saved); } catch { /* Optional persistence. */ }
    showAccount();
    void loadRooms();
  }
}

void init();

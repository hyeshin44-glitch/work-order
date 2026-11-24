/* 작업지시 관리 – 수파베이스 버전 */
(function () {
'use strict';

const CFG = window.APP_CONFIG || {};
const QN = [1,2,3,4,5,6,7,8,9,10,11,12];
const NAME_KEY = 'wo_login_name';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- 데이터 저장소 ---------- */
function supabaseStore() {
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    demo: false,
    async listOrders() { return chk(await sb.from('work_orders').select('*').order('id')); },
    async addOrder(o) { return chk(await sb.from('work_orders').insert(o).select().single()); },
    async updateOrder(id, p) { p.updated_at = new Date().toISOString(); return chk(await sb.from('work_orders').update(p).eq('id', id).select().single()); },
    async deleteOrder(id) { chk(await sb.from('work_orders').delete().eq('id', id)); },
    async listSpecs() { return chk(await sb.from('specs').select('*').order('name')); },
    async addSpec(s) { return chk(await sb.from('specs').insert(s).select().single()); },
    async updateSpec(id, s) { return chk(await sb.from('specs').update(s).eq('id', id).select().single()); },
    async deleteSpec(id) { chk(await sb.from('specs').delete().eq('id', id)); },
    async reset(includeSpecs) { chk(await sb.rpc('reset_season', { include_specs: includeSpecs })); },
    subscribe(cb) {
      sb.channel('wo-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, () => cb('orders'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'specs' }, () => cb('specs'))
        .subscribe();
    }
  };
}

function localStore() {
  const K = 'wo_demo_db';
  const load = () => { try { return JSON.parse(localStorage.getItem(K)) || null; } catch (e) { return null; } };
  let db = load() || { orders: [], specs: [], seqO: 1, seqS: 1 };
  const save = () => { try { localStorage.setItem(K, JSON.stringify(db)); } catch (e) {} };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    demo: true,
    async listOrders() { return clone(db.orders); },
    async addOrder(o) { const r = Object.assign({ id: db.seqO++, order_date: today(), in_progress: false, done: false, created_at: new Date().toISOString() }, o); db.orders.push(r); save(); return clone(r); },
    async updateOrder(id, p) { const r = db.orders.find(x => x.id === id); Object.assign(r, p); save(); return clone(r); },
    async deleteOrder(id) { db.orders = db.orders.filter(x => x.id !== id); save(); },
    async listSpecs() { return clone(db.specs).sort((a, b) => a.name.localeCompare(b.name, 'ko')); },
    async addSpec(s) { if (db.specs.some(x => x.name === s.name)) throw new Error('duplicate key'); const r = Object.assign({ id: db.seqS++ }, s); db.specs.push(r); save(); return clone(r); },
    async updateSpec(id, s) { const r = db.specs.find(x => x.id === id); Object.assign(r, s); save(); return clone(r); },
    async deleteSpec(id) { db.specs = db.specs.filter(x => x.id !== id); save(); },
    async reset(includeSpecs) { db.orders = []; db.seqO = 1; if (includeSpecs) { db.specs = []; db.seqS = 1; } save(); },
    subscribe() {}
  };
}

const store = (CFG.SUPABASE_URL && window.supabase) ? supabaseStore() : localStore();

/* ---------- 상태 ---------- */
const state = { name: '', orders: [], specs: [], editingId: null, editingSpecId: null, orient: 'portrait' };

/* ---------- 도우미 ---------- */
function today() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // 한국 시간
  return d.toISOString().slice(0, 10);
}
const DOW = ['일','월','화','수','목','금','토'];
function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return `${m}/${d}(${DOW[w]})`;
}
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function num(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
function totalOf(o) { return QN.reduce((s, n) => s + (o['q' + n] || 0) * n, 0); }
function specOf(item) { return state.specs.find(s => s.name === item); }
function perBoxOf(o) { const s = specOf(o.item); return s && s.per_box ? s.per_box : null; }
function boxesOf(total, per) { if (!per) return null; return { box: Math.floor(total / per), rest: total % per }; }
function boxText(b) { return b ? `${b.box}박스 ${b.rest}개` : '-'; }
function uniq(arr) { return Array.from(new Set(arr.filter(v => v !== null && v !== undefined && v !== ''))); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }
function fail(e) { console.error(e); toast('오류: ' + (e.message || e)); }
function fillSelect(sel, values, label, fmt) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` + values.map(v => `<option value="${esc(v)}">${esc(fmt ? fmt(v) : v)}</option>`).join('');
  if (values.includes(cur)) sel.value = cur;
}

/* ---------- 로그인 ---------- */
function getSavedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
function setSavedName(n) { try { n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY); } catch (e) {} }
function showLogin() { $('#login').classList.remove('hidden'); $('#loginName').value = state.name || ''; setTimeout(() => $('#loginName').focus(), 50); }
function applyName(n) {
  state.name = n;
  $('#whoName').textContent = n;
  $('#setName').textContent = n;
  if (!state.editingId) $('#f_instructor').value = n;
}
$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = $('#loginName').value.trim().replace(/\s+/g, ' ');
  if (!n) return;
  setSavedName(n); applyName(n);
  $('#login').classList.add('hidden');
});
$('#logoutBtn').addEventListener('click', showLogin);
$('#changeNameBtn').addEventListener('click', showLogin);

/* ---------- 탭 ---------- */
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
  renderAll();
});

/* ---------- 입력 폼 ---------- */
$('#qtyGrid').innerHTML = QN.map(n => `<label>수량${n} <small>×${n}</small><input type="number" min="0" inputmode="numeric" id="f_q${n}"></label>`).join('');

function formData() {
  const o = {
    ship_date: $('#f_ship_date').value || null,
    customer: $('#f_customer').value.trim(),
    destination: $('#f_destination').value.trim(),
    item: $('#f_item').value.trim(),
    outbox: $('#f_outbox').value.trim(),
    memo: $('#f_memo').value.trim()
  };
  QN.forEach(n => { o['q' + n] = num($('#f_q' + n).value); });
  return o;
}
function updateSummary() {
  const o = formData();
  const t = totalOf(o);
  const s = specOf(o.item);
  $('#s_total').textContent = t.toLocaleString();
  $('#s_per').textContent = s && s.per_box ? s.per_box : '-';
  $('#s_box').textContent = boxText(boxesOf(t, s && s.per_box));
}
function resetForm() {
  state.editingId = null;
  $('#orderForm').reset();
  $('#f_instructor').value = state.name;
  $('#f_order_date').value = fmtDate(today()) + ' (저장 시 자동)';
  $('#formTitle').textContent = '새 작업지시 등록';
  $('#saveBtn').textContent = '저장';
  $('#deleteBtn').classList.add('hidden');
  updateSummary();
  renderOrderTable();
}
function loadIntoForm(o) {
  state.editingId = o.id;
  $('#f_instructor').value = o.instructor;
  $('#f_order_date').value = fmtDate(o.order_date);
  $('#f_ship_date').value = o.ship_date || '';
  $('#f_customer').value = o.customer || '';
  $('#f_destination').value = o.destination || '';
  $('#f_item').value = o.item || '';
  $('#f_outbox').value = o.outbox || '';
  $('#f_memo').value = o.memo || '';
  QN.forEach(n => { $('#f_q' + n).value = o['q' + n] == null ? '' : o['q' + n]; });
  $('#formTitle').textContent = `작업지시 수정 (No.${o.id})`;
  $('#saveBtn').textContent = '수정 저장';
  $('#deleteBtn').classList.remove('hidden');
  updateSummary();
  renderOrderTable();
  if (window.innerWidth < 900) $('#orderForm').scrollIntoView({ behavior: 'smooth' });
}
$('#orderForm').addEventListener('input', updateSummary);
$('#f_item').addEventListener('change', () => {
  const s = specOf($('#f_item').value.trim());
  if (s && s.outbox) $('#f_outbox').value = s.outbox;
  updateSummary();
});
$('#resetFormBtn').addEventListener('click', resetForm);
$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const o = formData();
  if (!o.item && !o.customer && !o.destination) { toast('품목이나 주문자를 입력해 주세요'); return; }
  const btn = $('#saveBtn'); btn.disabled = true;
  try {
    if (state.editingId) {
      const r = await store.updateOrder(state.editingId, o);
      replaceOrder(r); toast(`No.${r.id} 수정했어요`);
    } else {
      o.instructor = state.name;
      o.order_date = today();
      const r = await store.addOrder(o);
      state.orders.push(r); toast(`No.${r.id} 저장했어요`);
    }
    resetForm(); renderAll();
  } catch (err) { fail(err); }
  btn.disabled = false;
});
$('#deleteBtn').addEventListener('click', async () => {
  const id = state.editingId; if (!id) return;
  if (!confirm(`No.${id} 작업지시를 삭제할까요?`)) return;
  try { await store.deleteOrder(id); state.orders = state.orders.filter(x => x.id !== id); resetForm(); renderAll(); toast('삭제했어요'); } catch (err) { fail(err); }
});
function replaceOrder(r) { const i = state.orders.findIndex(x => x.id === r.id); if (i >= 0) state.orders[i] = r; else state.orders.push(r); }

/* ---------- 작업지시 목록 ---------- */
function sortOrders(list) {
  return list.slice().sort((a, b) => (a.ship_date || '9999').localeCompare(b.ship_date || '9999') || a.id - b.id);
}
function filteredOrders() {
  const ship = $('#flt_ship').value, inst = $('#flt_inst').value, done = $('#flt_done').value,
        prog = $('#flt_prog').value, od = $('#flt_odate').value, q = $('#flt_q').value.trim().toLowerCase();
  return sortOrders(state.orders.filter(o =>
    (!ship || o.ship_date === ship) &&
    (!inst || o.instructor === inst) &&
    (done === '' || String(+o.done) === done) &&
    (prog === '' || String(+o.in_progress) === prog) &&
    (!od || o.order_date === od) &&
    (!q || [o.item, o.customer, o.destination, o.memo].join(' ').toLowerCase().includes(q))
  ));
}
function refreshFilters() {
  fillSelect($('#flt_ship'), uniq(state.orders.map(o => o.ship_date)).sort(), '전체', fmtDate);
  fillSelect($('#flt_inst'), uniq(state.orders.map(o => o.instructor)).sort((a, b) => a.localeCompare(b, 'ko')), '전체');
  const od = uniq(state.orders.map(o => o.order_date)).sort();
  ['#flt_odate', '#m_odate', '#t_odate'].forEach(s => fillSelect($(s), od, s === '#flt_odate' ? '전체' : '작업지시일 : 전체', fmtDate));
  $('#itemList').innerHTML = state.specs.map(s => `<option value="${esc(s.name)}">`).join('');
  $('#memoList').innerHTML = uniq(state.orders.map(o => o.memo)).slice(0, 200).map(m => `<option value="${esc(m)}">`).join('');
}
function qtyHead() { return QN.map(n => `<th class="c">수량${n}<small>×${n}</small></th>`).join(''); }
function qtyCells(o) { return QN.map(n => `<td class="c">${o['q' + n] ? o['q' + n] : '<span class="dim">·</span>'}</td>`).join(''); }

function renderOrderTable() {
  const list = filteredOrders();
  $('#listCount').textContent = `(${list.length}건 / 전체 ${state.orders.length}건)`;
  const head = `<thead><tr><th class="c">작업<br>진행중</th><th class="c">작업No.</th><th class="c">지시자</th><th class="c">완료</th><th class="c">출고일</th><th class="c">작업지시일</th><th>주문자</th><th>주문처</th><th>품목</th><th>아웃박스</th>${qtyHead()}<th class="r">총수량</th><th class="c">작업박스</th><th>비고</th></tr></thead>`;
  if (!list.length) { $('#orderTable').innerHTML = head + `<tbody><tr><td colspan="27" class="empty">${state.orders.length ? '조건에 맞는 작업지시가 없어요' : '아직 등록된 작업지시가 없어요. 왼쪽에서 첫 작업지시를 등록해 보세요.'}</td></tr></tbody>`; return; }
  const rows = list.map(o => {
    const t = totalOf(o);
    return `<tr class="click${o.done ? ' done' : ''}${o.id === state.editingId ? ' editing' : ''}" data-id="${o.id}">
      <td class="c"><input type="checkbox" class="prog" ${o.in_progress ? 'checked' : ''} title="작업진행중"></td>
      <td class="c"><b>${o.id}</b></td>
      <td class="c">${esc(o.instructor)}</td>
      <td class="c"><span class="pill done-toggle${o.done ? ' on' : ''}">${o.done ? '완료됨' : '미완료'}</span></td>
      <td class="c">${fmtDate(o.ship_date)}</td>
      <td class="c">${fmtDate(o.order_date)}</td>
      <td>${esc(o.customer)}</td><td>${esc(o.destination)}</td><td>${esc(o.item)}</td><td>${esc(o.outbox)}</td>
      ${qtyCells(o)}
      <td class="r"><b>${t.toLocaleString()}</b></td>
      <td class="c">${boxText(boxesOf(t, perBoxOf(o)))}</td>
      <td class="wrap">${esc(o.memo)}</td></tr>`;
  }).join('');
  $('#orderTable').innerHTML = head + '<tbody>' + rows + '</tbody>';
}
$('#orderTable').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const id = +tr.dataset.id; const o = state.orders.find(x => x.id === id); if (!o) return;
  if (e.target.classList.contains('prog')) {
    try { replaceOrder(await store.updateOrder(id, { in_progress: e.target.checked })); renderAll(); } catch (err) { fail(err); }
    return;
  }
  if (e.target.classList.contains('done-toggle')) {
    try { replaceOrder(await store.updateOrder(id, { done: !o.done })); renderAll(); } catch (err) { fail(err); }
    return;
  }
  loadIntoForm(o);
});
['#flt_ship', '#flt_inst', '#flt_done', '#flt_prog', '#flt_odate'].forEach(s => $(s).addEventListener('change', renderOrderTable));
$('#flt_q').addEventListener('input', renderOrderTable);
$('#fltReset').addEventListener('click', () => { ['#flt_ship', '#flt_inst', '#flt_done', '#flt_prog', '#flt_odate', '#flt_q'].forEach(s => $(s).value = ''); renderOrderTable(); });
$('#orient').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.orient = b.dataset.o; $$('#orient button').forEach(x => x.classList.toggle('on', x === b));
});

/* ---------- 인쇄 ---------- */
function doPrint(html, orient) {
  $('#pageStyle').textContent = `@page{size:A4 ${orient || 'portrait'};margin:10mm}`;
  $('#printArea').innerHTML = html;
  setTimeout(() => window.print(), 50);
}
$('#printBtn').addEventListener('click', () => {
  const list = filteredOrders().filter(o => !o.done && !o.in_progress);
  if (!list.length) { toast('인쇄할 작업지시가 없어요 (미완료 & 진행중 아닌 건)'); return; }
  const usedQ = QN.filter(n => list.some(o => o['q' + n]));
  const rows = list.map(o => {
    const t = totalOf(o);
    return `<tr><td class="c">${o.id}</td><td class="c">${esc(o.instructor)}</td><td class="c">${fmtDate(o.ship_date)}</td><td>${esc(o.customer)}</td><td>${esc(o.destination)}</td><td>${esc(o.item)}</td><td>${esc(o.outbox)}</td>${usedQ.map(n => `<td class="c">${o['q' + n] || ''}</td>`).join('')}<td class="r">${t}</td><td class="c">${boxText(boxesOf(t, perBoxOf(o)))}</td><td>${esc(o.memo)}</td></tr>`;
  }).join('');
  doPrint(`<div class="ptitle">작업지시서</div><div class="pmeta">인쇄: ${fmtDate(today())} · ${list.length}건</div>
    <table class="ptbl"><thead><tr><th>No.</th><th>지시자</th><th>출고일</th><th>주문자</th><th>주문처</th><th>품목</th><th>아웃박스</th>${usedQ.map(n => `<th class="c">수량${n}<br>×${n}</th>`).join('')}<th>총수량</th><th>작업박스</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table>`, state.orient);
});

/* ---------- CSV ---------- */
function downloadCsv(list, filename) {
  const head = ['작업No', '지시자', '작업지시일', '출고일', '주문자', '주문처', '품목', '아웃박스', ...QN.map(n => '수량' + n), '총수량', '작업박스', '비고', '작업진행중', '완료'];
  const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [head.join(',')].concat(sortOrders(list).map(o => {
    const t = totalOf(o);
    return [o.id, o.instructor, o.order_date, o.ship_date, o.customer, o.destination, o.item, o.outbox, ...QN.map(n => o['q' + n] || ''), t, boxText(boxesOf(t, perBoxOf(o))), o.memo, o.in_progress ? 'O' : '', o.done ? 'O' : ''].map(cell).join(',');
  }));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#csvBtn').addEventListener('click', () => downloadCsv(filteredOrders(), `작업지시_${today()}.csv`));
$('#backupBtn').addEventListener('click', () => {
  if (!state.orders.length) { toast('내려받을 작업지시가 없어요'); return; }
  downloadCsv(state.orders, `작업지시_전체백업_${today()}.csv`);
});

/* ---------- 통합 관리 ---------- */
function sectionsOf(list, doneFilter) {
  const secs = [];
  if (doneFilter !== '1') secs.push({ label: '미완료', rows: list.filter(o => !o.done) });
  if (doneFilter !== '0') secs.push({ label: '완료', rows: list.filter(o => o.done) });
  return secs.filter(s => s.rows.length);
}
function manageData() {
  const od = $('#m_odate').value, done = $('#m_done').value;
  return { list: state.orders.filter(o => (!od || o.order_date === od) && (done === '' || String(+o.done) === done)), done };
}
function manageTableHtml(cls) {
  const { list, done } = manageData();
  const head = `<thead><tr><th>품목</th><th>지시자</th><th>출고일</th><th>주문자</th><th>주문처</th><th class="r">총수량</th><th>비고</th></tr></thead>`;
  if (!list.length) return head + '<tbody><tr><td colspan="7" class="empty">데이터가 없어요</td></tr></tbody>';
  let body = '';
  sectionsOf(list, done).forEach(sec => {
    body += `<tr class="section"><td colspan="7">${sec.label} (${sec.rows.length}건)</td></tr>`;
    const rows = sec.rows.slice().sort((a, b) => (a.item || '').localeCompare(b.item || '', 'ko') || (a.instructor || '').localeCompare(b.instructor || '', 'ko') || (a.ship_date || '').localeCompare(b.ship_date || '') || a.id - b.id);
    let prev = null;
    rows.forEach(o => {
      const same = prev !== null && prev === o.item; prev = o.item;
      body += `<tr><td>${same ? '<span class="dim">〃</span>' : esc(o.item)}</td><td>${esc(o.instructor)}</td><td>${fmtDate(o.ship_date)}</td><td>${esc(o.customer)}</td><td>${esc(o.destination)}</td><td class="r">${totalOf(o).toLocaleString()}</td><td class="wrap">${esc(o.memo)}</td></tr>`;
    });
  });
  return head + '<tbody>' + body + '</tbody>';
}
function renderManage() {
  const { list } = manageData();
  let boxes = 0, total = 0;
  list.forEach(o => { const t = totalOf(o); total += t; const b = boxesOf(t, perBoxOf(o)); if (b) boxes += b.box; });
  const stat = (l, v) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`;
  $('#m_stats').innerHTML = stat('작업지시일', uniq(list.map(o => o.order_date)).length + '일') + stat('작업지시 건수', list.length + '건') + stat('품목', uniq(list.map(o => o.item)).length + '종') + stat('총 작업박스', boxes.toLocaleString() + '박스') + stat('총 수량', total.toLocaleString());
  $('#m_table').innerHTML = manageTableHtml();
}
['#m_odate', '#m_done'].forEach(s => $(s).addEventListener('change', renderManage));
$('#m_print').addEventListener('click', () => {
  const od = $('#m_odate').value;
  doPrint(`<div class="ptitle">통합 관리</div><div class="pmeta">작업지시일: ${od ? fmtDate(od) : '전체'} · ${$('#m_stats').innerText.replace(/\n/g, ' ')}</div><table class="ptbl">${manageTableHtml().replace(/class="dim"/g, '')}</table>`, 'portrait');
});

/* ---------- 통합관리(총수량) ---------- */
function totalTableHtml() {
  const od = $('#t_odate').value, done = $('#t_done').value;
  const list = state.orders.filter(o => (!od || o.order_date === od) && (done === '' || String(+o.done) === done));
  const head = `<thead><tr><th>아웃박스</th><th>품목</th><th class="c">출고일</th><th class="r">총수량</th><th class="c">작업박스</th><th class="r">박스</th><th class="r">개</th></tr></thead>`;
  if (!list.length) return head + '<tbody><tr><td colspan="7" class="empty">데이터가 없어요</td></tr></tbody>';
  let body = '';
  sectionsOf(list, done).forEach(sec => {
    body += `<tr class="section"><td colspan="7">${sec.label} (${sec.rows.length}건)</td></tr>`;
    // 아웃박스 + 품목별로 묶고, 그 안에서 출고일별 합계
    const groups = new Map();
    sec.rows.forEach(o => {
      const key = (o.outbox || '') + '\u0001' + (o.item || '');
      if (!groups.has(key)) groups.set(key, { outbox: o.outbox || '', item: o.item || '', byDate: new Map() });
      const g = groups.get(key); const d = o.ship_date || '';
      g.byDate.set(d, (g.byDate.get(d) || 0) + totalOf(o));
    });
    const sorted = Array.from(groups.values()).sort((a, b) =>
      ((a.outbox ? 0 : -1) - (b.outbox ? 0 : -1)) || a.outbox.localeCompare(b.outbox, 'ko', { numeric: true }) || a.item.localeCompare(b.item, 'ko'));
    let prevOut = null;
    sorted.forEach(g => {
      const per = (specOf(g.item) || {}).per_box;
      let st = 0, sb = 0, sr = 0, first = true;
      Array.from(g.byDate.keys()).sort().forEach(d => {
        const t = g.byDate.get(d); const b = boxesOf(t, per);
        st += t; if (b) { sb += b.box; sr += b.rest; }
        const outCell = (first && prevOut !== g.outbox) ? esc(g.outbox || '(미지정)') : '<span class="dim">〃</span>';
        body += `<tr><td>${outCell}</td><td>${first ? esc(g.item) : '<span class="dim">〃</span>'}</td><td class="c">${fmtDate(d)}</td><td class="r">${t.toLocaleString()}</td><td class="c">${b ? boxText(b) : ''}</td><td class="r">${b ? b.box : ''}</td><td class="r">${b ? b.rest : ''}</td></tr>`;
        first = false; prevOut = g.outbox;
      });
      body += `<tr class="subtotal"><td></td><td>${esc(g.item || '(품목 없음)')} 소계</td><td></td><td class="r">${st.toLocaleString()}</td><td class="c">${per ? `${sb}박스 ${sr}개` : ''}</td><td class="r">${per ? sb : ''}</td><td class="r">${per ? sr : ''}</td></tr>`;
    });
  });
  return head + '<tbody>' + body + '</tbody>';
}
function renderTotal() { $('#t_table').innerHTML = totalTableHtml(); }
['#t_odate', '#t_done'].forEach(s => $(s).addEventListener('change', renderTotal));
$('#t_print').addEventListener('click', () => {
  const od = $('#t_odate').value;
  doPrint(`<div class="ptitle">통합관리 (총수량)</div><div class="pmeta">작업지시일: ${od ? fmtDate(od) : '전체'}</div><table class="ptbl">${totalTableHtml().replace(/class="dim"/g, '')}</table>`, 'portrait');
});

/* ---------- 규격 ---------- */
function resetSpecForm() { state.editingSpecId = null; $('#specForm').reset(); $('#specTitle').textContent = '규격 등록'; }
function renderSpecs() {
  $('#specCount').textContent = `(${state.specs.length}건)`;
  const head = '<thead><tr><th>품명</th><th>규격</th><th class="c">입수량</th><th>포장박스</th><th class="c">관리</th></tr></thead>';
  if (!state.specs.length) { $('#specTable').innerHTML = head + '<tbody><tr><td colspan="5" class="empty">등록된 규격이 없어요. 품명과 입수량을 등록하면 작업박스가 자동 계산돼요.</td></tr></tbody>'; return; }
  $('#specTable').innerHTML = head + '<tbody>' + state.specs.map(s => `<tr data-id="${s.id}"><td>${esc(s.name)}</td><td>${esc(s.spec)}</td><td class="c">${s.per_box ?? ''}</td><td>${esc(s.outbox)}</td><td class="c"><button class="btn sm sp-edit">수정</button> <button class="btn sm danger sp-del">삭제</button></td></tr>`).join('') + '</tbody>';
}
$('#specTable').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const s = state.specs.find(x => x.id === +tr.dataset.id); if (!s) return;
  if (e.target.classList.contains('sp-edit')) {
    state.editingSpecId = s.id; $('#specTitle').textContent = '규격 수정';
    $('#sp_name').value = s.name; $('#sp_spec').value = s.spec || ''; $('#sp_per').value = s.per_box ?? ''; $('#sp_outbox').value = s.outbox || '';
    $('#sp_name').focus();
  } else if (e.target.classList.contains('sp-del')) {
    if (!confirm(`'${s.name}' 규격을 삭제할까요?`)) return;
    try { await store.deleteSpec(s.id); state.specs = state.specs.filter(x => x.id !== s.id); renderAll(); toast('삭제했어요'); } catch (err) { fail(err); }
  }
});
$('#specReset').addEventListener('click', resetSpecForm);
$('#specForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = { name: $('#sp_name').value.trim(), spec: $('#sp_spec').value.trim(), per_box: num($('#sp_per').value), outbox: $('#sp_outbox').value.trim() };
  if (!s.name) return;
  try {
    if (state.editingSpecId) { const r = await store.updateSpec(state.editingSpecId, s); state.specs = state.specs.map(x => x.id === r.id ? r : x); toast('수정했어요'); }
    else { const r = await store.addSpec(s); state.specs.push(r); toast('저장했어요'); }
    state.specs.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    resetSpecForm(); renderAll();
  } catch (err) { fail(/duplicate|unique/i.test(err.message) ? new Error('같은 품명이 이미 있어요') : err); }
});

/* ---------- 설정: 전체 삭제 ---------- */
$('#resetConfirm').addEventListener('input', () => { $('#resetBtn').disabled = $('#resetConfirm').value.trim() !== '삭제'; });
$('#resetBtn').addEventListener('click', async () => {
  const withSpecs = $('#resetSpecs').checked;
  const msg = `작업지시 ${state.orders.length}건${withSpecs ? `과 규격 ${state.specs.length}건` : ''}을 모두 삭제합니다.\n되돌릴 수 없어요. 계속할까요?`;
  if (!confirm(msg)) return;
  try {
    await store.reset(withSpecs);
    $('#resetConfirm').value = ''; $('#resetBtn').disabled = true; $('#resetSpecs').checked = false;
    await reload(); resetForm();
    toast('전체 삭제했어요');
  } catch (err) { fail(err); }
});

/* ---------- 렌더 / 로드 ---------- */
function renderAll() {
  refreshFilters();
  renderOrderTable(); renderManage(); renderTotal(); renderSpecs();
  $('#resetInfo').textContent = `현재 작업지시 ${state.orders.length}건, 규격 ${state.specs.length}건`;
}
async function reload() {
  const [o, s] = await Promise.all([store.listOrders(), store.listSpecs()]);
  state.orders = o; state.specs = s;
  if (state.editingId && !o.some(x => x.id === state.editingId)) state.editingId = null;
  renderAll(); updateSummary();
}
let reloadTimer = null;
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => reload().catch(fail), 400); }

async function init() {
  if (store.demo) $('#demoBanner').classList.remove('hidden');
  const n = getSavedName();
  if (n) applyName(n); else showLogin();
  resetForm();
  try { await reload(); } catch (err) { fail(err); }
  store.subscribe(scheduleReload);
}
init();
})();

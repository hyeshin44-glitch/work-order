/* 작업지시 관리 – 기존 구글시트 버전 화면/규칙 그대로, 저장소만 수파베이스 */
/* ===================== 기본 ===================== */
var QTY   = ['수량1','수량2','수량3','수량4','수량5','수량6','수량7','수량8','수량9','수량10','수량11','수량12'];
var QTY_W = [1,2,3,4,5,6,7,8,9,10,11,12];
function qtyW(h){ var i=QTY.indexOf(h); return i<0?0:QTY_W[i]; }

var ROWS=[], SPEC=[], SPEC_IDX={};
var EDIT_ID=null, EDIT_SPEC=null, DEMO=false, ME='';
var FL_DATES=[], FL_SHIP=[], FL_PIC=[], TT_DATES=[], SUM_DATES=[];
var PAGE_ORIENT='portrait';
var NAME_KEY='wo_login_name';

function $(s){ return document.querySelector(s); }
function $$(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(m){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }
function num(v){ var n=Number(v); return isNaN(n)?0:n; }
function norm(s){ return String(s==null?'':s).toLowerCase().replace(/\s+/g,''); }
function toast(msg, bad){
  var t=$('#toast'); t.textContent=msg; t.className='on'+(bad?' bad':'');
  clearTimeout(t._h); t._h=setTimeout(function(){ t.className=''; }, 2600);
}
function busy(on){ $('#loading').className = on?'on':''; }

var WD=['일','월','화','수','목','금','토'];
function isoToLabel(iso){
  var m=String(iso||'').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(!m) return iso||'';
  var d=new Date(+m[1],+m[2]-1,+m[3]);
  return (d.getMonth()+1)+'/'+d.getDate()+'('+WD[d.getDay()]+')';
}
function todayIso(){ var d=new Date(),p=function(n){return (n<10?'0':'')+n;};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }

/* ===================== 데이터 저장소 (수파베이스) ===================== */
var CFG = window.APP_CONFIG || {};
var SB = (CFG.SUPABASE_URL && window.supabase) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
var QCOL = QTY.map(function(h,i){ return 'q'+(i+1); });

/* 미리보기(연결 없음)용 메모리 저장소 : 수파베이스 테이블과 같은 모양 */
var MEM = (function(){
  var K='wo_demo_db2', db;
  try{ db=JSON.parse(localStorage.getItem(K)||'null'); }catch(e){}
  db = db || { orders:[], specs:[], seq:1, sseq:1 };
  function save(){ try{ localStorage.setItem(K, JSON.stringify(db)); }catch(e){} }
  function cp(x){ return JSON.parse(JSON.stringify(x)); }
  function find(id){ var r=null; db.orders.forEach(function(x){ if(x.id===id) r=x; }); return r; }
  return {
    orders:function(){ return cp(db.orders); },
    specs:function(){ return cp(db.specs); },
    getOrder:function(id){ var r=find(id); return r?cp(r):null; },
    insOrder:function(o){ o.id=db.seq++; db.orders.push(o); save(); return cp(o); },
    updOrder:function(id,p){ var r=find(id); if(r) Object.assign(r,p); save(); return r?cp(r):null; },
    delOrder:function(id){ db.orders=db.orders.filter(function(x){ return x.id!==id; }); save(); },
    insSpec:function(s){ s.id=db.sseq++; db.specs.push(s); save(); },
    updSpecByName:function(n,s){ db.specs.forEach(function(x){ if(x.name===n) Object.assign(x,s); }); save(); },
    upsertSpecs:function(rows){ rows.forEach(function(r){ var e=null; db.specs.forEach(function(x){ if(x.name===r.name) e=x; }); if(e) Object.assign(e,r); else { r.id=db.sseq++; db.specs.push(r); } }); save(); },
    delSpec:function(n){ db.specs=db.specs.filter(function(x){ return x.name!==n; }); save(); },
    reset:function(withSpec){ db.orders=[]; db.seq=1; if(withSpec){ db.specs=[]; db.sseq=1; } save(); }
  };
})();

function chk(res){ if(res.error) throw new Error(res.error.message); return res.data; }

/* DB 행 → 화면 행 (기존 시트 행과 같은 모양) */
function toRow(d){
  var o={ id:String(d.id), '작업No.':d.id,
    '지시자':d.instructor||'', '주문자':d.customer||'', '주문처':d.destination||'',
    '품목':d.item||'', '비고':d.memo||'',
    '일자ISO':d.order_date||'', '출고일ISO':d.ship_date||'',
    '완료':!!d.done, '완료일ISO':d.done_date||'' };
  o['일자']=isoToLabel(o['일자ISO']); o['출고일']=isoToLabel(o['출고일ISO']);
  o['완료일']=o['완료']?isoToLabel(o['완료일ISO']):'';
  o['작업진행중']=!o['완료'] && !!d.in_progress;
  QTY.forEach(function(h,i){ var v=d[QCOL[i]]; o[h]=(v===null||v===undefined||v==='')?'':Number(v); });
  o['박스']=''; o['개']=''; o['작업박스']=''; o['아웃박스']='';
  return o;
}
function toSpec(s){ return { '품명':s.name, '규격':s.spec||'', '입수량':(s.per_box===null||s.per_box===undefined)?'':s.per_box, '포장박스':s.outbox||'' }; }
function sortSpecs(list){ return list.sort(function(a,b){ return a['품명']<b['품명']?-1:1; }); }

var API = {
  getBootstrap: async function(){
    var o, s;
    if(SB){ var both=await Promise.all([SB.from('work_orders').select('*').order('id'), SB.from('specs').select('*')]); o=chk(both[0]); s=chk(both[1]); }
    else { o=MEM.orders(); s=MEM.specs(); }
    return { rows:o.map(toRow), spec:sortSpecs(s.map(toSpec)) };
  },
  getSpec: async function(){
    var s = SB ? chk(await SB.from('specs').select('*')) : MEM.specs();
    return { spec:sortSpecs(s.map(toSpec)) };
  },
  saveRow: async function(p){
    var rec={ customer:p['주문자'], destination:p['주문처'], item:p['품목'], memo:p['비고'],
              ship_date:p['출고일ISO']||null };
    QTY.forEach(function(h,i){ rec[QCOL[i]] = (p[h]===''||p[h]==null)?null:num(p[h]); });
    var d;
    if(p.id){
      var id=Number(p.id);
      var cur = SB ? chk(await SB.from('work_orders').select('id,done').eq('id',id).maybeSingle()) : MEM.getOrder(id);
      if(!cur) return { ok:false, msg:'수정할 행을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.' };
      if(cur.done) return { ok:false, msg:'완료 처리된 건은 수정할 수 없습니다.' };
      rec.updated_at=new Date().toISOString();
      d = SB ? chk(await SB.from('work_orders').update(rec).eq('id',id).select().single()) : MEM.updOrder(id,rec);
    } else {
      rec.instructor=p['지시자']; rec.order_date=todayIso(); rec.done=false; rec.in_progress=false;
      d = SB ? chk(await SB.from('work_orders').insert(rec).select().single()) : MEM.insOrder(rec);
    }
    return { ok:true, row:toRow(d) };
  },
  deleteRow: async function(id){
    if(SB) chk(await SB.from('work_orders').delete().eq('id',Number(id))); else MEM.delOrder(Number(id));
    return { ok:true, id:id };
  },
  setDone: async function(p){
    var iso=p.dateISO||todayIso();
    var rec={ done:true, done_date:iso, in_progress:false };
    if(SB) chk(await SB.from('work_orders').update(rec).eq('id',Number(p.id))); else MEM.updOrder(Number(p.id),rec);
    return { ok:true, id:p.id, done:true, '완료일ISO':iso, '완료일':isoToLabel(iso) };
  },
  setProgress: async function(p){
    var id=Number(p.id);
    var cur = SB ? chk(await SB.from('work_orders').select('id,done').eq('id',id).maybeSingle()) : MEM.getOrder(id);
    if(!cur) return { ok:false, msg:'해당 행을 찾지 못했습니다.' };
    if(cur.done) return { ok:false, msg:'완료된 건은 작업진행중으로 표시할 수 없습니다.' };
    if(SB) chk(await SB.from('work_orders').update({ in_progress:!!p.prog }).eq('id',id)); else MEM.updOrder(id,{ in_progress:!!p.prog });
    return { ok:true, id:p.id, prog:!!p.prog };
  },
  saveSpec: async function(p){
    var name=String(p['품명']||'').trim(), org=String(p.orgName||'').trim();
    if(!name) return { ok:false, msg:'품명을 입력해 주세요.' };
    var dupe=false, found=false;
    SPEC.forEach(function(s){
      var v=String(s['품명']||'').trim();
      if(org && v===org) found=true;
      else if(v.toLowerCase()===name.toLowerCase()) dupe=true;
    });
    if(dupe) return { ok:false, msg:'이미 등록된 품명입니다.' };
    var rec={ name:name, spec:String(p['규격']||'').trim(),
              per_box:(p['입수량']===''||p['입수량']==null)?null:num(p['입수량']),
              outbox:String(p['포장박스']||'').trim() };
    if(org && found){ if(SB) chk(await SB.from('specs').update(rec).eq('name',org)); else MEM.updSpecByName(org,rec); }
    else { if(SB) chk(await SB.from('specs').insert(rec)); else MEM.insSpec(rec); }
    return Object.assign({ ok:true }, await API.getSpec());
  },
  deleteSpec: async function(name){
    if(SB) chk(await SB.from('specs').delete().eq('name',name)); else MEM.delSpec(name);
    return Object.assign({ ok:true }, await API.getSpec());
  },
  upsertSpecs: async function(rows){
    if(SB) chk(await SB.from('specs').upsert(rows,{ onConflict:'name' })); else MEM.upsertSpecs(rows);
    return Object.assign({ ok:true }, await API.getSpec());
  },
  resetSeason: async function(withSpec){
    if(SB) chk(await SB.rpc('reset_season',{ include_specs:!!withSpec })); else MEM.reset(!!withSpec);
    return { ok:true };
  }
};

function call(fn, arg, cb, errCb){
  Promise.resolve().then(function(){ return API[fn](arg); })
    .then(function(res){ cb(res); })
    .catch(function(err){
      var m=(err && err.message)?err.message:String(err);
      if(errCb) errCb(m); else toast(m, true);
    });
}

/* ===================== 규격/계산 ===================== */
function buildSpecIdx(){
  SPEC_IDX={}; SPEC.forEach(function(s){ SPEC_IDX[norm(s['품명'])]=s; });
  fillItemList();
}
/* 품목 선택 목록 : 규격 품명 + 작업지시에 입력했던 품목 */
function fillItemList(){
  var seen={}, out=[];
  SPEC.map(function(s){ return s['품명']; }).concat(ROWS.map(function(r){ return r['품목']; })).forEach(function(v){
    v=String(v||'').trim(); if(v && !seen[norm(v)]){ seen[norm(v)]=1; out.push(v); }
  });
  $('#itemList').innerHTML = out.map(function(v){ return '<option value="'+esc(v)+'">'; }).join('');
}
function specOf(name){ return SPEC_IDX[norm(name)]||null; }
function calc(r){
  var total=0;
  for(var i=0;i<QTY.length;i++) total += num(r[QTY[i]]) * QTY_W[i];
  var sp = specOf(r['품목']);
  var ipsu = sp ? num(sp['입수량']) : 0;
  if(!ipsu){
    return { total:total, ipsu:0, box:num(r['박스']), ea:num(r['개']),
             label:(r['작업박스']||''), out:(sp?sp['포장박스']:(r['아웃박스']||'')), unknown:true };
  }
  return { total:total, ipsu:ipsu, box:Math.floor(total/ipsu), ea:total%ipsu,
           label:Math.floor(total/ipsu)+'박스 '+(total%ipsu)+'개', out:sp['포장박스'], unknown:false };
}

/* ===================== 수량 입력칸 생성 ===================== */
(function(){
  $('#qtyGrid').innerHTML = QTY.map(function(h,i){
    return '<label class="f"><span>'+h+' <span class="dim" style="font-weight:400">×'+QTY_W[i]+'</span></span>'
         + '<input type="number" min="0" id="f_'+h+'" class="qin"></label>';
  }).join('');
})();

/* ===================== 다중선택 드롭다운 ===================== */
function dateList(field){
  var s={}; ROWS.forEach(function(r){ var v=r[field+'ISO']||''; if(v) s[v]=1; });
  return Object.keys(s).sort();
}
function textList(field){
  var s={}; ROWS.forEach(function(r){ var v=r[field]; if(v) s[v]=1; });
  return Object.keys(s).sort();
}
function multiItems(cfg){
  if(cfg.text) return textList(cfg.field).map(function(v){ return {v:v,t:v}; });
  return dateList(cfg.field).map(function(v){ return {v:v,t:isoToLabel(v)}; });
}
function dateMultiLabel(cfg, sel){
  if(!sel.length) return '전체';
  var map={}; multiItems(cfg).forEach(function(x){ map[x.v]=x.t; });
  if(sel.length<=2) return sel.map(function(v){ return map[v]||v; }).join(', ');
  return sel.length+(cfg.unit||'일')+' 선택';
}
function fillDateMulti(cfg){
  var items = multiItems(cfg);
  var keys = items.map(function(x){ return x.v; });
  cfg.set(cfg.get().filter(function(v){ return keys.indexOf(v)>=0; }));
  var sel = cfg.get();
  var html = '<div class="head"><button class="btn sm" data-all="1">전체 선택</button>'
           + '<button class="btn sm" data-none="1">선택 해제</button></div>';
  html += items.map(function(x){
    return '<label class="row"><input type="checkbox" class="chk" value="'+esc(x.v)+'"'
         + (sel.indexOf(x.v)>=0?' checked':'')+'><span>'+esc(x.t)+'</span></label>';
  }).join('') || '<div class="dim" style="padding:6px">데이터 없음</div>';
  $(cfg.menu).innerHTML = html;
  $(cfg.btn).textContent = (cfg.prefix||'') + dateMultiLabel(cfg, sel);
}
function setupDateMulti(cfg){
  var wrap=$(cfg.wrap);
  function apply(sel){ cfg.set(sel); $(cfg.btn).textContent=(cfg.prefix||'')+dateMultiLabel(cfg, sel); cfg.onChange(); }
  $(cfg.btn).addEventListener('click', function(e){
    e.stopPropagation();
    $$('.ms').forEach(function(m){ if(m!==wrap) m.classList.remove('open'); });
    wrap.classList.toggle('open');
  });
  $(cfg.menu).addEventListener('change', function(e){
    if(e.target && e.target.type==='checkbox'){
      var sel=[]; $$(cfg.menu+' input[type=checkbox]').forEach(function(c){ if(c.checked) sel.push(c.value); });
      apply(sel);
    }
  });
  $(cfg.menu).addEventListener('click', function(e){
    e.stopPropagation();
    var t=e.target;
    if(t && t.getAttribute && t.getAttribute('data-all')){
      var sel=[]; $$(cfg.menu+' input[type=checkbox]').forEach(function(c){ c.checked=true; sel.push(c.value); });
      apply(sel);
    }
    if(t && t.getAttribute && t.getAttribute('data-none')){
      $$(cfg.menu+' input[type=checkbox]').forEach(function(c){ c.checked=false; });
      apply([]);
    }
  });
}
document.addEventListener('click', function(){ $$('.ms').forEach(function(m){ m.classList.remove('open'); }); });

var CFG_FLSHIP={ wrap:'#flShip', btn:'#flShipBtn', menu:'#flShipMenu', field:'출고일', prefix:'',
  get:function(){return FL_SHIP;}, set:function(v){FL_SHIP=v;}, onChange:function(){ renderRows(); } };
var CFG_FLPIC ={ wrap:'#flPic', btn:'#flPicBtn', menu:'#flPicMenu', field:'지시자', prefix:'', text:true, unit:'명',
  get:function(){return FL_PIC;}, set:function(v){FL_PIC=v;}, onChange:function(){ renderRows(); } };
var CFG_FL    ={ wrap:'#flDates', btn:'#flDatesBtn', menu:'#flDatesMenu', field:'일자', prefix:'',
  get:function(){return FL_DATES;}, set:function(v){FL_DATES=v;}, onChange:function(){ renderRows(); } };
var CFG_TT    ={ wrap:'#ttDates', btn:'#ttDatesBtn', menu:'#ttDatesMenu', field:'일자', prefix:'작업지시일 : ',
  get:function(){return TT_DATES;}, set:function(v){TT_DATES=v;}, onChange:function(){ renderTotal(); } };
var CFG_SUM   ={ wrap:'#sumDates', btn:'#sumDatesBtn', menu:'#sumDatesMenu', field:'일자', prefix:'작업지시일 : ',
  get:function(){return SUM_DATES;}, set:function(v){SUM_DATES=v;}, onChange:function(){ renderSum(); } };

/* ===================== 목록 ===================== */
function shipKey(r){ return (r['출고일ISO'] || '9999-12-31'); }

function filtered(){
  var q=norm($('#fl_q').value);
  var dn=$('#fl_완료').value, pg=$('#fl_진행').value;
  var list = ROWS.filter(function(r){
    if(FL_PIC.length && FL_PIC.indexOf(r['지시자']||'')<0) return false;
    if(FL_SHIP.length && FL_SHIP.indexOf(r['출고일ISO']||'')<0) return false;
    if(FL_DATES.length && FL_DATES.indexOf(r['일자ISO']||'')<0) return false;
    if(dn==='yes' && !r['완료']) return false;
    if(dn==='no' && r['완료']) return false;
    if(pg==='yes' && !r['작업진행중']) return false;
    if(pg==='no' && r['작업진행중']) return false;
    if(q && norm([r['품목'],r['주문자'],r['주문처'],r['비고'],r['지시자']].join(' ')).indexOf(q)<0) return false;
    return true;
  });
  // 정렬 1차 : 완료여부(미완료가 위)  2차 : 출고일 오름차순
  return list.map(function(r,i){ return {r:r,i:i}; })
    .sort(function(a,b){
      var d=(a.r['완료']?1:0)-(b.r['완료']?1:0);
      if(d!==0) return d;
      var sa=shipKey(a.r), sb=shipKey(b.r);
      if(sa!==sb) return sa<sb?-1:1;
      return a.i-b.i;
    })
    .map(function(x){ return x.r; });
}

function renderRows(){
  var list = filtered();
  $('#cntRows').textContent = '('+list.length+'건 / 전체 '+ROWS.length+'건)';

  // 값이 들어있는 수량 칸만 표시
  var qtyCols = QTY.filter(function(h){
    return list.some(function(r){ return r[h]!=='' && r[h]!=null && num(r[h])>0; });
  });

  var head='<thead><tr>'
    + '<th>작업<br>진행중</th><th>작업No.</th><th>지시자</th><th>완료</th>'
    + '<th>출고일</th><th>작업지시일</th>'
    + '<th class="l">주문자</th><th class="l">주문처</th><th class="l">품목</th>'
    + '<th class="nw">아웃박스</th><th>총수량</th>'
    + qtyCols.map(function(h){ return '<th>'+h+'<br><span class="dim" style="font-weight:400">×'+qtyW(h)+'</span></th>'; }).join('')
    + '<th class="l">비고</th><th>작업박스</th><th>박스</th><th>개</th>'
    + '<th>완료일</th><th>관리</th></tr></thead>';

  var body = list.map(function(r){
    var c=calc(r), done=!!r['완료'], prog=!!r['작업진행중'];
    return '<tr class="'+(done?'done':'')+(prog?' prog':'')+'">'
      + '<td><input type="checkbox" class="chk" data-prog="'+esc(r.id)+'"'
        + (prog?' checked':'') + (done?' disabled title="완료된 건은 변경할 수 없습니다"':'') + '></td>'
      + '<td class="no">'+esc(r['작업No.']||'')+'</td>'
      + '<td>'+esc(r['지시자'])+'</td>'
      + '<td>'+(done
          ? '<button class="btn sm done on" disabled title="완료 처리된 건은 되돌릴 수 없습니다">완료됨</button>'
          : '<button class="btn sm done" data-done="'+esc(r.id)+'">완료</button>')+'</td>'
      + '<td class="nw">'+esc(r['출고일'])+'</td>'
      + '<td class="nw">'+esc(r['일자'])+'</td>'
      + '<td class="l">'+esc(r['주문자'])+'</td>'
      + '<td class="l">'+esc(r['주문처'])+'</td>'
      + '<td class="l">'+esc(r['품목'])+'</td>'
      + '<td class="nw">'+esc(c.out||'')+'</td>'
      + '<td><b>'+(c.total||0)+'</b></td>'
      + qtyCols.map(function(h){ var v=r[h]; return '<td>'+(v===''||v==null||num(v)===0?'<span class="dim">·</span>':esc(v))+'</td>'; }).join('')
      + '<td class="l">'+esc(r['비고']||'')+'</td>'
      + '<td class="nw">'+esc(c.label||'')+'</td>'
      + '<td>'+(c.unknown?esc(r['박스']||''):c.box)+'</td>'
      + '<td>'+(c.unknown?esc(r['개']||''):c.ea)+'</td>'
      + '<td class="nw">'+(done && r['완료일'] ? '<span class="pill g">'+esc(r['완료일'])+'</span>' : '<span class="dim">·</span>')+'</td>'
      + '<td style="white-space:nowrap">'
        + (done ? '<button class="btn sm" disabled title="완료된 건은 수정할 수 없습니다">수정</button> '
                : '<button class="btn sm" data-edit="'+esc(r.id)+'">수정</button> ')
        + '<button class="btn sm danger" data-del="'+esc(r.id)+'">삭제</button>'
      + '</td></tr>';
  }).join('');

  $('#tblRows').innerHTML = head + '<tbody>' + (body || '<tr><td colspan="'+(18+qtyCols.length)+'" class="dim" style="padding:18px">데이터가 없습니다.</td></tr>') + '</tbody>';
}

function fillFilters(){
  fillMemoList(); fillItemList();
  fillDateMulti(CFG_FLSHIP); fillDateMulti(CFG_FLPIC); fillDateMulti(CFG_FL);
  fillDateMulti(CFG_TT); fillDateMulti(CFG_SUM);
}

/* ===================== 입력 폼 ===================== */
function formCalc(){
  var r={'품목':$('#f_품목').value};
  QTY.forEach(function(h){ r[h]=$('#f_'+h).value; });
  var c=calc(r);
  $('#calc_total').textContent = c.total;
  $('#calc_ipsu').textContent  = c.ipsu||'-';
  $('#calc_box').textContent   = c.ipsu? c.label : '-';
  var sp=specOf($('#f_품목').value);
  $('#f_아웃박스').value = sp? (sp['포장박스']||'') : '';
}
/* 비고 선택 목록 : 목록에 작성된 비고 (많이 쓴 순) */
function fillMemoList(){
  var cnt={};
  ROWS.forEach(function(r){ var v=String(r['비고']||'').trim(); if(v) cnt[v]=(cnt[v]||0)+1; });
  var keys=Object.keys(cnt).sort(function(a,b){ return (cnt[b]-cnt[a]) || (a<b?-1:1); });
  $('#memoList').innerHTML = keys.map(function(v){ return '<option value="'+esc(v)+'">'; }).join('');
}
function resetForm(){
  EDIT_ID=null; $('#formTitle').textContent='새 작업지시 등록';
  ['출고일','주문자','주문처','품목','비고'].forEach(function(h){ $('#f_'+h).value=''; });
  QTY.forEach(function(h){ $('#f_'+h).value=''; });
  $('#f_지시자').value = ME;   // 지시자 = 로그인한 이름 (자동)
  $('#f_일자').value = isoToLabel(todayIso())+'  (저장 시 자동)';
  formCalc();
}
function editRow(id){
  var r=null; ROWS.forEach(function(x){ if(x.id===id) r=x; });
  if(!r) return;
  if(r['완료']){ toast('완료된 건은 수정할 수 없습니다.', true); return; }
  EDIT_ID=id; $('#formTitle').textContent='작업지시 수정 (No.'+(r['작업No.']||'')+')';
  $('#f_지시자').value = r['지시자']||'';
  ['주문자','주문처','품목','비고'].forEach(function(h){ $('#f_'+h).value = r[h]||''; });
  $('#f_일자').value   = r['일자']||'-';
  $('#f_출고일').value = r['출고일ISO']||'';
  QTY.forEach(function(h){ $('#f_'+h).value = (r[h]===''||r[h]==null)?'':r[h]; });
  formCalc();
  window.scrollTo({top:0,behavior:'smooth'});
}
function saveForm(){
  var p={ id:EDIT_ID };
  ['지시자','주문자','주문처','품목','비고'].forEach(function(h){ p[h]=$('#f_'+h).value.trim(); });
  if(!EDIT_ID) p['지시자']=ME;
  p['출고일ISO']=$('#f_출고일').value;
  QTY.forEach(function(h){ var v=$('#f_'+h).value; p[h]= v===''?'':num(v); });
  if(!p['지시자']){ toast('이름이 없습니다. 오른쪽 위 「이름 바꾸기」로 이름을 넣어 주세요.', true); return; }
  if(!p['품목']){ toast('품목을 입력해 주세요.', true); return; }

  var btn=$('#btnSave'); btn.disabled=true; btn.textContent='저장 중…';
  call('saveRow', p, function(res){
    btn.disabled=false; btn.textContent='저장';
    if(!res || !res.ok){ toast((res&&res.msg)||'저장 실패', true); return; }
    var hit=-1; ROWS.forEach(function(x,i){ if(x.id===res.row.id) hit=i; });
    if(hit>=0) ROWS[hit]=res.row; else ROWS.push(res.row);
    fillFilters(); renderAll(); resetForm();
    toast('저장했습니다.');
  }, function(m){ btn.disabled=false; btn.textContent='저장'; toast(m,true); });
}

/* ===================== 행 액션 ===================== */
function findRow(id){ var r=null; ROWS.forEach(function(x){ if(x.id===id) r=x; }); return r; }
function doDone(id){
  var r=findRow(id);
  if(!r || r['완료']) return;
  if(!confirm('완료 처리하면 되돌릴 수 없고 수정도 할 수 없습니다. 진행할까요?')) return;
  var iso=todayIso(), prevProg=r['작업진행중'];
  r['완료']=true; r['완료일ISO']=iso; r['완료일']=isoToLabel(iso); r['작업진행중']=false;
  if(EDIT_ID===id) resetForm();
  renderAll();
  function undo(){ r['완료']=false; r['완료일']=''; r['완료일ISO']=''; r['작업진행중']=prevProg; renderAll(); }
  call('setDone', {id:id, dateISO:iso}, function(res){
    if(!res || !res.ok){ undo(); toast((res&&res.msg)||'완료 처리 실패', true); return; }
    toast('완료 처리했습니다.');
  }, function(m){ undo(); toast(m,true); });
}
function doProg(id, want, el){
  var r=findRow(id);
  if(!r) return;
  if(r['완료']){ if(el) el.checked=false; toast('완료된 건은 변경할 수 없습니다.', true); return; }
  var prev = !!r['작업진행중'];
  r['작업진행중']=want; renderAll();
  call('setProgress', {id:id, prog:want}, function(res){
    if(!res || !res.ok){ r['작업진행중']=prev; renderAll(); toast((res&&res.msg)||'변경 실패', true); return; }
    toast(want?'작업진행중(보류)으로 표시했습니다. 인쇄에서 제외됩니다.':'작업진행중 표시를 해제했습니다.');
  }, function(m){ r['작업진행중']=prev; renderAll(); toast(m,true); });
}
function doDelete(id){
  var r=findRow(id);
  if(!r) return;
  if(!confirm('이 작업지시를 삭제할까요?\n[No.'+(r['작업No.']||'')+'] '+(r['품목']||'')+' / '+(r['주문처']||''))) return;
  var keep=ROWS.slice();
  ROWS=ROWS.filter(function(x){ return x.id!==id; });
  if(EDIT_ID===id) resetForm();
  renderAll();
  call('deleteRow', id, function(res){
    if(!res || !res.ok){ ROWS=keep; renderAll(); toast((res&&res.msg)||'삭제 실패', true); return; }
    fillFilters(); toast('삭제했습니다.');
  }, function(m){ ROWS=keep; renderAll(); toast(m,true); });
}

$('#tblRows').addEventListener('click', function(e){
  var t=e.target.closest ? e.target.closest('button') : null;
  if(!t) return;
  if(t.getAttribute('data-edit')) editRow(t.getAttribute('data-edit'));
  else if(t.getAttribute('data-del')) doDelete(t.getAttribute('data-del'));
  else if(t.getAttribute('data-done')) doDone(t.getAttribute('data-done'));
});
$('#tblRows').addEventListener('change', function(e){
  var t=e.target;
  if(t && t.getAttribute && t.getAttribute('data-prog')) doProg(t.getAttribute('data-prog'), t.checked, t);
});

/* ===================== 인쇄 : 작업지시 목록 ===================== */
function setOrient(o){
  PAGE_ORIENT=o;
  $('#pageStyle').textContent='@page{size:A4 '+o+';margin:12mm 10mm}';
  $('#orientP').classList.toggle('on', o==='portrait');
  $('#orientL').classList.toggle('on', o==='landscape');
  try{ localStorage.setItem('orient', o); }catch(e){}
}
function uniq(list, f){ var s={},out=[]; list.forEach(function(r){ var v=f(r); if(v!=null && v!=='' && !s[v]){ s[v]=1; out.push(v);} }); return out; }

function buildListSheet(list){
  var wide = (PAGE_ORIENT==='landscape');
  var 지시자U = uniq(list,function(r){return r['지시자'];});
  var 출고일U = uniq(list,function(r){return r['출고일'];});
  var isoList = uniq(list,function(r){return r['일자ISO'];}).sort();

  var cols=[];
  cols.push({k:'주문처', t:'주문처', cls:'l', v:function(r){ return esc(r['주문처']||''); }});
  cols.push({k:'주문자', t:'주문자', cls:'l', v:function(r){ return esc(r['주문자']||''); }});
  if(출고일U.length>1 || wide) cols.push({k:'출고일', t:'출고일', cls:'nw', v:function(r){ return esc(r['출고일']||''); }});
  if(지시자U.length>1 || wide) cols.push({k:'지시자', t:'지시자', cls:'nw', v:function(r){ return esc(r['지시자']||''); }});
  cols.push({k:'품목', t:'품목', cls:'l', v:function(r){ return esc(r['품목']||''); }});

  QTY.forEach(function(h,i){
    if(list.some(function(r){ return r[h]!=='' && r[h]!=null && num(r[h])>0; })){
      cols.push({k:h, t:h+'<br><span style="font-weight:400">×'+QTY_W[i]+'</span>', cls:'r nw',
                 v:function(r){ return (r[h]===''||r[h]==null||num(r[h])===0)?'':esc(r[h]); }});
    }
  });
  cols.push({k:'비고', t:'비고', cls:'l', v:function(r){ return esc(r['비고']||''); }});
  cols.push({k:'작업박스', t:'작업박스', cls:'nw', v:function(r){ return esc(calc(r).label||''); }});
  cols.push({k:'박스', t:'박스', cls:'r', v:function(r){ var c=calc(r); return c.unknown?esc(r['박스']||''):c.box; }});
  cols.push({k:'개', t:'개', cls:'r', v:function(r){ var c=calc(r); return c.unknown?esc(r['개']||''):c.ea; }});

  // 정렬 : 출고일 → 품목 → 주문자
  var sorted = list.slice().sort(function(a,b){
    var sa=shipKey(a), sb=shipKey(b); if(sa!==sb) return sa<sb?-1:1;
    var ia=norm(a['품목']), ib=norm(b['품목']); if(ia!==ib) return ia<ib?-1:1;
    return norm(a['주문자'])<norm(b['주문자'])?-1:1;
  });

  var title;
  if(isoList.length===1) title = isoToLabel(isoList[0])+' 작업지시서';
  else if(isoList.length>1) title = isoToLabel(isoList[0])+' ~ '+isoToLabel(isoList[isoList.length-1])+' 작업지시서';
  else title = '작업지시서';

  var meta=[];
  if(지시자U.length===1 && !wide) meta.push('지시자 : '+지시자U[0]);
  if(출고일U.length===1 && !wide) meta.push('출고일 : '+출고일U[0]);
  meta.push('총 '+sorted.length+'건');

  var sumBox=0, sumEa=0;
  sorted.forEach(function(r){ var c=calc(r); sumBox+=c.unknown?num(r['박스']):c.box; sumEa+=c.unknown?num(r['개']):c.ea; });

  return '<div class="psheet"><h1>'+esc(title)+'</h1><div class="meta">'+esc(meta.join('  |  '))+'</div><table><thead><tr>'
    + cols.map(function(c){ return '<th class="'+(c.cls||'')+'">'+c.t+'</th>'; }).join('')
    + '</tr></thead><tbody>'
    + sorted.map(function(r){ return '<tr>'+cols.map(function(c){ return '<td class="'+(c.cls||'')+'">'+c.v(r)+'</td>'; }).join('')+'</tr>'; }).join('')
    + '<tr class="grand">'
    + cols.map(function(c,i){
        if(i===0) return '<td class="l">합계</td>';
        if(c.k==='작업박스') return '<td class="nw">'+sumBox+'박스 '+sumEa+'개</td>';
        if(c.k==='박스') return '<td class="r">'+sumBox+'</td>';
        if(c.k==='개') return '<td class="r">'+sumEa+'</td>';
        return '<td></td>';
      }).join('')
    + '</tr></tbody></table></div>';
}
function printHtml(html){
  $('#printArea').innerHTML = html;
  document.body.classList.add('printing');
  setTimeout(function(){
    window.print();
    setTimeout(function(){ document.body.classList.remove('printing'); }, 300);
  }, 60);
}
function printList(){
  var list = filtered().filter(function(r){ return !r['완료'] && !r['작업진행중']; });
  if(!list.length){ toast('인쇄할 건이 없습니다. (미완료 & 작업진행중 아닌 건만 인쇄)', true); return; }
  printHtml(buildListSheet(list));
}

/* ===================== CSV ===================== */
function csvOf(list, filename){
  var head=['작업진행중','작업No.','지시자','완료','출고일','작업지시일','주문자','주문처','품목','아웃박스','총수량']
    .concat(QTY).concat(['비고','작업박스','박스','개','완료일']);
  var lines=[head.join(',')];
  list.forEach(function(r){
    var c=calc(r);
    var row=[ r['작업진행중']?'진행중':'', r['작업No.']||'', r['지시자']||'', r['완료']?'완료':'',
              r['출고일']||'', r['일자']||'', r['주문자']||'', r['주문처']||'', r['품목']||'', c.out||'', c.total ]
      .concat(QTY.map(function(h){ return (r[h]===''||r[h]==null)?'':r[h]; }))
      .concat([ r['비고']||'', c.label||'', c.unknown?(r['박스']||''):c.box, c.unknown?(r['개']||''):c.ea, r['완료일']||'' ]);
    lines.push(row.map(function(v){ var s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(','));
  });
  var blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=filename; document.body.appendChild(a); a.click(); a.remove();
}
function csv(){ csvOf(filtered(), '작업지시_'+todayIso()+'.csv'); }

/* ===================== 통합 관리 ===================== */
function ttRows(){
  var dn=$('#tt_완료').value;
  return ROWS.filter(function(r){
    if(TT_DATES.length && TT_DATES.indexOf(r['일자ISO']||'')<0) return false;
    if(dn==='yes' && !r['완료']) return false;
    if(dn==='no' && r['완료']) return false;
    return true;
  });
}
function buildTotalSheet(forPrint){
  var list=ttRows();
  var dn=$('#tt_완료').value;
  var groups = dn==='' ? [{key:false,label:'미완료'},{key:true,label:'완료'}]
             : [{key:dn==='yes', label:dn==='yes'?'완료':'미완료'}];

  var head='<thead><tr><th class="l">품목</th><th class="l">지시자</th><th class="l">주문자</th>'
    +'<th class="l">주문처</th><th class="l">비고</th><th>총수량</th><th>작업박스</th><th>박스</th><th>개</th></tr></thead>';
  var NCOL=9, body='';

  groups.forEach(function(g){
    var sub = list.filter(function(r){ return !!r['완료']===g.key; });
    if(!sub.length) return;
    body += '<tr class="secrow"><td colspan="'+NCOL+'">'+esc(g.label)+' ('+sub.length+'건)</td></tr>';
    var items={}, order=[];
    sub.forEach(function(r){
      var k=norm(r['품목']);
      if(!items[k]){ items[k]={name:r['품목'], rows:[]}; order.push(k); }
      items[k].rows.push(r);
    });
    order.sort(function(a,b){ return items[a].name<items[b].name?-1:1; });
    order.forEach(function(k){
      var it=items[k], tBox=0,tEa=0,tTot=0;
      it.rows.sort(function(a,b){ var sa=shipKey(a),sb=shipKey(b); return sa<sb?-1:(sa>sb?1:0); });
      it.rows.forEach(function(r,idx){
        var c=calc(r);
        var box=c.unknown?num(r['박스']):c.box, ea=c.unknown?num(r['개']):c.ea;
        tBox+=box; tEa+=ea; tTot+=c.total;
        body += '<tr>'
          + '<td class="l">'+(idx===0?esc(it.name):'<span class="dim">〃</span>')+'</td>'
          + '<td class="l">'+esc(r['지시자']||'')+'</td>'
          + '<td class="l">'+esc(r['주문자']||'')+'</td>'
          + '<td class="l">'+esc(r['주문처']||'')+'</td>'
          + '<td class="l">'+esc(r['비고']||'')+'</td>'
          + '<td class="r">'+c.total+'</td>'
          + '<td class="nw">'+esc(c.label||'')+'</td>'
          + '<td class="r">'+box+'</td><td class="r">'+ea+'</td></tr>';
      });
      if(it.rows.length>1){
        body += '<tr class="sub"><td colspan="5" class="l">'+esc(it.name)+' 소계</td>'
          + '<td class="r">'+tTot+'</td><td class="nw">'+tBox+'박스 '+tEa+'개</td>'
          + '<td class="r">'+tBox+'</td><td class="r">'+tEa+'</td></tr>';
      }
    });
  });

  if(!body) body='<tr><td colspan="'+NCOL+'" class="dim" style="padding:18px">데이터가 없습니다.</td></tr>';
  if(forPrint){
    var isoList=uniq(list,function(r){return r['일자ISO'];}).sort();
    var title = isoList.length===1 ? isoToLabel(isoList[0])+' 통합 작업지시'
              : (isoList.length>1 ? isoToLabel(isoList[0])+' ~ '+isoToLabel(isoList[isoList.length-1])+' 통합 작업지시' : '통합 작업지시');
    return '<div class="psheet"><h1>'+esc(title)+'</h1><div class="meta">총 '+list.length+'건</div>'
      + '<table>'+head+'<tbody>'+body+'</tbody></table></div>';
  }
  return head+'<tbody>'+body+'</tbody>';
}
function renderTotal(){
  var list=ttRows();
  var items={}, box=0, tot=0;
  list.forEach(function(r){ var c=calc(r); items[norm(r['품목'])]=1; box += c.unknown?num(r['박스']):c.box; tot+=c.total; });
  var days=uniq(list,function(r){return r['일자'];});
  $('#ttCards').innerHTML =
      kpi('작업지시일', days.length? (days.length===1?days[0]:days.length+'일') : '-')
    + kpi('작업지시 건수', list.length+'건')
    + kpi('품목', Object.keys(items).length+'종')
    + kpi('총 작업박스', box+'박스')
    + kpi('총 수량', tot);
  $('#tblTotal').innerHTML = buildTotalSheet(false);
}
function kpi(k,v){ return '<div class="kpi"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>'; }

/* ===================== 통합관리(총수량) ===================== */
function sumRows(){
  var dn=$('#sum_완료').value;
  return ROWS.filter(function(r){
    if(SUM_DATES.length && SUM_DATES.indexOf(r['일자ISO']||'')<0) return false;
    if(dn==='yes' && !r['완료']) return false;
    if(dn==='no' && r['완료']) return false;
    return true;
  });
}
function buildSumSheet(forPrint){
  var list=sumRows();
  var dn=$('#sum_완료').value;
  var groups = dn==='' ? [{key:false,label:'미완료'},{key:true,label:'완료'}]
             : [{key:dn==='yes', label:dn==='yes'?'완료':'미완료'}];

  var head='<thead><tr><th class="l">아웃박스</th><th class="l">품목</th><th>출고일</th>'
    +'<th>총수량</th><th>작업박스</th><th>박스</th><th>개</th></tr></thead>';
  var NCOL=7, body='', gBox=0,gEa=0,gTot=0;

  groups.forEach(function(g){
    var sub=list.filter(function(r){ return !!r['완료']===g.key; });
    if(!sub.length) return;
    body += '<tr class="secrow"><td colspan="'+NCOL+'">'+esc(g.label)+' ('+sub.length+'건)</td></tr>';
    var tree={}, oOrder=[];
    sub.forEach(function(r){
      var c=calc(r);
      var ob=c.out||'(미지정)';
      if(!tree[ob]){ tree[ob]={name:ob, items:{}, order:[]}; oOrder.push(ob); }
      var ik=norm(r['품목']);
      if(!tree[ob].items[ik]){ tree[ob].items[ik]={name:r['품목'], days:{}, order:[]}; tree[ob].order.push(ik); }
      var it=tree[ob].items[ik];
      var dk=r['출고일ISO']||'';
      if(!it.days[dk]){ it.days[dk]={iso:dk, label:r['출고일']||'', total:0}; it.order.push(dk); }
      it.days[dk].total += c.total;
    });
    oOrder.sort();
    oOrder.forEach(function(ob){
      var O=tree[ob], oBox=0,oEa=0,oTot=0;
      O.order.sort(function(a,b){ return O.items[a].name<O.items[b].name?-1:1; });
      O.order.forEach(function(ik){
        var it=O.items[ik];
        var sp=specOf(it.name); var ipsu=sp?num(sp['입수량']):0;
        it.order.sort();
        var iBox=0,iEa=0,iTot=0;
        it.order.forEach(function(dk,di){
          var d=it.days[dk];
          var box=ipsu?Math.floor(d.total/ipsu):0, ea=ipsu?(d.total%ipsu):0;
          iBox+=box; iEa+=ea; iTot+=d.total;
          body += '<tr>'
            + '<td class="l">'+((di===0)?esc(O.name):'<span class="dim">〃</span>')+'</td>'
            + '<td class="l">'+((di===0)?esc(it.name):'<span class="dim">〃</span>')+'</td>'
            + '<td class="nw">'+esc(d.label||'')+'</td>'
            + '<td class="r">'+d.total+'</td>'
            + '<td class="nw">'+(ipsu?(box+'박스 '+ea+'개'):'')+'</td>'
            + '<td class="r">'+(ipsu?box:'')+'</td><td class="r">'+(ipsu?ea:'')+'</td></tr>';
        });
        oBox+=iBox; oEa+=iEa; oTot+=iTot;
        if(it.order.length>1){
          body += '<tr class="sub"><td class="gap"></td><td colspan="2" class="l">'+esc(it.name)+' 소계</td>'
            + '<td class="r">'+iTot+'</td><td class="nw">'+iBox+'박스 '+iEa+'개</td>'
            + '<td class="r">'+iBox+'</td><td class="r">'+iEa+'</td></tr>';
        }
      });
      if(O.order.length>1){
        body += '<tr class="sub2"><td colspan="3" class="l">'+esc(O.name)+' 소계</td>'
          + '<td class="r">'+oTot+'</td><td class="nw">'+oBox+'박스 '+oEa+'개</td>'
          + '<td class="r">'+oBox+'</td><td class="r">'+oEa+'</td></tr>';
      }
      gBox+=oBox; gEa+=oEa; gTot+=oTot;
    });
  });

  if(!body) body='<tr><td colspan="'+NCOL+'" class="dim" style="padding:18px">데이터가 없습니다.</td></tr>';
  else body += '<tr class="grand"><td colspan="3">총 합계</td><td class="r">'+gTot+'</td>'
             + '<td class="nw">'+gBox+'박스 '+gEa+'개</td><td class="r">'+gBox+'</td><td class="r">'+gEa+'</td></tr>';

  if(forPrint){
    var isoList=uniq(list,function(r){return r['일자ISO'];}).sort();
    var title = isoList.length===1 ? isoToLabel(isoList[0])+' 통합 총수량'
              : (isoList.length>1 ? isoToLabel(isoList[0])+' ~ '+isoToLabel(isoList[isoList.length-1])+' 통합 총수량' : '통합 총수량');
    return '<div class="psheet"><h1>'+esc(title)+'</h1><div class="meta">총 '+list.length+'건</div>'
      + '<table>'+head+'<tbody>'+body+'</tbody></table></div>';
  }
  return head+'<tbody>'+body+'</tbody>';
}
function renderSum(){ $('#tblSum').innerHTML = buildSumSheet(false); }

/* ===================== 규격 ===================== */
function renderSpec(){
  $('#cntSpec').textContent='('+SPEC.length+'건)';
  var head='<thead><tr><th class="l">품명</th><th class="l">규격</th><th>입수량</th><th class="l">포장박스</th><th>관리</th></tr></thead>';
  var body=SPEC.slice().sort(function(a,b){ return a['품명']<b['품명']?-1:1; }).map(function(s){
    return '<tr><td class="l">'+esc(s['품명'])+'</td><td class="l">'+esc(s['규격']||'')+'</td>'
      + '<td>'+esc(s['입수량'])+'</td><td class="l">'+esc(s['포장박스']||'')+'</td>'
      + '<td style="white-space:nowrap"><button class="btn sm" data-sedit="'+esc(s['품명'])+'">수정</button> '
      + '<button class="btn sm danger" data-sdel="'+esc(s['품명'])+'">삭제</button></td></tr>';
  }).join('');
  $('#tblSpec').innerHTML = head+'<tbody>'+(body||'<tr><td colspan="5" class="dim" style="padding:18px">규격이 없습니다.</td></tr>')+'</tbody>';
}
function resetSpec(){ EDIT_SPEC=null; $('#specTitle').textContent='규격 등록';
  ['품명','규격','입수량','포장박스'].forEach(function(h){ $('#s_'+h).value=''; }); }
function afterSpec(res){ SPEC=res.spec||[]; buildSpecIdx(); renderSpec(); renderAll(); formCalc(); }
$('#tblSpec').addEventListener('click', function(e){
  var t=e.target.closest?e.target.closest('button'):null; if(!t) return;
  var ed=t.getAttribute('data-sedit'), dl=t.getAttribute('data-sdel');
  if(ed){
    var s=null; SPEC.forEach(function(x){ if(x['품명']===ed) s=x; }); if(!s) return;
    EDIT_SPEC=ed; $('#specTitle').textContent='규격 수정';
    ['품명','규격','입수량','포장박스'].forEach(function(h){ $('#s_'+h).value=s[h]; });
    window.scrollTo({top:0,behavior:'smooth'});
  }
  if(dl){
    var used=ROWS.some(function(r){ return norm(r['품목'])===norm(dl); });
    if(!confirm((used?'이 품명은 작업지시에서 사용 중입니다.\n':'')+'「'+dl+'」 규격을 삭제할까요?')) return;
    call('deleteSpec', dl, function(res){
      if(!res||!res.ok){ toast((res&&res.msg)||'삭제 실패',true); return; }
      afterSpec(res); if(EDIT_SPEC===dl) resetSpec(); toast('삭제했습니다.');
    });
  }
});
$('#btnSpecSave').addEventListener('click', function(){
  var p={ '품명':$('#s_품명').value.trim(), '규격':$('#s_규격').value.trim(),
          '입수량':$('#s_입수량').value, '포장박스':$('#s_포장박스').value.trim(), orgName:EDIT_SPEC||'' };
  if(!p['품명']){ toast('품명을 입력해 주세요.',true); return; }
  var b=$('#btnSpecSave'); b.disabled=true; b.textContent='저장 중…';
  call('saveSpec', p, function(res){
    b.disabled=false; b.textContent='저장';
    if(!res||!res.ok){ toast((res&&res.msg)||'저장 실패',true); return; }
    afterSpec(res); resetSpec(); toast('저장했습니다.');
  }, function(m){ b.disabled=false; b.textContent='저장'; toast(m,true); });
});
$('#btnSpecReset').addEventListener('click', resetSpec);

/* ----- 규격 : 양식 내려받기 / 파일로 한번에 등록 / 현재 규격 내려받기 ----- */
var SPEC_HEAD=['품명','규격','입수량','포장박스'];
/* 엑셀 기능(약 0.9MB)은 처음 열 때 느려지지 않도록 규격 파일을 쓸 때만 불러옴 */
var XLSX_URL='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', _xlsxWait=null;
function needXLSX(cb){
  if(window.XLSX){ cb(); return; }
  if(!_xlsxWait){
    _xlsxWait=[]; busy(true);
    var sc=document.createElement('script'); sc.src=XLSX_URL;
    sc.onload=function(){ busy(false); var w=_xlsxWait; _xlsxWait=null; w.forEach(function(f){ f(); }); };
    sc.onerror=function(){ busy(false); _xlsxWait=null; sc.remove(); toast('엑셀 기능을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', true); };
    document.head.appendChild(sc);
  }
  _xlsxWait.push(cb);
}
function writeSpecBook(rows, filename){
  needXLSX(function(){ writeSpecBookNow(rows, filename); });
}
function writeSpecBookNow(rows, filename){
  var ws=XLSX.utils.aoa_to_sheet([SPEC_HEAD].concat(rows));
  ws['!cols']=[{wch:22},{wch:26},{wch:8},{wch:10}];
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '규격');
  XLSX.writeFile(wb, filename);
}
$('#btnSpecTpl').addEventListener('click', function(){ writeSpecBook([['예) 명품S2호','500ML',5,'3']], '규격_양식.xlsx'); });
$('#btnSpecExport').addEventListener('click', function(){
  if(!SPEC.length){ toast('등록된 규격이 없습니다.', true); return; }
  writeSpecBook(SPEC.map(function(s){ return [s['품명'], s['규격']||'', s['입수량'], s['포장박스']||'']; }), '규격_'+todayIso()+'.xlsx');
});
$('#btnSpecUpload').addEventListener('click', function(){ $('#specFile').click(); });
$('#specFile').addEventListener('change', function(e){
  var f=e.target.files[0]; e.target.value=''; if(!f) return;
  needXLSX(function(){ readSpecFile(f); });
});
function readSpecFile(f){
  f.arrayBuffer().then(function(buf){
    var wb=XLSX.read(buf,{type:'array'});
    var ws=wb.Sheets[wb.SheetNames[0]];
    var aoa=XLSX.utils.sheet_to_json(ws,{header:1, raw:false, defval:''});
    var hi=-1; aoa.forEach(function(r,i){ if(hi<0 && r.some(function(c){ return String(c).trim()==='품명'; })) hi=i; });
    if(hi<0){ toast('첫 줄에 「품명」 칸이 있는 양식을 사용해 주세요.', true); return; }
    var head=aoa[hi].map(function(c){ return String(c).trim(); });
    function col(names){ for(var i=0;i<head.length;i++) if(names.indexOf(head[i])>=0) return i; return -1; }
    var ci={ name:col(['품명']), spec:col(['규격','내용']), per:col(['입수량']), out:col(['포장박스','아웃박스','포장박스(아웃박스)']) };
    var map={}, rows=[];
    aoa.slice(hi+1).forEach(function(r){
      var name=String(r[ci.name]==null?'':r[ci.name]).trim();
      if(!name || name.indexOf('예)')===0) return;
      var per = ci.per>=0 ? String(r[ci.per]).replace(/,/g,'').trim() : '';
      var o={ name:name, spec:ci.spec>=0?String(r[ci.spec]).trim():'', per_box:per===''||isNaN(Number(per))?null:Number(per),
              outbox:ci.out>=0?String(r[ci.out]).trim():'' };
      if(map[name]===undefined){ map[name]=rows.length; rows.push(o); } else rows[map[name]]=o;
    });
    if(!rows.length){ toast('등록할 규격이 없습니다.', true); return; }
    var upd=rows.filter(function(r){ return SPEC.some(function(s){ return s['품명']===r.name; }); }).length;
    if(!confirm('규격 '+rows.length+'건을 등록할까요?\n새로 추가 '+(rows.length-upd)+'건, 기존 품명 수정 '+upd+'건')) return;
    call('upsertSpecs', rows, function(res){ afterSpec(res); toast('규격 '+rows.length+'건 등록했습니다.'); });
  }).catch(function(err){ toast('파일을 읽지 못했습니다: '+(err&&err.message?err.message:err), true); });
}

/* ===================== 로그인(이름) / 시즌 전체 삭제 ===================== */
function getSavedName(){ try{ return localStorage.getItem(NAME_KEY)||''; }catch(e){ return ''; } }
function setSavedName(n){ try{ localStorage.setItem(NAME_KEY,n); }catch(e){} }
function applyName(n){
  ME=n; $('#whoName').textContent=n; $('#setName').textContent=n;
  if(!EDIT_ID) $('#f_지시자').value=n;
}
function showLogin(){ $('#login').classList.add('on'); $('#loginName').value=ME; setTimeout(function(){ $('#loginName').focus(); }, 50); }
$('#loginForm').addEventListener('submit', function(e){
  e.preventDefault();
  var n=$('#loginName').value.trim().replace(/\s+/g,' ');
  if(!n){ toast('이름을 입력해 주세요.', true); return; }
  setSavedName(n); applyName(n); $('#login').classList.remove('on');
});
$('#btnChangeName').addEventListener('click', showLogin);
$('#btnChangeName2').addEventListener('click', showLogin);

function updateResetInfo(){ $('#rs_info').textContent='현재 작업지시 '+ROWS.length+'건, 규격 '+SPEC.length+'건'; }
$('#rs_confirm').addEventListener('input', function(){ $('#btnResetSeason').disabled = $('#rs_confirm').value.trim()!=='삭제'; });
$('#btnBackup').addEventListener('click', function(){
  if(!ROWS.length){ toast('내려받을 작업지시가 없습니다.', true); return; }
  csvOf(ROWS.slice().sort(function(a,b){ return a['작업No.']-b['작업No.']; }), '작업지시_전체백업_'+todayIso()+'.csv');
});
$('#btnResetSeason').addEventListener('click', function(){
  var withSpec=$('#rs_spec').checked;
  if(!confirm('작업지시 '+ROWS.length+'건'+(withSpec?'과 규격 '+SPEC.length+'건':'')+'을 모두 삭제합니다.\n되돌릴 수 없습니다. 계속할까요?')) return;
  busy(true);
  call('resetSeason', withSpec, function(){
    $('#rs_confirm').value=''; $('#btnResetSeason').disabled=true; $('#rs_spec').checked=false;
    reloadAll(function(){ busy(false); resetForm(); toast('전체 삭제했습니다. 새 시즌을 시작하세요.'); });
  }, function(m){ busy(false); toast(m,true); });
});

/* ===================== 공통 ===================== */
function showWarn(msg){ var w=$('#warnBar'); w.style.display='block'; w.textContent=msg; }
function renderAll(){ renderRows(); renderTotal(); renderSum(); updateResetInfo(); }

function switchView(v){
  $$('.tab').forEach(function(t){ t.classList.toggle('on', t.getAttribute('data-view')===v); });
  $$('.view').forEach(function(s){ s.classList.toggle('on', s.id==='view-'+v); });
}
$$('.tab').forEach(function(t){ t.addEventListener('click', function(){ switchView(t.getAttribute('data-view')); }); });

$('#btnSave').addEventListener('click', saveForm);
$('#btnReset').addEventListener('click', resetForm);
$('#f_품목').addEventListener('input', formCalc);
document.addEventListener('input', function(e){ if(e.target && e.target.classList && e.target.classList.contains('qin')) formCalc(); });
['fl_완료','fl_진행','fl_q'].forEach(function(id){
  $('#'+id).addEventListener(id==='fl_q'?'input':'change', renderRows);
});
$('#btnClearFl').addEventListener('click', function(){
  $('#fl_완료').value=''; $('#fl_진행').value=''; $('#fl_q').value='';
  FL_DATES=[]; FL_SHIP=[]; FL_PIC=[];
  fillDateMulti(CFG_FL); fillDateMulti(CFG_FLSHIP); fillDateMulti(CFG_FLPIC); renderRows();
});
$('#btnPrint').addEventListener('click', printList);
$('#btnCsv').addEventListener('click', csv);
$('#orientP').addEventListener('click', function(){ setOrient('portrait'); });
$('#orientL').addEventListener('click', function(){ setOrient('landscape'); });
$('#tt_완료').addEventListener('change', renderTotal);
$('#sum_완료').addEventListener('change', renderSum);
$('#btnPrintTotal').addEventListener('click', function(){ printHtml(buildTotalSheet(true)); });
$('#btnPrintSum').addEventListener('click', function(){ printHtml(buildSumSheet(true)); });

setupDateMulti(CFG_FLSHIP); setupDateMulti(CFG_FLPIC); setupDateMulti(CFG_FL);
setupDateMulti(CFG_TT); setupDateMulti(CFG_SUM);

/* 다른 사람이 입력·수정하면 내 화면도 자동으로 새로고침 */
function reloadAll(done){
  call('getBootstrap', undefined, function(res){
    ROWS=res.rows||[]; SPEC=res.spec||[];
    if(EDIT_ID && !ROWS.some(function(r){ return r.id===EDIT_ID && !r['완료']; })) resetForm();
    buildSpecIdx(); fillFilters(); renderAll(); renderSpec();
    if(done) done();
  }, function(m){ if(done) done(); toast(m,true); });
}
var _rt=null;
function scheduleReload(){ clearTimeout(_rt); _rt=setTimeout(function(){ reloadAll(); }, 500); }

/* ===================== 시작 ===================== */
(function boot(){
  try{ setOrient(localStorage.getItem('orient')||'portrait'); }catch(e){ setOrient('portrait'); }
  DEMO = !SB;
  if(DEMO) showWarn('미리보기 모드 : 아직 수파베이스에 연결되지 않아 데이터가 이 브라우저에만 저장됩니다.');
  var n=getSavedName(); if(n) applyName(n); else showLogin();
  busy(true);
  call('getBootstrap', undefined, function(res){
    busy(false);
    ROWS = res.rows||[]; SPEC = res.spec||[];
    buildSpecIdx(); fillFilters(); renderAll(); renderSpec(); resetForm();
  }, function(m){ busy(false); showWarn('데이터를 불러오지 못했습니다: '+m); });
  if(SB){
    SB.channel('wo-changes')
      .on('postgres_changes',{ event:'*', schema:'public', table:'work_orders' }, scheduleReload)
      .on('postgres_changes',{ event:'*', schema:'public', table:'specs' }, scheduleReload)
      .subscribe();
  }
})();

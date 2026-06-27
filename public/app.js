/* ============================================================
   СИТИ SRM — фронтенд серверной версии (Этап 2)
   ============================================================ */

/* ---------- API ---------- */
async function api(path, method='GET', body){
  const res = await fetch(path, {
    method, credentials:'same-origin',
    headers: body? {'Content-Type':'application/json'} : undefined,
    body: body? JSON.stringify(body) : undefined
  });
  let data=null; try{ data = await res.json(); }catch{}
  if(!res.ok) throw new Error((data&&data.error) || `Ошибка ${res.status}`);
  return data;
}

/* ---------- Тема ---------- */
const TKEY='citi_srm_theme';
const cssVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem(TKEY,t);updateThemeBtns();}
function toggleTheme(){const cur=document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';applyTheme(cur==='light'?'dark':'light');if(ME)render();}
function updateThemeBtns(){
  const light=document.documentElement.getAttribute('data-theme')==='light';
  document.querySelectorAll('[data-theme-ic]').forEach(e=>e.textContent=light?'🌙':'☀️');
  const lbl=document.getElementById('themeLbl'); if(lbl)lbl.textContent=light?'Тёмная тема':'Светлая тема';
}
applyTheme(localStorage.getItem(TKEY)||'light');

const LOGO_SVG = `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-label="СИТИ SRM">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6F86A8"/><stop offset="1" stop-color="#13233F"/></linearGradient></defs>
  <rect width="256" height="256" fill="url(#lg)"/>
  <g fill="#fff"><rect x="40" y="100" width="24" height="90"/><rect x="72" y="70" width="30" height="120"/><rect x="108" y="40" width="40" height="150"/><rect x="154" y="80" width="28" height="110"/><rect x="188" y="110" width="20" height="80"/></g>
  <rect x="36" y="190" width="176" height="7" rx="3.5" fill="#fff" opacity=".9"/></svg>`;
const LOGO_FULL='logo.jpg'; // полный логотип (здания + СИТИ SRM + подпись) — на экране входа

/* ---------- Состояние ---------- */
let ME=null, ROLES={}, DB=null, TASKS=[], USERS=[];
let current='dashboard';
let SCOPE = localStorage.getItem('citi_srm_scope') || 'all'; // 'all' или id объекта
const TODAY = new Date();

const canView = m => ME && ME.permissions.view.includes(m);
const canEdit = m => ME && ME.permissions.edit.includes(m);

/* ---------- helpers ---------- */
const fmt=n=>new Intl.NumberFormat('ru-RU').format(Math.round(n));
const money=n=>fmt(n)+' ₽';
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tenantOf=id=>DB.tenants.find(t=>t.id===id);
const unitOf=id=>DB.units.find(u=>u.id===id);
const contractOf=id=>DB.contracts.find(c=>c.id===id);
const userOf=id=>USERS.find(u=>u.id===id);
const unitStatus=u=>{ if(!u.tenant) return u.status||'free';
  const c=DB.contracts.find(c=>c.unit===u.id&&c.status!=='ended');
  const p=DB.payments.find(p=>c&&p.contract===c.id&&p.status==='overdue');
  return p?'debt':'occupied'; };
function monthlyRent(c){ const u=unitOf(c.unit); return u? c.rate*u.area : 0; }
function daysLeft(d){ if(!d) return 9999; return Math.round((new Date(d)-TODAY)/864e5); }
const val=id=>document.getElementById(id).value;
const pct=(a,b)=>b?Math.round(a/b*100):0;

/* ---------- объекты (портфель) и область видимости ---------- */
const buildingsList=()=>DB.buildings||[];
const buildingOf=id=>(DB.buildings||[]).find(b=>b.id===id);
const inScope=u=>SCOPE==='all'||u.building===SCOPE;
const sUnits=()=>DB.units.filter(inScope);
const unitInScope=id=>{const u=unitOf(id);return !!u&&inScope(u);};
const sContracts=()=>DB.contracts.filter(c=>unitInScope(c.unit));
const sPayments=()=>DB.payments.filter(p=>{const c=contractOf(p.contract);return c&&unitInScope(c.unit);});
const sUtilities=()=>DB.utilities.filter(x=>unitInScope(x.unit));
const sExpenses=()=>DB.expenses.filter(e=>SCOPE==='all'||e.building===SCOPE);
const sTenants=()=>SCOPE==='all'?DB.tenants:DB.tenants.filter(t=>DB.contracts.some(c=>c.tenant===t.id&&unitInScope(c.unit)));
function setScope(v){ SCOPE=v; localStorage.setItem('citi_srm_scope',v); render(); closeNav(); }
function scopeSub(){ if(SCOPE==='all'){const a=sUnits().reduce((s,u)=>s+u.area,0);return `Все объекты: ${buildingsList().length} · ${fmt(a)} м²`;} const b=buildingOf(SCOPE);return b?`${b.name} · ${b.address}`:'Объект'; }

function metrics(){
  const units=sUnits(), pays=sPayments();
  const total=units.reduce((s,u)=>s+u.area,0);
  const occ=units.filter(u=>u.tenant).reduce((s,u)=>s+u.area,0);
  const billed=pays.reduce((s,p)=>s+p.amount,0);
  const collected=pays.reduce((s,p)=>s+p.paid,0);
  const debt=pays.reduce((s,p)=>s+(p.amount-p.paid),0);
  const util=sUtilities().reduce((s,u)=>s+u.electricity+u.water+u.heating,0);
  const exp=sExpenses().reduce((s,e)=>s+e.amount,0);
  return {total,occ,occPct:pct(occ,total),billed,collected,debt,util,exp,net:collected-exp};
}

/* напоминания: мои незавершённые задачи, просроченные или со сроком ≤3 дней */
function myReminders(){
  return TASKS.filter(t=>t.assignee_id===ME.id && t.status!=='done' && daysLeft(t.due)<=3)
              .sort((a,b)=>daysLeft(a.due)-daysLeft(b.due));
}

/* ============================================================
   BOOT
   ============================================================ */
(async function boot(){
  try{
    const {user} = await api('/api/auth/me');
    ME=user; await loadData(); showApp();
  }catch{ showAuth('login'); }
})();

async function loadData(){
  const b = await api('/api/bootstrap');
  ME=b.user; ROLES=b.roles; DB=b.state; TASKS=b.tasks; USERS=b.users;
}

/* ============================================================
   AUTH UI
   ============================================================ */
function showAuth(mode='login'){
  ME=null;
  const roleOpts = Object.entries({
    leasing:'Отдел аренды', accountant:'Бухгалтер / Финансист', maintenance:'Эксплуатация',
    manager:'Управляющий объектом', owner:'Собственник / Руководитель', admin:'Администратор'
  }).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

  const login = `
    <h2>Вход в систему</h2><div class="lead">СИТИ SRM — управление коммерческой недвижимостью</div>
    <div class="err" id="authErr"></div>
    <div class="field"><label>Email</label><input id="a-email" type="email" placeholder="admin@citisrm.ru" autocomplete="username"></div>
    <div class="field"><label>Пароль</label><input id="a-pw" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    <button class="btn" onclick="doLogin()">Войти</button>
    <div class="swap">Нет аккаунта? <a onclick="showAuth('register')">Зарегистрироваться</a></div>
    <div class="demo-accounts"><div class="sec-h">Демо-доступ (клик для входа)</div>
      <span class="demo-chip" onclick="quickLogin('admin@citisrm.ru','admin123')">👑 Администратор</span>
      <span class="demo-chip" onclick="quickLogin('owner@citisrm.ru','owner123')">👁 Собственник</span>
      <span class="demo-chip" onclick="quickLogin('lease@citisrm.ru','lease123')">🏷 Отдел аренды</span>
      <span class="demo-chip" onclick="quickLogin('buh@citisrm.ru','buh123')">💰 Бухгалтер</span>
      <span class="demo-chip" onclick="quickLogin('exp@citisrm.ru','exp123')">🔧 Эксплуатация</span>
    </div>`;

  const register = `
    <h2>Регистрация</h2><div class="lead">Создайте учётную запись и выберите роль (права доступа)</div>
    <div class="err" id="authErr"></div>
    <div class="field"><label>ФИО</label><input id="r-name" placeholder="Иванов Иван"></div>
    <div class="row2"><div class="field"><label>Должность</label><input id="r-pos" placeholder="Менеджер"></div>
      <div class="field"><label>Телефон</label><input id="r-phone" placeholder="+7 ..."></div></div>
    <div class="field"><label>Email</label><input id="r-email" type="email" placeholder="you@citisrm.ru"></div>
    <div class="field"><label>Пароль</label><input id="r-pw" type="password" placeholder="не короче 6 символов"></div>
    <div class="field"><label>Роль (права доступа)</label><select id="r-role">${roleOpts}</select></div>
    <button class="btn" onclick="doRegister()">Создать аккаунт</button>
    <div class="swap">Уже есть аккаунт? <a onclick="showAuth('login')">Войти</a></div>`;

  document.getElementById('root').innerHTML = `
    <div class="theme-fab" onclick="toggleTheme()"><span data-theme-ic></span></div>
    <div class="auth"><div class="auth-card">
      <div style="text-align:center;margin-bottom:18px"><img src="${LOGO_FULL}" alt="СИТИ SRM" style="width:230px;max-width:78%;height:auto;border-radius:16px;background:#fff;padding:12px;box-shadow:var(--shadow)"></div>
      ${mode==='login'?login:register}
    </div></div>`;
  updateThemeBtns();
  const f=document.getElementById('a-email')||document.getElementById('r-name'); if(f)f.focus();
}
function authErr(msg){ const e=document.getElementById('authErr'); if(e){e.textContent=msg;e.classList.add('show');} }

async function doLogin(){
  try{ const {user}=await api('/api/auth/login','POST',{email:val('a-email'),password:val('a-pw')});
    ME=user; await loadData(); showApp(); }
  catch(e){ authErr(e.message); }
}
async function quickLogin(email,password){
  try{ const {user}=await api('/api/auth/login','POST',{email,password}); ME=user; await loadData(); showApp(); }
  catch(e){ authErr(e.message); }
}
async function doRegister(){
  const pw=val('r-pw'); if(pw.length<6) return authErr('Пароль не короче 6 символов');
  try{ const {user}=await api('/api/auth/register','POST',{
      full_name:val('r-name'),position:val('r-pos'),phone:val('r-phone'),
      email:val('r-email'),password:pw,role:val('r-role')});
    ME=user; await loadData(); showApp(); }
  catch(e){ authErr(e.message); }
}
async function logout(){ try{await api('/api/auth/logout','POST');}catch{} stopPolling(); showAuth('login'); }

/* ============================================================
   APP SHELL
   ============================================================ */
const NAV=[
  {group:'Обзор',items:[['dashboard','▦','Дашборд']]},
  {group:'Управление',items:[['objects','🏢','Объекты и занятость'],['tenants','👥','Арендаторы'],['contracts','📄','Договоры']]},
  {group:'Финансы',items:[['payments','💳','Платежи аренды'],['utilities','⚡','Коммуналка и расходы']]},
  {group:'Операции',items:[['tasks','✓','Задачи'],['employees','🧑‍💼','Сотрудники'],['reports','📊','Отчёты']]},
];
const PAGE_TITLES={dashboard:'Дашборд',objects:'Объекты',tenants:'Арендаторы',contracts:'Договоры',payments:'Платежи',utilities:'Коммуналка',tasks:'Задачи',employees:'Сотрудники',reports:'Отчёты'};

function showApp(){
  if(!canView(current)) current = NAV.flatMap(g=>g.items).map(i=>i[0]).find(canView) || 'dashboard';
  if(SCOPE!=='all' && !buildingOf(SCOPE)) SCOPE='all';
  const initials=(ME.full_name||'?').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('root').innerHTML=`
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="logo">${LOGO_SVG}</div><div><b>СИТИ SRM</b><small>Коммерческая недвижимость</small></div></div>
      <div id="scopeWrap" style="padding:0 4px 8px"></div>
      ${NAV.map(g=>{
        const items=g.items.filter(i=>canView(i[0])); if(!items.length) return '';
        return `<div class="nav-group">${g.group}</div>`+items.map(([k,ic,label])=>
          `<div class="nav-item" data-page="${k}"><span class="ic">${ic}</span> ${label} <span class="badge hidden" id="badge-${k}">0</span></div>`).join('');
      }).join('')}
      <div class="nav-item" onclick="toggleTheme()" style="margin-top:auto"><span class="ic" data-theme-ic></span> <span id="themeLbl">Светлая тема</span></div>
      <div class="side-foot">
        <div class="avatar">${initials}</div>
        <div style="min-width:0"><div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ME.full_name)}</div>
          <div style="font-size:11px;color:var(--muted2)">${esc(ME.roleTitle)}</div></div>
        <span class="lo" title="Выйти" onclick="logout()">⎋</span>
      </div>
    </aside>
    <div class="scrim" id="scrim" onclick="closeNav()"></div>
    <div class="mtopbar"><span class="burger" onclick="toggleNav()">☰</span><div class="logo">${LOGO_SVG}</div><b>СИТИ SRM</b></div>
    <main class="main" id="main"></main>
  </div>`;
  document.querySelectorAll('.nav-item[data-page]').forEach(n=>n.onclick=()=>{ current=n.dataset.page; markActive(); render(); closeNav(); });
  updateThemeBtns(); renderScopeSelector(); markActive(); render(); startPolling();
}
function toggleNav(){ document.getElementById('sidebar')?.classList.toggle('open'); document.getElementById('scrim')?.classList.toggle('show'); }
function closeNav(){ document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('scrim')?.classList.remove('show'); }
function markActive(){ document.querySelectorAll('.nav-item[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===current)); }
function renderScopeSelector(){
  const w=document.getElementById('scopeWrap'); if(!w)return;
  w.innerHTML=`<select class="search" id="scopeSel" style="width:100%;cursor:pointer" onchange="setScope(this.value)">
    <option value="all"${SCOPE==='all'?' selected':''}>🏙 Все объекты (${buildingsList().length})</option>
    ${buildingsList().map(b=>`<option value="${b.id}"${SCOPE===b.id?' selected':''}>🏢 ${esc(b.name)}</option>`).join('')}
  </select>`;
}

const PAGES={dashboard,objects,tenants,contracts,payments,utilities,tasks,employees,reports};
function render(){ updateBadges(); const m=document.getElementById('main'); if(!m)return; m.innerHTML=''; (PAGES[current]||dashboard)(); }
function el(html){ const d=document.createElement('div'); d.className='page'; d.innerHTML=html; document.getElementById('main').appendChild(d); return d; }
function head(title,sub,actions=''){ return `<div class="topbar"><div><h1>${title}</h1><div class="sub">${sub}</div></div><div class="spacer"></div>${actions}${bellHTML()}</div>`; }

function updateBadges(){
  if(!DB) return;
  const setB=(k,n)=>{const e=document.getElementById('badge-'+k); if(e){e.textContent=n; e.classList.toggle('hidden',!n);} };
  setB('payments', DB.payments.filter(p=>p.amount-p.paid>0).length);
  setB('tasks', TASKS.filter(t=>t.status!=='done').length);
}

/* ---------- Напоминания (колокольчик) ---------- */
function bellHTML(){
  const rem=myReminders();
  return `<div style="position:relative">
    <div class="bell" onclick="toggleNotif(event)">🔔${rem.length?`<span class="cnt">${rem.length}</span>`:''}</div>
    <div class="notif" id="notif">
      <div class="notif-h">Напоминания о сроках${rem.length?` · ${rem.length}`:''}</div>
      ${rem.length? rem.map(t=>{const dl=daysLeft(t.due);
        return `<div class="notif-i" onclick="gotoTasks()">
          <div class="t-strong" style="margin-bottom:3px">${esc(t.title)}</div>
          <div class="t-sub">📍 ${esc(t.unit)} · ${prioWord(t.priority)} · ${dueLabel(t.due)}</div></div>`;}).join('')
        : '<div class="empty" style="padding:24px">Нет срочных задач 🎉</div>'}
    </div></div>`;
}
function toggleNotif(e){ e.stopPropagation(); document.getElementById('notif').classList.toggle('show'); }
function gotoTasks(){ document.getElementById('notif')?.classList.remove('show'); current='tasks'; markActive(); render(); }
document.addEventListener('click',e=>{ const n=document.getElementById('notif'); if(n&&!e.target.closest('#notif')&&!e.target.closest('.bell')) n.classList.remove('show'); });

/* ---------- Сохранение общего состояния ---------- */
async function saveState(){ try{ await api('/api/state','POST', DB); }catch(e){ alert('Не удалось сохранить: '+e.message); } }
async function afterStateChange(){ await saveState(); render(); }

/* ============================================================
   ОБНОВЛЕНИЕ (многопользовательский режим — лёгкий опрос)
   ============================================================ */
let pollTimer=null;
function startPolling(){ stopPolling(); pollTimer=setInterval(silentRefresh, 30000); }
function stopPolling(){ if(pollTimer)clearInterval(pollTimer); pollTimer=null; }
async function silentRefresh(){
  if(!ME) return;
  if(document.getElementById('modalBg').classList.contains('show')) return; // не мешаем вводу
  try{
    const b=await api('/api/bootstrap'); DB=b.state; TASKS=b.tasks; USERS=b.users; ROLES=b.roles;
    updateBadges();
    if(['dashboard','tasks','employees','payments'].includes(current)) render();
    else { const bell=document.querySelector('.topbar .bell'); /* обновим только бейдж колокольчика */ }
  }catch{}
}

/* ============================================================
   ДАШБОРД
   ============================================================ */
function dashboard(){
  const m=metrics();
  const overdue=sPayments().filter(p=>p.status==='overdue').map(p=>{const c=contractOf(p.contract);return{name:tenantOf(c.tenant).name,unit:c.unit,amount:p.amount-p.paid};});
  const tasksOpen=TASKS.filter(t=>t.status!=='done').sort((a,b)=>daysLeft(a.due)-daysLeft(b.due)).slice(0,5);
  el(head('Дашборд', `${scopeSub()} · ${TODAY.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}`,
    (ME.role==='admin'||ME.role==='owner')?`<button class="btn ghost sm" onclick="resetDemo()">↺ Демо-данные</button>`:'')+
  `<div class="grid kpis" style="margin-bottom:18px">
    ${kpi('Заполняемость','#4f8cff','📐',m.occPct+'%','+3% за месяц','up')}
    ${kpi('Начислено (мес.)','#a78bfa','🧾',fmt(m.billed/1000)+' тыс','план аренды','')}
    ${kpi('Собрано (мес.)','#37d39b','💰',fmt(m.collected/1000)+' тыс',pct(m.collected,m.billed)+'% от плана','up')}
    ${kpi('Задолженность','#ff5d6c','⚠️',fmt(m.debt/1000)+' тыс',DB.payments.filter(p=>p.amount-p.paid>0).length+' счёта','down')}
    ${kpi('Чистый доход','#39d0d8','📈',fmt(m.net/1000)+' тыс','собрано − расходы','')}
  </div>
  <div class="grid" style="grid-template-columns:1.6fr 1fr;margin-bottom:18px">
    <div class="card"><div class="panel-title"><h3>Доходы и расходы</h3><span class="muted">тыс ₽ · 6 мес</span></div><canvas id="chIncome" height="120"></canvas></div>
    <div class="card"><div class="panel-title"><h3>Структура площадей</h3><span class="muted">м²</span></div><canvas id="chOcc" height="120"></canvas></div>
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr">
    <div class="card"><div class="panel-title"><h3>⚠️ Просроченные платежи</h3><span class="muted">${overdue.length}</span></div>
      <table><tbody>${overdue.length?overdue.map(o=>`<tr><td><div class="t-strong">${esc(o.name)}</div><div class="t-sub">Помещение ${o.unit}</div></td><td style="text-align:right"><span class="pill red">${money(o.amount)}</span></td></tr>`).join(''):'<tr><td class="empty">Нет просрочек</td></tr>'}</tbody></table>
    </div>
    <div class="card"><div class="panel-title"><h3>Ближайшие задачи</h3><span class="muted">${tasksOpen.length}</span></div>
      <table><tbody>${tasksOpen.length?tasksOpen.map(t=>`<tr><td><div class="t-strong">${esc(t.title)}</div><div class="t-sub">${esc(t.assignee_name||'—')} · ${esc(t.unit)}</div></td><td style="text-align:right">${prioPill(t.priority)}<div class="t-sub" style="margin-top:4px">${dueLabel(t.due)}</div></td></tr>`).join(''):'<tr><td class="empty">Нет задач</td></tr>'}</tbody></table>
    </div>
  </div>`);
  drawIncome(); drawOcc();
}
function kpi(label,color,ic,v,delta,dir){
  return `<div class="card kpi"><div class="kpi-top"><span class="label">${label}</span><span class="kpi-ic" style="background:${color}22;color:${color}">${ic}</span></div>
  <div class="val">${v}</div><div class="delta ${dir}">${dir==='up'?'▲ ':dir==='down'?'▼ ':''}${delta}</div></div>`;
}
function drawIncome(){
  new Chart(document.getElementById('chIncome'),{type:'bar',data:{labels:DB.history.map(h=>h.m),
    datasets:[{label:'Доходы',data:DB.history.map(h=>h.income),backgroundColor:cssVar('--accent'),borderRadius:6,barPercentage:.6},
    {label:'Расходы',data:DB.history.map(h=>h.expense),backgroundColor:cssVar('--red')+'88',borderRadius:6,barPercentage:.6}]},options:chOpts(true)});
}
function drawOcc(){
  const us=sUnits();
  const occ=us.filter(u=>u.tenant).reduce((s,u)=>s+u.area,0);
  const res=us.filter(u=>!u.tenant&&u.status==='reserved').reduce((s,u)=>s+u.area,0);
  const free=us.filter(u=>!u.tenant&&u.status!=='reserved').reduce((s,u)=>s+u.area,0);
  new Chart(document.getElementById('chOcc'),{type:'doughnut',data:{labels:['Занято','Резерв','Свободно'],
    datasets:[{data:[occ,res,free],backgroundColor:[cssVar('--green'),cssVar('--amber'),cssVar('--muted2')],borderWidth:0}]},
    options:{cutout:'68%',plugins:{legend:{position:'bottom',labels:{color:cssVar('--muted'),padding:14,font:{size:12}}}}}});
}
function chOpts(legend){const muted=cssVar('--muted'),grid=cssVar('--chart-grid');return{responsive:true,plugins:{legend:{display:legend,position:'top',align:'end',labels:{color:muted,boxWidth:12,font:{size:11}}}},
  scales:{x:{grid:{display:false},ticks:{color:muted}},y:{grid:{color:grid},ticks:{color:muted}}}};}

/* ============================================================
   ОБЪЕКТЫ
   ============================================================ */
function objects(){
  const m=metrics();
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  const us=sUnits();
  el(head('Объекты и занятость', scopeSub(),
    canEdit('objects')?`<button class="btn ghost" onclick="buildingModal()">+ Объект</button> <button class="btn" onclick="unitModal()">+ Помещение</button>`:'')+
  `<div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
    ${miniStat('Объектов',bs.length,'violet')}
    ${miniStat('Помещений',us.length)}
    ${miniStat('Занято',us.filter(u=>u.tenant).length,'green')}
    ${miniStat('Заполняемость',m.occPct+'%','blue')}
  </div><div id="bcards"></div>`);
  const addCard = (canEdit('objects')&&SCOPE==='all') ? `<div class="card" style="border-style:dashed;text-align:center;cursor:pointer" onclick="buildingModal()"><div style="padding:16px;color:var(--accent2);font-weight:650;font-size:14px">＋ Добавить новый объект</div></div>` : '';
  document.getElementById('bcards').innerHTML = (bs.map(buildingCard).join('') || '<div class="card"><div class="empty">Объекты не найдены</div></div>') + addCard;
}
const expandedBuildings = new Set(); // какие объекты развёрнуты в режиме «Все объекты»
function buildingCard(b){
  const us=DB.units.filter(u=>u.building===b.id);
  const totA=us.reduce((s,u)=>s+u.area,0), occA=us.filter(u=>u.tenant).reduce((s,u)=>s+u.area,0);
  const floors=[...new Set(us.map(u=>u.floor))].sort((a,b)=>a-b);
  const expanded = SCOPE!=='all' || expandedBuildings.has(b.id); // конкретный объект — сразу развёрнут
  const body = floors.length?floors.map(f=>{const fu=us.filter(u=>u.floor===f);
      return `<div class="floor"><div class="floor-h"><b>Этаж ${f}</b> · ${fu.length} помещ. · ${fmt(fu.reduce((s,u)=>s+u.area,0))} м²</div>
      <div class="units">${fu.map(unitTile).join('')}</div></div>`;}).join(''):'<div class="empty" style="padding:24px">В объекте пока нет помещений</div>';
  return `<div class="card" style="margin-bottom:16px">
    <div class="panel-title" style="margin-bottom:0">
      <div style="display:flex;align-items:center;gap:11px;cursor:pointer;flex:1;min-width:0" onclick="toggleBuilding('${b.id}')" title="${expanded?'Свернуть':'Развернуть'}">
        <span id="chev-${b.id}" style="color:var(--muted2);font-size:12px;flex-shrink:0;transition:transform .2s;transform:rotate(${expanded?90:0}deg)">▶</span>
        <div style="min-width:0"><h3>🏢 ${esc(b.name)}</h3><div class="t-sub" style="margin-top:3px">${esc(b.address)} · ${us.length} помещ. · ${fmt(totA)} м² · заполнено ${pct(occA,totA)}%</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        ${canEdit('objects')?`<button class="btn ghost sm" onclick="unitModal('${b.id}')">+ Помещение</button>`:''}
        ${canEdit('tenants')?`<button class="btn ghost sm" onclick="tenantModal('${b.id}')">+ Арендатор</button>`:''}
        ${canEdit('objects')?`<button class="btn ghost sm" onclick="editBuildingModal('${b.id}')" title="Редактировать объект">✎</button><button class="btn ghost sm" onclick="delBuilding('${b.id}')" title="Удалить объект">🗑</button>`:''}
        <div class="legend" style="margin-left:6px"><span><i style="background:var(--green)"></i>Занято</span><span><i style="background:var(--red)"></i>Долг</span><span><i style="background:var(--amber)"></i>Резерв</span><span><i style="background:var(--muted2)"></i>Свободно</span></div></div>
    </div>
    <div id="floors-${b.id}" style="display:${expanded?'block':'none'};margin-top:14px">${body}</div>
  </div>`;
}
function toggleBuilding(id){
  const el=document.getElementById('floors-'+id); if(!el)return;
  const open = el.style.display!=='none';
  el.style.display = open?'none':'block';
  const chev=document.getElementById('chev-'+id); if(chev) chev.style.transform=`rotate(${open?0:90}deg)`;
  if(open) expandedBuildings.delete(id); else expandedBuildings.add(id);
}

/* ---------- универсальная сворачиваемая секция (для арендаторов/договоров по объектам) ---------- */
const expandedSections = new Set();
function toggleSection(id){
  const el=document.getElementById('sect-'+id); if(!el)return;
  const open = el.style.display!=='none';
  el.style.display = open?'none':'block';
  const chev=document.getElementById('chev-'+id); if(chev) chev.style.transform=`rotate(${open?0:90}deg)`;
  if(open) expandedSections.delete(id); else expandedSections.add(id);
}
function collapseCard(id, headerInner, body, forceExpanded){
  const expanded = forceExpanded || SCOPE!=='all' || expandedSections.has(id);
  return `<div class="card" style="margin-bottom:16px">
    <div class="panel-title" style="margin-bottom:0">
      <div style="display:flex;align-items:center;gap:11px;cursor:pointer;flex:1;min-width:0" onclick="toggleSection('${id}')">
        <span id="chev-${id}" style="color:var(--muted2);font-size:12px;flex-shrink:0;transition:transform .2s;transform:rotate(${expanded?90:0}deg)">▶</span>
        <div style="min-width:0">${headerInner}</div>
      </div>
    </div>
    <div id="sect-${id}" style="display:${expanded?'block':'none'};margin-top:14px">${body}</div>
  </div>`;
}
function buildingHeader(b, count){
  return `<h3>🏢 ${esc(b.name)}</h3><div class="t-sub" style="margin-top:3px">${esc(b.address)} · ${count}</div>`;
}
function unitTile(u){
  const st=unitStatus(u); const cls={occupied:'u-occ',free:'u-free',reserved:'u-res',debt:'u-debt'}[st];
  const ten=u.tenant?tenantOf(u.tenant).name:(st==='reserved'?'Бронь':'Свободно');
  return `<div class="unit ${cls}" onclick="unitInfo('${u.id}')"><span class="bar"></span>
    <div class="u-id">${u.id}${u.ownership==='sold'?' 🏷':''}</div><div class="u-area">${u.type} · ${u.area} м²</div><div class="u-ten">${esc(ten)}</div>
    <div class="u-ten" style="color:var(--muted2);font-size:10.5px;margin-top:5px">📎 ${(u.documents||[]).length} док.${u.ownership==='sold'?' · сторонний собств.':''}</div></div>`;
}
function miniStat(label,v,color){return `<div class="card"><div class="label" style="color:var(--muted);font-size:12px">${label}</div><div style="font-size:24px;font-weight:750;margin-top:4px;color:${color?'var(--'+color+')':'var(--txt)'}">${v}</div></div>`;}

/* ============================================================
   АРЕНДАТОРЫ
   ============================================================ */
function tenants(){
  el(head('Арендаторы',`${sTenants().length} компаний · ${scopeSub()}`, canEdit('tenants')?`<button class="btn" onclick="tenantModal()">+ Арендатор</button>`:'')+
  `<div class="toolbar"><input class="search" id="tsearch" placeholder="Поиск по названию, ИНН..." oninput="renderTenants()"></div>
  <div id="tbcards"></div>`);
  renderTenants();
}
function tenantBuilding(t){const c=DB.contracts.find(c=>c.tenant===t.id);return c?(unitOf(c.unit)?.building||null):null;}
function tenantTable(list){
  return `<div style="overflow-x:auto"><table><thead><tr><th>Арендатор</th><th>Контакт</th><th>Отрасль</th><th>Помещение</th><th>Аренда/мес</th><th>Статус оплат</th></tr></thead><tbody>${list.map(tenantRow).join('')}</tbody></table></div>`;
}
function tenantRow(t){
  const c=DB.contracts.find(c=>c.tenant===t.id);
  const pay=c?DB.payments.find(p=>p.contract===c.id):null;
  const stp=pay?payPill(pay):'<span class="pill gray">—</span>';
  return `<tr onclick="tenantInfo('${t.id}')" style="cursor:pointer"><td><div class="t-strong">${esc(t.name)}</div><div class="t-sub">ИНН ${t.inn}</div></td>
    <td><div>${esc(t.contact)}</div><div class="t-sub">${t.phone}</div></td><td><span class="pill blue">${esc(t.industry)}</span></td>
    <td>${c?c.unit:'—'}</td><td class="t-strong">${c?money(monthlyRent(c)):'—'}</td><td>${stp}</td></tr>`;
}
function renderTenants(){
  const q=(document.getElementById('tsearch')?.value||'').toLowerCase();
  const match=t=>!q||t.name.toLowerCase().includes(q)||(t.inn||'').includes(q)||(t.contact||'').toLowerCase().includes(q);
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  let html = bs.map(b=>{
    const list=DB.tenants.filter(t=>tenantBuilding(t)===b.id && match(t));
    const body = list.length? tenantTable(list) : '<div class="empty" style="padding:20px">Нет арендаторов в объекте</div>';
    return collapseCard('ten-'+b.id, buildingHeader(b, list.length+' аренд.'), body, !!q);
  }).join('');
  if(SCOPE==='all'){
    const noplace=DB.tenants.filter(t=>!tenantBuilding(t) && match(t));
    if(noplace.length) html += collapseCard('ten-none',
      `<h3>📭 Без размещения</h3><div class="t-sub" style="margin-top:3px">Арендаторы без договора · ${noplace.length}</div>`,
      tenantTable(noplace), !!q);
  }
  document.getElementById('tbcards').innerHTML = html || '<div class="card"><div class="empty">Ничего не найдено</div></div>';
}

/* ============================================================
   ДОГОВОРЫ
   ============================================================ */
function contracts(){
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  el(head('Договоры аренды',`${sContracts().length} договоров · ${scopeSub()}`, canEdit('contracts')?`<button class="btn" onclick="contractModal()">+ Договор</button>`:'')+
  `<div id="cbcards"></div>`);
  document.getElementById('cbcards').innerHTML = bs.map(b=>{
    const cs=DB.contracts.filter(c=>unitOf(c.unit)?.building===b.id);
    const body = cs.length
      ? `<div style="overflow-x:auto"><table><thead><tr><th>№ / Арендатор</th><th>Помещение</th><th>Ставка ₽/м²</th><th>Аренда/мес</th><th>Срок</th><th>Индексация</th><th>Статус</th></tr></thead><tbody>${cs.map(contractRow).join('')}</tbody></table></div>`
      : '<div class="empty" style="padding:20px">Нет договоров в объекте</div>';
    return collapseCard('con-'+b.id, buildingHeader(b, cs.length+' догов.'), body, false);
  }).join('') || '<div class="card"><div class="empty">Объекты не найдены</div></div>';
}
function contractRow(c){const t=tenantOf(c.tenant);const dl=daysLeft(c.end);
  const stPill=c.status==='expiring'||dl<90?`<span class="pill amber">Истекает (${dl} дн)</span>`:`<span class="pill green">Активен</span>`;
  return `<tr style="cursor:pointer" onclick="contractInfo('${c.id}')"><td><div class="t-strong">${c.id.toUpperCase()}</div><div class="t-sub">${esc(t.name)}</div></td>
    <td>${c.unit}</td><td>${fmt(c.rate)}</td><td class="t-strong">${money(monthlyRent(c))}</td>
    <td><div>${fmtD(c.start)} —</div><div class="t-sub">${fmtD(c.end)}</div></td><td>${c.indexation}%/год</td><td>${stPill}</td></tr>`;
}
function fmtD(d){return new Date(d).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'});}

/* ============================================================
   ПЛАТЕЖИ
   ============================================================ */
function payments(){
  const m=metrics();
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  el(head('Платежи аренды',`Период: Июнь 2026 · ${scopeSub()}`, canEdit('payments')?`<button class="btn" onclick="paymentModal()">+ Начисление</button>`:'')+
  `<div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
    ${miniStat('Начислено',money(m.billed))}${miniStat('Собрано',money(m.collected),'green')}
    ${miniStat('Задолженность',money(m.debt),'red')}${miniStat('Собираемость',pct(m.collected,m.billed)+'%','blue')}
  </div><div id="pbcards"></div>`);
  document.getElementById('pbcards').innerHTML = bs.map(b=>{
    const ps=DB.payments.filter(p=>{const c=contractOf(p.contract);return c&&unitOf(c.unit)?.building===b.id;});
    const body = ps.length
      ? `<div style="overflow-x:auto"><table><thead><tr><th>Арендатор</th><th>Помещение</th><th>Период</th><th>Начислено</th><th>Оплачено</th><th>Срок</th><th>Статус</th><th></th></tr></thead><tbody>${ps.map(paymentRow).join('')}</tbody></table></div>`
      : '<div class="empty" style="padding:20px">Нет платежей в объекте</div>';
    const bd=ps.reduce((s,p)=>s+(p.amount-p.paid),0);
    return collapseCard('pay-'+b.id, buildingHeader(b, `${ps.length} плат.${bd>0?' · долг '+money(bd):''}`), body, false);
  }).join('') || '<div class="card"><div class="empty">Объекты не найдены</div></div>';
}
function paymentRow(p){const c=contractOf(p.contract);const t=tenantOf(c.tenant);
  return `<tr><td class="t-strong">${esc(t.name)}</td><td>${c.unit}</td><td>${p.period}</td><td>${money(p.amount)}</td>
    <td>${p.paid?money(p.paid):'—'}</td><td class="t-sub">${fmtD(p.due)}</td><td>${payPill(p)}</td>
    <td style="text-align:right">${(p.amount-p.paid>0&&canEdit('payments'))?`<button class="btn sm" onclick="payModal('${p.id}')">Внести оплату</button>`:'<span class="t-sub">оплачен</span>'}</td></tr>`;
}
function payPill(p){const m={paid:['green','Оплачен'],overdue:['red','Просрочен'],partial:['amber','Частично'],pending:['blue','Ожидание']};const x=m[p.status]||['gray','—'];return `<span class="pill ${x[0]}">${x[1]}</span>`;}
function payModal(id){const p=DB.payments.find(x=>x.id===id);if(!p)return;const c=contractOf(p.contract);const t=tenantOf(c.tenant);const rem=p.amount-p.paid;
  openM(`<div class="modal-h"><h3>Внести оплату</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    ${infoRow('Арендатор',esc(t.name))}${infoRow('Помещение',c.unit)}${infoRow('Период',p.period)}
    ${infoRow('Начислено',money(p.amount))}${infoRow('Уже оплачено',money(p.paid))}${infoRow('Остаток к оплате',`<span style="color:var(--red)">${money(rem)}</span>`)}
    <div class="row2" style="margin-top:14px"><div class="field"><label>Сумма оплаты, ₽</label><input id="pay-amt" type="number" value="${rem}"></div>
      <div class="field"><label>Дата оплаты</label><input id="pay-date" type="date" value="${TODAY.toISOString().slice(0,10)}"></div></div>
    <div class="t-sub">Можно внести частично — статус обновится автоматически (Частично / Оплачен).</div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="savePay('${id}')">Зачесть оплату</button></div>`);}
async function savePay(id){const p=DB.payments.find(x=>x.id===id);if(!p)return;
  const add=+val('pay-amt')||0; if(add<=0)return alert('Укажите сумму оплаты');
  p.paid=Math.min(p.amount,(p.paid||0)+add);
  p.paidDate=val('pay-date')||TODAY.toISOString().slice(0,10);
  p.status = p.paid>=p.amount?'paid':(p.paid>0?'partial':(daysLeft(p.due)<0?'overdue':'pending'));
  closeM(); await afterStateChange();}

/* ============================================================
   КОММУНАЛКА И РАСХОДЫ
   ============================================================ */
function utilities(){
  const UT=sUtilities(), EX=sExpenses();
  const ut=UT.reduce((s,u)=>s+u.electricity+u.water+u.heating,0);
  const ex=EX.reduce((s,e)=>s+e.amount,0);
  el(head('Коммуналка и расходы на содержание',`Период: Июнь 2026 · ${scopeSub()}`,canEdit('utilities')?`<button class="btn" onclick="expenseModal()">+ Расход</button>`:'')+
  `<div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
    ${miniStat('Коммунальные начисления',money(ut),'violet')}${miniStat('Расходы на содержание',money(ex),'amber')}${miniStat('Итого затраты',money(ut+ex),'red')}
  </div>
  <div id="ubcards"></div>
  <div class="card" style="margin-top:18px"><div class="panel-title"><h3>Структура расходов на содержание</h3><span class="muted">${scopeSub()}</span></div><canvas id="chExp" height="80"></canvas></div>`);
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  document.getElementById('ubcards').innerHTML = bs.map(b=>{
    const bu=DB.utilities.filter(u=>unitOf(u.unit)?.building===b.id);
    const be=DB.expenses.filter(e=>(e.building||'b1')===b.id);
    const tot=bu.reduce((s,u)=>s+u.electricity+u.water+u.heating,0)+be.reduce((s,e)=>s+e.amount,0);
    const body=`<div class="grid" style="grid-template-columns:1.2fr 1fr">
      <div><div class="sec-h" style="margin-top:0">Коммунальные начисления</div>${utilTable(bu)}</div>
      <div><div class="sec-h" style="margin-top:0">Эксплуатационные расходы</div>${expenseTable(be)}</div>
    </div>`;
    return collapseCard('util-'+b.id, buildingHeader(b, `затраты ${money(tot)}`), body, false);
  }).join('') || '<div class="card"><div class="empty">Объекты не найдены</div></div>';
  new Chart(document.getElementById('chExp'),{type:'bar',data:{labels:EX.map(e=>e.category),datasets:[{data:EX.map(e=>e.amount),backgroundColor:cssVar('--violet'),borderRadius:6}]},
    options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:cssVar('--chart-grid')},ticks:{color:cssVar('--muted')}},y:{grid:{display:false},ticks:{color:cssVar('--muted')}}}}});
}
function utilTable(list){
  return `<div style="overflow-x:auto"><table><thead><tr><th>Помещение</th><th>Эл-во</th><th>Вода</th><th>Отопл.</th><th>Итого</th><th>Статус</th></tr></thead><tbody>
    ${list.length?list.map(u=>{const tot=u.electricity+u.water+u.heating;return `<tr><td class="t-strong">${u.unit}</td><td>${fmt(u.electricity)}</td><td>${fmt(u.water)}</td><td>${fmt(u.heating)}</td><td class="t-strong">${money(tot)}</td><td>${utilPill(u.status)}</td></tr>`;}).join(''):'<tr><td colspan="6" class="empty">Нет начислений</td></tr>'}
    </tbody></table></div>`;
}
function expenseTable(list){
  return `<div style="overflow-x:auto"><table><thead><tr><th>Категория</th><th>Подрядчик</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>
    ${list.length?list.map(e=>`<tr><td class="t-strong">${esc(e.category)}</td><td class="t-sub">${esc(e.vendor)}</td><td class="t-strong">${money(e.amount)}</td><td>${utilPill(e.status)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Нет расходов</td></tr>'}
    </tbody></table></div>`;
}
function utilPill(s){const m={paid:['green','Оплачено'],invoiced:['blue','Выставлен'],overdue:['red','Просрочен'],planned:['gray','План']};const x=m[s]||['gray',s];return `<span class="pill ${x[0]}">${x[1]}</span>`;}

/* ============================================================
   ЗАДАЧИ (канбан + назначение сотрудникам + сроки)
   ============================================================ */
function tasks(){
  const mine=TASKS.filter(t=>t.assignee_id===ME.id&&t.status!=='done');
  const overdue=TASKS.filter(t=>t.status!=='done'&&daysLeft(t.due)<0);
  el(head('Задачи по объектам',`${TASKS.filter(t=>t.status!=='done').length} активных · мои: ${mine.length} · просрочено: ${overdue.length}`,
    canEdit('tasks')?`<button class="btn" onclick="taskModal()">+ Задача</button>`:'')+
  `<div class="grid" style="grid-template-columns:repeat(3,1fr)" id="board"></div>`);
  const cols=[['open','Открыто','var(--muted2)'],['in_progress','В работе','var(--accent)'],['done','Готово','var(--green)']];
  document.getElementById('board').innerHTML=cols.map(([k,label,color])=>{
    const items=TASKS.filter(t=>t.status===k);
    return `<div class="card"><div class="panel-title"><h3><span class="dot" style="background:${color}"></span>${label}</h3><span class="muted">${items.length}</span></div>
    ${items.map(t=>{
      const dl=daysLeft(t.due), cls=t.status!=='done'&&dl<0?'overdue':(t.status!=='done'&&dl<=3?'soon':'');
      const mineMark=t.assignee_id===ME.id?' · <span style="color:var(--accent2)">вы</span>':'';
      const canMove = canEdit('tasks') || t.assignee_id===ME.id;
      return `<div class="task-card ${cls}">
      <div class="t-strong" style="margin-bottom:6px;cursor:pointer" onclick="taskInfo(${t.id})">${esc(t.title)}</div>
      <div class="t-sub" style="margin-bottom:8px">📍 ${esc(t.unit)} · 👤 ${esc(t.assignee_name||'не назначен')}${mineMark}</div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">${prioPill(t.priority)}<span class="t-sub">${t.status==='done'?'<span style="color:var(--green)">✓ выполнено</span>':dueLabel(t.due)}</span></div>
      ${t.status!=='done'&&canMove?`<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="advanceTask(${t.id})">${t.status==='open'?'→ В работу':'✓ Завершить'}</button>`:''}
    </div>`;}).join('')||'<div class="empty">Пусто</div>'}</div>`;
  }).join('');
}
function prioPill(p){const m={high:['red','Высокий'],medium:['amber','Средний'],low:['gray','Низкий']};const x=m[p]||['gray',p];return `<span class="pill ${x[0]}">${x[1]}</span>`;}
function prioWord(p){return {high:'Высокий',medium:'Средний',low:'Низкий'}[p]||p;}
function dueLabel(d){const dl=daysLeft(d);if(d==null||dl===9999)return '<span class="t-sub">без срока</span>';if(dl<0)return `<span style="color:var(--red)">просрочено ${-dl} дн</span>`;if(dl===0)return '<span style="color:var(--amber)">сегодня</span>';if(dl<=3)return `<span style="color:var(--amber)">через ${dl} дн</span>`;return `через ${dl} дн`;}
async function advanceTask(id){const t=TASKS.find(t=>t.id===id);const next=t.status==='open'?'in_progress':'done';
  try{ await api('/api/tasks/'+id,'PATCH',{status:next}); await reloadTasks(); render(); }catch(e){alert(e.message);} }
async function reloadTasks(){ TASKS=await api('/api/tasks'); }

/* ============================================================
   СОТРУДНИКИ / ПОЛЬЗОВАТЕЛИ
   ============================================================ */
function employees(){
  const editable=canEdit('employees');
  el(head('Сотрудники и доступы',`${USERS.length} пользователей · роли и права доступа`,
    editable?`<button class="btn" onclick="userModal()">+ Сотрудник</button>`:'')+
  `<div class="card" style="padding:0"><table><thead><tr><th>Сотрудник</th><th>Должность</th><th>Роль / права</th><th>Контакты</th><th>Активных задач</th><th>Статус</th>${editable?'<th></th>':''}</tr></thead><tbody>
  ${USERS.map(u=>{
    const openCnt=TASKS.filter(t=>t.assignee_id===u.id&&t.status!=='done').length;
    const overdueCnt=TASKS.filter(t=>t.assignee_id===u.id&&t.status!=='done'&&daysLeft(t.due)<0).length;
    return `<tr><td><div class="t-strong">${esc(u.full_name)}${u.id===ME.id?' <span class="pill blue" style="padding:1px 7px">вы</span>':''}</div><div class="t-sub">${esc(u.email)}</div></td>
    <td>${esc(u.position||'—')}</td>
    <td><span class="pill role-${u.role}">${esc(u.roleTitle)}</span></td>
    <td class="t-sub">${esc(u.phone||'—')}</td>
    <td>${openCnt}${overdueCnt?` <span class="pill red" style="padding:1px 7px">${overdueCnt} просроч.</span>`:''}</td>
    <td>${u.active?'<span class="pill green">Активен</span>':'<span class="pill gray">Отключён</span>'}</td>
    ${editable?`<td style="text-align:right;white-space:nowrap">
      <button class="btn ghost sm" onclick="userModal(${u.id})">✎</button>
      ${u.id!==ME.id?`<button class="btn ghost sm" onclick="delUser(${u.id})">🗑</button>`:''}</td>`:''}</tr>`;
  }).join('')}
  </tbody></table></div>
  <div class="card" style="margin-top:18px"><div class="panel-title"><h3>Матрица прав доступа</h3><span class="muted">по ролям</span></div>
  ${permMatrix()}</div>`);
}
function permMatrix(){
  const mods=[['objects','Объекты'],['tenants','Аренд.'],['contracts','Догов.'],['payments','Платежи'],['utilities','Комм.'],['tasks','Задачи'],['reports','Отчёты'],['employees','Сотруд.']];
  const roles=Object.entries(ROLES);
  return `<div style="overflow-x:auto"><table><thead><tr><th>Роль</th>${mods.map(m=>`<th style="text-align:center">${m[1]}</th>`).join('')}</tr></thead><tbody>
  ${roles.map(([k,r])=>`<tr><td><span class="pill role-${k}">${esc(r.title)}</span></td>
    ${mods.map(([mk])=>{const e=r.edit.includes(mk),v=r.view.includes(mk);
      return `<td style="text-align:center">${e?'<span title="Редактирование" style="color:var(--green)">✎</span>':v?'<span title="Просмотр" style="color:var(--muted)">👁</span>':'<span style="color:var(--muted2)">—</span>'}</td>`;}).join('')}</tr>`).join('')}
  </tbody></table></div><div class="t-sub" style="margin-top:10px">✎ — редактирование · 👁 — только просмотр · — нет доступа</div>`;
}
async function delUser(id){ if(!confirm('Удалить сотрудника? Его задачи останутся без исполнителя.'))return;
  try{ await api('/api/users/'+id,'DELETE'); USERS=await api('/api/users'); await reloadTasks(); render(); }catch(e){alert(e.message);} }

/* ============================================================
   ОТЧЁТЫ
   ============================================================ */
function reports(){
  const m=metrics();
  const byTenant=sPayments().map(p=>{const c=contractOf(p.contract);return{name:tenantOf(c.tenant).name,billed:p.amount,paid:p.paid,debt:p.amount-p.paid};}).sort((a,b)=>b.debt-a.debt);
  el(head('Отчёты и аналитика',`Сводная отчётность · ${scopeSub()}`,`<button class="btn ghost sm" onclick="exportCSV()">⤓ Экспорт CSV</button>`)+
  `<div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
    ${miniStat('Валовый доход (мес.)',money(m.collected),'green')}${miniStat('Операц. расходы',money(m.exp),'amber')}
    ${miniStat('NOI (чистый опер. доход)',money(m.net),'blue')}${miniStat('Маржа NOI',pct(m.net,m.collected)+'%','violet')}
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:18px">
    <div class="card"><div class="panel-title"><h3>Динамика NOI</h3><span class="muted">тыс ₽</span></div><canvas id="chNOI" height="130"></canvas></div>
    <div class="card"><div class="panel-title"><h3>Заполняемость по этажам</h3><span class="muted">%</span></div><canvas id="chFloor" height="130"></canvas></div>
  </div>
  <div class="card" style="padding:0"><div class="panel-title" style="padding:16px 18px 0"><h3>Отчёт по расчётам с арендаторами</h3></div>
  <table><thead><tr><th>Арендатор</th><th>Начислено</th><th>Оплачено</th><th>Задолженность</th><th>% оплаты</th></tr></thead><tbody>
  ${byTenant.map(r=>`<tr><td class="t-strong">${esc(r.name)}</td><td>${money(r.billed)}</td><td>${money(r.paid)}</td><td>${r.debt>0?`<span class="pill red">${money(r.debt)}</span>`:`<span class="pill green">0 ₽</span>`}</td>
  <td><div class="prog" style="width:90px"><span style="width:${Math.round(r.paid/r.billed*100)}%"></span></div></td></tr>`).join('')}
  </tbody></table></div>`);
  new Chart(document.getElementById('chNOI'),{type:'line',data:{labels:DB.history.map(h=>h.m),datasets:[{label:'NOI',data:DB.history.map(h=>h.income-h.expense),borderColor:cssVar('--green'),backgroundColor:cssVar('--green')+'22',fill:true,tension:.35,pointRadius:3}]},options:chOpts(false)});
  const su=sUnits(); const floors=[...new Set(su.map(u=>u.floor))].sort();
  new Chart(document.getElementById('chFloor'),{type:'bar',data:{labels:floors.map(f=>'Этаж '+f),datasets:[{data:floors.map(f=>{const us=su.filter(u=>u.floor===f);const t=us.reduce((s,u)=>s+u.area,0);const o=us.filter(u=>u.tenant).reduce((s,u)=>s+u.area,0);return pct(o,t);}),backgroundColor:cssVar('--accent'),borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{max:100,grid:{color:cssVar('--chart-grid')},ticks:{color:cssVar('--muted')}},x:{grid:{display:false},ticks:{color:cssVar('--muted')}}}}});
}
function exportCSV(){
  let rows=[['Объект','Арендатор','Помещение','Период','Начислено','Оплачено','Задолженность','Статус']];
  sPayments().forEach(p=>{const c=contractOf(p.contract);const b=buildingOf(unitOf(c.unit)?.building);rows.push([b?b.name:'',tenantOf(c.tenant).name,c.unit,p.period,p.amount,p.paid,p.amount-p.paid,p.status]);});
  const csv='﻿'+rows.map(r=>r.join(';')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='otchet_arenda_2026-06.csv';a.click();
}
async function resetDemo(){ if(!confirm('Сбросить все данные (помещения, договоры, платежи, задачи) к демо? Пользователи сохранятся.'))return;
  try{ await api('/api/reset','POST'); await loadData(); render(); }catch(e){alert(e.message);} }

/* ============================================================
   МОДАЛКИ
   ============================================================ */
const mBg=document.getElementById('modalBg'),mEl=document.getElementById('modal');
function openM(html){mEl.innerHTML=html;mBg.classList.add('show');}
function closeM(){mBg.classList.remove('show');}
mBg.onclick=e=>{if(e.target===mBg)closeM();};

/* помещение */
function unitModal(presetBuilding){const def=presetBuilding||(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id);
  openM(`<div class="modal-h"><h3>Новое помещение</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Объект</label><select id="f-building">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
  <div class="row2"><div class="field"><label>Номер</label><input id="f-id" placeholder="3-03"></div><div class="field"><label>Этаж</label><input id="f-floor" type="number" value="1"></div></div>
  <div class="row2"><div class="field"><label>Площадь, м²</label><input id="f-area" type="number" value="100"></div><div class="field"><label>Тип</label><select id="f-type"><option>Офис</option><option>Ритейл</option><option>Кафе</option><option>Коворкинг</option><option>Склад</option></select></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveUnit()">Добавить</button></div>`);}
async function saveUnit(){const id=val('f-id').trim(); if(!id)return alert('Укажите номер');
  if(unitOf(id))return alert('Помещение с номером '+id+' уже существует');
  const u={id,building:val('f-building'),floor:+val('f-floor'),area:+val('f-area'),type:val('f-type'),tenant:null,status:'free',ownership:'own',owner:null,
    responsible:{name:ME.full_name,role:ME.position,phone:ME.phone,email:ME.email},
    documents:[{name:'План_помещения_'+id+'.pdf',type:'plan',kind:'Поэтажный план'},{name:'Выписка_ЕГРН_'+id+'.pdf',type:'ownership',kind:'Право собственности'}]};
  DB.units.push(u);closeM();await afterStateChange();}

/* объект (здание) */
function buildingModal(){openM(`<div class="modal-h"><h3>Новый объект</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Наименование</label><input id="b-name" placeholder="БЦ «Название»"></div>
  <div class="field"><label>Адрес</label><input id="b-addr" placeholder="г. Москва, ул. ..."></div>
  <div class="row2"><div class="field"><label>Этажей</label><input id="b-floors" type="number" value="5"></div>
    <div class="field"><label>Общая площадь, м²</label><input id="b-area" type="number" value="0"></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveBuilding()">Добавить объект</button></div>`);}
async function saveBuilding(){const name=val('b-name').trim(); if(!name)return alert('Укажите наименование');
  const id='b'+Date.now();
  DB.buildings.push({id,name,address:val('b-addr').trim(),floors:+val('b-floors')||1,totalArea:+val('b-area')||0});
  closeM(); await saveState(); SCOPE=id; localStorage.setItem('citi_srm_scope',id); showApp();}
function editBuildingModal(id){const b=buildingOf(id);if(!b)return;
  openM(`<div class="modal-h"><h3>Редактировать объект</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Наименование</label><input id="b-name" value="${esc(b.name)}"></div>
  <div class="field"><label>Адрес</label><input id="b-addr" value="${esc(b.address||'')}"></div>
  <div class="row2"><div class="field"><label>Этажей</label><input id="b-floors" type="number" value="${b.floors||1}"></div>
    <div class="field"><label>Общая площадь, м²</label><input id="b-area" type="number" value="${b.totalArea||0}"></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveBuildingEdit('${id}')">Сохранить</button></div>`);}
async function saveBuildingEdit(id){const b=buildingOf(id);if(!b)return;
  const name=val('b-name').trim(); if(!name)return alert('Укажите наименование');
  b.name=name; b.address=val('b-addr').trim(); b.floors=+val('b-floors')||1; b.totalArea=+val('b-area')||0;
  closeM(); await saveState(); showApp();}
async function delBuilding(id){const b=buildingOf(id);if(!b)return;
  const units=DB.units.filter(u=>u.building===id);
  if(units.length) return alert(`Нельзя удалить объект «${b.name}»: в нём ${units.length} помещ. Сначала удалите или перенесите помещения.`);
  if(!confirm(`Удалить объект «${b.name}»?`))return;
  DB.buildings=DB.buildings.filter(x=>x.id!==id);
  if(SCOPE===id){SCOPE='all';localStorage.setItem('citi_srm_scope','all');}
  closeM(); await saveState(); showApp();}

/* арендатор */
function tenantModal(presetBuilding){const def=presetBuilding||(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id);
  openM(`<div class="modal-h"><h3>Новый арендатор</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Наименование</label><input id="f-name" placeholder="ООО «Компания»"></div>
  <div class="row2"><div class="field"><label>Контактное лицо</label><input id="f-contact"></div><div class="field"><label>ИНН</label><input id="f-inn"></div></div>
  <div class="row2"><div class="field"><label>Телефон</label><input id="f-phone"></div><div class="field"><label>Отрасль</label><input id="f-industry" value="Офис"></div></div>
  <div class="field"><label>Email</label><input id="f-email"></div>
  <div class="sec-h">Разместить в объекте <span class="t-sub" style="text-transform:none;letter-spacing:0">необязательно</span></div>
  <div class="row2"><div class="field"><label>Объект</label><select id="f-tbuilding" onchange="fillTenantUnits()">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Свободное помещение</label><select id="f-tunit"></select></div></div>
  <div class="row2"><div class="field"><label>Ставка ₽/м²/мес</label><input id="f-trate" type="number" value="2200"></div><div class="field"><label>Договор до</label><input id="f-tend" type="date" value="2029-06-30"></div></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveTenant()">Добавить</button></div>`);
  fillTenantUnits();
}
function fillTenantUnits(){
  const bid=val('f-tbuilding');
  const free=DB.units.filter(u=>u.building===bid && !u.tenant);
  const sel=document.getElementById('f-tunit'); if(!sel)return;
  sel.innerHTML=`<option value="">— не размещать сейчас —</option>`+free.map(u=>`<option value="${u.id}">${u.id} · ${u.type} · ${u.area} м²</option>`).join('');
}
async function saveTenant(){
  if(!val('f-name').trim())return alert('Укажите наименование');
  const id='t'+Date.now();
  DB.tenants.push({id,name:val('f-name'),contact:val('f-contact'),phone:val('f-phone'),email:val('f-email'),inn:val('f-inn'),industry:val('f-industry')});
  const uid=val('f-tunit');
  if(uid){ const u=unitOf(uid); const rate=+val('f-trate')||0;
    DB.contracts.push({id:'c'+Date.now(),tenant:id,unit:uid,rate,start:TODAY.toISOString().slice(0,10),end:val('f-tend')||'2029-06-30',deposit:rate*(u?u.area:0)*2,indexation:6,status:'active'});
    if(u) u.tenant=id;
  }
  closeM();await afterStateChange();
}

/* договор */
function contractModal(){const free=sUnits().filter(u=>!u.tenant);const pool=free.length?free:sUnits();openM(`<div class="modal-h"><h3>Новый договор</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Арендатор</label><select id="f-ten">${DB.tenants.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
  <div class="field"><label>Помещение (свободные)</label><select id="f-unit">${pool.map(u=>`<option value="${u.id}">${u.id} · ${u.area} м² · ${esc(buildingOf(u.building)?.name||'')}</option>`).join('')}</select></div>
  <div class="row2"><div class="field"><label>Ставка ₽/м²/мес</label><input id="f-rate" type="number" value="2200"></div><div class="field"><label>Индексация %/год</label><input id="f-idx" type="number" value="6"></div></div>
  <div class="row2"><div class="field"><label>Начало</label><input id="f-start" type="date" value="2026-07-01"></div><div class="field"><label>Окончание</label><input id="f-end" type="date" value="2029-06-30"></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveContract()">Создать</button></div>`);}
async function saveContract(){const u=val('f-unit');const rate=+val('f-rate');const area=unitOf(u).area;
  DB.contracts.push({id:'c'+Date.now(),tenant:val('f-ten'),unit:u,rate,start:val('f-start'),end:val('f-end'),deposit:rate*area*2,indexation:+val('f-idx'),status:'active'});
  unitOf(u).tenant=val('f-ten');closeM();await afterStateChange();}

/* платёж */
function paymentModal(){openM(`<div class="modal-h"><h3>Новый платёж</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Договор</label><select id="f-c">${sContracts().map(c=>`<option value="${c.id}">${c.id.toUpperCase()} · ${esc(tenantOf(c.tenant).name)} · ${c.unit}</option>`).join('')}</select></div>
  <div class="row2"><div class="field"><label>Период</label><input id="f-period" value="2026-07"></div><div class="field"><label>Сумма</label><input id="f-amount" type="number"></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="savePayment()">Добавить</button></div>`);}
async function savePayment(){DB.payments.push({id:'p'+Date.now(),contract:val('f-c'),period:val('f-period'),amount:+val('f-amount'),due:'2026-07-05',paid:0,paidDate:null,status:'pending'});closeM();await afterStateChange();}

/* расход */
function expenseModal(){const def=SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id;
  openM(`<div class="modal-h"><h3>Новый расход</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Объект</label><select id="f-ebuilding">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
  <div class="row2"><div class="field"><label>Категория</label><input id="f-cat" placeholder="Клининг"></div><div class="field"><label>Сумма</label><input id="f-amt" type="number"></div></div>
  <div class="field"><label>Подрядчик</label><input id="f-vendor"></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveExpense()">Добавить</button></div>`);}
async function saveExpense(){DB.expenses.push({id:'e'+Date.now(),building:val('f-ebuilding'),category:val('f-cat'),vendor:val('f-vendor'),period:'2026-06',amount:+val('f-amt'),status:'planned'});closeM();await afterStateChange();}

/* задача */
function taskModal(id){
  const t=id?TASKS.find(x=>x.id===id):null;
  const userOpts=USERS.filter(u=>u.active).map(u=>`<option value="${u.id}"${t&&t.assignee_id===u.id?' selected':''}>${esc(u.full_name)} — ${esc(u.roleTitle)}</option>`).join('');
  const unitOpts=['—',...DB.units.map(u=>u.id)].map(x=>`<option${t&&t.unit===x?' selected':''}>${x}</option>`).join('');
  openM(`<div class="modal-h"><h3>${t?'Редактировать задачу':'Новая задача'}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Описание задачи</label><input id="f-title" value="${t?esc(t.title):''}" placeholder="Что нужно сделать"></div>
  <div class="field"><label>Комментарий</label><textarea id="f-desc" rows="2">${t?esc(t.description):''}</textarea></div>
  <div class="row2"><div class="field"><label>Помещение</label><select id="f-unit2">${unitOpts}</select></div>
    <div class="field"><label>Ответственный сотрудник</label><select id="f-ass">${userOpts}</select></div></div>
  <div class="row2"><div class="field"><label>Срок выполнения</label><input id="f-due" type="date" value="${t&&t.due?t.due:''}"></div>
    <div class="field"><label>Приоритет</label><select id="f-prio">
      <option value="high"${t&&t.priority==='high'?' selected':''}>Высокий</option>
      <option value="medium"${!t||t.priority==='medium'?' selected':''}>Средний</option>
      <option value="low"${t&&t.priority==='low'?' selected':''}>Низкий</option></select></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveTask(${id||0})">${t?'Сохранить':'Создать'}</button></div>`);}
async function saveTask(id){
  const body={title:val('f-title'),description:val('f-desc'),unit:val('f-unit2'),assignee_id:+val('f-ass'),due:val('f-due')||null,priority:val('f-prio')};
  if(!body.title.trim())return alert('Укажите описание задачи');
  try{ if(id){await api('/api/tasks/'+id,'PATCH',body);} else {await api('/api/tasks','POST',body);} closeM(); await reloadTasks(); render(); }catch(e){alert(e.message);}
}
function taskInfo(id){const t=TASKS.find(x=>x.id===id);const canManage=canEdit('tasks')||t.assignee_id===ME.id;
  openM(`<div class="modal-h"><h3>Задача</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="t-strong" style="font-size:15px;margin-bottom:10px">${esc(t.title)}</div>
  ${t.description?`<div class="t-sub" style="margin-bottom:14px">${esc(t.description)}</div>`:''}
  ${infoRow('Помещение',esc(t.unit))}${infoRow('Ответственный',esc(t.assignee_name||'не назначен'))}${infoRow('Должность',esc(t.assignee_position||'—'))}
  ${infoRow('Приоритет',prioWord(t.priority))}${infoRow('Срок',t.due?fmtD(t.due)+' · '+dueLabel(t.due):'без срока')}
  ${infoRow('Статус',{open:'Открыто',in_progress:'В работе',done:'Готово'}[t.status])}${infoRow('Поставил',esc(t.creator_name||'—'))}</div>
  <div class="modal-f">
    ${canManage&&t.status!=='done'?`<button class="btn ghost" onclick="closeM();advanceTask(${t.id})">${t.status==='open'?'→ В работу':'✓ Завершить'}</button>`:''}
    ${canEdit('tasks')?`<button class="btn ghost" onclick="taskModal(${t.id})">✎ Изменить</button><button class="btn danger" onclick="delTask(${t.id})">Удалить</button>`:''}
    <button class="btn" onclick="closeM()">Закрыть</button></div>`);}
async function delTask(id){ if(!confirm('Удалить задачу?'))return; try{ await api('/api/tasks/'+id,'DELETE'); closeM(); await reloadTasks(); render(); }catch(e){alert(e.message);} }

/* сотрудник / пользователь */
function userModal(id){
  const u=id?USERS.find(x=>x.id===id):null;
  const roleOpts=Object.entries(ROLES).map(([k,r])=>`<option value="${k}"${u&&u.role===k?' selected':''}>${esc(r.title)}</option>`).join('');
  openM(`<div class="modal-h"><h3>${u?'Редактировать сотрудника':'Новый сотрудник'}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>ФИО</label><input id="u-name" value="${u?esc(u.full_name):''}"></div>
  <div class="row2"><div class="field"><label>Должность</label><input id="u-pos" value="${u?esc(u.position):''}"></div>
    <div class="field"><label>Телефон</label><input id="u-phone" value="${u?esc(u.phone):''}"></div></div>
  <div class="field"><label>Email (логин)</label><input id="u-email" type="email" value="${u?esc(u.email):''}" ${u?'disabled style="opacity:.6"':''}></div>
  <div class="field"><label>${u?'Новый пароль (если менять)':'Пароль'}</label><input id="u-pw" type="password" placeholder="${u?'оставьте пустым':'не короче 6 символов'}"></div>
  <div class="field"><label>Роль (права доступа)</label><select id="u-role">${roleOpts}</select></div>
  ${u?`<div class="field"><label>Доступ</label><select id="u-active"><option value="1"${u.active?' selected':''}>Активен</option><option value="0"${!u.active?' selected':''}>Отключён</option></select></div>`:''}
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveUser(${id||0})">${u?'Сохранить':'Добавить'}</button></div>`);}
async function saveUser(id){
  try{
    if(id){
      const body={full_name:val('u-name'),position:val('u-pos'),phone:val('u-phone'),role:val('u-role'),active:val('u-active')==='1'};
      if(val('u-pw'))body.password=val('u-pw');
      await api('/api/users/'+id,'PATCH',body);
    }else{
      const pw=val('u-pw'); if(pw.length<6)return alert('Пароль не короче 6 символов');
      await api('/api/users','POST',{full_name:val('u-name'),position:val('u-pos'),phone:val('u-phone'),email:val('u-email'),password:pw,role:val('u-role')});
    }
    closeM(); USERS=await api('/api/users'); if(id===ME.id){const me=await api('/api/auth/me');ME=me.user;} render();
  }catch(e){alert(e.message);}
}

/* info-модалки */
function docIcon(t){return {plan:'📐',contract:'📄',ownership:'🏷️',owner:'👥',act:'🧾',other:'📎'}[t]||'📎';}
function unitInfo(id){const u=unitOf(id);const c=DB.contracts.find(c=>c.unit===id);const t=u.tenant?tenantOf(u.tenant):null;const r=u.responsible||{};
  openM(`<div class="modal-h"><h3>Помещение ${u.id}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="sec-h">Характеристики</div>
    ${infoRow('Объект',esc(buildingOf(u.building)?.name||'—'))}${infoRow('Тип',u.type)}${infoRow('Площадь',u.area+' м²')}${infoRow('Этаж',u.floor)}
    ${infoRow('Форма владения',u.ownership==='sold'?'<span class="pill amber">Продано · сторонний собственник</span>':'<span class="pill green">В собственности компании</span>')}
    ${t?infoRow('Арендатор',esc(t.name))+infoRow('Ставка',fmt(c.rate)+' ₽/м²')+infoRow('Аренда/мес',money(monthlyRent(c)))+infoRow('Договор до',fmtD(c.end)):infoRow('Статус',u.status==='reserved'?'Бронь':'Свободно / доступно к сдаче')}
    ${u.ownership==='sold'&&u.owner?`<div class="sec-h">Собственник помещения</div>${infoRow('Собственник',esc(u.owner.name))}${infoRow('ИНН / реквизиты',u.owner.inn||'—')}${infoRow('Контакт',esc(u.owner.contact||'—'))}`:''}
    <div class="sec-h">Ответственное лицо</div>
    ${infoRow('ФИО',esc(r.name||'—'))}${r.role?infoRow('Должность',esc(r.role)):''}${infoRow('Телефон',r.phone||'—')}${infoRow('Email',esc(r.email||'—'))}
    <div class="sec-h">Связанные документы</div>
    ${(u.documents&&u.documents.length)?u.documents.map(d=>`<div class="doc"><div class="di">${docIcon(d.type)}</div><div style="flex:1;min-width:0"><div class="t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div><div class="t-sub">${esc(d.kind||'')}</div></div></div>`).join(''):'<div class="empty" style="padding:16px">Документы не прикреплены</div>'}
  </div>
  <div class="modal-f">${canEdit('objects')?`<button class="btn ghost" onclick="editUnitModal('${u.id}')">✎ Редактировать</button><button class="btn danger" onclick="delUnit('${u.id}')">Удалить</button>`:''}<button class="btn" onclick="closeM()">Закрыть</button></div>`);}

function editUnitModal(id){const u=unitOf(id);if(!u)return;const r=u.responsible||{};const o=u.owner||{};
  openM(`<div class="modal-h"><h3>Редактировать помещение ${u.id}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="sec-h">Характеристики</div>
    <div class="row2"><div class="field"><label>Объект</label><select id="e-building">${buildingsList().map(b=>`<option value="${b.id}"${u.building===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Тип</label><select id="e-type">${['Офис','Ритейл','Кафе','Коворкинг','Склад'].map(x=>`<option${u.type===x?' selected':''}>${x}</option>`).join('')}</select></div></div>
    <div class="row2"><div class="field"><label>Этаж</label><input id="e-floor" type="number" value="${u.floor}"></div><div class="field"><label>Площадь, м²</label><input id="e-area" type="number" value="${u.area}"></div></div>
    <div class="sec-h">Ответственное лицо</div>
    <div class="row2"><div class="field"><label>ФИО</label><input id="e-rname" value="${esc(r.name||'')}"></div><div class="field"><label>Должность</label><input id="e-rrole" value="${esc(r.role||'')}"></div></div>
    <div class="row2"><div class="field"><label>Телефон</label><input id="e-rphone" value="${esc(r.phone||'')}"></div><div class="field"><label>Email</label><input id="e-remail" value="${esc(r.email||'')}"></div></div>
    <div class="sec-h">Форма владения</div>
    <div class="field"><label>Статус</label><select id="e-own" onchange="document.getElementById('owner-box').style.display=this.value==='sold'?'block':'none'">
      <option value="own"${u.ownership!=='sold'?' selected':''}>В собственности компании</option>
      <option value="sold"${u.ownership==='sold'?' selected':''}>Продано стороннему собственнику</option></select></div>
    <div id="owner-box" style="display:${u.ownership==='sold'?'block':'none'}">
      <div class="field"><label>Собственник (наименование / ФИО)</label><input id="e-oname" value="${esc(o.name||'')}"></div>
      <div class="row2"><div class="field"><label>ИНН / реквизиты</label><input id="e-oinn" value="${esc(o.inn||'')}"></div><div class="field"><label>Контакт</label><input id="e-ocontact" value="${esc(o.contact||'')}"></div></div></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="unitInfo('${u.id}')">Отмена</button><button class="btn" onclick="saveUnitEdit('${u.id}')">Сохранить</button></div>`);}
async function saveUnitEdit(id){const u=unitOf(id);if(!u)return;
  u.building=val('e-building'); u.type=val('e-type'); u.floor=+val('e-floor'); u.area=+val('e-area');
  u.responsible={name:val('e-rname'),role:val('e-rrole'),phone:val('e-rphone'),email:val('e-remail')};
  u.ownership=val('e-own');
  u.owner=u.ownership==='sold'?{name:val('e-oname'),inn:val('e-oinn'),contact:val('e-ocontact')}:null;
  closeM(); await afterStateChange();}
async function delUnit(id){const u=unitOf(id);if(!u)return;
  const c=DB.contracts.find(c=>c.unit===id);
  const warn=c?`\n\nВнимание: по помещению есть договор — он и связанные платежи тоже будут удалены.`:'';
  if(!confirm(`Удалить помещение ${id}?${warn}`))return;
  const cids=DB.contracts.filter(c=>c.unit===id).map(c=>c.id);
  DB.contracts=DB.contracts.filter(c=>c.unit!==id);
  DB.payments=DB.payments.filter(p=>!cids.includes(p.contract));
  DB.utilities=DB.utilities.filter(x=>x.unit!==id);
  DB.units=DB.units.filter(x=>x.id!==id);
  closeM(); await afterStateChange();}

function tenantInfo(id){const t=tenantOf(id);const c=DB.contracts.find(c=>c.tenant===id);const u=c?unitOf(c.unit):null;
  openM(`<div class="modal-h"><h3>${esc(t.name)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">${infoRow('Контакт',esc(t.contact))}${infoRow('Телефон',t.phone)}${infoRow('Email',esc(t.email))}${infoRow('ИНН',t.inn)}${infoRow('Отрасль',esc(t.industry))}
  ${c?infoRow('Объект',esc(buildingOf(u?.building)?.name||'—'))+infoRow('Помещение',c.unit)+infoRow('Аренда/мес',money(monthlyRent(c)))+infoRow('Договор',fmtD(c.start)+' — '+fmtD(c.end)):infoRow('Размещение','не размещён в помещении')}</div>
  <div class="modal-f">${canEdit('tenants')?`<button class="btn ghost" onclick="editTenantModal('${id}')">✎ Редактировать</button><button class="btn danger" onclick="delTenant('${id}')">Удалить</button>`:''}<button class="btn" onclick="closeM()">Закрыть</button></div>`);}
function editTenantModal(id){const t=tenantOf(id);if(!t)return;
  openM(`<div class="modal-h"><h3>Редактировать арендатора</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Наименование</label><input id="et-name" value="${esc(t.name)}"></div>
  <div class="row2"><div class="field"><label>Контактное лицо</label><input id="et-contact" value="${esc(t.contact||'')}"></div><div class="field"><label>ИНН</label><input id="et-inn" value="${esc(t.inn||'')}"></div></div>
  <div class="row2"><div class="field"><label>Телефон</label><input id="et-phone" value="${esc(t.phone||'')}"></div><div class="field"><label>Отрасль</label><input id="et-industry" value="${esc(t.industry||'')}"></div></div>
  <div class="field"><label>Email</label><input id="et-email" value="${esc(t.email||'')}"></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="tenantInfo('${id}')">Отмена</button><button class="btn" onclick="saveTenantEdit('${id}')">Сохранить</button></div>`);}
async function saveTenantEdit(id){const t=tenantOf(id);if(!t)return;
  if(!val('et-name').trim())return alert('Укажите наименование');
  t.name=val('et-name'); t.contact=val('et-contact'); t.inn=val('et-inn'); t.phone=val('et-phone'); t.industry=val('et-industry'); t.email=val('et-email');
  closeM(); await afterStateChange();}
async function delTenant(id){const t=tenantOf(id);if(!t)return;
  const cs=DB.contracts.filter(c=>c.tenant===id);
  const warn=cs.length?`\n\nВнимание: у арендатора ${cs.length} договор(а) — они и платежи будут удалены, помещения освободятся.`:'';
  if(!confirm(`Удалить арендатора «${t.name}»?${warn}`))return;
  const cids=cs.map(c=>c.id);
  cs.forEach(c=>{const u=unitOf(c.unit);if(u&&u.tenant===id){u.tenant=null;u.status='free';}});
  DB.contracts=DB.contracts.filter(c=>c.tenant!==id);
  DB.payments=DB.payments.filter(p=>!cids.includes(p.contract));
  DB.tenants=DB.tenants.filter(x=>x.id!==id);
  closeM(); await afterStateChange();}
function contractInfo(id){const c=contractOf(id);const t=tenantOf(c.tenant);const u=unitOf(c.unit);
  openM(`<div class="modal-h"><h3>Договор ${c.id.toUpperCase()}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">${infoRow('Арендатор',esc(t.name))}${infoRow('Помещение',c.unit+' · '+u.area+' м²')}${infoRow('Ставка',fmt(c.rate)+' ₽/м²/мес')}${infoRow('Аренда/мес',money(monthlyRent(c)))}${infoRow('Депозит',money(c.deposit))}${infoRow('Индексация',c.indexation+'% / год')}${infoRow('Период',fmtD(c.start)+' — '+fmtD(c.end))}${infoRow('Осталось',daysLeft(c.end)+' дн')}</div>
  <div class="modal-f"><button class="btn" onclick="closeM()">Закрыть</button></div>`);}
function infoRow(k,v){return `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line);gap:14px"><span class="t-sub">${k}</span><span class="t-strong" style="text-align:right">${v}</span></div>`;}

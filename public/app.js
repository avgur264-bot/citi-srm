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
  if(!res.ok){ const err=new Error((data&&data.error) || `Ошибка ${res.status}`); err.status=res.status; err.data=data; throw err; }
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
let ALLOW_REG=false; // разрешена ли самостоятельная регистрация (с сервера)
let ASSIST_KEY=false, ASSIST_PROVIDER='gigachat'; // задан ли ключ модели в окружении (AI-помощник)
let ADS_AVITO=false, ADS_CIAN=false; // заданы ли ключи площадок (реклама) — реальная синхронизация
let ADS_INFO=null;          // {feedAvito, feedCian, feedProtected} — грузится на странице «Реклама»
let IS_DEMO=false;          // true только в автономной демо-версии (выставляется сборщиком)
const DEMO_LIMIT=1000;      // лимит записей в демо-версии
let current='dashboard';
let SCOPE = localStorage.getItem('citi_srm_scope') || 'all'; // 'all' или id объекта
const TODAY = new Date();

const canView = m => ME && ME.permissions.view.includes(m);
const canEdit = m => ME && ME.permissions.edit.includes(m);
// логин: вводят только имя → подставляем домен; полный email оставляем как есть
const LOGIN_DOMAIN='@citisrm.ru';
const mkLogin = v => { v=(v||'').trim(); return !v? '' : (v.includes('@')? v.toLowerCase() : v.toLowerCase()+LOGIN_DOMAIN); };

/* ---------- helpers ---------- */
const fmt=n=>new Intl.NumberFormat('ru-RU').format(Math.round(n));
const money=n=>fmt(n)+' ₽';
// экранируем и одинарную кавычку/обратный апостроф — id и значения часто попадают в onclick="fn('${...}')"
const esc=s=>(s==null?'':String(s)).replace(/[&<>"'`]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
// безопасная внешняя ссылка: только http(s)/mailto, иначе пусто (защита от javascript:/data:text/html)
const safeUrl=u=>{ const s=String(u||'').trim(); return (/^(https?:\/\/|mailto:)/i.test(s) || /^\/api\/files\//.test(s))?s:''; };
// ячейка CSV: экранирование + защита от формульных инъекций в Excel (ведущие = + - @)
const csvCell=v=>{ let s=String(v==null?'':v); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
const tenantOf=id=>DB.tenants.find(t=>t.id===id);
const unitOf=id=>DB.units.find(u=>u.id===id);
// Отображаемый номер помещения (уникален в рамках объекта). id — внутренний глобальный ключ, НЕ показывать.
const unitNum=id=>{const u=unitOf(id);return u?(u.num||u.id):id;};
// Генерация глобально-уникального id для нового помещения: если номер свободен глобально — id=номер (как раньше);
// при коллизии (такой номер уже есть в другом объекте) — уникальный id без спецсимволов.
function genUnitId(num,building){
  const clean=s=>String(s).replace(/[<>"'`&]/g,'');
  const n=clean(num); if(!unitOf(n)) return n;
  const base=clean(n+'_'+String(building||'').replace(/[^0-9A-Za-zА-Яа-я_-]/g,'').slice(0,8))||('u'+Date.now().toString(36));
  let id=base,k=2; while(unitOf(id)){ id=base+'_'+k; k++; }
  return id;
}
const contractOf=id=>DB.contracts.find(c=>c.id===id);
const userOf=id=>USERS.find(u=>u.id===id);
const unitStatus=u=>{ if(!u.tenant) return u.status||'free';
  const c=DB.contracts.find(c=>c.unit===u.id&&c.status!=='ended');
  const p=DB.payments.find(p=>c&&p.contract===c.id&&p.status==='overdue');
  return p?'debt':'occupied'; };
// кто занимает помещение: арендатор / собственник (для проданных помещений) / свободно
function unitOccupant(u){ if(!u) return ''; if(u.tenant){ const t=tenantOf(u.tenant); return t?t.name:'арендатор'; } if(u.ownership==='sold'){ return '🏷 '+((u.owner&&u.owner.name)||'собственник'); } return 'свободно'; }
// тариф по объекту (если задан) иначе общий из настроек; расчётный коэффициент электро по объекту (иначе 1)
function buildingTariff(bid,kind){ const b=buildingOf(bid); const t=b&&b.tariffs&&+b.tariffs[kind]; return t>0?t:(+((stg().tariffs||{})[kind])||0); }
function buildingElecCoef(bid){ const b=buildingOf(bid); const c=b&&+b.elecCoef; return c>0?c:1; }
// ставка: 'sqm' — ₽/м²/мес (× площадь), 'flat' — фиксированная сумма за помещение/мес
function monthlyRent(c){ if(!c) return 0; if(c.rateType==='flat') return +c.rate||0; const u=unitOf(c.unit); return u? c.rate*u.area : 0; }
function rateTypeSelect(id,sel){ return `<select id="${id}" onchange="syncRateLbl('${id}')"><option value="sqm"${sel==='flat'?'':' selected'}>за м² в месяц</option><option value="flat"${sel==='flat'?' selected':''}>фикс. за помещение/мес</option></select>`; }
function rateLblText(sel){ return sel==='flat'?'Ставка ₽/мес (за помещение)':'Ставка ₽/м²/мес'; }
function syncRateLbl(selId){ const s=document.getElementById(selId); const lbl=document.getElementById(selId+'-lbl'); if(s&&lbl) lbl.textContent=rateLblText(s.value); }
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
  try{ const c = await api('/api/config'); ALLOW_REG = !!c.allowRegistration; ASSIST_KEY = !!c.assistantKey; ASSIST_PROVIDER = c.assistantProvider||'gigachat'; ADS_AVITO = !!c.avitoConfigured; ADS_CIAN = !!c.cianConfigured; }catch{ ALLOW_REG=false; }
  try{
    const {user} = await api('/api/auth/me');
    ME=user; await loadData(); showApp();
  }catch{ showAuth('login'); }
})();

function ensureState(){
  if(!DB) return;
  // Миграция: у помещений без num проставляем num=id (отображение не меняется, id — прежний ключ связей)
  if(Array.isArray(DB.units)) DB.units.forEach(u=>{ if(u.num===undefined||u.num===null||u.num==='') u.num=u.id; });
  if(!Array.isArray(DB.salaries)) DB.salaries=[];
  if(!Array.isArray(DB.requests)) DB.requests=[];
  if(!Array.isArray(DB.equipment)) DB.equipment=[];
  if(!DB.budgets || typeof DB.budgets!=='object' || Array.isArray(DB.budgets)) DB.budgets={};
  if(typeof DB.penaltyRate!=='number') DB.penaltyRate=0.1;
  if(!Array.isArray(DB.listings)) DB.listings=[];
  if(!Array.isArray(DB.signage)) DB.signage=[];
  DB.listings.forEach(a=>{ if(!Array.isArray(a.documents)) a.documents=[]; if(!a.source) a.source = a.lastSync?'demo':'manual'; });
  DB.signage.forEach(s=>{ if(!Array.isArray(s.documents)) s.documents=[]; });
  if(!Array.isArray(DB.buildingMeters)) DB.buildingMeters=[];
  if(!Array.isArray(DB.heatCost)) DB.heatCost=[]; // себестоимость отопления по объекту/периоду (топливо+кочегар+котёл)
  if(!Array.isArray(DB.fuelLog)) DB.fuelLog=[]; // учёт ГСМ: приход + остаток → израсходовано (литры) по объекту/периоду
  if(!Array.isArray(DB.audit)) DB.audit=[];
  if(!DB.integrations) DB.integrations={};
  const I=DB.integrations;
  if(!I.bank) I.bank={connected:false,name:'',lastSync:null};
  if(!I.energy) I.energy={connected:false,lastSync:null};
  if(!I.water) I.water={connected:false,lastSync:null};
  if(!I.onec) I.onec={connected:false,base:'',lastSync:null};
  if(!Array.isArray(I.log)) I.log=[];
  // что именно синхронизировать (по типам документов + фильтры по объекту и периоду)
  if(!I.bank.scope || typeof I.bank.scope!=='object') I.bank.scope={rent:true,expenses:false};
  if(!I.onec.scope || typeof I.onec.scope!=='object') I.onec.scope={rent:true,expenses:true,salaries:true};
  [I.bank.scope,I.onec.scope].forEach(sc=>{ if(typeof sc.building!=='string')sc.building='all'; if(typeof sc.periodFrom!=='string')sc.periodFrom=''; if(typeof sc.periodTo!=='string')sc.periodTo=''; });
  // Настройки клиента (брендинг, модули, справочники) — у каждого своя база.
  if(!DB.settings || typeof DB.settings!=='object') DB.settings={};
  const S=DB.settings;
  if(typeof S.company!=='string') S.company='СИТИ SRM';
  if(typeof S.subtitle!=='string') S.subtitle='Коммерческая недвижимость';
  if(typeof S.accent!=='string') S.accent='';
  if(typeof S.logo!=='string') S.logo='';
  if(!S.modules || typeof S.modules!=='object') S.modules={};
  if(!Array.isArray(S.expenseCats)) S.expenseCats=['Клининг','Охрана','Электроэнергия','Водоснабжение','Отопление','Текущий ремонт','Вывоз мусора','Обслуживание лифтов'];
  if(!Array.isArray(S.unitTypes)) S.unitTypes=['Офис','Ритейл','Кафе','Коворкинг','Склад'];
  if(!Array.isArray(S.payMethodsExtra)) S.payMethodsExtra=[];
  if(!S.notify || typeof S.notify!=='object') S.notify={};
  if(!S.notify.telegram || typeof S.notify.telegram!=='object') S.notify.telegram={enabled:false,token:'',chatId:'',time:'08:00'};
  // автоматизации (по умолчанию ВЫКЛ — ничего не делают «сюрпризом»)
  if(!S.autoRent || typeof S.autoRent!=='object') S.autoRent={enabled:false,accrualDay:1,dueDay:5};
  if(!S.autoRemind || typeof S.autoRemind!=='object') S.autoRemind={enabled:false,everyDays:7};
  if(!S.autoIndex || typeof S.autoIndex!=='object') S.autoIndex={enabled:false};
  if(!S.autoOwnerUtil || typeof S.autoOwnerUtil!=='object') S.autoOwnerUtil={enabled:false,day:1};
  if(!S.assistant || typeof S.assistant!=='object') S.assistant={enabled:false,provider:'gigachat',actions:true};
  if(typeof S.assistant.actions!=='boolean') S.assistant.actions=true;
  if(typeof S.assistant.dailyLimit!=='number' || S.assistant.dailyLimit<1) S.assistant.dailyLimit=250;
  // тарифы для расчёта коммуналки по показаниям счётчиков
  if(!S.tariffs || typeof S.tariffs!=='object') S.tariffs={electricity:6.5,water:45,heating:35};
  // одноразовая миграция: раньше отопление было в ₽/Гкал (крупные значения), теперь ₽/м²
  if(!S._heatMigrated){ if(+S.tariffs.heating>200) S.tariffs.heating=35; S._heatMigrated=true; }
}
/* ---- брендинг и модули из настроек клиента ---- */
const isAdmin = ()=> ME && (ME.role==='admin'||ME.role==='owner');
const stg = ()=> (DB&&DB.settings)||{};
const modOn = k => { const m=stg().modules||{}; return m[k]!==false; };
function brandLogoHtml(){ const s=stg(); return s.logo?`<img src="${s.logo}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:8px">`:LOGO_SVG; }
function applyAccent(){ const a=stg().accent; const r=document.documentElement;
  if(a && /^#[0-9a-fA-F]{6}$/.test(a)){ r.style.setProperty('--accent',a); r.style.setProperty('--accent2',a); }
  else { r.style.removeProperty('--accent'); r.style.removeProperty('--accent2'); } }
async function loadData(){
  const b = await api('/api/bootstrap');
  ME=b.user; ROLES=b.roles; DB=b.state; TASKS=b.tasks; USERS=b.users;
  ensureState(); applyRoleOverrides(); resetAuditBaseline();
}
// применяем настроенную клиентом матрицу прав поверх ролей по умолчанию (admin/owner всегда полные)
function applyRoleOverrides(){
  const ov=DB&&DB.roleMatrix; if(!ov||typeof ov!=='object')return;
  Object.entries(ov).forEach(([role,perm])=>{ if(role==='admin'||role==='owner'||!ROLES[role]||!perm)return;
    if(Array.isArray(perm.view)) ROLES[role].view=perm.view.slice();
    if(Array.isArray(perm.edit)) ROLES[role].edit=perm.edit.slice(); });
  if(ME && ROLES[ME.role] && ME.role!=='admin' && ME.role!=='owner')
    ME.permissions={view:ROLES[ME.role].view.slice(),edit:ROLES[ME.role].edit.slice()};
}

/* ============================================================
   AUTH UI
   ============================================================ */
function showAuth(mode='login'){
  ME=null;
  if(mode==='register' && !ALLOW_REG) mode='login';
  const roleOpts = Object.entries({
    leasing:'Отдел аренды', accountant:'Бухгалтер / Финансист', maintenance:'Эксплуатация'
  }).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

  const login = `
    <h2>Вход в систему</h2><div class="lead">СИТИ SRM — управление коммерческой недвижимостью</div>
    <div class="err" id="authErr"></div>
    <div class="field"><label>Логин</label><input id="a-email" placeholder="admin (или admin@citisrm.ru)" autocomplete="username"></div>
    <div class="field"><label>Пароль</label><input id="a-pw" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    <button class="btn" onclick="doLogin()">Войти</button>
    ${ALLOW_REG?`<div class="swap">Нет аккаунта? <a onclick="showAuth('register')">Зарегистрироваться</a></div>
    <div class="demo-accounts"><div class="sec-h">Демо-доступ (клик для входа)</div>
      <span class="demo-chip" onclick="quickLogin('admin@citisrm.ru','admin123')">👑 Администратор</span>
      <span class="demo-chip" onclick="quickLogin('owner@citisrm.ru','owner123')">👁 Собственник</span>
      <span class="demo-chip" onclick="quickLogin('lease@citisrm.ru','lease123')">🏷 Отдел аренды</span>
      <span class="demo-chip" onclick="quickLogin('buh@citisrm.ru','buh123')">💰 Бухгалтер</span>
      <span class="demo-chip" onclick="quickLogin('exp@citisrm.ru','exp123')">🔧 Эксплуатация</span>
    </div>`:''}`;

  const register = `
    <h2>Регистрация</h2><div class="lead">Создайте учётную запись и выберите роль (права доступа)</div>
    <div class="err" id="authErr"></div>
    <div class="field"><label>ФИО</label><input id="r-name" placeholder="Иванов Иван"></div>
    <div class="row2"><div class="field"><label>Должность</label><input id="r-pos" placeholder="Менеджер"></div>
      <div class="field"><label>Телефон</label><input id="r-phone" placeholder="+7 ..."></div></div>
    <div class="field"><label>Логин</label><div style="display:flex"><input id="r-email" placeholder="ivanov" style="border-top-right-radius:0;border-bottom-right-radius:0"><span style="padding:9px 11px;border:1px solid var(--line2);border-left:none;border-radius:0 10px 10px 0;background:var(--bg2);color:var(--muted);white-space:nowrap;display:flex;align-items:center">@citisrm.ru</span></div></div>
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
  try{ const {user}=await api('/api/auth/login','POST',{email:mkLogin(val('a-email')),password:val('a-pw')});
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
      email:mkLogin(val('r-email')),password:pw,role:val('r-role')});
    ME=user; await loadData(); showApp(); }
  catch(e){ authErr(e.message); }
}
async function logout(){ try{await api('/api/auth/logout','POST');}catch{} stopPolling(); showAuth('login'); }

/* ============================================================
   APP SHELL
   ============================================================ */
const NAV=[
  {group:'Обзор',items:[['today','☀️','Сегодня'],['dashboard','▦','Дашборд'],['alerts','🔔','Центр сроков'],['help','❓','Помощь']]},
  {group:'Управление',items:[['objects','🏢','Объекты и занятость'],['tenants','👥','Арендаторы'],['contracts','📄','Договоры']]},
  {group:'Финансы',items:[['payments','💳','Платежи аренды'],['utilities','⚡','Коммуналка и расходы'],['salaries','💼','Зарплата (ФОТ)'],['budget','📈','Бюджет и долги']]},
  {group:'Операции',items:[['tasks','✓','Задачи'],['requests','🛠','Заявки'],['upkeep','🧰','Плановое ТО'],['ads','📣','Реклама'],['employees','🧑‍💼','Сотрудники'],['reports','📊','Отчёты']]},
  {group:'Интеграции',items:[['integrations','🔗','Синхронизация']]},
  {group:'Администрирование',items:[['audit','🛡','Журнал действий'],['settings','⚙','Настройки']]},
];
// модули, которые можно включать/выключать в настройках (без dashboard и settings)
const TOGGLEABLE=[['objects','Объекты и занятость'],['tenants','Арендаторы'],['contracts','Договоры'],['payments','Платежи аренды'],['utilities','Коммуналка и расходы'],['salaries','Зарплата (ФОТ)'],['budget','Бюджет и долги'],['tasks','Задачи'],['requests','Заявки на обслуживание'],['upkeep','Плановое ТО'],['ads','Реклама и вывески'],['employees','Сотрудники'],['reports','Отчёты'],['integrations','Синхронизация']];
const navVisible = k => (k==='settings'||k==='audit') ? isAdmin() : (k==='today'||k==='alerts'||k==='help') ? true : (canView(k) && modOn(k));
const PAGE_TITLES={dashboard:'Дашборд',objects:'Объекты',tenants:'Арендаторы',contracts:'Договоры',payments:'Платежи',utilities:'Коммуналка',tasks:'Задачи',employees:'Сотрудники',reports:'Отчёты'};

function showApp(){
  if(!navVisible(current)) current = NAV.flatMap(g=>g.items).map(i=>i[0]).find(navVisible) || 'dashboard';
  if(SCOPE!=='all' && !buildingOf(SCOPE)) SCOPE='all';
  applyAccent();
  const initials=(ME.full_name||'?').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('root').innerHTML=`
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="logo">${brandLogoHtml()}</div><div><b>${esc(stg().company)}${IS_DEMO?' <span class="pill amber" style="padding:1px 6px;font-size:9px;vertical-align:middle">ДЕМО</span>':''}</b><small>${esc(stg().subtitle)}</small></div></div>
      <div id="scopeWrap" style="padding:0 4px 8px"></div>
      ${NAV.map(g=>{
        const items=g.items.filter(i=>navVisible(i[0])); if(!items.length) return '';
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
    <div class="mtopbar"><span class="burger" onclick="toggleNav()">☰</span><div class="logo">${brandLogoHtml()}</div><b>${esc(stg().company)}</b></div>
    <main class="main" id="main"></main>
    ${quickAddItems().length?`<div class="fab-add" title="Быстро добавить" onclick="quickAddMenu()">+</div>`:''}
    ${assistOn()?`<div class="fab-assist" title="AI-помощник" onclick="toggleAssist()">💬</div>${assistPanelHTML()}`:''}
  </div>`;
  document.querySelectorAll('.nav-item[data-page]').forEach(n=>n.onclick=()=>{ current=n.dataset.page; markActive(); render(); closeNav(); });
  updateThemeBtns(); renderScopeSelector(); markActive(); render(); startPolling(); maybeWizard();
}
/* ---------- AI-помощник (Фаза 1: подсказки/чтение) ---------- */
const assistOn = ()=> ASSIST_KEY && stg().assistant && stg().assistant.enabled;
let ASSIST_HIST=[]; // [{role,content}]
const ASSIST_SUGGEST=['Как внести оплату?','Откуда берётся NOI?','Кто не заплатил за этот месяц?','Как продлить договор?','Как внести показания счётчиков?'];
function assistPanelHTML(){ return `<div class="assist-panel" id="assistPanel">
  <div class="assist-h">💬 AI-помощник <span class="t-sub" style="font-weight:400">· подсказки</span><span style="margin-left:auto;display:flex;gap:10px;align-items:center"><span style="cursor:pointer" title="Как пользоваться" onclick="assistHelp()">ℹ️</span><span class="x" style="margin:0" onclick="toggleAssist()">×</span></span></div>
  <div class="assist-msgs" id="assistMsgs"></div>
  <div class="assist-sug" id="assistSug">${ASSIST_SUGGEST.map(s=>`<span onclick="assistAsk('${s.replace(/'/g,"\\'")}')">${esc(s)}</span>`).join('')}</div>
  <div class="assist-in"><input id="assistInput" placeholder="Спросите о работе с системой…" onkeydown="if(event.key==='Enter')assistSend()"><button onclick="assistSend()">➤</button></div>
</div>`; }
function assistHelp(){
  openM(`<div class="modal-h"><h3>💬 Как пользоваться AI-помощником</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b" style="line-height:1.6">
    <div class="t-sub" style="margin-bottom:10px">Помощник понимает обычный язык. Просто напишите, что хотите узнать или сделать.</div>
    <div class="sec-h" style="margin-top:0">1. Вопросы по работе</div>
    <div>Спросите «как сделать» — он подскажет по шагам и назовёт нужный раздел.</div>
    <div class="t-sub" style="margin:6px 0 0">Примеры: «Как внести оплату?» · «Как добавить помещение?» · «Что такое Центр сроков?» · «Откуда берётся NOI?»</div>
    <div class="sec-h">2. Вопросы по данным</div>
    <div>Спросите про текущее состояние — ответит по вашим объектам.</div>
    <div class="t-sub" style="margin:6px 0 0">Примеры: «Кто не заплатил за июнь?» · «Какие договоры скоро истекают?» · «Что по плановому ТО на неделю?»</div>
    <div class="sec-h">3. Действия (с подтверждением)</div>
    <div>Попросите что-то сделать — помощник покажет карточку с кнопкой <b>«✓ Подтвердить»</b>. Пока не нажмёте — ничего не изменится.</div>
    <div class="t-sub" style="margin:6px 0 0">Примеры: «Отметь оплату по ТехноСофт за июнь» · «Создай задачу проверить лифт до 5 июля» · «Продли договор по 1-01 до 31.12.2027» · «Отметь ТО по лифту выполненным».</div>
    <div class="sec-h">Важно знать</div>
    <ul style="margin:6px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:5px">
      <li>Помощник видит данные <b>только по вашим правам</b> — чужого и секретов (пароли, зарплаты, если нет доступа) не покажет.</li>
      <li>Действия выполняются <b>в рамках ваших прав</b> и записываются в Журнал действий.</li>
      <li>Если данных нет или вопрос непонятен — честно скажет и предложит, где посмотреть. Может ошибаться — проверяйте важное.</li>
      <li>Переключатель «Все объекты / конкретный объект» вверху слева влияет и на ответы помощника.</li>
      <li>Есть дневной лимит вопросов (по умолчанию 250) — чтобы расходы были предсказуемы.</li>
    </ul>
    <div class="t-sub" style="margin-top:12px">Включается/настраивается администратором: Настройки → «AI-помощник».</div>
  </div>
  <div class="modal-f"><button class="btn" onclick="closeM()">Понятно</button></div>`);
}
function toggleAssist(){ const p=document.getElementById('assistPanel'); if(!p)return; const open=p.classList.toggle('show');
  if(open){ renderAssist(); setTimeout(()=>document.getElementById('assistInput')?.focus(),50); } }
function assistMsgHTML(m,i){
  if(m.role==='action'){ const a=m.action;
    return `<div class="assist-msg bot" style="border-left:3px solid var(--accent)">
      <div class="t-strong" style="margin-bottom:6px">⚡ Подтвердите действие</div>
      <div style="margin-bottom:8px">${esc(a.label||'действие')}</div>
      ${m.done?`<div class="t-sub" style="color:${m.ok?'var(--green)':'var(--red)'}">${esc(m.result||'')}</div>`
        :`<div style="display:flex;gap:8px"><button class="btn sm" onclick="assistConfirm(${i})">✓ Подтвердить</button><button class="btn ghost sm" onclick="assistDecline(${i})">Отмена</button></div>`}
    </div>`; }
  return `<div class="assist-msg ${m.role==='user'?'user':'bot'}">${esc(m.content)}</div>`;
}
function renderAssist(){ const box=document.getElementById('assistMsgs'); if(!box)return;
  box.innerHTML = ASSIST_HIST.length? ASSIST_HIST.map((m,i)=>assistMsgHTML(m,i)).join('')
    : `<div class="assist-msg bot">Здравствуйте! Я помогу разобраться в СИТИ SRM и могу выполнять простые действия (с вашим подтверждением): отметить оплату, создать задачу/заявку, продлить договор и т.п. Спрашивайте простыми словами.</div>`;
  const sug=document.getElementById('assistSug'); if(sug) sug.style.display=ASSIST_HIST.length?'none':'flex';
  box.scrollTop=box.scrollHeight; }
function assistAsk(q){ const inp=document.getElementById('assistInput'); if(inp){ inp.value=q; } assistSend(); }
async function assistSend(){
  const inp=document.getElementById('assistInput'); if(!inp)return; const q=inp.value.trim(); if(!q)return; inp.value='';
  ASSIST_HIST.push({role:'user',content:q}); ASSIST_HIST.push({role:'assistant',content:'…думаю'}); renderAssist();
  try{
    const hist=ASSIST_HIST.filter(m=>m.role==='user'||m.role==='assistant').slice(0,-2).slice(-6);
    const r=await api('/api/assistant','POST',{question:q,scope:SCOPE,history:hist});
    ASSIST_HIST.pop(); // убрать «думаю»
    if(r&&r.enabled===false){ ASSIST_HIST.push({role:'assistant',content:'Помощник сейчас выключен.'}); }
    else { ASSIST_HIST.push({role:'assistant',content:(r&&(r.answer||r.error))||'Пустой ответ.'});
      if(r&&r.action) ASSIST_HIST.push({role:'action',action:r.action,done:false}); }
  }catch(e){ ASSIST_HIST.pop(); ASSIST_HIST.push({role:'assistant',content:'Помощник недоступен: '+(e.message||e)}); }
  renderAssist();
}
function assistDecline(i){ const m=ASSIST_HIST[i]; if(!m||m.role!=='action')return; m.done=true; m.ok=false; m.result='Отменено.'; renderAssist(); }
// выполнение подтверждённого действия — через обычные функции (права + аудит соблюдаются)
async function assistConfirm(i){ const m=ASSIST_HIST[i]; if(!m||m.role!=='action'||m.done)return; const a=m.action; const p=a.params||{};
  try{
    if(a.type==='pay'){ const pay=DB.payments.find(x=>x.id===p.paymentId); if(!pay) throw 'платёж не найден'; await quickPay(p.paymentId); }
    else if(a.type==='task_create'){ await api('/api/tasks','POST',{title:p.title,unit:p.unit||'—',due:p.due||null,priority:'medium'}); await reloadTasks(); render(); }
    else if(a.type==='task_done'){ const t=TASKS.find(x=>(x.title||'').toLowerCase().includes((p.title||'').toLowerCase())); if(!t) throw 'задача не найдена'; await api('/api/tasks/'+t.id,'PATCH',{status:'done'}); await reloadTasks(); render(); }
    else if(a.type==='request_create'){ ensureState(); DB.requests.unshift({id:'r'+Date.now(),building:p.building,unit:null,tenant:null,category:p.category,title:p.title,priority:p.priority,status:'new',assignee_id:null,created_by:ME.id,created_at:new Date().toISOString(),due:null,note:''}); await afterStateChange(); }
    else if(a.type==='request_take'){ const r=(DB.requests||[]).find(x=>(x.title||'').toLowerCase().includes((p.title||'').toLowerCase())&&reqOpen(x)); if(!r) throw 'заявка не найдена'; await advanceRequest(r.id); }
    else if(a.type==='contract_renew'){ const c=contractOf(p.contractId); if(!c) throw 'договор не найден'; c.end=p.end; c.status='active'; await afterStateChange(); }
    else if(a.type==='contract_rate'){ const c=contractOf(p.contractId); if(!c) throw 'договор не найден'; const old=c.rate; c.rate=p.rate; c.rateType=p.rateType||c.rateType||'sqm'; if(old!==c.rate){ c.rateHistory=Array.isArray(c.rateHistory)?c.rateHistory:[]; c.rateHistory.push({date:TODAY.toISOString().slice(0,10),oldRate:old,newRate:c.rate,by:'AI-помощник'}); } await afterStateChange(); }
    else if(a.type==='upkeep_done'){ const e=(DB.equipment||[]).find(x=>x.id===p.equipmentId); if(!e) throw 'оборудование не найдено'; const today=TODAY.toISOString().slice(0,10); e.lastService=today; e.nextService=addMonths(today,e.intervalMonths||12); await afterStateChange(); }
    else if(a.type==='assign_tenant'){ const u=unitOf(p.unit); if(!u||u.tenant) throw 'помещение занято или не найдено'; let tid=p.tenantId; if(!tid){ tid='t'+Date.now(); DB.tenants.push({id:tid,name:p.tenantName,contact:'',phone:'',email:'',inn:'',industry:''}); } const monthly=p.rateType==='flat'?p.rate:p.rate*(u.area||0); DB.contracts.push({id:'c'+Date.now(),tenant:tid,unit:p.unit,rate:p.rate,rateType:p.rateType,start:TODAY.toISOString().slice(0,10),end:addMonths(TODAY.toISOString().slice(0,10),12),deposit:Math.round(monthly),indexation:6,status:'active'}); u.tenant=tid; await afterStateChange(); }
    else throw 'неизвестное действие';
    m.done=true; m.ok=true; m.result='✓ Выполнено.';
  }catch(e){ m.done=true; m.ok=false; m.result='Не удалось: '+(e.message||e); }
  renderAssist();
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

const PAGES={today:todayPage,dashboard,alerts,help,objects,tenants,contracts,payments,utilities,salaries,tasks,requests,upkeep,ads,budget,employees,reports,integrations,audit:auditPage,settings:settingsPage};
function render(){ updateBadges(); const m=document.getElementById('main'); if(!m)return; m.innerHTML=''; (PAGES[current]||dashboard)(); }
function el(html){ const d=document.createElement('div'); d.className='page'; d.innerHTML=html; document.getElementById('main').appendChild(d); return d; }
function head(title,sub,actions=''){ return `<div class="topbar"><div style="display:flex;align-items:center;gap:8px"><h1>${title}</h1>${PAGE_HELP[current]?`<button class="bell" style="width:30px;height:30px;font-size:15px" title="Для чего этот раздел" onclick="pageHelp()">ℹ️</button>`:''}</div><div class="sub" style="width:100%">${sub}</div><div class="spacer"></div>${actions}${searchHTML()}${bellHTML()}</div>`; }
/* ---------- глобальный поиск (B3) ---------- */
function searchHTML(){ return `<div class="gsearch"><input class="search" id="gsearch" placeholder="🔍 Поиск…" style="width:180px;max-width:42vw" oninput="runSearch(this.value)" onfocus="runSearch(this.value)"><div class="gsearch-res" id="gsearchRes"></div></div>`; }
function runSearch(q){
  const box=document.getElementById('gsearchRes'); if(!box) return;
  q=(q||'').trim().toLowerCase();
  if(q.length<2){ box.classList.remove('show'); box.innerHTML=''; return; }
  const res=[]; const add=(icon,title,sub,fn,id)=>res.push({icon,title,sub,fn,id});
  // арендаторы
  if(canView('tenants')) sTenants().filter(t=>(t.name||'').toLowerCase().includes(q)||(t.inn||'').includes(q)||(t.contact||'').toLowerCase().includes(q))
    .slice(0,6).forEach(t=>add('👥',t.name,`Арендатор · ИНН ${esc(t.inn||'—')}`,'tenantInfo',t.id));
  // помещения
  if(canView('objects')) sUnits().filter(u=>((u.num||u.id||'')+' '+(u.id||'')).toLowerCase().includes(q)||(u.type||'').toLowerCase().includes(q))
    .slice(0,6).forEach(u=>add('🏢',`Помещение ${u.num||u.id}`,`${esc(u.type||'')} · ${u.area} м²`,'unitInfo',u.id));
  // договоры
  if(canView('contracts')) sContracts().filter(c=>{const t=tenantOf(c.tenant);return (c.id||'').toLowerCase().includes(q)||(unitNum(c.unit)||'').toLowerCase().includes(q)||(t&&(t.name||'').toLowerCase().includes(q));})
    .slice(0,6).forEach(c=>{const t=tenantOf(c.tenant);add('📄',`Договор ${(c.id||'').toUpperCase()}`,`${esc(t?t.name:'')} · ${esc(unitNum(c.unit))}`,'contractInfo',c.id);});
  // платежи
  if(canView('payments')) sPayments().filter(p=>{const c=contractOf(p.contract);const t=c&&tenantOf(c.tenant);return (p.period||'').includes(q)||(t&&(t.name||'').toLowerCase().includes(q));})
    .slice(0,6).forEach(p=>{const c=contractOf(p.contract);const t=c&&tenantOf(c.tenant);add('💳',`Платёж ${p.period}`,`${esc(t?t.name:'')} · ${money(p.amount)} · ${p.status}`,'payModal',p.id);});
  box.innerHTML = res.length
    ? res.slice(0,20).map(r=>`<div class="gi" onclick="searchGo('${r.fn}','${esc(r.id)}')"><span style="font-size:17px">${r.icon}</span><div style="flex:1;min-width:0"><div class="t-strong">${esc(r.title)}</div><div class="t-sub">${r.sub}</div></div></div>`).join('')
    : `<div class="gi"><div class="t-sub">Ничего не найдено по «${esc(q)}»</div></div>`;
  box.classList.add('show');
}
// без eval: диспетчеризация по белому списку функций
const SEARCH_FNS={ tenantInfo, unitInfo, contractInfo, payModal };
function searchGo(fn,id){ const box=document.getElementById('gsearchRes'); if(box){box.classList.remove('show');} const gs=document.getElementById('gsearch'); if(gs)gs.value='';
  const f=SEARCH_FNS[fn]; if(typeof f==='function'){ try{ f(id); }catch(e){} } }
document.addEventListener('click',e=>{ const g=document.getElementById('gsearchRes'); if(g&&!e.target.closest('.gsearch')) g.classList.remove('show'); });
/* ---------- быстрое добавление (B4 FAB) ---------- */
function quickAddItems(){
  const it=[];
  if(canEdit('payments') && DB && DB.contracts && DB.contracts.length) it.push(['💳','Платёж','paymentModal()']);
  if(canEdit('tasks')) it.push(['✓','Задача','taskModal()']);
  if(canEdit('requests')) it.push(['🛠','Заявка','requestModal()']);
  if(canEdit('tenants')) it.push(['👥','Арендатор','tenantModal()']);
  if(canEdit('objects')) it.push(['🏢','Помещение','unitModal()']);
  if(canEdit('contracts') && DB && DB.tenants && DB.tenants.length) it.push(['📄','Договор','contractModal()']);
  return it;
}
function quickAddMenu(){
  const items=quickAddItems(); if(!items.length) return;
  openM(`<div class="modal-h"><h3>＋ Быстро добавить</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="grid" style="grid-template-columns:repeat(2,1fr);gap:10px">
    ${items.map(([ic,label,call])=>`<button class="btn ghost" style="justify-content:flex-start;padding:14px;font-size:15px" onclick="closeM();${call}"><span style="font-size:18px;margin-right:8px">${ic}</span>${label}</button>`).join('')}
  </div></div>`);
}
const PAGE_HELP={
  today:{t:'Сегодня',d:'Простой экран действий на день: что нужно сделать прямо сейчас — просроченные оплаты, истекающие договоры, просроченное ТО, новые заявки и задачи на сегодня. У каждой строки кнопка действия в один клик (оплачено, продлить, выполнено, в работу, завершить). Это упрощённый вид того же, что показывают Центр сроков и колокольчик 🔔.'},
  dashboard:{t:'Дашборд',d:'Главный экран с ключевыми показателями бизнеса. Настраивается под вас: «⚙ Настроить» — добавить/убрать любые из 17 блоков; перетаскивайте блоки мышью, чтобы расставить по-своему. Настройка сохраняется лично для вашего аккаунта.'},
  alerts:{t:'Центр сроков',d:'Собирает в одном месте всё, что требует внимания: просроченные платежи, истекающие договоры, плановое ТО, срочные заявки и задачи. Клик по событию открывает нужный раздел. Эти же события показывает колокольчик 🔔.'},
  objects:{t:'Объекты и занятость',d:'Портфель ваших зданий и помещений. Здесь добавляют объекты и помещения, заносят арендаторов, видят заполняемость и статусы (занято / резерв / свободно / долг). Переключатель «Все объекты» вверху фильтрует все разделы системы.'},
  tenants:{t:'Арендаторы',d:'Реестр компаний-арендаторов: контакты, ИНН, реквизиты, связанные договоры, вывески и прикреплённые документы. В карточке можно загрузить файлы (договоры, письма).'},
  contracts:{t:'Договоры аренды',d:'Условия аренды по каждому помещению: ставка, срок, индексация, депозит. Сроки окончания договоров автоматически попадают в Центр сроков, чтобы вовремя продлить.'},
  payments:{t:'Платежи аренды',d:'Начисления и оплаты по договорам, по объектам и периодам. Внесение оплаты (частичной или полной), выбор способа оплаты, история платежей и печать квитанции (PDF).'},
  utilities:{t:'Коммуналка и расходы',d:'Начисления за свет/воду и расходы на содержание по каждому объекту, с фильтром по периоду и графиком структуры расходов. Основа для контроля затрат.'},
  salaries:{t:'Зарплата (ФОТ)',d:'Фонд оплаты труда по сотрудникам: начисление зарплаты, отметка о выплате и способ оплаты. Сумма попадает в бюджет и отчёты.'},
  budget:{t:'Бюджет и долги',d:'Финансовый контроль: годовой план/факт доходов и расходов по объектам с расчётом NOI и % выполнения; старение задолженности по срокам (1–30, 31–60, 61–90, 90+ дней) и автоматический расчёт пеней.'},
  tasks:{t:'Задачи',d:'Канбан-доска внутренних задач по объектам: назначение исполнителю, сроки, приоритеты. Просроченные задачи подсвечиваются и попадают в напоминания.'},
  requests:{t:'Заявки на обслуживание',d:'Обращения по проблемам на объекте (сантехника, электрика, лифт, климат и т.п.). Полный цикл: создание → назначение исполнителю → «В работу» → «Выполнено». Контроль сроков и просрочек.'},
  upkeep:{t:'Плановое ТО',d:'Реестр оборудования (лифты, вентиляция, пожарная сигнализация и др.) с графиком обслуживания. Система показывает, что просрочено или скоро требует ТО; кнопка «✅ ТО выполнено» фиксирует обслуживание и планирует следующее.'},
  ads:{t:'Реклама',d:'Объявления о сдаче на ЦИАН/Авито с синхронизацией статистики (просмотры, заявки) и разрешения на вывески — как арендаторов (видны в их карточках), так и собственника. Со сроками действия и документами.'},
  employees:{t:'Сотрудники и доступы',d:'Кто допущен к системе: добавление сотрудников, их роли и контакты. Внизу — редактируемая матрица прав доступа: нажмите «✎ Изменить права», чтобы задать, что каждой роли можно (нет / просмотр / редактирование).'},
  reports:{t:'Отчёты',d:'Сводная аналитика: валовый доход, операционные расходы, NOI, маржа, динамика по месяцам, заполняемость, расчёты с арендаторами по объектам. Выгрузка в CSV.'},
  integrations:{t:'Синхронизация',d:'Подключение банка, 1С, Мособлэнергосбыта и Водоканала. На каждой карточке: «ℹ️ Как подключить» (пошаговая инструкция), «⚙ Что синхронизировать» (выбор документов, объекта, периода) и журнал обмена.'},
  settings:{t:'Настройки',d:'Оформление под клиента: логотип, название компании, фирменный цвет; включение/выключение разделов меню; справочники (категории расходов, типы помещений, способы оплаты). Всё применяется только к этому клиенту.'},
  audit:{t:'Журнал действий',d:'Аудит безопасности: кто, что и когда создал, изменил или удалил в системе — включая изменение прав доступа. Помогает контролировать работу сотрудников.'},
};
function pageHelp(){ const h=PAGE_HELP[current]; if(!h)return;
  openM(`<div class="modal-h"><h3>ℹ️ ${esc(h.t)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div style="line-height:1.6">${esc(h.d)}</div></div>
  <div class="modal-f"><button class="btn" onclick="closeM()">Понятно</button></div>`);
}
function help(){
  const steps=[
    'Заведите объекты и помещения — раздел «Объекты и занятость» (кнопки «+ Объект», «+ Помещение»).',
    'Добавьте арендаторов и оформите договоры аренды.',
    'Внесите сотрудников и настройте им права — раздел «Сотрудники» (матрица прав).',
    'Оформите систему под себя — «Настройки»: логотип, название, цвет, нужные модули, справочники.',
    'Соберите дашборд под себя — «⚙ Настроить» и перетаскивание блоков мышью.',
    'Работайте: платежи, заявки, плановое ТО, бюджет, отчёты. Следите за «Центром сроков» 🔔.'
  ];
  const tips=[
    'У каждого раздела рядом с заголовком есть «ℹ️» — краткое описание, для чего он.',
    'Колокольчик 🔔 вверху показывает всё срочное (просрочки, истекающие договоры, ТО).',
    'Переключатель «Все объекты» вверху слева фильтрует ВСЕ разделы по выбранному зданию.',
    'Тёмная/светлая тема — переключатель внизу бокового меню.',
    'Документы (PDF, фото) можно прикреплять в карточках помещений, арендаторов, объявлений и разрешений.',
    'Доступ к разделам зависит от вашей роли — права настраивает администратор в «Сотрудниках».'
  ];
  const sections=NAV.map(g=>{ const items=g.items.filter(i=>i[0]!=='help'&&navVisible(i[0])&&PAGE_HELP[i[0]]);
    if(!items.length)return ''; return `<div style="margin-top:14px"><div class="t-sub" style="text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">${esc(g.group)}</div>
    ${items.map(([k,ic,label])=>`<div class="doc" style="border:1px solid var(--line2);border-radius:11px;padding:11px 13px;margin-bottom:8px;cursor:pointer" onclick="gotoPage('${k}')">
      <div class="di" style="font-size:17px">${ic}</div>
      <div style="flex:1;min-width:0"><div class="t-strong">${esc(label)}</div><div class="t-sub">${esc(PAGE_HELP[k].d)}</div></div>
      <span class="t-sub">→</span></div>`).join('')}</div>`; }).join('');
  el(head('Помощь и инструкция','Как пользоваться СИТИ SRM','')+
  `<div class="card" style="margin-bottom:16px"><div style="line-height:1.6"><b>СИТИ SRM</b> — система управления коммерческой недвижимостью: объекты и помещения, арендаторы и договоры, платежи и расходы, задачи, заявки на обслуживание, плановое ТО, бюджет, реклама, отчёты и интеграции. Всё привязано к объектам — переключатель «Все объекты» вверху слева фильтрует данные по выбранному зданию.</div></div>
  <div class="card" style="margin-bottom:16px"><div class="sec-h" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>🚀 Быстрый старт (для нового пользователя)</span>${isAdmin()?`<span><button class="btn sm" onclick="startWizard()">▶ Запустить мастер</button> <button class="btn ghost sm" onclick="importModal('units')">⤓ Импорт из CSV</button></span>`:''}</div>
    <ol style="margin:6px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:8px;line-height:1.5">${steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>
  <div class="card" style="margin-bottom:16px"><div class="sec-h">📚 Разделы системы <span class="t-sub">— нажмите, чтобы перейти</span></div>${sections}</div>
  <div class="card"><div class="sec-h">💡 Полезные подсказки</div>
    <ul style="margin:6px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:7px;line-height:1.5">${tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></div>`);
}

function updateBadges(){
  if(!DB) return;
  const setB=(k,n)=>{const e=document.getElementById('badge-'+k); if(e){e.textContent=n; e.classList.toggle('hidden',!n);} };
  setB('payments', DB.payments.filter(p=>p.amount-p.paid>0).length);
  setB('tasks', TASKS.filter(t=>t.status!=='done').length);
  setB('requests', (DB.requests||[]).filter(r=>r.status==='new'||r.status==='in_progress').length);
  setB('upkeep', (DB.equipment||[]).filter(e=>daysLeft(e.nextService)<0).length);
}

/* ---------- Напоминания (колокольчик) ---------- */
function bellHTML(){
  const al=buildAlerts(); const top=al.slice(0,12); const dang=al.filter(a=>a.level==='danger').length;
  return `<div style="position:relative">
    <div class="bell" onclick="toggleNotif(event)">🔔${al.length?`<span class="cnt"${dang?' style="background:var(--red)"':''}>${al.length}</span>`:''}</div>
    <div class="notif" id="notif">
      <div class="notif-h">Сроки и уведомления${al.length?` · ${al.length}`:''}</div>
      ${top.length? top.map(a=>`<div class="notif-i" onclick="gotoPage('${a.page}')">
          <div class="t-strong" style="margin-bottom:3px"><span style="color:${alertColor(a.level)}">${a.icon}</span> ${esc(a.title)}</div>
          <div class="t-sub">${a.cat} · ${a.sub}</div></div>`).join('')
        : '<div class="empty" style="padding:24px">Срочных событий нет 🎉</div>'}
      ${al.length>12?`<div class="notif-i" onclick="gotoPage('alerts')" style="text-align:center;color:var(--accent2)">Ещё ${al.length-12} → весь центр сроков</div>`:(al.length?`<div class="notif-i" onclick="gotoPage('alerts')" style="text-align:center;color:var(--accent2)">Открыть центр сроков →</div>`:'')}
    </div></div>`;
}
function toggleNotif(e){ e.stopPropagation(); document.getElementById('notif').classList.toggle('show'); }
function gotoTasks(){ document.getElementById('notif')?.classList.remove('show'); current='tasks'; markActive(); render(); }
document.addEventListener('click',e=>{ const n=document.getElementById('notif'); if(n&&!e.target.closest('#notif')&&!e.target.closest('.bell')) n.classList.remove('show'); });

/* ---------- Сохранение общего состояния ---------- */
async function saveState(){
  try{ const r=await api('/api/state','POST', DB); if(r&&r._ver) DB._ver=r._ver; }
  catch(e){
    // конфликт версий: кто-то сохранил параллельно — не перетираем, берём свежее и просим повторить
    if(e.status===409 && e.data && e.data.state){ DB=e.data.state; ensureState(); applyRoleOverrides(); resetAuditBaseline(); render();
      alert('Данные были изменены другим пользователем. Ваше последнее действие не сохранено — проверьте и повторите.'); return; }
    alert('Не удалось сохранить: '+(e.message||e));
  }
}
/* ---------- Журнал действий (аудит): сравнение состояния «до/после» ---------- */
let _auditPrev=null;
function stripAudit(db){ const {audit,...rest}=db||{}; const r={...rest};
  if(r.integrations){ const {log,...intRest}=r.integrations; r.integrations=intRest; } return r; }
function resetAuditBaseline(){ try{ _auditPrev=DB?JSON.parse(JSON.stringify(stripAudit(DB))):null; }catch{ _auditPrev=null; } }
function diffColl(label,prev,curr,nf){ const out=[];
  const pm=new Map((prev||[]).map(x=>[x.id,x])), cm=new Map((curr||[]).map(x=>[x.id,x]));
  cm.forEach((c,id)=>{ if(!pm.has(id)) out.push(`${label}: создан «${nf(c)}»`); else if(JSON.stringify(pm.get(id))!==JSON.stringify(c)) out.push(`${label} изменён: «${nf(c)}»`); });
  pm.forEach((p,id)=>{ if(!cm.has(id)) out.push(`${label}: удалён «${nf(p)}»`); });
  return out; }
function auditDiff(prev,curr){ const out=[];
  const colls=[['buildings','Объект',x=>x.name],['units','Помещение',x=>x.id],['tenants','Арендатор',x=>x.name],
    ['contracts','Договор',x=>x.id],['payments','Платёж',x=>(x.period+' / '+x.contract)],['utilities','Коммуналка',x=>x.period||x.id],
    ['expenses','Расход',x=>x.category||x.id],['salaries','Зарплата',x=>x.period],['requests','Заявка',x=>x.title],
    ['equipment','Оборудование',x=>x.name],['listings','Объявление',x=>x.title],['signage','Разрешение',x=>x.kind||x.permitNo]];
  colls.forEach(([k,label,nf])=>out.push(...diffColl(label,prev[k],curr[k],nf)));
  if(JSON.stringify(prev.budgets)!==JSON.stringify(curr.budgets)) out.push('Бюджеты: изменены');
  if(JSON.stringify(prev.settings)!==JSON.stringify(curr.settings)) out.push('Настройки системы: изменены');
  if(prev.penaltyRate!==curr.penaltyRate) out.push('Ставка пени: изменена');
  if(JSON.stringify(prev.roleMatrix)!==JSON.stringify(curr.roleMatrix)) out.push('Права доступа (роли): изменены');
  return out; }
function recordAudit(){ if(!ME||!DB) return; ensureState();
  const curr=stripAudit(DB);
  if(_auditPrev){ const entries=auditDiff(_auditPrev,curr);
    if(entries.length){ DB.audit.unshift({ts:new Date().toISOString(),user:ME.full_name,role:ME.roleTitle,entries:entries.slice(0,30)}); DB.audit=DB.audit.slice(0,200); } }
  try{ _auditPrev=JSON.parse(JSON.stringify(curr)); }catch{}
}
const DEMO_COLLECTIONS=['buildings','units','tenants','contracts','payments','utilities','expenses','salaries','requests','equipment','listings','signage'];
function countRecords(){ if(!DB) return 0; let n=(TASKS||[]).length; DEMO_COLLECTIONS.forEach(k=>{ if(Array.isArray(DB[k])) n+=DB[k].length; }); return n; }
function buyFullModal(){
  openM(`<div class="modal-h"><h3>⭐ Демо-версия СИТИ SRM</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b" style="text-align:center">
    <div style="font-size:46px;margin:4px 0 6px">🔒</div>
    <div class="t-strong" style="font-size:17px;margin-bottom:8px">Достигнут лимит демо-версии (${DEMO_LIMIT} записей)</div>
    <div class="t-sub" style="line-height:1.6;margin-bottom:14px">Вы оценили возможности системы на примерах. Для полноценной работы без ограничений — приобретите полную версию.</div>
    <div class="card" style="background:var(--bg2);text-align:left">
      <div class="t-strong" style="margin-bottom:6px">В полной версии:</div>
      <div class="t-sub" style="line-height:1.7">• Без лимита записей и пользователей<br>• Многопользовательский режим и права доступа<br>• Telegram-уведомления, интеграции (банк / 1С / коммуналка)<br>• Своё облако или установка на ваш сервер, авто-бэкапы<br>• Поддержка и обновления</div>
    </div>
    <div style="margin-top:14px">Связаться: <b>avgur264@gmail.com</b></div>
  </div>
  <div class="modal-f"><button class="btn" onclick="closeM()">Понятно</button></div>`);
}
async function afterStateChange(){
  if(IS_DEMO && countRecords()>DEMO_LIMIT){           // демо-лимит: запись не сохраняем, показываем предложение
    buyFullModal();
    try{ DB=await api('/api/state'); ensureState(); }catch{}  // откат несохранённой записи к последнему состоянию
    render(); return;
  }
  recordAudit(); await saveState(); render();
}

/* ============================================================
   ОБНОВЛЕНИЕ (многопользовательский режим — лёгкий опрос)
   ============================================================ */
let pollTimer=null;
function startPolling(){ stopPolling(); pollTimer=setInterval(silentRefresh, 30000); }
function stopPolling(){ if(pollTimer)clearInterval(pollTimer); pollTimer=null; }
// принудительно перечитать состояние с сервера и перерисовать (после серверных мутаций — напр. синхронизация рекламы)
async function reloadState(){
  const b=await api('/api/bootstrap'); DB=b.state; TASKS=b.tasks; USERS=b.users; ROLES=b.roles; ensureState(); applyRoleOverrides(); resetAuditBaseline(); updateBadges(); render();
}
async function silentRefresh(){
  if(!ME) return;
  if(document.getElementById('modalBg')?.classList.contains('show')) return; // не мешаем вводу в модалке
  if(document.getElementById('assistPanel')?.classList.contains('show')) return; // не мешаем чату помощника
  // не перерисовываем, если пользователь что-то печатает или тащит виджет — иначе стирается ввод/срывается drag
  const ae=document.activeElement; if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT')) return;
  if(window._dashDragging) return;
  try{
    const b=await api('/api/bootstrap'); DB=b.state; TASKS=b.tasks; USERS=b.users; ROLES=b.roles; ensureState(); applyRoleOverrides(); resetAuditBaseline();
    updateBadges();
    if(['today','dashboard','tasks','employees','payments','salaries','integrations'].includes(current)) render();
    else { const bell=document.querySelector('.topbar .bell'); /* обновим только бейдж колокольчика */ }
  }catch{}
}

/* ============================================================
   ДАШБОРД
   ============================================================ */
/* ---------- настраиваемый дашборд (персональный, перетаскиваемый) ---------- */
let _dashM=null;
const dashStoreKey=()=>'citi_srm_dash2_'+(ME?ME.id:'x');
const DASH_DEFAULT_ORDER=['occ','billed','collected','planMonth','debt','net','chIncome','chOcc','overdue','tasks'];
function dashCard(title,badge,inner){ return `<div class="card"><div class="panel-title"><h3>${title}</h3>${badge!=null?`<span class="muted">${badge}</span>`:''}</div>${inner}</div>`; }
function dashRows(rows,emptyTxt){ return `<table><tbody>${rows.length?rows.join(''):`<tr><td class="empty">${emptyTxt}</td></tr>`}</tbody></table>`; }
/* каталог виджетов: id → {label, span (1=малый,2=широкий), build:()=>html, draw?:()=>void} */
const DASH_CATALOG={
  occ:{label:'KPI · Заполняемость',span:1,build:()=>kpi('Заполняемость','#4f8cff','📐',_dashM.occPct+'%','+3% за месяц','up')},
  billed:{label:'KPI · Начислено',span:1,build:()=>kpi('Начислено (всего)','#a78bfa','🧾',fmt(_dashM.billed/1000)+' тыс','по всем периодам','')},
  collected:{label:'KPI · Собрано',span:1,build:()=>kpi('Собрано (всего)','#37d39b','💰',fmt(_dashM.collected/1000)+' тыс',pct(_dashM.collected,_dashM.billed)+'% собираемость','up')},
  debt:{label:'KPI · Задолженность',span:1,build:()=>kpi('Задолженность','#ff5d6c','⚠️',fmt(_dashM.debt/1000)+' тыс',DB.payments.filter(p=>p.amount-p.paid>0).length+' счёта','down')},
  planMonth:{label:'KPI · План сбора (до конца месяца)',span:1,build:()=>{
    const ym=TODAY.toISOString().slice(0,7);
    const eom=new Date(TODAY.getFullYear(),TODAY.getMonth()+1,0);
    const daysLeftM=Math.max(0,Math.ceil((eom-TODAY)/864e5));
    // план = уже начисленные за период платежи + ещё не начисленные по действующим договорам (без двойного счёта)
    const paysThis=sPayments().filter(p=>(p.period||'')===ym);
    const accrued=paysThis.reduce((s,p)=>s+(+p.amount||0),0);
    const have=new Set(paysThis.map(p=>p.contract));
    const cs=DB.contracts.filter(c=>c.status!=='ended' && (SCOPE==='all'||unitOf(c.unit)?.building===SCOPE));
    const toAccrue=cs.filter(c=>!have.has(c.id)).reduce((s,c)=>s+monthlyRent(c),0);
    const plan=accrued+toAccrue;
    return kpi('План сбора (мес.)','#f5a623','🎯',fmt(plan/1000)+' тыс',`начислено + к начислению · ${daysLeftM} дн. до конца`,'');}},
  net:{label:'KPI · Чистый доход',span:1,build:()=>kpi('Чистый доход','#39d0d8','📈',fmt(_dashM.net/1000)+' тыс','собрано − расходы','')},
  fot:{label:'KPI · Зарплата (ФОТ)',span:1,build:()=>{const s=(DB.salaries||[]).reduce((a,x)=>a+(x.amount||0),0);return kpi('ФОТ (всего)','#f59e42','💼',fmt(s/1000)+' тыс','фонд оплаты труда','');}},
  adsKpi:{label:'KPI · Реклама',span:1,build:()=>{const ls=(DB.listings||[]).filter(a=>SCOPE==='all'||a.building===SCOPE);const act=ls.filter(a=>a.status==='active').length;const v=ls.reduce((s,a)=>s+(a.views||0),0);return kpi('Объявления','#22a7f0','📣',act+' активн.','👁 '+fmt(v)+' просмотров','');}},
  chIncome:{label:'График · Доходы и расходы',span:2,build:()=>`<div class="card"><div class="panel-title"><h3>Доходы и расходы</h3><span class="muted">тыс ₽ · 6 мес</span></div><canvas id="chIncome" height="120"></canvas></div>`,draw:drawIncome},
  chOcc:{label:'График · Структура площадей',span:1,build:()=>`<div class="card"><div class="panel-title"><h3>Структура площадей</h3><span class="muted">м²</span></div><canvas id="chOcc" height="120"></canvas></div>`,draw:drawOcc},
  overdue:{label:'Виджет · Просроченные платежи',span:2,build:()=>{const o=sPayments().filter(p=>p.status==='overdue').map(p=>{const c=contractOf(p.contract);const t=c&&tenantOf(c.tenant);return{name:t?t.name:'—',unit:c?unitNum(c.unit):'—',amount:p.amount-p.paid};});
    return dashCard('⚠️ Просроченные платежи',o.length,dashRows(o.map(x=>`<tr><td><div class="t-strong">${esc(x.name)}</div><div class="t-sub">Помещение ${esc(x.unit)}</div></td><td style="text-align:right"><span class="pill red">${money(x.amount)}</span></td></tr>`),'Нет просрочек'));}},
  tasks:{label:'Виджет · Ближайшие задачи',span:2,build:()=>{const t=TASKS.filter(x=>x.status!=='done').sort((a,b)=>daysLeft(a.due)-daysLeft(b.due)).slice(0,5);
    return dashCard('Ближайшие задачи',t.length,dashRows(t.map(x=>`<tr><td><div class="t-strong">${esc(x.title)}</div><div class="t-sub">${esc(x.assignee_name||'—')} · ${esc(x.unit)}</div></td><td style="text-align:right">${prioPill(x.priority)}<div class="t-sub" style="margin-top:4px">${dueLabel(x.due)}</div></td></tr>`),'Нет задач'));}},
  requests:{label:'Виджет · Заявки на обслуживание',span:2,build:()=>{const r=sRequests().filter(reqOpen).sort((a,b)=>daysLeft(a.due)-daysLeft(b.due)).slice(0,5);
    return dashCard('🛠 Активные заявки',r.length,dashRows(r.map(x=>`<tr><td><div class="t-strong">${esc(x.title)}</div><div class="t-sub">${esc(x.category||'')}</div></td><td style="text-align:right">${prioPill(x.priority)}<div class="t-sub" style="margin-top:4px">${dueLabel(x.due)}</div></td></tr>`),'Нет активных заявок'));}},
  upkeep:{label:'Виджет · Плановое ТО',span:2,build:()=>{const e=sEquip().filter(x=>daysLeft(x.nextService)<=30).sort((a,b)=>daysLeft(a.nextService)-daysLeft(b.nextService)).slice(0,5);
    return dashCard('🧰 ТО: скоро / просрочено',e.length,dashRows(e.map(x=>{const st=upkeepStatus(x);return `<tr><td><div class="t-strong">${esc(x.name)}</div><div class="t-sub">${esc(x.type||'')}</div></td><td style="text-align:right"><span class="pill ${st[0]}">${st[1]}</span><div class="t-sub" style="margin-top:4px">${st[2]}</div></td></tr>`;}),'Всё в графике'));}},
  aging:{label:'Виджет · Задолженность по срокам',span:2,build:()=>{const a=agingBuckets(SCOPE);
    const rows=[['Текущая',a.cur],['1–30 дн',a.d30],['31–60 дн',a.d60],['61–90 дн',a.d90],['90+ дн',a.d90p]].map(([l,v])=>`<tr><td class="t-sub">${l}</td><td style="text-align:right" class="t-strong">${money(v)}</td></tr>`);
    rows.push(`<tr><td class="t-strong">Пеня</td><td style="text-align:right;color:var(--amber)"><b>${money(Math.round(a.penalty))}</b></td></tr>`);
    return dashCard('💳 Старение задолженности',money(a.total),`<table><tbody>${rows.join('')}</tbody></table>`);}},
  alerts:{label:'Виджет · Центр сроков',span:2,build:()=>{const al=buildAlerts().slice(0,6);
    return dashCard('🔔 Требует внимания',al.length,al.length?al.map(a=>`<div class="doc" style="border-left:3px solid ${alertColor(a.level)};border-radius:7px;padding:8px 10px;margin-bottom:6px;cursor:pointer" onclick="gotoPage('${a.page}')"><div style="flex:1;min-width:0"><div class="t-strong">${a.icon} ${esc(a.title)}</div><div class="t-sub">${a.cat} · ${a.sub}</div></div></div>`).join(''):'<div class="empty" style="padding:16px">Срочных событий нет 🎉</div>');}},
  budget:{label:'Виджет · Бюджет план/факт',span:2,build:()=>{const y=String(TODAY.getFullYear());const bs=SCOPE==='all'?buildingsList():buildingsList().filter(b=>b.id===SCOPE);
    let iP=0,iF=0,eP=0,eF=0;bs.forEach(b=>{const bg=(DB.budgets||{})[b.id]||{};iP+=bg.income||0;eP+=bg.expense||0;iF+=bIncome(b.id,y);eF+=bExpense(b.id,y);});
    const rows=[['План доход',money(iP)],['Факт доход',money(iF)+' '+pctCell(iF,iP)],['План расход',money(eP)],['Факт расход',money(eF)+' '+pctCell(eF,eP,true)],['NOI (факт)',`<b>${money(iF-eF)}</b>`]].map(([l,v])=>`<tr><td class="t-sub">${l}</td><td style="text-align:right">${v}</td></tr>`);
    return dashCard('📈 Бюджет '+y,null,`<table><tbody>${rows.join('')}</tbody></table>`);}},
  expiring:{label:'Виджет · Договоры на исходе',span:2,build:()=>{const cs=DB.contracts.filter(c=>{if(c.status==='ended')return false;const u=unitOf(c.unit);if(!(SCOPE==='all'||(u&&u.building===SCOPE)))return false;const dl=c.end?daysLeft(c.end):9999;return dl<=90;}).sort((a,b)=>daysLeft(a.end)-daysLeft(b.end)).slice(0,5);
    return dashCard('📄 Договоры на исходе',cs.length,dashRows(cs.map(c=>{const t=tenantOf(c.tenant);return `<tr><td><div class="t-strong">${esc(t?t.name:c.id)}</div><div class="t-sub">${esc(unitNum(c.unit))} · до ${c.end?fmtD(c.end):'—'}</div></td><td style="text-align:right">${dueLabel(c.end)}</td></tr>`;}),'Нет договоров на исходе'));}},
};
function dashCfg(){ try{const s=JSON.parse(localStorage.getItem(dashStoreKey()));
  if(s&&Array.isArray(s.order)) return {order:s.order.filter(id=>DASH_CATALOG[id])};
  }catch{} return {order:DASH_DEFAULT_ORDER.slice()}; }
function saveDashCfg(c){ localStorage.setItem(dashStoreKey(), JSON.stringify(c)); }
function dashboard(){
  _dashM=metrics(); const cfg=dashCfg();
  const tiles=cfg.order.map(id=>{const w=DASH_CATALOG[id];if(!w)return '';
    return `<div class="dash-tile" data-wid="${id}" draggable="true" style="grid-column:span ${w.span};cursor:grab;align-self:start">${w.build()}</div>`;}).join('');
  const empty=!cfg.order.length?'<div class="card"><div class="empty">Все блоки скрыты. Нажмите «⚙ Настроить» и добавьте нужные.</div></div>':'';
  el(head('Дашборд', `${scopeSub()} · ${TODAY.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}`,
    `<button class="btn ghost sm" onclick="dashSettings()">⚙ Настроить</button>${(ME.role==='admin'||ME.role==='owner')?` <button class="btn ghost sm" onclick="resetDemo()">↺ Демо-данные</button>`:''}`)+
  (cfg.order.length?`<div class="t-sub" style="margin-bottom:10px">✋ Перетаскивайте блоки мышью, чтобы расставить по-своему. «⚙ Настроить» — добавить/убрать блоки.</div>`:'')+
  `<div class="grid" id="dashGrid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));align-items:start">${tiles}</div>${empty}`);
  cfg.order.forEach(id=>{const w=DASH_CATALOG[id];if(w&&w.draw){try{w.draw();}catch{}}});
  dashDrag();
}
function dashDrag(){ const grid=document.getElementById('dashGrid'); if(!grid)return; let dragId=null;
  grid.querySelectorAll('.dash-tile').forEach(elm=>{
    elm.addEventListener('dragstart',()=>{dragId=elm.dataset.wid;elm.style.opacity='.35';window._dashDragging=true;});
    elm.addEventListener('dragend',()=>{elm.style.opacity='';window._dashDragging=false;});
    elm.addEventListener('dragover',e=>e.preventDefault());
    elm.addEventListener('drop',e=>{e.preventDefault();const overId=elm.dataset.wid;if(!dragId||dragId===overId)return;
      const cfg=dashCfg();const o=cfg.order.slice();const from=o.indexOf(dragId),to=o.indexOf(overId);if(from<0||to<0)return;
      o.splice(from,1);o.splice(to,0,dragId);saveDashCfg({order:o});render();});
  });
}
function dashSettings(){ const cfg=dashCfg(); const cur=new Set(cfg.order);
  openM(`<div class="modal-h"><h3>Настройка дашборда</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="t-sub" style="margin-bottom:10px">Отметьте блоки для показа. Порядок меняется перетаскиванием прямо на дашборде. Настройка — лично для вашего аккаунта.</div>
  ${Object.entries(DASH_CATALOG).map(([k,w])=>`<label style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer">
    <input type="checkbox" id="dc-${k}" ${cur.has(k)?'checked':''} style="width:18px;height:18px;accent-color:var(--accent)"><span>${w.label}</span></label>`).join('')}
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="resetDash()">Сбросить</button><button class="btn" onclick="applyDash()">Применить</button></div>`);}
function applyDash(){ const old=dashCfg().order; const enabled=Object.keys(DASH_CATALOG).filter(k=>document.getElementById('dc-'+k)?.checked);
  const order=old.filter(k=>enabled.includes(k)).concat(enabled.filter(k=>!old.includes(k)));
  saveDashCfg({order}); closeM(); render(); }
function resetDash(){ saveDashCfg({order:DASH_DEFAULT_ORDER.slice()}); closeM(); render(); }
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
    canEdit('objects')?`<button class="btn ghost" onclick="importModal('units')">⤓ Импорт</button> <button class="btn ghost" onclick="buildingModal()">+ Объект</button> <button class="btn" onclick="unitModal()">+ Помещение</button>`:'')+
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
        <button class="btn ghost sm" onclick="planModal('${b.id}')" title="План и схема занятости">📐 План</button>
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
/* ---------- интерактивный план объекта ---------- */
const PLAN_COL={occupied:'#37d39b',debt:'#ff5d6c',reserved:'#f5a623',free:'#94a3b8'};
const PLAN_LBL={occupied:'Занято',debt:'Долг',reserved:'Резерв',free:'Свободно'};
function planModal(bid){
  const b=buildingOf(bid); if(!b)return; const ed=canEdit('objects');
  const us=DB.units.filter(u=>u.building===bid);
  const floors=[...new Set(us.map(u=>u.floor))].sort((a,b)=>a-b);
  const tile=u=>{const st=unitStatus(u);const c=PLAN_COL[st]||PLAN_COL.free;
    return `<div onmouseenter="planHover('${esc(u.id)}')" onclick="closeM();unitInfo('${esc(u.id)}')" title="Помещение ${esc(u.num||u.id)} — клик для подробностей" style="background:${c}1f;border:2px solid ${c};border-radius:9px;padding:9px 11px;min-width:92px;cursor:pointer">
      <div class="t-strong">${esc(u.num||u.id)}</div><div class="t-sub">${u.area} м²</div><div style="font-size:11px;color:${c};font-weight:700;margin-top:2px">${PLAN_LBL[st]}</div></div>`;};
  // миграция старого одиночного плана (data:image) в общий список файлов
  if(b.plan && /^data:image\//.test(b.plan)){ if(!Array.isArray(b.planDocs)) b.planDocs=[]; b.planDocs.push({name:'План объекта',img:true,url:b.plan}); delete b.plan; saveState(); }
  const pd=Array.isArray(b.planDocs)?b.planDocs:[];
  openM(`<div class="modal-h"><h3>📐 План — ${esc(b.name)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    ${pd.length?`<div class="sec-h" style="margin-top:0">Планы объекта (${pd.length})</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">${pd.map((d,i)=>d.img?
        `<div><img src="${esc(d.url)}" alt="${esc(d.name)}" style="width:100%;border-radius:10px;border:1px solid var(--line2)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span class="t-sub">${esc(d.name)}</span>${ed?`<button class="btn ghost sm" onclick="delPlanDoc('${bid}',${i})">🗑 Убрать</button>`:''}</div></div>`
        : `<div class="doc"><div class="di">📄</div><div style="flex:1;min-width:0"><div class="t-strong">${esc(d.name)}</div><div class="t-sub">PDF / документ</div></div>
          <button class="btn ghost sm" onclick="openPlanFile('${bid}',${i})">Открыть</button>${ed?`<button class="btn ghost sm" onclick="delPlanDoc('${bid}',${i})">🗑</button>`:''}</div>`
      ).join('')}</div>`:''}
    ${ed?`<div class="field"><label>${pd.length?'Добавить ещё файлы плана':'Загрузить план объекта'} <span class="t-sub">— PNG, JPG, WEBP или PDF, можно несколько файлов, до 12 МБ каждый</span></label>
      <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple onchange="onPlanFiles('${bid}',this)" style="font-size:13px;padding:8px;border:1px dashed var(--line2);border-radius:9px;background:var(--bg2);width:100%"></div>`:''}
    ${ed&&assistOn()?`<div style="margin:2px 0 10px"><button class="btn ghost sm" onclick="recognizePlanModal('${bid}')">🤖 Распознать помещения с плана (ИИ)</button>
      <div class="t-sub" style="margin-top:3px">GigaChat прочитает план (картинку или PDF) и предложит список помещений — вы проверите и добавите.</div></div>`:''}
    <div class="sec-h">Схема занятости</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:12px">${Object.entries(PLAN_LBL).map(([k,l])=>`<span style="display:inline-flex;align-items:center;gap:5px"><i style="width:12px;height:12px;border-radius:3px;background:${PLAN_COL[k]};display:inline-block"></i>${l}</span>`).join('')}</div>
    ${floors.length?floors.map(f=>`<div style="margin-bottom:12px"><div class="t-sub" style="margin-bottom:6px">Этаж ${f}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${us.filter(u=>u.floor===f).map(tile).join('')}</div></div>`).join(''):'<div class="empty" style="padding:20px">В объекте пока нет помещений</div>'}
    <div class="card" id="planDetails" style="margin-top:8px;background:var(--bg2)"><div class="t-sub">Наведите курсор на помещение — появится информация. Клик — полная карточка.</div></div>
  </div>
  <div class="modal-f"><button class="btn" onclick="closeM()">Закрыть</button></div>`);
}
function planHover(id){ const u=unitOf(id); const box=document.getElementById('planDetails'); if(!u||!box)return;
  const c=DB.contracts.find(x=>x.unit===id&&x.status!=='ended'); const t=u.tenant?tenantOf(u.tenant):null; const st=unitStatus(u); const r=u.responsible||{};
  box.innerHTML=`<div class="t-strong" style="margin-bottom:6px">Помещение ${esc(u.num||u.id)}${u.name?' · '+esc(u.name):''} · ${u.area} м² · ${esc(u.type||'')}</div>
    <div class="t-sub">Статус: <b style="color:${PLAN_COL[st]}">${PLAN_LBL[st]}</b></div>
    ${t?`<div class="t-sub">Арендатор: ${esc(t.name)}</div>`:'<div class="t-sub">Помещение свободно</div>'}
    ${c?`<div class="t-sub">Аренда: ${money(c.rate)}/м² · ${money(monthlyRent(c))}/мес · договор до ${c.end?fmtD(c.end):'—'}</div>`:''}
    ${r.name?`<div class="t-sub">Ответственный: ${esc(r.name)}${r.phone?' · '+esc(r.phone):''}</div>`:''}
    <div class="t-sub" style="margin-top:6px;color:var(--accent2)">Клик по помещению — открыть полную карточку →</div>`;
}
// загрузка плана: несколько файлов, PNG/JPG/WEBP/PDF, через файловое хранилище (в демо — data URL)
async function onPlanFiles(bid,input){ const files=input.files?[...input.files]:[]; if(!files.length)return; const b=buildingOf(bid); if(!b)return;
  if(!Array.isArray(b.planDocs)) b.planDocs=[]; let added=0;
  for(const f of files){
    if(!/^(image\/(png|jpe?g|webp)|application\/pdf)$/i.test(f.type)){ alert('«'+f.name+'»: подходят только PNG, JPG, WEBP или PDF.'); continue; }
    if(f.size>12*1024*1024){ alert('«'+f.name+'» больше 12 МБ — выберите файл поменьше.'); continue; }
    const data=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(String(r.result||'')); r.onerror=()=>res(''); r.readAsDataURL(f); });
    if(!data) continue;
    let url=data, stored='embed'; const img=/^image\//i.test(f.type);
    try{ const r=await api('/api/files','POST',{folder:bid+'/plan',name:f.name,dataUrl:data}); url=r.url; stored=r.stored||'file'; }
    catch(err){ alert('Не удалось загрузить «'+f.name+'»: '+(err.message||err)); continue; }
    b.planDocs.push({name:f.name,url,stored,img}); added++;
  }
  input.value='';
  if(added){ await afterStateChange(); }
  planModal(bid);
}
function openPlanFile(bid,i){ const b=buildingOf(bid); const d=((b&&b.planDocs)||[])[i]; if(!d)return; const url=d.url||'';
  if(url.startsWith('data:')){ fetch(url).then(r=>r.blob()).then(bl=>window.open(URL.createObjectURL(bl),'_blank')).catch(()=>{}); return; }
  const s=safeUrl(url); if(s) window.open(s,'_blank','noopener'); else alert('Файл недоступен для открытия.'); }
async function delPlanDoc(bid,i){ const b=buildingOf(bid); if(!b||!Array.isArray(b.planDocs))return; const d=b.planDocs[i]; if(!d)return;
  if(!confirm('Убрать «'+(d.name||'файл')+'» из плана объекта?'))return; b.planDocs.splice(i,1); await afterStateChange(); planModal(bid); }

/* ---------- Распознавание помещений с плана (ИИ, GigaChat Vision) ---------- */
// динамическая подгрузка pdf.js (для рендера PDF-плана в картинку) — только когда нужно
let _pdfjsPromise=null;
function loadScriptOnce(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error('Не удалось загрузить '+src)); document.head.appendChild(s); }); }
async function ensurePdfJs(){
  if(window.pdfjsLib) return window.pdfjsLib;
  if(!_pdfjsPromise){ _pdfjsPromise=(async()=>{
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    if(window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  })(); }
  await _pdfjsPromise; if(!window.pdfjsLib) throw new Error('pdf.js не загрузился'); return window.pdfjsLib;
}
function dataUrlToBytes(u){ const b64=String(u).split(',')[1]||''; const bin=atob(b64); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i); return arr; }
function loadImage(src){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=()=>rej(new Error('Не удалось прочитать картинку')); im.src=src; }); }
// первую страницу PDF → PNG (с ограничением размера)
async function pdfToImageDataUrl(pdfDataUrl,pageNum){
  const pdfjs=await ensurePdfJs(); const pdf=await pdfjs.getDocument({data:dataUrlToBytes(pdfDataUrl)}).promise;
  const pn=Math.min(Math.max(1, parseInt(pageNum,10)||1), pdf.numPages); const page=await pdf.getPage(pn);   // выбранная страница (этаж) многостраничного PDF
  const v1=page.getViewport({scale:1}); const maxD=1800; const scale=Math.min(2.2, maxD/Math.max(v1.width,v1.height));   // проверенный размер (на нём находило кабинеты)
  const vp=page.getViewport({scale}); const c=document.createElement('canvas'); c.width=Math.round(vp.width); c.height=Math.round(vp.height);
  const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);   // белый фон
  await page.render({canvasContext:ctx,viewport:vp}).promise;
  return c.toDataURL('image/jpeg',0.9);
}
// картинку → нормализованный dataURL (ограничение по стороне 2000px)
async function imageToDataUrl(srcDataUrl){
  const im=await loadImage(srcDataUrl); let w=im.naturalWidth||im.width, h=im.naturalHeight||im.height; if(!w||!h)throw new Error('Пустая картинка');
  const k=Math.min(1,1800/Math.max(w,h)); w=Math.round(w*k); h=Math.round(h*k);   // проверенный размер по большей стороне
  const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(im,0,0,w,h);
  return c.toDataURL('image/jpeg',0.9);
}
async function urlToDataUrl(url){ if(!url)throw new Error('Нет файла'); if(url.startsWith('data:'))return url;
  const s=safeUrl(url); if(!s)throw new Error('Файл недоступен'); const r=await fetch(s); if(!r.ok)throw new Error('Не удалось загрузить файл плана');
  const bl=await r.blob(); return await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(String(fr.result)); fr.onerror=()=>rej(new Error('Ошибка чтения файла')); fr.readAsDataURL(bl); }); }
const isPdfDoc = d => !d.img && /\.pdf($|\?)/i.test((d.name||'')+' '+(d.url||''));
// сохранить загруженный в окне распознавания файл как план объекта (чтобы картинка осталась в разделе «План»)
async function savePlanDocFromFile(bid,f,dataUrl){
  const b=buildingOf(bid); if(!b)return; if(!Array.isArray(b.planDocs)) b.planDocs=[];
  if(b.planDocs.some(d=>d.name===f.name)) return;                 // такой файл уже добавлен — не дублируем
  const img=/^image\//i.test(f.type); let url=dataUrl, stored='embed';
  try{ const rr=await api('/api/files','POST',{folder:bid+'/plan',name:f.name,dataUrl}); url=rr.url; stored=rr.stored||'file'; }catch{}
  b.planDocs.push({name:f.name,url,stored,img});
  await afterStateChange();
}

function recognizePlanModal(bid){
  const b=buildingOf(bid); if(!b)return; const pd=Array.isArray(b.planDocs)?b.planDocs:[];
  const choices=pd.map((d,i)=>`<label style="display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer">
    <input type="radio" name="prsrc" value="${i}"${i===0?' checked':''}> <span>${d.img?'🖼':'📄'} ${esc(d.name||('План '+(i+1)))}</span></label>`).join('');
  openM(`<div class="modal-h"><h3>🤖 Распознавание помещений с плана</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-sub" style="margin-bottom:8px">ИИ (GigaChat) прочитает план и предложит список помещений с номерами и площадями. Вы проверите и добавите нужные — до подтверждения в базу ничего не попадёт. Точность зависит от чёткости плана.</div>
    ${pd.length?`<div class="sec-h" style="margin-top:0">Выберите загруженный план</div>${choices}`:'<div class="t-sub">У объекта пока нет загруженных планов — загрузите файл ниже.</div>'}
    <div class="field" style="margin-top:8px"><label>${pd.length?'…или загрузите новый файл':'Загрузите файл плана'} <span class="t-sub">(PNG, JPG или PDF)</span></label>
      <input type="file" id="prFile" accept="image/png,image/jpeg,image/webp,application/pdf" style="font-size:13px;padding:8px;border:1px dashed var(--line2);border-radius:9px;background:var(--bg2);width:100%"></div>
    <div class="row2" style="margin-top:4px"><div class="field"><label>Этаж <span class="t-sub">(проставится найденным помещениям)</span></label><input id="prFloor" type="number" placeholder="напр. 1"></div>
      <div class="field"><label>Страница PDF <span class="t-sub">(многостранич. план — этаж = страница)</span></label><input id="prPage" type="number" min="1" value="1"></div></div>
    <div class="field"><button class="btn" style="width:100%" onclick="runPlanRecognize('${bid}')">🔍 Распознать</button></div>
    <div id="planRecOut" style="margin-top:10px"></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Закрыть</button></div>`);
}

async function runPlanRecognize(bid){
  const out=document.getElementById('planRecOut'); const say=h=>{ if(out)out.innerHTML=h; };
  try{
    const b=buildingOf(bid); const pd=Array.isArray(b.planDocs)?b.planDocs:[];
    const fi=document.getElementById('prFile'); const f=fi&&fi.files&&fi.files[0];
    let srcDataUrl, isPdf;
    say('<div class="t-sub">⏳ Готовлю изображение…</div>');
    if(f){
      if(!/^(image\/(png|jpe?g|webp)|application\/pdf)$/i.test(f.type)) throw new Error('Подходят только PNG, JPG или PDF');
      if(f.size>15*1024*1024) throw new Error('Файл больше 15 МБ');
      srcDataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=()=>rej(new Error('Ошибка чтения файла'));r.readAsDataURL(f);});
      isPdf=/pdf/i.test(f.type);
    }else{
      const sel=document.querySelector('input[name="prsrc"]:checked'); if(!sel) throw new Error('Выберите план или загрузите файл');
      const d=pd[+sel.value]; if(!d) throw new Error('План не найден'); srcDataUrl=await urlToDataUrl(d.url); isPdf=isPdfDoc(d);
    }
    say('<div class="t-sub">⏳ Обрабатываю изображение…</div>');
    const pageNum=isPdf?(parseInt((document.getElementById('prPage')||{}).value,10)||1):1;
    const imgDataUrl=isPdf?await pdfToImageDataUrl(srcDataUrl,pageNum):await imageToDataUrl(srcDataUrl);
    say('<div class="t-sub">🤖 GigaChat распознаёт план… это может занять до минуты.</div>');
    const floor=(document.getElementById('prFloor').value||'').trim();
    const r=await api('/api/plan/recognize','POST',{dataUrl:imgDataUrl,building:bid,floor});
    if(r.enabled===false){ say('<div class="empty">ИИ-помощник выключен или не задан ключ модели. Включите в «Настройки → AI-помощник».</div>'); return; }
    if(r.error){ say('<div class="empty">⚠️ '+esc(r.error)+'</div>'); return; }
    const units=Array.isArray(r.units)?r.units:[];
    if(!units.length){ say('<div class="empty">Не удалось распознать помещения. Попробуйте более чёткий файл, увеличьте масштаб плана или укажите этаж.</div>'); return; }
    if(f){ try{ await savePlanDocFromFile(bid,f,srcDataUrl); }catch{} }   // сохраняем загруженный файл как план объекта
    renderPlanRecTable(bid,units);
  }catch(e){ say('<div class="empty">⚠️ '+esc(e.message||String(e))+'</div>'); }
}

function renderPlanRecTable(bid,units){
  const out=document.getElementById('planRecOut'); if(!out)return; const types=(stg().unitTypes||['Офис','Склад']);
  const inThisObj=n=>DB.units.some(x=>x.building===bid && (x.num||x.id)===n);   // дубликат — только в ЭТОМ объекте
  const rows=units.map((u,i)=>{ const dup=inThisObj(u.number);
    const topt=types.map(t=>`<option${(u.type&&String(t).toLowerCase()===String(u.type).toLowerCase())?' selected':''}>${esc(t)}</option>`).join('');
    return `<tr data-i="${i}"${dup?' style="background:rgba(255,107,107,.10)"':''}>
      <td style="text-align:center"><input type="checkbox" id="pr-chk-${i}"${dup?'':' checked'}></td>
      <td><input id="pr-num-${i}" value="${esc(u.number)}" style="width:78px"></td>
      <td><input id="pr-area-${i}" type="number" step="0.1" value="${u.area??''}" style="width:66px" placeholder="—"></td>
      <td><input id="pr-floor-${i}" type="number" value="${u.floor??''}" style="width:52px" placeholder="—"></td>
      <td><select id="pr-type-${i}">${topt}</select></td>
      <td class="t-sub" style="color:#e0564f">${dup?'уже есть':''}</td></tr>`; }).join('');
  const dupN=units.filter(u=>inThisObj(u.number)).length;
  out.innerHTML=`<div class="sec-h">Найдено помещений: ${units.length}${dupN?` · из них уже в этом объекте: ${dupN} (галочки сняты)`:''}</div>
    <div class="t-sub" style="margin-bottom:6px">Проверьте номера и площади, поправьте при необходимости. Снимите галочку у ненужных. Красным — помещения, которые уже есть.</div>
    <div style="overflow:auto"><table id="planRecTable"><thead><tr><th></th><th>Номер</th><th>м²</th><th>Этаж</th><th>Тип</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" onclick="addRecognizedUnits('${bid}')">✓ Добавить отмеченные</button>
      <button class="btn ghost" onclick="recognizePlanModal('${bid}')">↻ Заново</button></div>`;
}

async function addRecognizedUnits(bid){
  const trs=document.querySelectorAll('#planRecTable tbody tr'); const add=[]; let dup=0, blank=0;
  const taken=new Set(DB.units.map(u=>u.id));   // для генерации глобально-уникального id
  const genId=num=>{ if(!taken.has(num))return num; const base=(num+'_'+String(bid).replace(/[^0-9A-Za-zА-Яа-я_-]/g,'').slice(0,8))||('u'+Date.now().toString(36)); let id=base,k=2; while(taken.has(id)){id=base+'_'+k;k++;} return id; };
  trs.forEach(tr=>{ const i=tr.dataset.i; const chk=document.getElementById('pr-chk-'+i); if(!chk||!chk.checked)return;
    const num=(document.getElementById('pr-num-'+i).value||'').trim().replace(/[<>"'`&]/g,''); if(!num){blank++;return;}
    // дубликат — только В ЭТОМ объекте (в разных объектах номера могут совпадать)
    if(DB.units.some(x=>x.building===bid&&(x.num||x.id)===num) || add.some(u=>u.num===num)){dup++;return;}
    const area=+document.getElementById('pr-area-'+i).value||0; const floor=+document.getElementById('pr-floor-'+i).value||1; const type=document.getElementById('pr-type-'+i).value||'Офис';
    const id=genId(num); taken.add(id);
    add.push({ id,num,name:'',building:bid,floor,area,type,tenant:null,status:'free',ownership:'own',owner:null,
      responsible:{name:ME.full_name,role:ME.position,phone:ME.phone,email:ME.email},documents:[] }); });
  if(!add.length){ alert('Не отмечено ни одного нового помещения'+(dup?` (пропущено дубликатов: ${dup})`:'')); return; }
  DB.units.push(...add); await afterStateChange();
  alert('Добавлено помещений: '+add.length+(dup?`\nПропущено дубликатов: ${dup}`:'')+(blank?`\nПропущено без номера: ${blank}`:''));
  closeM(); planModal(bid);
}

/* ---------- универсальная сворачиваемая секция (для арендаторов/договоров по объектам) ---------- */
const expandedSections = new Set();
const chartFactories = {}; // id канваса -> функция создания графика (ленивая инициализация в свёрнутых секциях)
function activateCharts(root){ if(!root||!window.Chart)return; root.querySelectorAll('canvas').forEach(cv=>{
  if(cv.offsetParent===null) return; const ex=Chart.getChart(cv); if(ex){ex.resize();} else if(chartFactories[cv.id]){ chartFactories[cv.id](); } }); }
function toggleSection(id){
  const el=document.getElementById('sect-'+id); if(!el)return;
  const open = el.style.display!=='none';
  el.style.display = open?'none':'block';
  const chev=document.getElementById('chev-'+id); if(chev) chev.style.transform=`rotate(${open?0:90}deg)`;
  if(open) expandedSections.delete(id);
  else { expandedSections.add(id); setTimeout(()=>activateCharts(el),40); }
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
  const ten=u.tenant?(tenantOf(u.tenant)||{}).name:(st==='reserved'?'Бронь':'Свободно');
  return `<div class="unit ${cls}" onclick="unitInfo('${esc(u.id)}')"><span class="bar"></span>
    <div class="u-id">${esc(u.num||u.id)}${u.name?' · '+esc(u.name):''}${u.ownership==='sold'?' 🏷':''}</div><div class="u-area">${esc(u.type)} · ${u.area} м²</div><div class="u-ten">${esc(ten)}</div>
    <div class="u-ten" style="color:var(--muted2);font-size:10.5px;margin-top:5px">📎 ${(u.documents||[]).length} док.${u.ownership==='sold'?' · сторонний собств.':''}</div></div>`;
}
function miniStat(label,v,color){return `<div class="card"><div class="label" style="color:var(--muted);font-size:12px">${label}</div><div style="font-size:24px;font-weight:750;margin-top:4px;color:${color?'var(--'+color+')':'var(--txt)'}">${v}</div></div>`;}

/* ============================================================
   АРЕНДАТОРЫ
   ============================================================ */
function tenants(){
  el(head('Арендаторы',`${sTenants().length} компаний · ${scopeSub()}`, canEdit('tenants')?`<button class="btn ghost" onclick="importModal('tenants')">⤓ Импорт</button> <button class="btn" onclick="tenantModal()">+ Арендатор</button>`:'')+
  `<div class="toolbar"><input class="search" id="tsearch" placeholder="Поиск по названию, ИНН..." oninput="renderTenants()"></div>
  <div id="tbcards"></div>`);
  renderTenants();
}
function tenantBuilding(t){const c=DB.contracts.find(c=>c.tenant===t.id);return c?(unitOf(c.unit)?.building||null):null;}
function tenantUnit(t){const c=DB.contracts.find(c=>c.tenant===t.id);return c?unitNum(c.unit):'';}
const byUnitNo=(a,b)=>String(tenantUnit(a)).localeCompare(String(tenantUnit(b)),undefined,{numeric:true});
function tenantTable(list){
  return `<div style="overflow-x:auto"><table><thead><tr><th>Арендатор</th><th>Контакт</th><th>Отрасль</th><th>Помещение</th><th>Аренда/мес</th><th>Статус оплат</th></tr></thead><tbody>${list.map(tenantRow).join('')}</tbody></table></div>`;
}
function tenantRow(t){
  const c=DB.contracts.find(c=>c.tenant===t.id);
  const pay=c?DB.payments.find(p=>p.contract===c.id):null;
  const stp=pay?payPill(pay):'<span class="pill gray">—</span>';
  return `<tr onclick="tenantInfo('${t.id}')" style="cursor:pointer"><td><div class="t-strong">${esc(t.name)}</div><div class="t-sub">ИНН ${esc(t.inn)}</div></td>
    <td><div>${esc(t.contact)}</div><div class="t-sub">${esc(t.phone)}</div></td><td><span class="pill blue">${esc(t.industry)}</span></td>
    <td>${esc(c?unitNum(c.unit):'—')}</td><td class="t-strong">${c?money(monthlyRent(c)):'—'}</td><td>${stp}</td></tr>`;
}
function renderTenants(){
  const q=(document.getElementById('tsearch')?.value||'').toLowerCase();
  const match=t=>!q||t.name.toLowerCase().includes(q)||(t.inn||'').includes(q)||(t.contact||'').toLowerCase().includes(q);
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  let html = bs.map(b=>{
    const list=DB.tenants.filter(t=>tenantBuilding(t)===b.id && match(t)).sort(byUnitNo);
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
  return `<tr style="cursor:pointer" onclick="contractInfo('${c.id}')"><td><div class="t-strong">${(c.id||'').toUpperCase()}</div><div class="t-sub">${esc(t?t.name:'—')}</div></td>
    <td>${esc(unitNum(c.unit))}</td><td>${fmt(c.rate)}<div class="t-sub">${c.rateType==='flat'?'₽/мес за помещ.':'₽/м²'}</div></td><td class="t-strong">${money(monthlyRent(c))}</td>
    <td><div>${fmtD(c.start)} —</div><div class="t-sub">${fmtD(c.end)}</div></td><td>${c.indexation}%/год</td><td>${stPill}</td></tr>`;
}
function fmtD(d){return new Date(d).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'});}

/* ============================================================
   ПЛАТЕЖИ
   ============================================================ */
let payPeriod=''; // '' = все периоды
function setPayPeriod(v){ payPeriod=v; render(); }
function payments(){
  const inPer = p => !payPeriod || p.period===payPeriod;
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  const ps0 = sPayments().filter(inPer);
  const billed=ps0.reduce((s,p)=>s+p.amount,0), collected=ps0.reduce((s,p)=>s+p.paid,0), debt=billed-collected;
  const pers=[...new Set(DB.payments.map(p=>p.period).filter(Boolean))].sort().reverse();
  el(head('Платежи аренды',`${payPeriod?'Период: '+fmtPeriod(payPeriod):'Все периоды'} · ${scopeSub()}`, canEdit('payments')?`<button class="btn" onclick="paymentModal()">+ Начисление</button>`:'')+
  `<div class="toolbar"><span class="t-sub">Период:</span><select class="search" style="width:auto;min-width:160px" onchange="setPayPeriod(this.value)"><option value="">Все периоды</option>${pers.map(p=>`<option value="${p}"${payPeriod===p?' selected':''}>${fmtPeriod(p)}</option>`).join('')}</select></div>
  <div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
    ${miniStat('Начислено',money(billed))}${miniStat('Собрано',money(collected),'green')}
    ${miniStat('Задолженность',money(debt),'red')}${miniStat('Собираемость',pct(collected,billed)+'%','blue')}
  </div><div id="pbcards"></div>`);
  document.getElementById('pbcards').innerHTML = bs.map(b=>{
    const ps=DB.payments.filter(p=>{const c=contractOf(p.contract);return c&&unitOf(c.unit)?.building===b.id && inPer(p);});
    const body = ps.length
      ? `<div style="overflow-x:auto"><table><thead><tr><th>Арендатор</th><th>Помещение</th><th>Период</th><th>Начислено</th><th>Оплачено</th><th>Срок</th><th>Статус</th><th></th></tr></thead><tbody>${ps.map(paymentRow).join('')}</tbody></table></div>`
      : '<div class="empty" style="padding:20px">Нет платежей в объекте</div>';
    const bd=ps.reduce((s,p)=>s+(p.amount-p.paid),0);
    return collapseCard('pay-'+b.id, buildingHeader(b, `${ps.length} плат.${bd>0?' · долг '+money(bd):''}`), body, false);
  }).join('') || '<div class="card"><div class="empty">Объекты не найдены</div></div>';
}
const PAY_METHODS={cash:'Наличные',bank:'Безналичный',card:'Карта',transfer:'Перевод'};
// встроенные способы + добавленные клиентом в настройках
function payMethods(){ const m={...PAY_METHODS}; (stg().payMethodsExtra||[]).forEach(x=>{const k=String(x).trim(); if(k)m[k]=k;}); return m; }
const payLabel=k=>payMethods()[k]||k;
const payMethodOpts=(sel='bank')=>Object.entries(payMethods()).map(([k,v])=>`<option value="${esc(k)}"${k===sel?' selected':''}>${esc(v)}</option>`).join('');
function pTx(p){ if(p.transactions&&p.transactions.length) return p.transactions; if(p.paid>0) return [{amount:p.paid,date:p.paidDate||p.due,method:'bank',legacy:true}]; return []; }
function paymentRow(p){const c=contractOf(p.contract);const t=c&&tenantOf(c.tenant);const bal=p.amount-p.paid;
  return `<tr><td class="t-strong">${esc(t?t.name:'—')}</td><td>${esc(c?unitNum(c.unit):'—')}</td><td>${p.period}</td><td>${money(p.amount)}</td>
    <td>${p.paid?money(p.paid):'—'}</td><td class="t-sub">${fmtD(p.due)}</td><td>${payPill(p)}</td>
    <td style="text-align:right;white-space:nowrap">
      ${bal>0&&canEdit('payments')?`<button class="btn sm" title="Отметить полностью оплаченным (сегодня, безналичный)" onclick="quickPay('${p.id}')">✓ Оплачено</button> `:''}
      <button class="btn ghost sm" title="Открыть / история / частичная оплата" onclick="payModal('${p.id}')">${bal>0?'Оплата':'⋯'}</button>
      ${p.paid>0?`<button class="btn ghost sm" title="Печать квитанции" onclick="printReceipt('${p.id}')">🖶</button>`:''}
    </td></tr>`;
}
// B2. Оплата в один тап: полная оплата, способ по умолчанию (безналичный), дата = сегодня.
async function quickPay(id){
  const p=DB.payments.find(x=>x.id===id); if(!p) return;
  const rem=p.amount-p.paid; if(rem<=0) return;
  if(!p.transactions||!p.transactions.length){ p.transactions = p.paid>0?[{amount:p.paid,date:p.paidDate||p.due,method:'bank'}]:[]; }
  const today=TODAY.toISOString().slice(0,10);
  p.transactions.push({amount:rem,date:today,method:'bank'});
  p.paid=p.amount; p.paidDate=today; p.status='paid';
  if(document.getElementById('modalBg')?.classList.contains('show')) closeM();
  await afterStateChange();
}
function payPill(p){const m={paid:['green','Оплачен'],overdue:['red','Просрочен'],partial:['amber','Частично'],pending:['blue','Ожидание']};const x=m[p.status]||['gray','—'];return `<span class="pill ${x[0]}">${x[1]}</span>`;}
function payModal(id){const p=DB.payments.find(x=>x.id===id);if(!p)return;const c=contractOf(p.contract);const t=c&&tenantOf(c.tenant);const rem=p.amount-p.paid;const tx=pTx(p);const editable=rem>0&&canEdit('payments');
  const cUnit=c?unitNum(c.unit):'—';const tName=t?t.name:'—';
  openM(`<div class="modal-h"><h3>Оплата · ${p.period}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    ${infoRow('Арендатор',esc(tName))}${infoRow('Помещение',esc(cUnit))}
    ${infoRow('Начислено',money(p.amount))}${infoRow('Оплачено',money(p.paid))}${infoRow('Остаток',rem>0?`<span style="color:var(--red)">${money(rem)}</span>`:'<span style="color:var(--green)">0 ₽</span>')}
    <div class="sec-h">История платежей <button class="btn ghost sm" ${p.paid>0?'':'disabled'} onclick="printReceipt('${p.id}')">🖶 Квитанция (итог)</button></div>
    ${tx.length?tx.map((x,i)=>`<div class="doc"><div class="di">💳</div><div style="flex:1;min-width:0"><div class="t-strong">${money(x.amount)} · ${esc(payLabel(x.method))}</div><div class="t-sub">${x.date?fmtD(x.date):'—'}</div></div><button class="btn ghost sm" onclick="printReceipt('${p.id}',${i})">🖶</button></div>`).join(''):'<div class="empty" style="padding:14px">Оплат ещё не было</div>'}
    ${editable?`<div class="sec-h">Внести оплату</div>
    <div class="row2"><div class="field"><label>Сумма, ₽</label><input id="pay-amt" type="number" value="${rem}"></div>
      <div class="field"><label>Дата</label><input id="pay-date" type="date" value="${TODAY.toISOString().slice(0,10)}"></div></div>
    <div class="field"><label>Способ оплаты</label><select id="pay-method">${payMethodOpts('bank')}</select></div>
    <div class="t-sub">Можно внести частично — статус обновится автоматически (Частично / Оплачен).</div>`:''}
  </div>
  <div class="modal-f">${canEdit('payments')?`<button class="btn danger" onclick="delPayment('${id}')">🗑 Удалить начисление</button>`:''}<div class="spacer"></div>${editable?`<button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="savePay('${id}')">Зачесть оплату</button>`:'<button class="btn" onclick="closeM()">Закрыть</button>'}</div>`);}
// удалить начисление (платёж) целиком — вместе с внесёнными по нему оплатами
async function delPayment(id){ if(!canEdit('payments'))return; const p=DB.payments.find(x=>x.id===id); if(!p)return;
  const c=contractOf(p.contract); const t=c&&tenantOf(c.tenant);
  const warn = (+p.paid>0) ? `\n\n⚠️ По начислению уже внесена оплата ${money(p.paid)} — она тоже удалится.` : '';
  if(!confirm(`Удалить начисление за ${p.period}${t?` — ${t.name}`:''} на сумму ${money(p.amount)}?${warn}\n\nДействие необратимо.`)) return;
  DB.payments=DB.payments.filter(x=>x.id!==id); closeM(); await afterStateChange(); }
async function savePay(id){const p=DB.payments.find(x=>x.id===id);if(!p)return;
  const add=+val('pay-amt')||0; if(add<=0)return alert('Укажите сумму оплаты');
  if(!p.transactions||!p.transactions.length){ p.transactions = p.paid>0?[{amount:p.paid,date:p.paidDate||p.due,method:'bank'}]:[]; }
  p.transactions.push({amount:add,date:val('pay-date')||TODAY.toISOString().slice(0,10),method:val('pay-method')||'bank'});
  p.paid=Math.min(p.amount,p.transactions.reduce((s,x)=>s+x.amount,0));
  p.paidDate=val('pay-date')||TODAY.toISOString().slice(0,10);
  p.status = p.paid>=p.amount?'paid':(p.paid>0?'partial':(daysLeft(p.due)<0?'overdue':'pending'));
  closeM(); await afterStateChange();}
function printReceipt(pid, txIndex){
  const p=DB.payments.find(x=>x.id===pid);if(!p)return;
  const c=contractOf(p.contract)||{};const t=tenantOf(c.tenant)||{name:'—',inn:'—'};const u=unitOf(c.unit);const b=buildingOf(u&&u.building);
  const tx=pTx(p); const x=(txIndex!=null&&tx[txIndex])?tx[txIndex]:(tx.length?tx[tx.length-1]:{amount:p.paid,date:p.paidDate,method:'bank'});
  const rem=Math.max(0,p.amount-p.paid);
  const num=esc((''+pid).toUpperCase()+'-'+((txIndex!=null?txIndex:Math.max(0,tx.length-1))+1));
  const row=(k,v,cls='')=>`<div class="row ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const html=`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Квитанция ${num}</title>
  <style>*{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}body{margin:0;padding:20px;color:#13233F}
  .rcpt{max-width:380px;margin:0 auto}.logo{width:56px;height:56px;border-radius:13px;overflow:hidden;margin:0 auto 8px}.logo svg{width:100%;height:100%;display:block}
  .rh{text-align:center;font-weight:800;font-size:18px}.rh small{display:block;font-weight:400;font-size:10px;color:#5F6D82;letter-spacing:.5px;margin-top:2px}
  h2{text-align:center;font-size:14px;margin:14px 0 12px}
  .row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:12.5px}.row span{color:#5F6D82}.row b{text-align:right}
  .row.big b{font-size:17px;color:#10b07f}hr{border:none;border-top:1px dashed #c5d0e0;margin:10px 0}
  .sign{margin-top:24px;font-size:12px;display:flex;justify-content:space-between;align-items:flex-end}.sign .nm{color:#5F6D82;font-size:11px}
  .ft{margin-top:18px;text-align:center;font-size:10px;color:#9099ab}
  @media print{body{padding:0}.noprint{display:none}}
  .pbtn{display:block;margin:18px auto 0;padding:9px 16px;border:none;border-radius:8px;background:#3b6fe0;color:#fff;font-weight:600;cursor:pointer}</style></head>
  <body>
   <div class="rcpt">
    <div class="logo">${LOGO_SVG}</div>
    <div class="rh">СИТИ SRM<small>СИСТЕМА УПРАВЛЕНИЯ КОММЕРЧЕСКОЙ НЕДВИЖИМОСТЬЮ</small></div>
    <h2>Квитанция об оплате № ${num}</h2>
    ${row('Дата платежа',x.date?fmtD(x.date):'—')}
    ${row('Объект',esc(b&&b.name||'—'))}
    ${row('Адрес',esc(b&&b.address||'—'))}
    ${row('Помещение',esc((u&&(u.num||u.id))||c.unit||'—'))}
    ${row('Арендатор',esc(t.name))}
    ${row('ИНН',esc(t.inn||'—'))}
    ${row('Назначение','Аренда за '+p.period)}
    <hr>
    ${row('Сумма платежа',money(x.amount),'big')}
    ${row('Способ оплаты',esc(payLabel(x.method)))}
    <hr>
    ${row('Начислено за период',money(p.amount))}
    ${row('Оплачено всего',money(p.paid))}
    ${row('Остаток',money(rem))}
    <div class="sign"><div>Принял: ____________</div><div class="nm">${esc((ME&&ME.full_name)||'')}</div></div>
    <div class="ft">Сформировано в СИТИ SRM · ${fmtD(TODAY.toISOString().slice(0,10))}</div>
    <button class="pbtn noprint" onclick="window.print()">🖶 Печать / Сохранить в PDF</button>
   </div>
  </body></html>`;
  const w=window.open('','_blank','width=440,height=720');
  if(!w){alert('Разрешите всплывающие окна, чтобы открыть квитанцию');return;}
  w.document.open(); w.document.write(html); w.document.close();
}

/* ============================================================
   КОММУНАЛКА И РАСХОДЫ
   ============================================================ */
let utilPeriod=''; // '' = все периоды
function periodsList(){ return [...new Set([...DB.utilities,...DB.expenses].map(x=>x.period).filter(Boolean))].sort().reverse(); }
function fmtPeriod(p){ if(!p)return 'все периоды'; const [y,mo]=p.split('-'); const mn=['','январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь']; return (mn[+mo]||mo)+' '+y; }
function setUtilPeriod(v){ utilPeriod=v; render(); }
function utilities(){
  const inPer = x => !utilPeriod || x.period===utilPeriod;
  const UT=sUtilities().filter(inPer), EX=sExpenses().filter(inPer);
  const ut=UT.reduce((s,u)=>s+u.electricity+u.water+u.heating,0);
  const ex=EX.reduce((s,e)=>s+e.amount,0);
  const pers=periodsList();
  el(head('Коммуналка и расходы на содержание',`${utilPeriod?'Период: '+fmtPeriod(utilPeriod):'Все периоды'} · ${scopeSub()}`,canEdit('utilities')?`<button class="btn ghost" onclick="readingsModal()">📟 Показания помещений</button> <button class="btn ghost" onclick="odpuEntry()">🏢 Показания ОДПУ</button> <button class="btn ghost" onclick="gsmEntry()">⛽ ГСМ</button> <button class="btn ghost" onclick="boilerEntry()">🔥 Котельная</button> <button class="btn" onclick="expenseModal()">+ Расход</button>`:'')+
  `<div class="toolbar"><span class="t-sub">Период:</span><select class="search" style="width:auto;min-width:160px" onchange="setUtilPeriod(this.value)"><option value="">Все периоды</option>${pers.map(p=>`<option value="${p}"${utilPeriod===p?' selected':''}>${fmtPeriod(p)}</option>`).join('')}</select></div>
  <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
    ${miniStat('Коммунальные начисления',money(ut),'violet')}${miniStat('Расходы на содержание',money(ex),'amber')}${miniStat('Итого затраты',money(ut+ex),'red')}
  </div>
  ${utilReportCard()}
  <div id="ubcards"></div>`);
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  document.getElementById('ubcards').innerHTML = bs.map(b=>{
    const bu=DB.utilities.filter(u=>unitOf(u.unit)?.building===b.id && inPer(u));
    const be=DB.expenses.filter(e=>(e.building||'b1')===b.id && inPer(e));
    const tot=bu.reduce((s,u)=>s+u.electricity+u.water+u.heating,0)+be.reduce((s,e)=>s+e.amount,0);
    const body=`<div class="grid" style="grid-template-columns:1.2fr 1fr">
      <div><div class="sec-h" style="margin-top:0">Коммунальные начисления</div>${utilTable(bu)}</div>
      <div><div class="sec-h" style="margin-top:0">Эксплуатационные расходы</div>${expenseTable(be)}</div>
    </div>
    <div class="sec-h">🏢 Общедомовые приборы учёта (ОДПУ)</div>${odpuSummary(b.id, utilPeriod)}
    ${be.length?`<div class="sec-h">Структура расходов на содержание</div><canvas id="chExp-${b.id}" height="${Math.max(80,be.length*28)}"></canvas>`:''}`;
    return collapseCard('util-'+b.id, buildingHeader(b, `затраты ${money(tot)}`), body, false);
  }).join('') || '<div class="card"><div class="empty">Объекты не найдены</div></div>';
  bs.forEach(b=>{const be=DB.expenses.filter(e=>(e.building||'b1')===b.id && inPer(e));const cv=document.getElementById('chExp-'+b.id);
    if(cv&&be.length){ chartFactories['chExp-'+b.id]=()=>new Chart(cv,{type:'bar',data:{labels:be.map(e=>e.category),datasets:[{data:be.map(e=>e.amount),backgroundColor:cssVar('--violet'),borderRadius:6}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:cssVar('--chart-grid')},ticks:{color:cssVar('--muted')}},y:{grid:{display:false},ticks:{color:cssVar('--muted')}}}}});
      if(cv.offsetParent!==null) chartFactories['chExp-'+b.id](); }});
}
function utilTable(list){
  const rows=[...list].sort((a,b)=>String(unitNum(a.unit)).localeCompare(String(unitNum(b.unit)),'ru',{numeric:true}));   // по номеру помещения, а не по порядку внесения
  return `<div style="overflow-x:auto"><table><thead><tr><th>Помещение</th><th>Эл-во</th><th>Вода</th><th>Отопл.</th><th>Итого</th><th>Статус</th></tr></thead><tbody>
    ${rows.length?rows.map(u=>{const tot=u.electricity+u.water+u.heating;const clk=canEdit('utilities');const un=unitOf(u.unit);return `<tr${clk?` style="cursor:pointer" onclick="utilEdit('${esc(u.id)}')"`:''}><td class="t-strong">${esc(unitNum(u.unit))}${un&&un.name?`<div class="t-sub">${esc(un.name)}</div>`:''}</td><td>${fmt(u.electricity)}</td><td>${fmt(u.water)}</td><td>${fmt(u.heating)}</td><td class="t-strong">${money(tot)}</td><td>${utilPill(u.status)}</td></tr>`;}).join(''):'<tr><td colspan="6" class="empty">Нет начислений</td></tr>'}
    </tbody></table></div>`;
}
function expenseTable(list){
  return `<div style="overflow-x:auto"><table><thead><tr><th>Категория</th><th>Подрядчик</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>
    ${list.length?list.map(e=>{const clk=canEdit('utilities');return `<tr${clk?` style="cursor:pointer" onclick="expenseEdit('${esc(e.id)}')"`:''}><td class="t-strong">${esc(e.category)}${e.note?`<div class="t-sub">${esc(e.note)}</div>`:''}</td><td class="t-sub">${esc(e.vendor)}</td><td class="t-strong">${money(e.amount)}</td><td>${utilPill(e.status)}</td></tr>`;}).join(''):'<tr><td colspan="4" class="empty">Нет расходов</td></tr>'}
    </tbody></table></div>`;
}
function utilPill(s){const m={paid:['green','Оплачено'],invoiced:['blue','Выставлен'],overdue:['red','Просрочен'],planned:['gray','План']};const x=m[s]||['gray',s];return `<span class="pill ${x[0]}">${x[1]}</span>`;}
/* Отчёт по коммунальным услугам: выставлено по счётчикам / собрано фактически / % / прогноз сбора, по типам */
const UTIL_ISSUED = st => st==='invoiced'||st==='overdue'||st==='paid';   // «выставлено» — реально начислено (не «План»)
// Сумма «нагорело» по ОДПУ (что выставили НАМ снабжающие организации) за период(ы) объекта
function odpuBilledFor(bid){
  const meters = (DB.buildingMeters||[]).filter(m=>m.building===bid && (!utilPeriod || m.period===utilPeriod));
  const t={electricity:0,water:0,heating:0}; let any=false;
  meters.forEach(m=>{const a=odpuAccrued(m); if(a){any=true; t.electricity+=a.electricity; t.water+=a.water; t.heating+=a.heating;}});
  return any?t:null;
}
function utilReportRowsFor(cur, hist, odpu, bid){
  const heat = bid ? heatingCostFor(bid, utilPeriod) : null;   // себестоимость отопления (топливо+кочегар+котёл)
  return [['electricity','⚡ Электроэнергия'],['water','💧 Вода'],['heating','🔥 Отопление']].map(([k,label])=>{
    // отопление: «Выставлено нам» = себестоимость (не ОДПУ); электро/вода — по ОДПУ
    const supplier  = k==='heating' ? (heat?heat.total:null) : (odpu ? (+odpu[k]||0) : null);
    const billed    = cur.filter(u=>UTIL_ISSUED(u.status)).reduce((s,u)=>s+(+u[k]||0),0);   // начислено арендаторам
    const collected = cur.filter(u=>u.status==='paid').reduce((s,u)=>s+(+u[k]||0),0);        // собрано с арендаторов
    const hb = hist.filter(u=>UTIL_ISSUED(u.status)).reduce((s,u)=>s+(+u[k]||0),0);
    const hc = hist.filter(u=>u.status==='paid').reduce((s,u)=>s+(+u[k]||0),0);
    const rate = hb>0 ? hc/hb : (billed>0?collected/billed:0);
    const forecast = Math.min(billed, Math.round(collected + (billed-collected)*rate));
    const pct = billed>0 ? Math.round(collected/billed*100) : 0;
    const loss = supplier==null ? null : (supplier - billed);   // ОДН / потери = ОДПУ − начислено арендаторам
    return {k,label,supplier,billed,collected,forecast,pct,loss};
  });
}
function utilReportTable(rows){
  const sum=k=>rows.reduce((s,r)=>s+(r[k]||0),0);
  const anyO=rows.some(r=>r.supplier!=null);
  const tS=sum('supplier'),tB=sum('billed'),tC=sum('collected'),tF=sum('forecast');
  const m=v=>v==null?'—':money(v);
  return `<div style="overflow-x:auto"><table><thead><tr><th>Услуга</th><th>Выставлено нам</th><th>Начислено арендаторам</th><th>Собрано с них</th><th>Прогноз сбора</th><th>Разница (ОДН/потери)</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td class="t-strong">${r.label}</td><td>${m(r.supplier)}</td><td>${money(r.billed)}</td><td class="t-strong" style="color:var(--green)">${money(r.collected)}</td><td style="color:var(--accent2)">${money(r.forecast)}</td><td${r.loss?` style="color:var(--amber)"`:''}>${m(r.loss)}</td></tr>`).join('')}
  <tr style="border-top:2px solid var(--line2)"><td class="t-strong">Итого по объекту</td><td class="t-strong">${anyO?money(tS):'—'}</td><td class="t-strong">${money(tB)}</td><td class="t-strong" style="color:var(--green)">${money(tC)}</td><td class="t-strong" style="color:var(--accent2)">${money(tF)}</td><td class="t-strong"${anyO&&(tS-tB)?` style="color:var(--amber)"`:''}>${anyO?money(tS-tB):'—'}</td></tr>
  </tbody></table></div>`;
}
function utilReportBuildings(){
  const inPer = x => !utilPeriod || x.period===utilPeriod;
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  return bs.map(b=>({b,
    cur: sUtilities().filter(u=>unitOf(u.unit)?.building===b.id && inPer(u)),
    hist: sUtilities().filter(u=>unitOf(u.unit)?.building===b.id),
    odpu: odpuBilledFor(b.id)}));
}
function utilReportCard(){
  const secs = utilReportBuildings();
  const body = secs.map(({b,cur,hist,odpu})=>{ const heat=heatingCostFor(b.id, utilPeriod);
    const breakdown = heat ? `<div class="t-sub" style="margin-top:6px">🔥 Отопление (себестоимость): топливо ${money(heat.fuel)} + зарплата кочегара ${money(heat.stoker)} + котёл ${money(heat.boiler)} = <b>${money(heat.total)}</b>${canEdit('utilities')?` · <button class="btn ghost sm" onclick="boilerEntry('${b.id}')">✎ Котельная</button>`:''}</div>`
      : `<div class="t-sub" style="margin-top:6px">🔥 Отопление: данные котельной за период не внесены — «Выставлено нам» = «—». ${canEdit('utilities')?`<button class="btn ghost sm" onclick="boilerEntry('${b.id}')">🔥 Внести</button>`:''}</div>`;
    return `<div class="sec-h" style="margin-top:14px">🏢 ${esc(b.name)}${odpu?'':' <span class="t-sub">— показания ОДПУ за период не внесены</span>'}</div>${utilReportTable(utilReportRowsFor(cur,hist,odpu,b.id))}${breakdown}`;
  }).join('') || '<div class="empty" style="padding:16px">Объекты не найдены</div>';
  return `<div class="card" style="margin-bottom:18px"><div class="panel-title"><h3>📊 Отчёт по коммунальным услугам</h3><span class="muted">${utilPeriod?fmtPeriod(utilPeriod):'все периоды'} · по объектам</span></div>
  ${body}
  <div class="t-sub" style="margin-top:10px">«Выставлено нам» — для электро/воды это ОДПУ (общедомовые счётчики, кнопка «🏢 Показания ОДПУ»); для отопления это <b>себестоимость</b> (топливо + зарплата кочегара + котёл, кнопка «🔥 Котельная»). «Начислено арендаторам» — по их счётчикам. «Собрано с них» — оплачено арендаторами. «Прогноз сбора» = собрано + недобор × историческая собираемость. «Разница (ОДН/потери)» = ОДПУ − начислено арендаторам (общедомовые нужды / потери). <button class="btn ghost sm" onclick="exportUtilReport()">⤓ Экспорт CSV</button></div></div>`;
}
function exportUtilReport(){
  let out=[['Объект','Услуга','Выставлено нам','Начислено арендаторам','Собрано','Прогноз сбора','Разница (ОДН/потери)']];
  utilReportBuildings().forEach(({b,cur,hist,odpu})=>{
    const rows=utilReportRowsFor(cur,hist,odpu,b.id);
    rows.forEach(r=>out.push([b.name,r.label.replace(/^[^ ]+ /,''),r.supplier==null?'—':r.supplier,r.billed,r.collected,r.forecast,r.loss==null?'—':r.loss]));
    const s=k=>rows.reduce((a,r)=>a+(r[k]||0),0); const anyO=rows.some(r=>r.supplier!=null);
    out.push([b.name,'Итого',anyO?s('supplier'):'—',s('billed'),s('collected'),s('forecast'),anyO?(s('supplier')-s('billed')):'—']);
    const heat=heatingCostFor(b.id, utilPeriod);
    if(heat) out.push([b.name,'Отопление — себестоимость (топливо / кочегар / котёл)',heat.fuel,heat.stoker,heat.boiler,'',heat.total]);
  });
  const csv='﻿'+out.map(r=>r.map(csvCell).join(';')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='kommunalka_otchet_'+(utilPeriod||'all')+'.csv';a.click();
}
/* ---------- A4. Показания счётчиков → автосумма коммуналки ----------
   mode 'meter' — по счётчику: (тек.−пред.)×тариф; mode 'area' — по площади: площадь×тариф (₽/м²). */
// [ключ, название, ед., режим('meter'|'area'), есть_коэффициент]
const UTIL_KINDS=[['electricity','Электроэнергия','кВт·ч','meter',true],['water','Вода','м³','meter',false],['heating','Отопление','м²','area',false]];
const utilKindMode=k=>(UTIL_KINDS.find(x=>x[0]===k)||[])[3]||'meter';
function lastReading(unitId,kind,beforePeriod){
  const recs=(DB.utilities||[]).filter(u=>u.unit===unitId && u.readings && u.readings[kind] && (!beforePeriod || String(u.period)<beforePeriod))
    .sort((a,b)=>String(b.period).localeCompare(String(a.period)));
  return recs.length? (+recs[0].readings[kind].current||0) : 0;
}
function readingsModal(){
  if(!canEdit('utilities')) return;
  const def=SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id;
  const units=DB.units.filter(u=>u.building===def);
  openM(`<div class="modal-h"><h3>📟 Внести показания счётчиков</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="row2">
      <div class="field"><label>Объект</label><select id="rd-building" onchange="rdUnitsRefresh()">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Помещение</label><select id="rd-unit" onchange="rdPrefill()">${units.map(u=>`<option value="${esc(u.id)}">${esc(u.num||u.id)}${u.name?' · '+esc(u.name):''} · ${esc(u.type||'')} — ${esc(unitOccupant(u))}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Период</label><input id="rd-period" type="month" value="${utilPeriod||TODAY.toISOString().slice(0,7)}" onchange="rdPrefill()"></div>
    <div class="t-sub" style="margin-bottom:8px">Электро — (текущее − предыдущее) × коэффициент × тариф. Вода — (текущее − предыдущее) × тариф. Отопление — площадь помещения × тариф ₽/м². Тарифы и коэффициент берутся из карточки объекта/«Настроек», можно переопределить.</div>
    ${UTIL_KINDS.map(([k,label,unit,mode,coef])=>{ const cols=mode==='area'?2:(coef?4:3);
      const fields = mode==='area'
        ? `<div class="field" style="margin:0"><label>Площадь, м²</label><input id="rd-${k}-area" type="number" step="any" value="0" oninput="rdRecalc()"></div>
           <div class="field" style="margin:0"><label>Тариф ₽/м²</label><input id="rd-${k}-tar" type="number" step="any" value="0" oninput="rdRecalc()"></div>`
        : `<div class="field" style="margin:0"><label>Предыдущее</label><input id="rd-${k}-prev" type="number" step="any" value="0" oninput="rdRecalc()"></div>
           <div class="field" style="margin:0"><label>Текущее</label><input id="rd-${k}-cur" type="number" step="any" placeholder="0" oninput="rdRecalc()"></div>
           ${coef?`<div class="field" style="margin:0"><label>Коэффициент</label><input id="rd-${k}-coef" type="number" step="any" value="1" oninput="rdRecalc()"></div>`:''}
           <div class="field" style="margin:0"><label>Тариф ₽</label><input id="rd-${k}-tar" type="number" step="any" value="0" oninput="rdRecalc()"></div>`;
      return `<div class="card" style="background:var(--bg2);margin-bottom:8px"><div class="t-strong" style="margin-bottom:6px">${label} <span class="t-sub">(${unit})</span></div>
      <div class="grid" style="grid-template-columns:repeat(${cols},1fr);gap:8px">${fields}</div>
      <div class="t-sub" style="margin-top:6px">К начислению: <b id="rd-${k}-sum">0 ₽</b></div></div>`; }).join('')}
    <div class="sec-h" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><span>Дополнительные счётчики</span><span><button class="btn ghost sm" onclick="rdAddExtra('electricity')">+ Электросчётчик</button> <button class="btn ghost sm" onclick="rdAddExtra('water')">+ Водосчётчик</button></span></div>
    <div id="rd-extra-box"></div>
    <div class="sec-h" style="display:flex;justify-content:space-between"><span>Итого за период</span><b id="rd-total">0 ₽</b></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveReadings()">Создать начисление</button></div>`);
  rdPrefill();
}
function rdUnitsRefresh(){ const b=val('rd-building'); const sel=document.getElementById('rd-unit');
  sel.innerHTML=DB.units.filter(u=>u.building===b).map(u=>`<option value="${esc(u.id)}">${esc(u.num||u.id)}${u.name?' · '+esc(u.name):''} · ${esc(u.type||'')} — ${esc(unitOccupant(u))}</option>`).join(''); rdPrefill(); }
function rdPrefill(){ const unit=val('rd-unit'); const period=val('rd-period'); const bid=val('rd-building'); const u=unitOf(unit);
  UTIL_KINDS.forEach(([k,,,mode,coef])=>{ const te=document.getElementById('rd-'+k+'-tar'); if(te) te.value=buildingTariff(bid,k);
    if(coef){ const ce=document.getElementById('rd-'+k+'-coef'); if(ce) ce.value=buildingElecCoef(bid); }
    if(mode==='area'){ const ae=document.getElementById('rd-'+k+'-area'); if(ae) ae.value=Math.round(((u&&u.area)||0)*100)/100; }
    else { const pe=document.getElementById('rd-'+k+'-prev'); if(pe) pe.value=lastReading(unit,k,period); } });
  const box=document.getElementById('rd-extra-box'); if(box){ box.innerHTML='';
    const rec=DB.utilities.find(x=>x.unit===unit && x.period===period);
    if(rec&&rec.readings){ (rec.readings.electricityExtra||[]).forEach(m=>rdAddExtra('electricity',m)); (rec.readings.waterExtra||[]).forEach(m=>rdAddExtra('water',m)); } }
  rdRecalc(); }
function rdSum(k){ const tar=+val('rd-'+k+'-tar')||0;
  if(utilKindMode(k)==='area'){ const area=+val('rd-'+k+'-area')||0; return Math.max(0,Math.round(area*tar)); }
  const prev=+val('rd-'+k+'-prev')||0, cur=+val('rd-'+k+'-cur')||0;
  const ce=document.getElementById('rd-'+k+'-coef'); const coef=ce?(+ce.value||1):1;
  return Math.max(0,Math.round((cur-prev)*coef*tar)); }
let _rdSeq=0;
function rdAddExtra(kind,data){ data=data||{}; const box=document.getElementById('rd-extra-box'); if(!box)return; const isE=kind==='electricity'; const i=_rdSeq++;
  const wrap=document.createElement('div'); wrap.className='rd-extra card'; wrap.style.cssText='background:var(--bg2);margin-bottom:8px'; wrap.dataset.kind=kind; wrap.dataset.i=i;
  wrap.innerHTML=`<div style="display:flex;justify-content:flex-end;align-items:flex-end;gap:8px;margin-bottom:8px"><div class="field" style="margin:0;flex:1;min-width:0"><label>Название счётчика <span class="t-sub">(на что стоит)</span></label><input class="rd-x-name" placeholder="${isE?'напр. Электро — вход №2':'напр. Вода — санузел'}" value="${esc(data.name||'')}"></div><span class="trash" title="Удалить" onclick="this.closest('.rd-extra').remove();rdRecalc()" style="padding-bottom:9px">🗑</span></div>
  <div class="grid" style="grid-template-columns:repeat(${isE?4:3},1fr);gap:8px">
    <div class="field" style="margin:0"><label>Предыдущее</label><input class="rd-x-prev" type="number" step="any" value="${+data.prev||0}" oninput="rdRecalc()"></div>
    <div class="field" style="margin:0"><label>Текущее</label><input class="rd-x-cur" type="number" step="any" value="${data.current!=null?+data.current:''}" placeholder="0" oninput="rdRecalc()"></div>
    ${isE?`<div class="field" style="margin:0"><label>Коэффициент</label><input class="rd-x-coef" type="number" step="any" value="${data.coef!=null?+data.coef:1}" oninput="rdRecalc()"></div>`:''}
    <div class="field" style="margin:0"><label>Тариф ₽</label><input class="rd-x-tar" type="number" step="any" value="${+data.tariff||0}" oninput="rdRecalc()"></div>
  </div>
  <div class="t-sub" style="margin-top:6px">К начислению: <b class="rd-x-sum">0 ₽</b></div>`;
  box.appendChild(wrap); rdRecalc();
}
function rdExtraSumFor(kind){ let s=0; document.querySelectorAll('.rd-extra').forEach(el=>{ if(el.dataset.kind!==kind)return;
  const g=c=>{const e=el.querySelector('.'+c);return e?(+e.value||0):0;}; const coefEl=el.querySelector('.rd-x-coef'); const coef=coefEl?(+coefEl.value||1):1;
  const sum=Math.max(0,Math.round((g('rd-x-cur')-g('rd-x-prev'))*coef*g('rd-x-tar'))); const se=el.querySelector('.rd-x-sum'); if(se)se.textContent=money(sum); s+=sum; }); return s; }
function rdRecalc(){ let total=0;
  UTIL_KINDS.forEach(([k])=>{ const sum=rdSum(k); total+=sum; const se=document.getElementById('rd-'+k+'-sum'); if(se)se.textContent=money(sum); });
  total += rdExtraSumFor('electricity') + rdExtraSumFor('water');
  const te=document.getElementById('rd-total'); if(te)te.textContent=money(total); }
async function saveReadings(){ const unit=val('rd-unit'); const period=val('rd-period'); if(!unit||!period) return alert('Выберите помещение и период');
  const readings={}, amt={};
  UTIL_KINDS.forEach(([k,,,mode,coef])=>{ const tar=+val('rd-'+k+'-tar')||0; amt[k]=rdSum(k);
    readings[k]= mode==='area' ? {area:+val('rd-'+k+'-area')||0,tariff:tar} : {prev:+val('rd-'+k+'-prev')||0,current:+val('rd-'+k+'-cur')||0,tariff:tar,...(coef?{coef:+val('rd-'+k+'-coef')||1}:{})}; });
  const extra={electricity:[],water:[]};
  document.querySelectorAll('.rd-extra').forEach(el=>{ const kind=el.dataset.kind; if(kind!=='electricity'&&kind!=='water')return;
    const g=c=>{const e=el.querySelector('.'+c);return e?(+e.value||0):0;}; const nm=(el.querySelector('.rd-x-name')?.value||'').trim();
    const coefEl=el.querySelector('.rd-x-coef'); const coef=coefEl?(+coefEl.value||1):1;
    const row={name:nm,prev:g('rd-x-prev'),current:g('rd-x-cur'),tariff:g('rd-x-tar')}; if(kind==='electricity')row.coef=coef; extra[kind].push(row); });
  const exE=extra.electricity.reduce((s,m)=>s+Math.max(0,Math.round((m.current-m.prev)*(m.coef||1)*m.tariff)),0);
  const exW=extra.water.reduce((s,m)=>s+Math.max(0,Math.round((m.current-m.prev)*m.tariff)),0);
  amt.electricity+=exE; amt.water+=exW;
  if(extra.electricity.length) readings.electricityExtra=extra.electricity; if(extra.water.length) readings.waterExtra=extra.water;
  let u=DB.utilities.find(x=>x.unit===unit && x.period===period);
  if(u){ u.electricity=amt.electricity; u.water=amt.water; u.heating=amt.heating; u.readings=readings; }
  else DB.utilities.push({id:'u'+Date.now(),unit,period,electricity:amt.electricity,water:amt.water,heating:amt.heating,status:'invoiced',readings});
  closeM(); await afterStateChange();
}
/* ---------- ОДПУ: общедомовые приборы учёта + сведение «Нагорело / Собрали / Разница» ---------- */
function buildingMeter(bid,period){ return (DB.buildingMeters||[]).find(m=>m.building===bid && m.period===period)||null; }
function odpuAccrued(m){ if(!m)return null; const e=m.electricity||{},w=m.water||{},h=m.heating||{};
  return { electricity:Math.max(0,Math.round(((+e.cur||0)-(+e.prev||0))*(+e.coef||1)*(+e.tariff||0))),
    water:Math.max(0,Math.round(((+w.cur||0)-(+w.prev||0))*(+w.tariff||0))),
    heating:Math.max(0,Math.round((+h.area||0)*(+h.tariff||0))) }; }
function odpuCollected(bid,period){ const us=DB.utilities.filter(u=>unitOf(u.unit)?.building===bid && u.period===period);
  return { electricity:us.reduce((s,u)=>s+(+u.electricity||0),0), water:us.reduce((s,u)=>s+(+u.water||0),0), heating:us.reduce((s,u)=>s+(+u.heating||0),0) }; }
function odpuEntry(bid){ if(!canEdit('utilities')) return; const id=bid||(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id); if(!id) return alert('Сначала добавьте объект'); buildingMeterModal(id, utilPeriod); }
/* ---------- 🔥 Котельная: себестоимость отопления = топливо + зарплата кочегара(ов объекта) + обслуживание котла ---------- */
function heatCostRec(bid,period){ return (DB.heatCost||[]).find(h=>h.building===bid && h.period===period)||null; }
/* ---------- ⛽ ГСМ: приход + остаток → израсходовано (литры). Израсходованное автоматически = «Количество» топлива котельной ---------- */
function fuelRec(bid,period){ return (DB.fuelLog||[]).find(f=>f.building===bid && f.period===period)||null; }
// остаток на конец предыдущего периода (для авто-подстановки «остатка на начало»)
function prevFuelClosing(bid,period){
  const recs=(DB.fuelLog||[]).filter(f=>f.building===bid && String(f.period)<String(period)).sort((a,b)=>String(b.period).localeCompare(String(a.period)));
  return recs.length? (+recs[0].closing||0) : 0;
}
// приход за период = сумма поставок (журнал); поддержка старого одиночного поля purchased
function fuelPurchasedQty(f){ if(!f) return 0; if(Array.isArray(f.purchases)) return f.purchases.reduce((s,x)=>s+(+x.qty||0),0); return +f.purchased||0; }
// средневзвешенная цена закупки по поставкам месяца (для себестоимости)
function fuelAvgPrice(f){ if(!f) return 0; if(Array.isArray(f.purchases)&&f.purchases.length){ const q=fuelPurchasedQty(f); const cost=f.purchases.reduce((s,x)=>s+(+x.qty||0)*(+x.price||0),0); return q>0?cost/q:0; } return +f.fuelPrice||0; }
// израсходовано за период = остаток на начало + приход − остаток на конец + корректировка (недостача +, излишек −)
function fuelConsumed(bid,period){ const f=fuelRec(bid,period); if(!f) return null;
  const open=(f.opening!=null?+f.opening:prevFuelClosing(bid,period))||0;
  return Math.max(0, open + fuelPurchasedQty(f) - (+f.closing||0) + (+f.correction||0)); }
// зарплата кочегаров объекта за период (сотрудник с должностью «кочегар» и building===bid)
function stokerSalaryFor(bid,period){
  const stokerIds=new Set((USERS||[]).filter(u=>/кочегар/i.test(u.position||'') && u.building===bid).map(u=>u.id));
  if(!stokerIds.size) return 0;
  return (DB.salaries||[]).filter(s=>stokerIds.has(s.user_id) && (!period||s.period===period)).reduce((a,s)=>a+(+s.amount||0),0);
}
// себестоимость отопления за период (или все периоды, если period пустой)
function heatingCostFor(bid,period){
  let fuel=0,boiler=0;
  (DB.heatCost||[]).filter(h=>h.building===bid && (!period||h.period===period)).forEach(h=>{
    // если по объекту/периоду ведётся ГСМ — количество (израсходовано) и цену (средняя по поставкам) берём из него
    const f = fuelRec(h.building, h.period);
    const cons = fuelConsumed(h.building, h.period);
    const qty = cons!=null ? cons : (+h.fuelQty||0);
    const price = (f && Array.isArray(f.purchases) && f.purchases.length) ? fuelAvgPrice(f) : (+h.fuelPrice||0);
    fuel += Math.round(qty*price); boiler += (+h.boilerMaint||0);
  });
  const stoker=stokerSalaryFor(bid,period);
  const total=fuel+stoker+boiler;
  if(total===0 && !heatCostRec(bid,period) && !stoker) return null;   // данных нет → в отчёте «—»
  return {fuel,stoker,boiler,total};
}
function boilerEntry(bid){ if(!canEdit('utilities')) return; const id=bid||(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id); if(!id) return alert('Сначала добавьте объект'); boilerModal(id, utilPeriod); }
function boilerModal(bid,period){
  if(!canEdit('utilities')) return; const b=buildingOf(bid); if(!b) return;
  period=period||utilPeriod||TODAY.toISOString().slice(0,7);
  const h=heatCostRec(bid,period)||{};
  openM(`<div class="modal-h"><h3>🔥 Котельная — себестоимость отопления</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="row2">
      <div class="field"><label>Объект</label><select id="hb-building" onchange="boilerModal(this.value, document.getElementById('hb-period').value)">${buildingsList().map(x=>`<option value="${x.id}"${x.id===bid?' selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Период</label><input id="hb-period" type="month" value="${period}"></div>
    </div>
    <div class="t-sub" style="margin-bottom:8px">Себестоимость = топливо (кол-во × цена) + зарплата кочегаров этого объекта за период + обслуживание котла. Зарплата берётся из ФОТ по сотрудникам с должностью «кочегар», привязанным к объекту (поле «Объект» в карточке сотрудника).</div>
    <div class="card" style="background:var(--bg2);margin-bottom:8px"><div class="t-strong" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center"><span>Топливо</span><button class="btn ghost sm" onclick="gsmModal('${bid}',document.getElementById('hb-period').value)">⛽ ГСМ (приход/остаток)</button></div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
        ${(()=>{const cons=fuelConsumed(bid,period);return cons!=null
          ? `<div class="field" style="margin:0"><label>Кол-во (израсходовано)</label><input id="hb-qty" type="number" step="any" value="${cons}" readonly style="opacity:.7" title="Из ГСМ: остаток на начало + приход − остаток на конец"><div class="t-sub" style="margin-top:3px">⛽ авто из ГСМ</div></div>`
          : `<div class="field" style="margin:0"><label>Количество</label><input id="hb-qty" type="number" step="any" value="${+h.fuelQty||0}" oninput="hbRecalc()"></div>`;})()}
        <div class="field" style="margin:0"><label>Единица</label><input id="hb-unit" value="${esc(h.fuelUnit||'л')}" placeholder="л / т / м³"></div>
        ${(()=>{const fr=fuelRec(bid,period);const hasDl=fr&&Array.isArray(fr.purchases)&&fr.purchases.length;const avg=hasDl?Math.round(fuelAvgPrice(fr)*100)/100:(+h.fuelPrice||0);return hasDl
          ? `<div class="field" style="margin:0"><label>Цена (средняя, ₽)</label><input id="hb-price" type="number" step="any" value="${avg}" readonly style="opacity:.7" title="Средневзвешенная цена по журналу поставок ГСМ"><div class="t-sub" style="margin-top:3px">⛽ из ГСМ</div></div>`
          : `<div class="field" style="margin:0"><label>Цена за единицу, ₽</label><input id="hb-price" type="number" step="any" value="${avg}" oninput="hbRecalc()"></div>`;})()}
      </div><div class="t-sub" style="margin-top:6px">Стоимость топлива: <b id="hb-fuel">0 ₽</b></div></div>
    <div class="field"><label>Обслуживание котла за период, ₽</label><input id="hb-boiler" type="number" step="any" value="${+h.boilerMaint||0}" oninput="hbRecalc()"></div>
    <div class="doc" style="background:var(--bg2)"><div class="di">💼</div><div style="flex:1;min-width:0"><div class="t-strong">Зарплата кочегаров объекта за период</div><div class="t-sub">из ФОТ (должность «кочегар» + этот объект)</div></div><b id="hb-stoker">${money(stokerSalaryFor(bid,period))}</b></div>
    <div class="sec-h" style="display:flex;justify-content:space-between"><span>Итого себестоимость отопления</span><b id="hb-total">0 ₽</b></div>
  </div>
  <div class="modal-f">${heatCostRec(bid,period)?`<button class="btn ghost sm" onclick="delBoiler('${bid}','${period}')">🗑 Удалить</button>`:''}<div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveBoiler('${bid}')">Сохранить</button></div>`);
  hbRecalc();
}
function hbRecalc(){
  const fuel=Math.round((+val('hb-qty')||0)*(+val('hb-price')||0));
  const boiler=+val('hb-boiler')||0;
  const stoker=+(document.getElementById('hb-stoker')?.textContent||'0').replace(/[^\d]/g,'')||0;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=money(v);};
  set('hb-fuel',fuel); set('hb-total',fuel+boiler+stoker);
}
async function saveBoiler(bid){ if(!Array.isArray(DB.heatCost)) DB.heatCost=[];
  bid=val('hb-building')||bid; const period=val('hb-period'); if(!period) return alert('Укажите период');
  const data={ building:bid, period, fuelQty:+val('hb-qty')||0, fuelUnit:(val('hb-unit')||'').trim().slice(0,10), fuelPrice:+val('hb-price')||0, boilerMaint:+val('hb-boiler')||0 };
  const ex=DB.heatCost.find(h=>h.building===bid && h.period===period);
  if(ex) Object.assign(ex,data); else DB.heatCost.push({id:'hc'+Date.now(),...data});
  closeM(); await afterStateChange(); }
async function delBoiler(bid,period){ if(!confirm('Удалить данные котельной за этот период?'))return; DB.heatCost=(DB.heatCost||[]).filter(h=>!(h.building===bid && h.period===period)); closeM(); await afterStateChange(); }
/* ⛽ ГСМ: приход + остаток → израсходовано; результат автоматически идёт в «Количество» котельной */
function gsmEntry(bid){ if(!canEdit('utilities')) return; const id=bid||(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id); if(!id) return alert('Сначала добавьте объект'); gsmModal(id, utilPeriod); }
let _gsmRows=[]; // журнал поставок в текущем окне [{date,qty,price}]
function gsmModal(bid,period){
  if(!canEdit('utilities')) return; const b=buildingOf(bid); if(!b) return;
  period=period||utilPeriod||TODAY.toISOString().slice(0,7);
  const f=fuelRec(bid,period)||{};
  const openDef = f.opening!=null ? +f.opening : prevFuelClosing(bid,period);
  // журнал поставок из записи (или миграция старого одиночного «приход» в одну строку)
  _gsmRows = Array.isArray(f.purchases) ? f.purchases.map(x=>({date:x.date||'',qty:+x.qty||0,price:+x.price||0}))
    : ((+f.purchased>0)?[{date:'',qty:+f.purchased||0,price:+f.fuelPrice||0}]:[]);
  openM(`<div class="modal-h"><h3>⛽ ГСМ — учёт топлива</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="row2">
      <div class="field"><label>Объект</label><select id="gs-building" onchange="gsmModal(this.value, document.getElementById('gs-period').value)">${buildingsList().map(x=>`<option value="${x.id}"${x.id===bid?' selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Период</label><input id="gs-period" type="month" value="${period}" onchange="gsmModal(document.getElementById('gs-building').value, this.value)"></div>
    </div>
    <div class="t-sub" style="margin-bottom:8px">Израсходовано = остаток на начало + приход (по журналу поставок) − остаток на конец. Это количество и средняя цена поставок автоматически идут в котельную для расчёта себестоимости.</div>
    <div class="sec-h" style="display:flex;justify-content:space-between;align-items:center;margin-top:0"><span>📒 Поставки за ${fmtPeriod(period)}</span><span><button class="btn ghost sm" onclick="fuelJournalModal('${bid}')">📖 Журнал</button> <button class="btn ghost sm" onclick="gsmAddRow()">+ Поставка</button></span></div>
    <div id="gs-rows"></div>
    <div class="t-sub" style="margin:4px 0 10px">Приход всего: <b id="gs-purchtot">0 л</b> · средняя цена: <b id="gs-avg">0 ₽/л</b></div>
    <div class="sec-h" style="margin-top:0">Сверка остатков</div>
    <div class="row2">
      <div class="field"><label>Остаток на начало (л) <span class="t-sub">факт (замер)</span></label><input id="gs-open" type="number" step="any" value="${openDef}" oninput="gsRecalc()"></div>
      <div class="field"><label>Остаток на конец месяца (л) <span class="t-sub">факт (замер)</span></label><input id="gs-close" type="number" step="any" value="${+f.closing||0}" oninput="gsRecalc()"></div>
    </div>
    <div class="t-sub" id="gs-reconc" data-prev="${prevFuelClosing(bid,period)}" style="margin-bottom:8px"></div>
    <div class="field"><label>Корректировка расхода (±л) <span class="t-sub">недостача +, излишек −; для списания потерь/сверки</span></label><input id="gs-corr" type="number" step="any" value="${+f.correction||0}" oninput="gsRecalc()"></div>
    <div class="sec-h" style="display:flex;justify-content:space-between"><span>Израсходовано за месяц</span><b id="gs-cons">0 л</b></div>
    <div class="t-sub" id="gs-formula"></div>
  </div>
  <div class="modal-f">${fuelRec(bid,period)?`<button class="btn ghost sm" onclick="delGsm('${bid}','${period}')">🗑 Удалить</button>`:''}<div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveGsm('${bid}')">Сохранить</button></div>`);
  renderGsmRows(); gsRecalc();
}
// читаем строки поставок прямо из полей (надёжно, без зависимости от inline-переменных)
function gsReadRows(){ return [...document.querySelectorAll('#gs-rows .gs-row')].map(el=>({
  date: el.querySelector('.gs-d')?.value||'',
  qty: +el.querySelector('.gs-q')?.value||0,
  price: +el.querySelector('.gs-p')?.value||0 })); }
function renderGsmRows(){ const box=document.getElementById('gs-rows'); if(!box) return;
  box.innerHTML = _gsmRows.length ? _gsmRows.map((r,i)=>`<div class="gs-row" style="display:grid;grid-template-columns:1.1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px">
    <div class="field" style="margin:0"><label class="t-sub">Дата</label><input class="gs-d" type="date" value="${esc(r.date||'')}"></div>
    <div class="field" style="margin:0"><label class="t-sub">Кол-во, л</label><input class="gs-q" type="number" step="any" value="${r.qty||0}" oninput="gsRecalc()"></div>
    <div class="field" style="margin:0"><label class="t-sub">Цена, ₽/л</label><input class="gs-p" type="number" step="any" value="${r.price||0}" oninput="gsRecalc()"></div>
    <button class="btn ghost sm" style="height:38px" onclick="gsmDelRow(${i})" title="Удалить поставку">🗑</button></div>`).join('')
    : '<div class="empty" style="padding:10px">Поставок пока нет — нажмите «+ Поставка».</div>';
}
function gsmAddRow(){ _gsmRows=gsReadRows(); _gsmRows.push({date:TODAY.toISOString().slice(0,10),qty:0,price:0}); renderGsmRows(); gsRecalc(); }
function gsmDelRow(i){ _gsmRows=gsReadRows(); _gsmRows.splice(i,1); renderGsmRows(); gsRecalc(); }
function gsRecalc(){ const o=+val('gs-open')||0, c=+val('gs-close')||0, corr=+val('gs-corr')||0; const rows=gsReadRows();
  const p=rows.reduce((s,r)=>s+(+r.qty||0),0);
  const cost=rows.reduce((s,r)=>s+(+r.qty||0)*(+r.price||0),0);
  const avg=p>0?Math.round(cost/p*100)/100:0; const avail=o+p; const cons=Math.max(0,o+p-c+corr);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('gs-purchtot',fmt(p)+' л'); set('gs-avg',fmt(avg)+' ₽/л'); set('gs-cons',fmt(cons)+' л');
  // сверка: расчётный остаток на начало (из прошлого месяца) против указанного факта
  const rec=document.getElementById('gs-reconc'); if(rec){ const prev=+rec.dataset.prev||0; const d=Math.round((o-prev)*100)/100;
    rec.innerHTML=`Доступно (начало + приход): <b>${fmt(avail)} л</b>. Расчётный остаток на начало (из прошлого месяца): ${fmt(prev)} л`+(d!==0?` · <span style="color:var(--amber)">расхождение ${d>0?'+':''}${fmt(d)} л</span> — учтено как корректировка начального остатка`:` · ✓ совпадает`); }
  const fm=document.getElementById('gs-formula'); if(fm) fm.innerHTML=`${fmt(o)} (начало) + ${fmt(p)} (приход) − ${fmt(c)} (конец)${corr?(corr>0?' + '+fmt(corr)+' (недостача)':' − '+fmt(-corr)+' (излишек)'):''} = <b>${fmt(cons)} л</b> израсходовано · средняя цена <b>${fmt(avg)} ₽/л</b> → в котельную`; }
async function saveGsm(bid){ if(!Array.isArray(DB.fuelLog)) DB.fuelLog=[];
  bid=val('gs-building')||bid; const period=val('gs-period'); if(!period) return alert('Укажите период');
  const purchases=gsReadRows().filter(r=>(+r.qty||0)>0).map(r=>({date:r.date||'',qty:+r.qty||0,price:+r.price||0}));
  const ex=DB.fuelLog.find(f=>f.building===bid && f.period===period);
  if(ex){ ex.opening=+val('gs-open')||0; ex.closing=+val('gs-close')||0; ex.correction=+val('gs-corr')||0; ex.purchases=purchases; delete ex.purchased; delete ex.fuelPrice; }
  else DB.fuelLog.push({id:'fl'+Date.now(),building:bid,period,opening:+val('gs-open')||0,closing:+val('gs-close')||0,correction:+val('gs-corr')||0,purchases});
  closeM(); await afterStateChange(); }
async function delGsm(bid,period){ if(!confirm('Удалить запись ГСМ за этот период?'))return; DB.fuelLog=(DB.fuelLog||[]).filter(f=>!(f.building===bid && f.period===period)); closeM(); await afterStateChange(); }
// 📖 Журнал всех поставок топлива по объекту (все периоды)
function fuelJournalModal(bid){ const b=buildingOf(bid); if(!b) return; const ed=canEdit('utilities');
  // разворачиваем поставки из всех записей ГСМ объекта в единый список (с ссылкой период+индекс — для правки/удаления)
  const items=[];
  (DB.fuelLog||[]).filter(f=>f.building===bid).forEach(f=>{
    (Array.isArray(f.purchases)?f.purchases:[]).forEach((p,pidx)=>items.push({period:f.period,pidx,date:p.date||'',qty:+p.qty||0,price:+p.price||0}));
  });
  items.sort((a,b)=>String(b.date||b.period).localeCompare(String(a.date||a.period)));
  const totQty=items.reduce((s,x)=>s+x.qty,0), totCost=items.reduce((s,x)=>s+x.qty*x.price,0);
  const cols=ed?6:5;
  const rows=items.map(x=>`<tr><td class="t-sub">${fmtPeriod(x.period)}</td><td>${x.date?fmtD(x.date):'—'}</td><td>${fmt(x.qty)} л</td><td>${fmt(x.price)} ₽/л</td><td class="t-strong">${money(x.qty*x.price)}</td>${ed?`<td style="white-space:nowrap"><button class="btn ghost sm" title="Изменить" onclick="fuelDeliveryEdit('${bid}','${x.period}',${x.pidx})">✎</button> <button class="btn ghost sm" title="Удалить" onclick="delFuelDelivery('${bid}','${x.period}',${x.pidx})">🗑</button></td>`:''}</tr>`).join('');
  openM(`<div class="modal-h"><h3>📖 Журнал поставок топлива — ${esc(b.name)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-sub" style="margin-bottom:8px">Все поставки по объекту за всё время. Средняя цена — средневзвешенная по всем поставкам.${ed?' Можно изменить (✎) или удалить (🗑) любую запись.':''}</div>
    <div style="overflow-x:auto"><table><thead><tr><th>Период</th><th>Дата</th><th>Количество</th><th>Цена</th><th>Сумма</th>${ed?'<th></th>':''}</tr></thead><tbody>
    ${rows||`<tr><td colspan="${cols}" class="empty">Поставок пока нет</td></tr>`}
    ${items.length?`<tr style="border-top:2px solid var(--line2)"><td class="t-strong" colspan="2">Итого</td><td class="t-strong">${fmt(totQty)} л</td><td class="t-strong">${totQty>0?fmt(Math.round(totCost/totQty*100)/100):0} ₽/л</td><td class="t-strong">${money(totCost)}</td>${ed?'<td></td>':''}</tr>`:''}
    </tbody></table></div>
  </div>
  <div class="modal-f"><div class="spacer"></div><button class="btn" onclick="gsmModal('${bid}', utilPeriod)">← Назад к ГСМ</button></div>`);
}
// удалить одну поставку из журнала (запись период+индекс)
async function delFuelDelivery(bid,period,pidx){ if(!canEdit('utilities'))return;
  const f=(DB.fuelLog||[]).find(x=>x.building===bid && x.period===period); if(!f||!Array.isArray(f.purchases)||!f.purchases[pidx])return;
  const p=f.purchases[pidx];
  if(!confirm(`Удалить поставку ${p.date?fmtD(p.date):''} — ${fmt(+p.qty||0)} л по ${fmt(+p.price||0)} ₽/л?`))return;
  f.purchases.splice(pidx,1);
  await afterStateChange(); fuelJournalModal(bid);
}
// изменить одну поставку из журнала — компактное окно даты/кол-ва/цены
function fuelDeliveryEdit(bid,period,pidx){ if(!canEdit('utilities'))return; const b=buildingOf(bid); if(!b)return;
  const f=(DB.fuelLog||[]).find(x=>x.building===bid && x.period===period); if(!f||!Array.isArray(f.purchases)||!f.purchases[pidx])return;
  const p=f.purchases[pidx];
  openM(`<div class="modal-h"><h3>Изменить поставку — ${esc(b.name)}, ${fmtPeriod(period)}</h3><span class="x" onclick="fuelJournalModal('${bid}')">×</span></div>
  <div class="modal-b">
    <div class="field"><label>Дата поставки</label><input id="fd-date" type="date" value="${esc(p.date||'')}"></div>
    <div class="row2">
      <div class="field"><label>Количество, л</label><input id="fd-qty" type="number" step="any" value="${+p.qty||0}"></div>
      <div class="field"><label>Цена, ₽/л</label><input id="fd-price" type="number" step="any" value="${+p.price||0}"></div>
    </div>
  </div>
  <div class="modal-f"><button class="btn ghost sm" onclick="delFuelDelivery('${bid}','${period}',${pidx})">🗑 Удалить</button><div class="spacer"></div><button class="btn ghost" onclick="fuelJournalModal('${bid}')">Отмена</button><button class="btn" onclick="saveFuelDelivery('${bid}','${period}',${pidx})">Сохранить</button></div>`);
}
async function saveFuelDelivery(bid,period,pidx){ if(!canEdit('utilities'))return;
  const f=(DB.fuelLog||[]).find(x=>x.building===bid && x.period===period); if(!f||!Array.isArray(f.purchases)||!f.purchases[pidx])return;
  f.purchases[pidx]={date:val('fd-date')||'',qty:+val('fd-qty')||0,price:+val('fd-price')||0};
  await afterStateChange(); fuelJournalModal(bid);
}
function odpuSummary(bid,period){
  const ed=canEdit('utilities');
  const entryBtn = ed?`<button class="btn ghost sm" style="margin-top:6px" onclick="odpuEntry('${bid}')">🏢 Внести / изменить показания ОДПУ</button>`:'';
  if(!period) return `<div class="t-sub" style="padding:6px 0">Сведение «нагорело / собрали / разница» считается за конкретный период — выберите месяц вверху страницы. Внести показания дома можно и сейчас (период указывается в окне):</div>${entryBtn}`;
  const m=buildingMeter(bid,period); const acc=odpuAccrued(m); const col=odpuCollected(bid,period);
  const rows=[['electricity','Электроэнергия'],['water','Вода'],['heating','Отопление']].map(([k,l])=>{
    const a=acc?acc[k]:null; const c=col[k]||0; const diff=(a==null)?null:(a-c);
    return `<tr><td class="t-strong">${l}</td><td>${a==null?'—':money(a)}</td><td>${money(c)}</td><td${diff!=null&&diff!==0?` style="color:var(--amber)"`:''}>${diff==null?'—':money(diff)}</td></tr>`;
  }).join('');
  const totA=acc?(acc.electricity+acc.water+acc.heating):null, totC=col.electricity+col.water+col.heating;
  return `<table><thead><tr><th>Ресурс</th><th>Нагорело (ОДПУ)</th><th>Собрали (с помещений)</th><th>Разница</th></tr></thead><tbody>${rows}
    <tr style="border-top:2px solid var(--line2)"><td class="t-strong">Итого</td><td><b>${totA==null?'—':money(totA)}</b></td><td><b>${money(totC)}</b></td><td><b${totA!=null&&(totA-totC)!==0?` style="color:var(--amber)"`:''}>${totA==null?'—':money(totA-totC)}</b></td></tr></tbody></table>
    <div class="t-sub" style="margin-top:6px">«Разница» — общедомовые нужды / потери (показания дома минус сумма по всем помещениям, включая собственников). ${entryBtn}</div>`;
}
function buildingMeterModal(bid,period){
  if(!canEdit('utilities')) return; const b=buildingOf(bid); if(!b) return;
  period=period||utilPeriod||TODAY.toISOString().slice(0,7);
  const m=buildingMeter(bid,period);
  const totalArea=Math.round(DB.units.filter(u=>u.building===bid).reduce((s,u)=>s+(+u.area||0),0)*100)/100;
  const e=(m&&m.electricity)||{}, w=(m&&m.water)||{}, h=(m&&m.heating)||{};
  openM(`<div class="modal-h"><h3>🏢 Показания общедомовых счётчиков (ОДПУ)</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="row2">
      <div class="field"><label>Объект</label><select id="bm-building" onchange="buildingMeterModal(this.value, document.getElementById('bm-period').value)">${buildingsList().map(x=>`<option value="${x.id}"${x.id===bid?' selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Период</label><input id="bm-period" type="month" value="${period}"></div>
    </div>
    <div class="t-sub" style="margin-bottom:8px">Показания общедомовых приборов учёта. «Нагорело» сравнивается с суммой по помещениям, разница — общедомовые нужды.</div>
    <div class="card" style="background:var(--bg2);margin-bottom:8px"><div class="t-strong" style="margin-bottom:6px">Электроэнергия <span class="t-sub">(кВт·ч)</span></div>
      <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:8px">
        <div class="field" style="margin:0"><label>Предыдущее</label><input id="bm-e-prev" type="number" step="any" value="${+e.prev||0}" oninput="bmRecalc()"></div>
        <div class="field" style="margin:0"><label>Текущее</label><input id="bm-e-cur" type="number" step="any" value="${+e.cur||0}" oninput="bmRecalc()"></div>
        <div class="field" style="margin:0"><label>Коэффициент</label><input id="bm-e-coef" type="number" step="any" value="${+e.coef||buildingElecCoef(bid)}" oninput="bmRecalc()"></div>
        <div class="field" style="margin:0"><label>Тариф ₽</label><input id="bm-e-tar" type="number" step="any" value="${+e.tariff||buildingTariff(bid,'electricity')}" oninput="bmRecalc()"></div>
      </div><div class="t-sub" style="margin-top:6px">Нагорело: <b id="bm-e-sum">0 ₽</b></div></div>
    <div class="card" style="background:var(--bg2);margin-bottom:8px"><div class="t-strong" style="margin-bottom:6px">Вода <span class="t-sub">(м³)</span></div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="field" style="margin:0"><label>Предыдущее</label><input id="bm-w-prev" type="number" step="any" value="${+w.prev||0}" oninput="bmRecalc()"></div>
        <div class="field" style="margin:0"><label>Текущее</label><input id="bm-w-cur" type="number" step="any" value="${+w.cur||0}" oninput="bmRecalc()"></div>
        <div class="field" style="margin:0"><label>Тариф ₽</label><input id="bm-w-tar" type="number" step="any" value="${+w.tariff||buildingTariff(bid,'water')}" oninput="bmRecalc()"></div>
      </div><div class="t-sub" style="margin-top:6px">Нагорело: <b id="bm-w-sum">0 ₽</b></div></div>
    <div class="card" style="background:var(--bg2);margin-bottom:8px"><div class="t-strong" style="margin-bottom:6px">Отопление <span class="t-sub">(м²)</span></div>
      <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:8px">
        <div class="field" style="margin:0"><label>Площадь дома, м²</label><input id="bm-h-area" type="number" step="any" value="${+h.area||totalArea||0}" oninput="bmRecalc()"></div>
        <div class="field" style="margin:0"><label>Тариф ₽/м²</label><input id="bm-h-tar" type="number" step="any" value="${+h.tariff||buildingTariff(bid,'heating')}" oninput="bmRecalc()"></div>
      </div><div class="t-sub" style="margin-top:6px">Нагорело: <b id="bm-h-sum">0 ₽</b></div></div>
    <div class="sec-h" style="display:flex;justify-content:space-between"><span>Всего нагорело по дому</span><b id="bm-total">0 ₽</b></div>
  </div>
  <div class="modal-f">${m?`<button class="btn ghost sm" onclick="delBuildingMeter('${bid}','${period}')">🗑 Удалить</button>`:''}<div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveBuildingMeter('${bid}')">Сохранить</button></div>`);
  bmRecalc();
}
function bmRecalc(){
  const e=Math.max(0,Math.round(((+val('bm-e-cur')||0)-(+val('bm-e-prev')||0))*(+val('bm-e-coef')||1)*(+val('bm-e-tar')||0)));
  const w=Math.max(0,Math.round(((+val('bm-w-cur')||0)-(+val('bm-w-prev')||0))*(+val('bm-w-tar')||0)));
  const h=Math.max(0,Math.round((+val('bm-h-area')||0)*(+val('bm-h-tar')||0)));
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=money(v);};
  set('bm-e-sum',e);set('bm-w-sum',w);set('bm-h-sum',h);set('bm-total',e+w+h);
}
async function saveBuildingMeter(bid){ if(!Array.isArray(DB.buildingMeters)) DB.buildingMeters=[];
  bid=val('bm-building')||bid; const period=val('bm-period'); if(!period) return alert('Укажите период');
  const data={ building:bid, period,
    electricity:{prev:+val('bm-e-prev')||0,cur:+val('bm-e-cur')||0,coef:+val('bm-e-coef')||1,tariff:+val('bm-e-tar')||0},
    water:{prev:+val('bm-w-prev')||0,cur:+val('bm-w-cur')||0,tariff:+val('bm-w-tar')||0},
    heating:{area:+val('bm-h-area')||0,tariff:+val('bm-h-tar')||0} };
  const ex=DB.buildingMeters.find(m=>m.building===bid && m.period===period);
  if(ex) Object.assign(ex,data); else DB.buildingMeters.push({id:'bm'+Date.now(),...data});
  closeM(); await afterStateChange();
}
async function delBuildingMeter(bid,period){ if(!confirm('Удалить показания ОДПУ за этот период?'))return;
  DB.buildingMeters=(DB.buildingMeters||[]).filter(m=>!(m.building===bid && m.period===period)); closeM(); await afterStateChange(); }
const EX_STATUS=[['planned','План'],['invoiced','Выставлен (счёт получен)'],['paid','Оплачено'],['overdue','Просрочен']];
function expenseEdit(id){ const e=DB.expenses.find(x=>x.id===id); if(!e||!canEdit('utilities'))return; const b=buildingOf(e.building);
  openM(`<div class="modal-h"><h3>Расход на содержание</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-sub" style="margin-bottom:10px">Объект: ${esc(b?b.name:e.building||'—')}${e.period?' · '+fmtPeriod(e.period):''}</div>
    <div class="row2"><div class="field"><label>Категория</label><input id="ee-cat" list="catList2" value="${esc(e.category||'')}"><datalist id="catList2">${(stg().expenseCats||[]).map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Сумма, ₽</label><input id="ee-amt" type="number" value="${e.amount||0}"></div></div>
    <div class="row2"><div class="field"><label>Подрядчик</label><input id="ee-vendor" value="${esc(e.vendor||'')}"></div>
      <div class="field"><label>Статус</label><select id="ee-status">${EX_STATUS.map(([k,l])=>`<option value="${k}"${e.status===k?' selected':''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label>Назначение <span class="t-sub">на что потрачено</span></label><input id="ee-note" value="${esc(e.note||'')}" placeholder="напр. ремонт кровли, замена насоса"></div>
    <div class="row2"><div class="field"><label>Дата оплаты <span class="t-sub">(если оплачено)</span></label><input id="ee-date" type="date" value="${e.paidDate||''}"></div>
      <div class="field"><label>Способ оплаты</label><select id="ee-method">${payMethodOpts(e.method||'bank')}</select></div></div>
    <div class="t-sub">«Оплачено» — расход проведён (попадёт в факт бюджета и сверку с банком). Статусы: План → Выставлен → Оплачено.</div>
  </div>
  <div class="modal-f"><button class="btn ghost sm" onclick="delExpense('${id}')">🗑 Удалить</button><div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveExpenseEdit('${id}')">Сохранить</button></div>`);
}
async function saveExpenseEdit(id){ const e=DB.expenses.find(x=>x.id===id); if(!e)return;
  e.category=val('ee-cat').trim()||e.category; e.amount=+val('ee-amt')||0; e.vendor=val('ee-vendor').trim(); e.note=val('ee-note').trim(); e.status=val('ee-status');
  if(e.status==='paid'){ e.paidDate=val('ee-date')||TODAY.toISOString().slice(0,10); e.method=val('ee-method'); }
  else { e.paidDate=val('ee-date')||null; }
  closeM(); await afterStateChange(); }
async function delExpense(id){ if(!confirm('Удалить этот расход?'))return; DB.expenses=DB.expenses.filter(x=>x.id!==id); closeM(); await afterStateChange(); }
function utilEdit(id){ const u=DB.utilities.find(x=>x.id===id); if(!u||!canEdit('utilities'))return;
  openM(`<div class="modal-h"><h3>Коммунальные начисления — ${esc(u.unit)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="row2"><div class="field"><label>Электроэнергия, ₽</label><input id="ue-el" type="number" value="${u.electricity||0}"></div>
      <div class="field"><label>Вода, ₽</label><input id="ue-wt" type="number" value="${u.water||0}"></div></div>
    <div class="row2"><div class="field"><label>Отопление, ₽</label><input id="ue-ht" type="number" value="${u.heating||0}"></div>
      <div class="field"><label>Статус</label><select id="ue-status">${EX_STATUS.map(([k,l])=>`<option value="${k}"${u.status===k?' selected':''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label>Дата оплаты <span class="t-sub">(если оплачено)</span></label><input id="ue-date" type="date" value="${u.paidDate||''}"></div>
  </div>
  <div class="modal-f"><button class="btn ghost sm" onclick="delUtil('${id}')">🗑 Удалить</button><div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveUtilEdit('${id}')">Сохранить</button></div>`);
}
async function saveUtilEdit(id){ const u=DB.utilities.find(x=>x.id===id); if(!u)return;
  u.electricity=+val('ue-el')||0; u.water=+val('ue-wt')||0; u.heating=+val('ue-ht')||0; u.status=val('ue-status');
  u.paidDate=(u.status==='paid')?(val('ue-date')||TODAY.toISOString().slice(0,10)):(val('ue-date')||null);
  closeM(); await afterStateChange(); }
async function delUtil(id){ if(!confirm('Удалить это начисление?'))return; DB.utilities=DB.utilities.filter(x=>x.id!==id); closeM(); await afterStateChange(); }

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
async function advanceTask(id){const t=TASKS.find(t=>t.id===id);if(!t)return;const next=t.status==='open'?'in_progress':'done';
  try{ await api('/api/tasks/'+id,'PATCH',{status:next}); await reloadTasks(); render(); }catch(e){alert(e.message);} }
async function reloadTasks(){ TASKS=await api('/api/tasks'); }

/* ============================================================
   ЗАЯВКИ НА ОБСЛУЖИВАНИЕ (эксплуатация по объектам)
   ============================================================ */
const REQ_CATS=['Сантехника','Электрика','Климат / вентиляция','Лифт','Клининг','Двери / замки','Отделка / ремонт','Безопасность','Прочее'];
const sRequests=()=>(DB.requests||[]).filter(r=>SCOPE==='all'||r.building===SCOPE);
const reqOpen=r=>r.status==='new'||r.status==='in_progress';
function reqStatusPill(s){const m={new:['gray','Новая'],in_progress:['amber','В работе'],done:['green','Выполнена'],rejected:['red','Отклонена']};const x=m[s]||['gray',s];return `<span class="pill ${x[0]}">${x[1]}</span>`;}
function requests(){
  const list=sRequests();
  const open=list.filter(reqOpen); const overdue=open.filter(r=>daysLeft(r.due)<0);
  el(head('Заявки на обслуживание',`${open.length} активных · просрочено: ${overdue.length} · ${scopeSub()}`,
    canEdit('requests')?`<button class="btn" onclick="requestModal()">+ Заявка</button>`:'')+
  `<div class="grid" style="grid-template-columns:repeat(3,1fr)" id="reqboard"></div><div id="reqRej"></div>`);
  const cols=[['new','Новые','var(--muted2)'],['in_progress','В работе','var(--accent)'],['done','Выполнено','var(--green)']];
  document.getElementById('reqboard').innerHTML=cols.map(([k,label,color])=>{
    const items=list.filter(r=>r.status===k);
    return `<div class="card"><div class="panel-title"><h3><span class="dot" style="background:${color}"></span>${label}</h3><span class="muted">${items.length}</span></div>
    ${items.map(reqCard).join('')||'<div class="empty">Пусто</div>'}</div>`;
  }).join('');
  const rej=list.filter(r=>r.status==='rejected');
  document.getElementById('reqRej').innerHTML=rej.length?`<div class="card" style="margin-top:14px"><div class="sec-h">Отклонённые (${rej.length})</div>${rej.map(reqCard).join('')}</div>`:'';
}
function reqCard(r){
  const u=userOf(r.assignee_id); const t=r.tenant&&tenantOf(r.tenant); const b=buildingOf(r.building);
  const dl=daysLeft(r.due), cls=reqOpen(r)&&dl<0?'overdue':(reqOpen(r)&&dl<=3?'soon':'');
  return `<div class="task-card ${cls}">
    <div class="t-strong" style="margin-bottom:6px;cursor:pointer" onclick="requestInfo('${r.id}')">${esc(r.title)}</div>
    <div class="t-sub" style="margin-bottom:5px">🏢 ${esc(b?b.name:r.building)}${r.unit?' · 📍 '+esc(unitNum(r.unit)):''}${t?' · 👤 '+esc(t.name):''}</div>
    <div class="t-sub" style="margin-bottom:8px">🛠 ${esc(r.category||'—')} · ${esc(u?u.full_name:'не назначен')}</div>
    <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">${prioPill(r.priority)}<span class="t-sub">${r.status==='done'?'<span style="color:var(--green)">✓ '+(r.done_at?fmtD(r.done_at):'выполнено')+'</span>':(r.status==='rejected'?'отклонена':dueLabel(r.due))}</span></div>
    ${canEdit('requests')&&reqOpen(r)?`<button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="advanceRequest('${r.id}')">${r.status==='new'?'→ В работу':'✓ Выполнено'}</button>`:''}
  </div>`;
}
function requestModal(id){
  const r=id?(DB.requests||[]).find(x=>x.id===id):null;
  const def=r?r.building:(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id);
  const unitOpts=b=>DB.units.filter(u=>u.building===b).map(u=>`<option value="${esc(u.id)}"${r&&r.unit===u.id?' selected':''}>${esc(u.num||u.id)}</option>`).join('');
  const usr=USERS.filter(u=>u.active);
  openM(`<div class="modal-h"><h3>${r?'Заявка':'Новая заявка'}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="field"><label>Заголовок</label><input id="rq-title" value="${r?esc(r.title):''}" placeholder="Что случилось"></div>
    <div class="row2">
      <div class="field"><label>Объект</label><select id="rq-building" onchange="reqUnitsRefresh()">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Помещение</label><select id="rq-unit"><option value="">— не указано —</option>${unitOpts(def)}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>Тип</label><select id="rq-cat">${REQ_CATS.map(c=>`<option${r&&r.category===c?' selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Приоритет</label><select id="rq-prio">${[['high','Высокий'],['medium','Средний'],['low','Низкий']].map(([k,l])=>`<option value="${k}"${(r?r.priority:'medium')===k?' selected':''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>Исполнитель</label><select id="rq-assignee"><option value="">— не назначен —</option>${usr.map(u=>`<option value="${u.id}"${r&&r.assignee_id===u.id?' selected':''}>${esc(u.full_name)} — ${esc(u.roleTitle)}</option>`).join('')}</select></div>
      <div class="field"><label>Срок</label><input id="rq-due" type="date" value="${r&&r.due?r.due:''}"></div>
    </div>
    <div class="field"><label>Описание</label><textarea id="rq-note" rows="3" class="search" style="width:100%;resize:vertical;font-family:inherit">${r?esc(r.note||''):''}</textarea></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveRequest(${r?`'${r.id}'`:''})">${r?'Сохранить':'Создать'}</button></div>`);
}
function reqUnitsRefresh(){ const b=val('rq-building'); const sel=document.getElementById('rq-unit');
  sel.innerHTML='<option value="">— не указано —</option>'+DB.units.filter(u=>u.building===b).map(u=>`<option value="${esc(u.id)}">${esc(u.num||u.id)}</option>`).join(''); }
async function saveRequest(id){
  const title=val('rq-title').trim(); if(!title) return alert('Укажите заголовок заявки');
  ensureState();
  const data={ building:val('rq-building'), unit:val('rq-unit')||null, category:val('rq-cat'), title,
    priority:val('rq-prio'), assignee_id:+val('rq-assignee')||null, due:val('rq-due')||null, note:val('rq-note').trim() };
  if(id){ const r=DB.requests.find(x=>x.id===id); if(r) Object.assign(r,data); }
  else { DB.requests.unshift({ id:'r'+Date.now(), ...data, tenant:null, status:'new', created_by:ME.id, created_at:new Date().toISOString(), done_at:null }); }
  closeM(); await afterStateChange();
}
async function advanceRequest(id){ const r=(DB.requests||[]).find(x=>x.id===id); if(!r)return;
  r.status = r.status==='new'?'in_progress':'done';
  if(r.status==='done') r.done_at=new Date().toISOString();
  await afterStateChange(); }
async function rejectRequest(id){ if(!confirm('Отклонить заявку?'))return; const r=(DB.requests||[]).find(x=>x.id===id); if(r)r.status='rejected'; closeM(); await afterStateChange(); }
async function delRequest(id){ if(!confirm('Удалить заявку?'))return; DB.requests=(DB.requests||[]).filter(x=>x.id!==id); closeM(); await afterStateChange(); }
function requestInfo(id){
  const r=(DB.requests||[]).find(x=>x.id===id); if(!r)return;
  const u=userOf(r.assignee_id); const t=r.tenant&&tenantOf(r.tenant); const b=buildingOf(r.building); const ed=canEdit('requests');
  const row=(k,v)=>`<div class="row"><span>${k}</span><b>${v}</b></div>`;
  openM(`<div class="modal-h"><h3>Заявка на обслуживание</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-strong" style="font-size:16px;margin-bottom:10px">${esc(r.title)}</div>
    ${row('Статус',reqStatusPill(r.status))}
    ${row('Объект',esc(b?b.name:r.building))}
    ${r.unit?row('Помещение',esc(unitNum(r.unit))):''}
    ${t?row('Арендатор',esc(t.name)):''}
    ${row('Тип',esc(r.category||'—'))}
    ${row('Приоритет',prioWord(r.priority))}
    ${row('Исполнитель',esc(u?u.full_name:'не назначен'))}
    ${row('Срок',r.due?fmtD(r.due):'—')}
    ${row('Создана',fmtDateTime(r.created_at))}
    ${r.done_at?row('Выполнена',fmtDateTime(r.done_at)):''}
    ${r.note?`<div style="margin-top:8px"><div class="t-sub" style="margin-bottom:4px">Описание</div><div>${esc(r.note)}</div></div>`:''}
  </div>
  <div class="modal-f">
    ${ed?`<button class="btn ghost sm" onclick="requestModal('${r.id}')">Редактировать</button>
      ${reqOpen(r)?`<button class="btn ghost sm" onclick="rejectRequest('${r.id}')">Отклонить</button>`:''}
      <button class="btn ghost sm" onclick="delRequest('${r.id}')">🗑</button>`:''}
    <div class="spacer"></div>
    ${ed&&reqOpen(r)?`<button class="btn" onclick="advanceRequest('${r.id}');closeM()">${r.status==='new'?'→ В работу':'✓ Выполнено'}</button>`:'<button class="btn ghost" onclick="closeM()">Закрыть</button>'}
  </div>`);
}

/* ============================================================
   ПЛАНОВОЕ ТО ОБОРУДОВАНИЯ
   ============================================================ */
const EQUIP_TYPES=['Лифт','Вентиляция / кондиционирование','Пожарная сигнализация','Система отопления','Электрощитовая','Водоснабжение','Видеонаблюдение','Системы доступа','Прочее'];
function addMonths(dateStr,m){ const d=new Date(dateStr); if(isNaN(d))return ''; d.setMonth(d.getMonth()+(+m||0)); return d.toISOString().slice(0,10); }
function upkeepStatus(eq){ const dl=daysLeft(eq.nextService); if(eq.nextService==null||dl===9999) return ['gray','Не задано','—']; if(dl<0) return ['red','Просрочено',`${-dl} дн назад`]; if(dl<=30) return ['amber','Скоро',`через ${dl} дн`]; return ['green','В графике',`через ${dl} дн`]; }
const sEquip=()=>(DB.equipment||[]).filter(e=>SCOPE==='all'||e.building===SCOPE);
function upkeep(){
  const list=sEquip().slice().sort((a,b)=>String(a.nextService||'9999').localeCompare(String(b.nextService||'9999')));
  const overdue=list.filter(e=>daysLeft(e.nextService)<0).length;
  const soon=list.filter(e=>{const d=daysLeft(e.nextService);return d>=0&&d<=30;}).length;
  const ed=canEdit('upkeep');
  el(head('Плановое ТО оборудования',`${list.length} ед. · просрочено: ${overdue} · в ближайшие 30 дн: ${soon} · ${scopeSub()}`,
    ed?`<button class="btn" onclick="equipModal()">+ Оборудование</button>`:'')+
  `<div class="card" style="padding:0;overflow-x:auto"><table><thead><tr><th>Оборудование</th><th>Объект</th><th>Тип</th><th>Подрядчик</th><th>Интервал</th><th>Последнее ТО</th><th>Следующее ТО</th><th>Статус</th>${ed?'<th></th>':''}</tr></thead><tbody>
  ${list.length?list.map(e=>{const b=buildingOf(e.building);const st=upkeepStatus(e);
    return `<tr>
      <td class="t-strong" style="cursor:pointer" onclick="equipModal('${e.id}')">${esc(e.name)}${e.location?`<div class="t-sub">${esc(e.location)}</div>`:''}</td>
      <td class="t-sub">${esc(b?b.name:e.building)}</td>
      <td class="t-sub">${esc(e.type||'—')}</td>
      <td class="t-sub">${esc(e.vendor||'—')}</td>
      <td class="t-sub">${e.intervalMonths?e.intervalMonths+' мес':'—'}</td>
      <td class="t-sub">${e.lastService?fmtD(e.lastService):'—'}</td>
      <td><b>${e.nextService?fmtD(e.nextService):'—'}</b><div class="t-sub">${st[2]}</div></td>
      <td><span class="pill ${st[0]}">${st[1]}</span></td>
      ${ed?`<td><button class="btn ghost sm" onclick="markServiced('${e.id}')">✅ ТО выполнено</button></td>`:''}
    </tr>`;}).join(''):`<tr><td colspan="9" class="empty">Оборудование не добавлено</td></tr>`}
  </tbody></table></div>`);
}
function equipModal(id){
  const e=id?(DB.equipment||[]).find(x=>x.id===id):null;
  const def=e?e.building:(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id);
  openM(`<div class="modal-h"><h3>${e?'Оборудование':'Новое оборудование'}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="field"><label>Название</label><input id="eq-name" value="${e?esc(e.name):''}" placeholder="Пассажирский лифт №1"></div>
    <div class="row2">
      <div class="field"><label>Объект</label><select id="eq-building">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Тип</label><select id="eq-type">${EQUIP_TYPES.map(t=>`<option${e&&e.type===t?' selected':''}>${t}</option>`).join('')}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>Размещение</label><input id="eq-loc" value="${e?esc(e.location||''):''}" placeholder="Подъезд 1 / кровля"></div>
      <div class="field"><label>Подрядчик ТО</label><input id="eq-vendor" value="${e?esc(e.vendor||''):''}" placeholder="ООО «ЛифтСервис»"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Интервал ТО, мес</label><input id="eq-interval" type="number" min="1" value="${e?e.intervalMonths||12:12}"></div>
      <div class="field"><label>Последнее ТО</label><input id="eq-last" type="date" value="${e&&e.lastService?e.lastService:''}"></div>
    </div>
    <div class="field"><label>Следующее ТО <span class="t-sub">(если пусто — посчитается от последнего + интервал)</span></label><input id="eq-next" type="date" value="${e&&e.nextService?e.nextService:''}"></div>
    <div class="field"><label>Примечание</label><textarea id="eq-note" rows="2" class="search" style="width:100%;resize:vertical;font-family:inherit">${e?esc(e.note||''):''}</textarea></div>
  </div>
  <div class="modal-f">${e?`<button class="btn ghost sm" onclick="delEquip('${e.id}')">🗑 Удалить</button>`:''}<div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveEquip(${e?`'${e.id}'`:''})">${e?'Сохранить':'Добавить'}</button></div>`);
}
async function saveEquip(id){
  const name=val('eq-name').trim(); if(!name)return alert('Укажите название оборудования');
  ensureState(); const interval=+val('eq-interval')||12; const last=val('eq-last')||null;
  let next=val('eq-next')||null; if(!next && last) next=addMonths(last,interval);
  const data={building:val('eq-building'),name,type:val('eq-type'),location:val('eq-loc').trim(),vendor:val('eq-vendor').trim(),intervalMonths:interval,lastService:last,nextService:next,note:val('eq-note').trim()};
  if(id){const e=DB.equipment.find(x=>x.id===id); if(e)Object.assign(e,data);}
  else DB.equipment.push({id:'eq'+Date.now(),...data});
  closeM(); await afterStateChange();
}
async function markServiced(id){ const e=(DB.equipment||[]).find(x=>x.id===id); if(!e)return;
  const today=TODAY.toISOString().slice(0,10);
  if(!confirm(`Отметить, что ТО «${e.name}» выполнено сегодня?\nСледующее ТО запланируется через ${e.intervalMonths||12} мес.`))return;
  e.lastService=today; e.nextService=addMonths(today,e.intervalMonths||12);
  await afterStateChange(); }
async function delEquip(id){ if(!confirm('Удалить оборудование из реестра?'))return; DB.equipment=(DB.equipment||[]).filter(x=>x.id!==id); closeM(); await afterStateChange(); }

/* ============================================================
   БЮДЖЕТ ПО ОБЪЕКТУ (план/факт) + СТАРЕНИЕ ЗАДОЛЖЕННОСТИ
   ============================================================ */
const paymentBuilding=p=>{const c=contractOf(p.contract);const u=c&&unitOf(c.unit);return u?u.building:null;};
const bIncome=(bid,year)=>DB.payments.filter(p=>paymentBuilding(p)===bid && String(p.period||'').startsWith(year)).reduce((s,p)=>s+(p.paid||0),0);
const bExpense=(bid,year)=>DB.expenses.filter(e=>e.building===bid && String(e.period||'').startsWith(year)).reduce((s,e)=>s+(e.amount||0),0);
function pctCell(fact,plan,expense){ if(!plan) return '<span class="t-sub">—</span>'; const p=Math.round(fact/plan*100);
  const color=expense?(p>100?'var(--red)':p>90?'var(--amber)':'var(--green)'):(p>=100?'var(--green)':p>=70?'var(--amber)':'var(--red)');
  return `<span style="color:${color};font-weight:600">${p}%</span>`; }
function agingBuckets(bid){
  const a={cur:0,d30:0,d60:0,d90:0,d90p:0,penalty:0,total:0,count:0}; const rate=(DB.penaltyRate||0)/100;
  DB.payments.filter(p=>(bid==='all'||paymentBuilding(p)===bid) && (p.amount-p.paid)>0).forEach(p=>{
    const debt=p.amount-p.paid; const od=-daysLeft(p.due); a.total+=debt; a.count++;
    if(od<=0) a.cur+=debt; else if(od<=30) a.d30+=debt; else if(od<=60) a.d60+=debt; else if(od<=90) a.d90+=debt; else a.d90p+=debt;
    if(od>0) a.penalty+=debt*rate*od;
  });
  return a;
}
function budget(){
  const year=String(TODAY.getFullYear());
  const blds=(SCOPE==='all'?buildingsList():buildingsList().filter(b=>b.id===SCOPE));
  const ed=canEdit('budget');
  let tIncP=0,tIncF=0,tExpP=0,tExpF=0;
  const bRows=blds.map(b=>{ const bg=(DB.budgets||{})[b.id]||{income:0,expense:0};
    const incP=bg.income||0,expP=bg.expense||0,incF=bIncome(b.id,year),expF=bExpense(b.id,year);
    tIncP+=incP;tIncF+=incF;tExpP+=expP;tExpF+=expF;
    return `<tr>
      <td class="t-strong">${esc(b.name)}</td>
      <td>${money(incP)}</td><td>${money(incF)}</td><td>${pctCell(incF,incP)}</td>
      <td>${money(expP)}</td><td>${money(expF)}</td><td>${pctCell(expF,expP,true)}</td>
      <td><b>${money(incF-expF)}</b><div class="t-sub">план ${money(incP-expP)}</div></td>
      ${ed?`<td><button class="btn ghost sm" onclick="budgetModal('${b.id}')">✎ План</button></td>`:''}</tr>`;
  }).join('');
  // старение задолженности
  let agg={cur:0,d30:0,d60:0,d90:0,d90p:0,penalty:0,total:0,count:0};
  const agRows=blds.map(b=>{ const a=agingBuckets(b.id); Object.keys(agg).forEach(k=>agg[k]+=a[k]);
    return `<tr><td class="t-strong">${esc(b.name)}</td>
      <td>${money(a.cur)}</td><td>${a.d30?money(a.d30):'—'}</td><td>${a.d60?money(a.d60):'—'}</td><td>${a.d90?money(a.d90):'—'}</td>
      <td${a.d90p?' style="color:var(--red)"':''}>${a.d90p?money(a.d90p):'—'}</td>
      <td><b>${money(a.total)}</b></td><td style="color:var(--amber)">${a.penalty?money(Math.round(a.penalty)):'—'}</td></tr>`;
  }).join('');
  el(head('Бюджет и контроль задолженности',`План/факт за ${year} год · ${scopeSub()}`,'')+
  `<div class="card" style="padding:0;overflow-x:auto;margin-bottom:16px"><div class="sec-h" style="padding:14px 16px 0">Бюджет: план / факт (${year})</div>
   <table><thead><tr><th>Объект</th><th>План доход</th><th>Факт доход</th><th>%</th><th>План расход</th><th>Факт расход</th><th>%</th><th>NOI (факт)</th>${ed?'<th></th>':''}</tr></thead><tbody>
   ${bRows||`<tr><td colspan="9" class="empty">Нет объектов</td></tr>`}
   <tr style="border-top:2px solid var(--line2)"><td class="t-strong">Итого</td><td>${money(tIncP)}</td><td><b>${money(tIncF)}</b></td><td>${pctCell(tIncF,tIncP)}</td><td>${money(tExpP)}</td><td><b>${money(tExpF)}</b></td><td>${pctCell(tExpF,tExpP,true)}</td><td><b>${money(tIncF-tExpF)}</b></td>${ed?'<td></td>':''}</tr>
   </tbody></table></div>
   <div class="card" style="padding:0;overflow-x:auto">
   <div class="sec-h" style="padding:14px 16px 0;display:flex;align-items:center;justify-content:space-between"><span>Старение задолженности и пени</span>
     <span class="t-sub">Ставка пени: <b>${DB.penaltyRate||0}%</b>/день ${ed?`<button class="btn ghost sm" onclick="penaltyModal()" style="margin-left:6px">изменить</button>`:''}</span></div>
   <table><thead><tr><th>Объект</th><th>Текущая</th><th>1–30 дн</th><th>31–60 дн</th><th>61–90 дн</th><th>90+ дн</th><th>Всего долг</th><th>Пеня</th></tr></thead><tbody>
   ${agRows||`<tr><td colspan="8" class="empty">Нет объектов</td></tr>`}
   <tr style="border-top:2px solid var(--line2)"><td class="t-strong">Итого (${agg.count})</td><td>${money(agg.cur)}</td><td>${money(agg.d30)}</td><td>${money(agg.d60)}</td><td>${money(agg.d90)}</td><td style="color:var(--red)">${money(agg.d90p)}</td><td><b>${money(agg.total)}</b></td><td style="color:var(--amber)"><b>${money(Math.round(agg.penalty))}</b></td></tr>
   </tbody></table></div>`);
}
function budgetModal(bid){ const b=buildingOf(bid); const bg=(DB.budgets||{})[bid]||{income:0,expense:0};
  openM(`<div class="modal-h"><h3>Годовой план — ${esc(b?b.name:bid)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="field"><label>План доходов (аренда), ₽ / год</label><input id="bg-income" type="number" value="${bg.income||0}"></div>
    <div class="field"><label>План расходов (содержание), ₽ / год</label><input id="bg-expense" type="number" value="${bg.expense||0}"></div>
    <div class="t-sub">Факт считается автоматически из платежей и расходов за ${TODAY.getFullYear()} год.</div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveBudget('${bid}')">Сохранить</button></div>`);
}
async function saveBudget(bid){ ensureState(); DB.budgets[bid]={income:+val('bg-income')||0,expense:+val('bg-expense')||0}; closeM(); await afterStateChange(); }
function penaltyModal(){
  openM(`<div class="modal-h"><h3>Ставка пени</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Пеня за просрочку, % в день от суммы долга</label><input id="pen-rate" type="number" step="0.01" value="${DB.penaltyRate||0}"></div>
  <div class="t-sub">Обычно 0.1% в день (≈1/300 ставки ЦБ). Пеня начисляется на дни просрочки.</div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="savePenalty()">Сохранить</button></div>`);
}
async function savePenalty(){ ensureState(); DB.penaltyRate=+val('pen-rate')||0; closeM(); await afterStateChange(); }

/* ============================================================
   ЦЕНТР СРОКОВ И АВТО-АЛЕРТЫ (агрегатор по всем модулям)
   ============================================================ */
function buildAlerts(){
  if(!DB) return [];
  const A=[]; const inS=b=>SCOPE==='all'||b===SCOPE;
  // Просроченные платежи
  DB.payments.filter(p=>p.amount-p.paid>0 && daysLeft(p.due)<0).forEach(p=>{ const b=paymentBuilding(p); if(!inS(b))return;
    const c=contractOf(p.contract); const t=c&&tenantOf(c.tenant); const dl=daysLeft(p.due);
    A.push({level:'danger',icon:'💳',cat:'Платежи',id:p.id,title:`Просрочка оплаты: ${t?t.name:('договор '+p.contract)}`,sub:`${money(p.amount-p.paid)} · просрочено ${-dl} дн`,page:'payments',sort:dl}); });
  // Договоры на исходе (≤60 дн) или истёкшие
  DB.contracts.forEach(c=>{ if(c.status==='ended')return; const u=unitOf(c.unit); const b=u&&u.building; if(!inS(b))return;
    const dl=c.end?daysLeft(c.end):9999; if(dl>60)return; const t=tenantOf(c.tenant);
    A.push({level:dl<0?'danger':dl<=30?'warn':'info',icon:'📄',cat:'Договоры',id:c.id,title:`Договор ${dl<0?'истёк':'истекает'}: ${t?t.name:c.id}`,sub:`${esc(unitNum(c.unit))} · ${c.end?fmtD(c.end):''} · ${dueLabel(c.end)}`,page:'contracts',sort:dl}); });
  // Плановое ТО просрочено/скоро (≤30 дн)
  (DB.equipment||[]).forEach(e=>{ if(!inS(e.building))return; const dl=daysLeft(e.nextService); if(e.nextService==null||dl===9999||dl>30)return;
    A.push({level:dl<0?'danger':'warn',icon:'🧰',cat:'Плановое ТО',id:e.id,title:`ТО ${dl<0?'просрочено':'скоро'}: ${e.name}`,sub:`${e.nextService?fmtD(e.nextService):''} · ${dueLabel(e.nextService)}`,page:'upkeep',sort:dl}); });
  // Заявки на обслуживание срочные (≤3 дн или просрочено)
  (DB.requests||[]).filter(r=>r.status==='new'||r.status==='in_progress').forEach(r=>{ if(!inS(r.building))return; const dl=daysLeft(r.due); if(dl>3)return;
    A.push({level:dl<0?'danger':'warn',icon:'🛠',cat:'Заявки',id:r.id,reqStatus:r.status,title:`Заявка: ${r.title}`,sub:`${esc(r.category||'')} · ${dueLabel(r.due)}`,page:'requests',sort:dl}); });
  // Задачи срочные
  (TASKS||[]).filter(t=>t.status!=='done' && daysLeft(t.due)<=3).forEach(t=>{ const dl=daysLeft(t.due);
    A.push({level:dl<0?'danger':'warn',icon:'✓',cat:'Задачи',id:t.id,taskStatus:t.status,title:t.title,sub:`${esc(t.unit||'')} · ${dueLabel(t.due)}`,page:'tasks',sort:dl}); });
  // Разрешения на вывески истекают/истекли (≤60 дн)
  (DB.signage||[]).forEach(s=>{ if(!inS(s.building))return; const dl=s.expiry?daysLeft(s.expiry):9999; if(dl>60)return;
    const who=s.owner==='self'?'собственника':((s.tenant&&tenantOf(s.tenant))?tenantOf(s.tenant).name:'арендатора');
    A.push({level:dl<0?'danger':dl<=30?'warn':'info',icon:'📣',cat:'Реклама',id:s.id,title:`Разрешение ${dl<0?'истекло':'истекает'}: ${esc(s.kind||'вывеска')} (${esc(who)})`,sub:`${esc(s.permitNo||'')} · ${s.expiry?fmtD(s.expiry):''} · ${dueLabel(s.expiry)}`,page:'ads',sort:dl}); });
  return A.sort((x,y)=>x.sort-y.sort);
}
const alertColor=l=>l==='danger'?'var(--red)':l==='warn'?'var(--amber)':'var(--accent2)';
function gotoPage(p){ document.getElementById('notif')?.classList.remove('show'); current=p; markActive(); render(); closeNav(); }
function alerts(){
  const all=buildAlerts();
  const dang=all.filter(a=>a.level==='danger').length, warn=all.filter(a=>a.level==='warn').length;
  const cats=[...new Set(all.map(a=>a.cat))];
  el(head('Центр сроков и уведомлений',`${all.length} событий требуют внимания · ${scopeSub()}`,'')+
  `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:16px">
    <div class="card"><div class="t-sub">Всего событий</div><div style="font-size:26px;font-weight:700">${all.length}</div></div>
    <div class="card"><div class="t-sub">🔴 Критичные</div><div style="font-size:26px;font-weight:700;color:var(--red)">${dang}</div></div>
    <div class="card"><div class="t-sub">🟡 Предупреждения</div><div style="font-size:26px;font-weight:700;color:var(--amber)">${warn}</div></div>
  </div>
  ${all.length? cats.map(cat=>{ const items=all.filter(a=>a.cat===cat);
    return `<div class="card" style="margin-bottom:14px"><div class="sec-h">${esc(cat)} · ${items.length}</div>
      ${items.map(a=>`<div class="doc" style="border-left:3px solid ${alertColor(a.level)};border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer" onclick="gotoPage('${a.page}')">
        <div class="di" style="font-size:17px">${a.icon}</div>
        <div style="flex:1;min-width:0"><div class="t-strong">${esc(a.title)}</div><div class="t-sub">${a.sub}</div></div>
        <span class="t-sub">→</span></div>`).join('')}</div>`;
  }).join('') : '<div class="card"><div class="empty" style="padding:30px">Срочных событий нет — всё под контролем 🎉</div></div>'}`);
}

/* ============================================================
   ЭКРАН «СЕГОДНЯ» — простые действия в один клик (надстройка над buildAlerts)
   ============================================================ */
function todayPage(){
  const all=buildAlerts();
  const groups=[
    {key:'Деньги',icon:'💰',cats:['Платежи']},
    {key:'Договоры',icon:'📄',cats:['Договоры']},
    {key:'Обслуживание',icon:'🛠',cats:['Плановое ТО','Заявки']},
    {key:'Задачи',icon:'✓',cats:['Задачи']},
    {key:'Прочее',icon:'📣',cats:['Реклама']},
  ];
  const blocks=groups.map(g=>{ const items=all.filter(a=>g.cats.includes(a.cat)); if(!items.length) return '';
    return `<div class="card" style="margin-bottom:14px"><div class="sec-h">${g.icon} ${g.key} · ${items.length}</div>${items.map(todayRow).join('')}</div>`;
  }).filter(Boolean).join('');
  el(head('Сегодня', `Что нужно сделать · ${scopeSub()} · ${TODAY.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}`,'')+
   (all.length? blocks : `<div class="card"><div class="empty" style="padding:40px;font-size:16px">На сегодня всё сделано 🎉<div class="t-sub" style="margin-top:8px">Срочных дел нет. Загляните в Дашборд или Центр сроков.</div></div></div>`));
}
function todayRow(a){
  return `<div class="doc" style="border-left:3px solid ${alertColor(a.level)};border-radius:8px;padding:10px 12px;margin-bottom:8px;align-items:center;gap:10px">
    <div class="di" style="font-size:18px">${a.icon}</div>
    <div style="flex:1;min-width:0;cursor:pointer" onclick="gotoPage('${a.page}')"><div class="t-strong">${esc(a.title)}</div><div class="t-sub">${a.cat} · ${a.sub}</div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${todayActions(a)}</div></div>`;
}
function todayActions(a){
  const id=a.id, b=[];
  if(a.cat==='Платежи'){ if(canEdit('payments')){ b.push(`<button class="btn sm" title="Полная оплата сегодня" onclick="quickPay('${id}')">✓ Оплачено</button>`); b.push(`<button class="btn ghost sm" onclick="remindDebtor('${id}')">📨 Напомнить</button>`); } }
  else if(a.cat==='Договоры'){ if(canEdit('contracts')) b.push(`<button class="btn sm" onclick="renewModal('${id}')">Продлить</button>`); }
  else if(a.cat==='Плановое ТО'){ if(canEdit('upkeep')) b.push(`<button class="btn sm" onclick="markServiced('${id}')">✅ ТО выполнено</button>`); }
  else if(a.cat==='Заявки'){ if(canEdit('requests')) b.push(`<button class="btn sm" onclick="advanceRequest('${id}')">${a.reqStatus==='new'?'→ В работу':'✓ Выполнено'}</button>`); }
  else if(a.cat==='Задачи'){ if(canEdit('tasks')) b.push(`<button class="btn sm" onclick="advanceTask(${id})">${a.taskStatus==='open'?'→ В работу':'✓ Завершить'}</button>`); }
  if(!b.length) b.push(`<button class="btn ghost sm" onclick="gotoPage('${a.page}')">Открыть →</button>`);
  return b.join('');
}
// Продление договора (из «Сегодня»): новая дата окончания + опц. индексация ставки.
function renewModal(id){ const c=contractOf(id); if(!c)return; const t=tenantOf(c.tenant);
  const defEnd=addMonths(c.end||TODAY.toISOString().slice(0,10),12);
  openM(`<div class="modal-h"><h3>Продление договора</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    ${infoRow('Договор',esc((c.id||'').toUpperCase()))}${t?infoRow('Арендатор',esc(t.name)):''}${infoRow('Помещение',esc(unitNum(c.unit)))}
    ${infoRow('Текущая ставка',money(c.rate)+(c.rateType==='flat'?' /мес за помещение':' /м²'))}${infoRow('Окончание сейчас',c.end?fmtD(c.end):'—')}
    <div class="field" style="margin-top:10px"><label>Новая дата окончания</label><input id="rn-end" type="date" value="${defEnd}"></div>
    ${c.indexation?`<label style="display:flex;align-items:center;gap:9px;cursor:pointer"><input type="checkbox" id="rn-idx" checked> Применить индексацию ${c.indexation}%/год к ставке (${money(c.rate)} → ${money(Math.round(c.rate*(1+c.indexation/100)))})</label>`:''}
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveRenew('${id}')">Продлить</button></div>`);
}
async function saveRenew(id){ const c=contractOf(id); if(!c)return; const end=val('rn-end'); if(!end) return alert('Укажите дату окончания');
  c.end=end; c.status='active';
  if(document.getElementById('rn-idx')?.checked && c.indexation) c.rate=Math.round(c.rate*(1+c.indexation/100));
  closeM(); await afterStateChange();
}
// Напоминание должнику: готовый текст (копировать / письмо). Полная авторассылка — отдельная автоматизация.
function remindDebtor(id){ const p=DB.payments.find(x=>x.id===id); if(!p)return;
  const c=contractOf(p.contract); const t=c&&tenantOf(c.tenant); const u=c&&unitOf(c.unit); const b=u&&buildingOf(u.building);
  const rem=p.amount-p.paid; const dl=daysLeft(p.due);
  const text=`Уважаемый арендатор${t?' ('+t.name+')':''}!\nНапоминаем о задолженности по аренде.\nОбъект: ${b?b.name:'—'}${c?', помещение '+unitNum(c.unit):''}\nПериод: ${p.period}\nК оплате: ${money(rem)}\nСрок оплаты: ${fmtD(p.due)}${dl<0?' (просрочено '+(-dl)+' дн)':''}\nПросим погасить задолженность в ближайшее время. Спасибо!`;
  openM(`<div class="modal-h"><h3>📨 Напоминание должнику</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    ${t?infoRow('Арендатор',esc(t.name)):''}${t&&t.phone?infoRow('Телефон',esc(t.phone)):''}${t&&t.email?infoRow('Email',esc(t.email)):''}
    <div class="field" style="margin-top:10px"><label>Текст напоминания</label><textarea id="rem-text" rows="9" class="search" style="width:100%;resize:vertical;font-family:inherit">${esc(text)}</textarea></div>
    <div class="t-sub">Скопируйте и отправьте арендатору удобным способом. Контакты видны согласно правам доступа.</div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="copyRemind()">📋 Скопировать</button>${t&&t.email?`<a class="btn" href="mailto:${esc(t.email)}?subject=${encodeURIComponent('Напоминание об оплате аренды')}&body=${encodeURIComponent(text)}">✉ Письмо</a>`:''}<button class="btn ghost" onclick="closeM()">Закрыть</button></div>`);
}
function copyRemind(){ const t=document.getElementById('rem-text'); if(!t)return; t.select();
  try{ navigator.clipboard.writeText(t.value); }catch{ try{document.execCommand('copy');}catch{} } alert('Текст скопирован'); }

/* ============================================================
   РЕКЛАМА: объявления (ЦИАН/Авито) + разрешения на вывески
   ============================================================ */
const AD_PLATFORMS={cian:['ЦИАН','#0468ff'],avito:['Авито','#00aaff'],other:['Другая','#888']};
const SIGN_KINDS=['Настенная вывеска','Световой короб','Медиафасад','Рекламная стела','Баннер','Штендер','Витрина','Крышная установка'];
const adPlatform=p=>AD_PLATFORMS[p]||AD_PLATFORMS.other;
// метка источника текущих просмотров/заявок
const adSourceBadge=s=>({api:'🌐 с площадки',demo:'🧪 демо',manual:'✍ вручную'}[s]||'синх.');
function listingStatusPill(s){const m={active:['green','Активно'],paused:['amber','На паузе'],archived:['gray','В архиве']};const x=m[s]||['gray',s];return `<span class="pill ${x[0]}">${x[1]}</span>`;}
function signageStatus(s){ const dl=daysLeft(s.expiry); if(s.expiry==null||dl===9999) return ['gray','Бессрочно','—']; if(dl<0) return ['red','Истекло',`${-dl} дн назад`]; if(dl<=60) return ['amber','Истекает',`через ${dl} дн`]; return ['green','Действует',`через ${dl} дн`]; }
const sListings=()=>(DB.listings||[]).filter(a=>SCOPE==='all'||a.building===SCOPE);
const sSignage=()=>(DB.signage||[]).filter(s=>SCOPE==='all'||s.building===SCOPE);
let signFilter='all';
function setSignFilter(f){ signFilter=f; render(); }
function ads(){
  const ed=canEdit('ads');
  if(ed && ADS_INFO===null && !IS_DEMO) loadAdsInfo();   // подтянуть статус интеграции/ссылки фида (один раз)
  const list=sListings(); const totV=list.reduce((s,a)=>s+(a.views||0),0); const totL=list.reduce((s,a)=>s+(a.leads||0),0); const active=list.filter(a=>a.status==='active').length;
  const sign=sSignage(); const filtered=sign.filter(s=>signFilter==='all'||s.owner===signFilter);
  const tabs=[['all','Все'],['tenant','Арендаторов'],['self','Собственника']];
  el(head('Реклама и вывески',`Объявления: ${list.length} (активных ${active}) · разрешения: ${sign.length} · ${scopeSub()}`,
    ed?`<button class="btn ghost" onclick="listingModal()">+ Объявление</button> <button class="btn" onclick="signageModal()">+ Разрешение</button>`:'')+
  `<div class="card" style="padding:0;overflow-x:auto;margin-bottom:16px">
    <div class="sec-h" style="padding:14px 16px 0;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Объявления на площадках · 👁 ${fmt(totV)} просмотров · 📞 ${totL} заявок</span>
      ${ed?`<span><button class="btn ghost sm" onclick="syncListings('cian')">↻ ЦИАН</button> <button class="btn ghost sm" onclick="syncListings('avito')">↻ Авито</button></span>`:''}</div>
    <table><thead><tr><th>Площадка</th><th>Объект / пом.</th><th>Заголовок</th><th>Цена</th><th>Просм.</th><th>Заявки</th><th>Статус</th>${ed?'<th></th>':''}</tr></thead><tbody>
    ${list.length?list.map(a=>{const pl=adPlatform(a.platform);const b=buildingOf(a.building);
      return `<tr>
        <td><span class="pill" style="background:${pl[1]}22;color:${pl[1]}">${pl[0]}</span></td>
        <td class="t-sub">${esc(b?b.name:a.building)}${a.unit?' · '+esc(a.unit):''}</td>
        <td class="t-strong" style="cursor:pointer" onclick="listingInfo('${a.id}')">${esc(a.title)}${a.documents&&a.documents.length?` 📎${a.documents.length}`:''}${safeUrl(a.url)?` <a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="font-size:12px">↗</a>`:''}</td>
        <td>${money(a.price)}</td><td>👁 ${fmt(a.views||0)}</td><td>📞 ${a.leads||0}</td>
        <td>${listingStatusPill(a.status)}${a.lastSync?`<div class="t-sub">${adSourceBadge(a.source)} ${fmtDateTime(a.lastSync)}</div>`:''}${a.lastSyncError?`<div class="t-sub" style="color:var(--amber)" title="${esc(a.lastSyncError)}">⚠ ошибка синх.</div>`:''}</td>
        ${ed?`<td><button class="btn ghost sm" onclick="delListing('${a.id}')">🗑</button></td>`:''}</tr>`;}).join(''):`<tr><td colspan="8" class="empty">Объявлений нет</td></tr>`}
    </tbody></table>
    ${ed?adsIntegrationBlock():''}
  </div>
  <div class="card" style="padding:0;overflow-x:auto">
    <div class="sec-h" style="padding:14px 16px 0;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>Разрешения на вывески и наружную рекламу</span>
      <span>${tabs.map(([k,l])=>`<button class="btn ${signFilter===k?'':'ghost'} sm" onclick="setSignFilter('${k}')">${l}</button>`).join(' ')}</span></div>
    <table><thead><tr><th>Чьё</th><th>Объект / пом.</th><th>Тип конструкции</th><th>№ разрешения</th><th>Выдано</th><th>Действует до</th><th>Статус</th>${ed?'<th></th>':''}</tr></thead><tbody>
    ${filtered.length?filtered.map(s=>{const st=signageStatus(s);const b=buildingOf(s.building);const t=s.tenant&&tenantOf(s.tenant);
      return `<tr>
        <td>${s.owner==='self'?'<span class="pill" style="background:rgba(106,168,255,.18);color:var(--accent2)">Собственник</span>':`<span class="t-strong">${esc(t?t.name:'Арендатор')}</span>`}</td>
        <td class="t-sub">${esc(b?b.name:s.building||'—')}${s.unit?' · '+esc(s.unit):''}</td>
        <td class="t-strong" style="cursor:pointer" onclick="signageInfo('${s.id}')">${esc(s.kind||'—')}${s.documents&&s.documents.length?` 📎${s.documents.length}`:''}</td><td class="t-sub">${esc(s.permitNo||'—')}</td>
        <td class="t-sub">${s.issued?fmtD(s.issued):'—'}</td>
        <td><b>${s.expiry?fmtD(s.expiry):'—'}</b><div class="t-sub">${st[2]}</div></td>
        <td><span class="pill ${st[0]}">${st[1]}</span></td>
        ${ed?`<td><button class="btn ghost sm" onclick="signageModal('${s.id}')">✎</button></td>`:''}</tr>`;}).join(''):`<tr><td colspan="8" class="empty">Разрешений нет</td></tr>`}
    </tbody></table></div>`);
}
// блок статуса интеграции с площадками + ссылки на XML-фид (для вставки в кабинет площадки)
function adsIntegrationBlock(){
  const st = (ok)=> ok?'<b style="color:var(--green)">подключён ✓</b>':'<b style="color:var(--muted)">не подключён (демо-режим)</b>';
  const feed = ADS_INFO ? `<div class="t-sub" style="margin-top:6px">Ссылка на XML-фид для автозагрузки Авито (вставьте в кабинете площадки):<br>
    <code style="user-select:all;word-break:break-all">${esc(ADS_INFO.feedAvito||'')}</code>${ADS_INFO.feedProtected?' <span class="t-sub">(защищён токеном)</span>':''}</div>` : '';
  return `<div class="t-sub" style="padding:10px 16px;border-top:1px solid var(--line)">
    📣 <b>API Авито:</b> ${st(ADS_AVITO)} · <b>ЦИАН:</b> ${st(ADS_CIAN)} <span class="t-sub">(Фаза 2)</span>
    ${feed}
    <div style="margin-top:6px">Кнопка «↻ Авито» при подключённых ключах тянет реальные просмотры/заявки по «ID на площадке (extId)». Без ключей — демо-прирост. Ключи задаются в окружении клиента (скрипт <code>set-ads-keys.sh</code>), в браузер не передаются.</div>
  </div>`;
}
// подгрузить статус интеграции/ссылки фида и обновить блок (вызывается при открытии раздела)
async function loadAdsInfo(){
  if(IS_DEMO){ return; }
  try{ ADS_INFO = await api('/api/ads/info'); ADS_AVITO=!!ADS_INFO.avitoConfigured; ADS_CIAN=!!ADS_INFO.cianConfigured; if(current==='ads') render(); }catch{}
}
async function syncListings(platform){
  const pname=adPlatform(platform)[0];
  const configured = platform==='avito'?ADS_AVITO : platform==='cian'?ADS_CIAN : false;
  // Боевой режим: ключи заданы — реальный запрос к площадке через сервер
  if(configured && !IS_DEMO){
    try{
      const r=await api('/api/ads/sync','POST',{platform});   // сигнатура: api(путь, метод, тело)
      await reloadState();
      alert(`Синхронизация с «${pname}» завершена.\nОбновлено объявлений: ${r.updated||0}${r.skipped?`\nПропущено (нет extId/данных): ${r.skipped}`:''}${r.note?`\n${r.note}`:''}`);
    }catch(e){ alert('Ошибка синхронизации с «'+pname+'»:\n'+(e.message||e)); }
    return;
  }
  // Ключи не заданы: раздел работает как раньше — демо-прирост (ничего не ломаем)
  ensureState(); const now=new Date().toISOString();
  const items=(DB.listings||[]).filter(a=>a.platform===platform && a.status==='active');
  if(!items.length) return alert(`На площадке «${pname}» нет активных объявлений для синхронизации.`);
  if(!confirm(`API «${pname}» не подключён (ключи не заданы в окружении).\nВыполнить демо-синхронизацию (тестовый прирост просмотров)?`)) return;
  let dV=0,dL=0;
  items.forEach(a=>{ const addV=Math.max(5,Math.round((a.views||0)*0.08)); const addL=Math.max(0,Math.round(addV/40));
    a.views=(a.views||0)+addV; a.leads=(a.leads||0)+addL; a.lastSync=now; a.source='demo'; dV+=addV; dL+=addL; });
  logSync(platform,'📣',pname,'in',`Демо-синхронизация: ${items.length} объявл.`,items.length,0,[`+${dV} просмотров`,`+${dL} заявок`]);
  await afterStateChange(); alert(`Демо-синхронизация с «${pname}» завершена.\nОбъявлений: ${items.length}\n+${dV} просмотров, +${dL} заявок.\n\nДля реальных данных подключите API площадки в окружении клиента.`);
}
function listingModal(id){
  const a=id?(DB.listings||[]).find(x=>x.id===id):null;
  const def=a?a.building:(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id);
  openM(`<div class="modal-h"><h3>${a?'Объявление':'Новое объявление'}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="row2"><div class="field"><label>Площадка</label><select id="ad-platform">${Object.entries(AD_PLATFORMS).map(([k,v])=>`<option value="${k}"${a&&a.platform===k?' selected':''}>${v[0]}</option>`).join('')}</select></div>
      <div class="field"><label>Статус</label><select id="ad-status">${[['active','Активно'],['paused','На паузе'],['archived','В архиве']].map(([k,l])=>`<option value="${k}"${(a?a.status:'active')===k?' selected':''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label>Заголовок</label><input id="ad-title" value="${a?esc(a.title):''}" placeholder="Аренда офиса 95 м²"></div>
    <div class="row2"><div class="field"><label>Объект</label><select id="ad-building">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Помещение</label><input id="ad-unit" value="${a?esc(a.unit||''):''}" placeholder="1-03"></div></div>
    <div class="row2"><div class="field"><label>Цена, ₽/мес</label><input id="ad-price" type="number" value="${a?a.price||0:0}"></div>
      <div class="field"><label>Ссылка</label><input id="ad-url" value="${a?esc(a.url||''):''}" placeholder="https://"></div></div>
    <div class="field"><label>ID на площадке (extId) <span class="t-sub">id объявления на Авито/ЦИАН — для подтяжки статистики и сопоставления с фидом</span></label><input id="ad-extid" value="${a?esc(a.extId||''):''}" placeholder="напр. 1234567890"></div>
    <div class="field"><label>Описание <span class="t-sub">идёт в XML-фид площадки</span></label><textarea id="ad-desc" rows="3" placeholder="Описание объекта для площадки">${a?esc(a.description||''):''}</textarea></div>
  </div>
  <div class="modal-f">${a?`<button class="btn ghost sm" onclick="delListing('${a.id}')">🗑 Удалить</button>`:''}<div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveListing(${a?`'${a.id}'`:''})">${a?'Сохранить':'Добавить'}</button></div>`);
}
async function saveListing(id){
  const title=val('ad-title').trim(); if(!title)return alert('Укажите заголовок объявления'); ensureState();
  const data={platform:val('ad-platform'),status:val('ad-status'),title,building:val('ad-building'),unit:val('ad-unit').trim(),price:+val('ad-price')||0,url:val('ad-url').trim(),extId:val('ad-extid').trim(),description:val('ad-desc').trim()};
  if(id){const a=DB.listings.find(x=>x.id===id); if(a)Object.assign(a,data);}
  else DB.listings.unshift({id:'ad'+Date.now(),...data,views:0,leads:0,source:'manual',posted:TODAY.toISOString().slice(0,10),lastSync:null,lastSyncError:null,documents:[]});
  closeM(); await afterStateChange();
}
async function delListing(id){ if(!confirm('Удалить объявление?'))return; DB.listings=(DB.listings||[]).filter(x=>x.id!==id); closeM(); await afterStateChange(); }
function signageModal(id){
  const s=id?(DB.signage||[]).find(x=>x.id===id):null;
  const def=s?s.building:(SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id);
  const owner=s?s.owner:'tenant'; const tnts=DB.tenants||[];
  openM(`<div class="modal-h"><h3>${s?'Разрешение на рекламу':'Новое разрешение'}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="field"><label>Чья реклама</label><select id="sg-owner" onchange="sgOwnerToggle()">
      <option value="tenant"${owner==='tenant'?' selected':''}>Арендатора</option>
      <option value="self"${owner==='self'?' selected':''}>Собственника (своя)</option></select></div>
    <div class="field" id="sg-tenant-wrap"><label>Арендатор</label><select id="sg-tenant">${tnts.map(t=>`<option value="${t.id}"${s&&s.tenant===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select></div>
    <div class="row2"><div class="field"><label>Объект</label><select id="sg-building">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Помещение (если есть)</label><input id="sg-unit" value="${s?esc(s.unit||''):''}" placeholder="2-01"></div></div>
    <div class="row2"><div class="field"><label>Тип конструкции</label><select id="sg-kind">${SIGN_KINDS.map(k=>`<option${s&&s.kind===k?' selected':''}>${k}</option>`).join('')}</select></div>
      <div class="field"><label>№ разрешения</label><input id="sg-permit" value="${s?esc(s.permitNo||''):''}" placeholder="РВ-2026-..."></div></div>
    <div class="row2"><div class="field"><label>Выдано</label><input id="sg-issued" type="date" value="${s&&s.issued?s.issued:''}"></div>
      <div class="field"><label>Действует до</label><input id="sg-expiry" type="date" value="${s&&s.expiry?s.expiry:''}"></div></div>
    <div class="field"><label>Примечание</label><input id="sg-note" value="${s?esc(s.note||''):''}"></div>
  </div>
  <div class="modal-f">${s?`<button class="btn ghost sm" onclick="delSignage('${s.id}')">🗑 Удалить</button>`:''}<div class="spacer"></div><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveSignage(${s?`'${s.id}'`:''})">${s?'Сохранить':'Добавить'}</button></div>`);
  sgOwnerToggle();
}
function sgOwnerToggle(){ const o=val('sg-owner'); const w=document.getElementById('sg-tenant-wrap'); if(w)w.style.display=o==='tenant'?'':'none'; }
async function saveSignage(id){
  ensureState(); const owner=val('sg-owner');
  const data={owner,tenant:owner==='tenant'?val('sg-tenant'):null,building:val('sg-building'),unit:val('sg-unit').trim()||null,kind:val('sg-kind'),permitNo:val('sg-permit').trim(),issued:val('sg-issued')||null,expiry:val('sg-expiry')||null,note:val('sg-note').trim()};
  if(id){const s=DB.signage.find(x=>x.id===id); if(s)Object.assign(s,data);}
  else DB.signage.push({id:'sg'+Date.now(),...data,documents:[]});
  closeM(); await afterStateChange();
}
async function delSignage(id){ if(!confirm('Удалить разрешение?'))return; DB.signage=(DB.signage||[]).filter(x=>x.id!==id); closeM(); await afterStateChange(); }
function listingInfo(id){ const a=(DB.listings||[]).find(x=>x.id===id); if(!a)return; const pl=adPlatform(a.platform); const b=buildingOf(a.building); const ed=canEdit('ads');
  openM(`<div class="modal-h"><h3>Объявление</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-strong" style="font-size:16px;margin-bottom:10px">${esc(a.title)}</div>
    ${infoRow('Площадка',esc(pl[0]))}
    ${infoRow('Объект',esc(b?b.name:a.building)+(a.unit?' · '+esc(a.unit):''))}
    ${infoRow('Цена',money(a.price))}
    ${infoRow('Статус',listingStatusPill(a.status))}
    ${infoRow('Просмотры / заявки',`👁 ${fmt(a.views||0)} · 📞 ${a.leads||0}`)}
    ${a.extId?infoRow('ID на площадке',esc(a.extId)):''}
    ${infoRow('Источник данных',adSourceBadge(a.source))}
    ${a.posted?infoRow('Размещено',fmtD(a.posted)):''}
    ${a.lastSync?infoRow('Синхронизация',fmtDateTime(a.lastSync)):''}
    ${a.lastSyncError?infoRow('Ошибка синх.',`<span style="color:var(--amber)">${esc(a.lastSyncError)}</span>`):''}
    ${a.description?infoRow('Описание',esc(a.description)):''}
    ${safeUrl(a.url)?infoRow('Ссылка',`<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">открыть ↗</a>`):(a.url?infoRow('Ссылка',esc(a.url)+' (небезопасная ссылка)'):'')}
    <div style="margin-top:12px">${docsBlock('listing',id,a.documents)}</div>
  </div>
  <div class="modal-f">${ed?`<button class="btn ghost" onclick="listingModal('${id}')">✎ Редактировать</button>`:''}<div class="spacer"></div><button class="btn" onclick="closeM()">Закрыть</button></div>`);
}
function signageInfo(id){ const s=(DB.signage||[]).find(x=>x.id===id); if(!s)return; const st=signageStatus(s); const b=buildingOf(s.building); const t=s.tenant&&tenantOf(s.tenant); const ed=canEdit('ads');
  openM(`<div class="modal-h"><h3>Разрешение на рекламу</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-strong" style="font-size:16px;margin-bottom:10px">${esc(s.kind||'Вывеска')}</div>
    ${infoRow('Чьё',s.owner==='self'?'Собственник (своя реклама)':(t?esc(t.name):'Арендатор'))}
    ${infoRow('Объект',esc(b?b.name:s.building||'—')+(s.unit?' · '+esc(s.unit):''))}
    ${infoRow('№ разрешения',esc(s.permitNo||'—'))}
    ${infoRow('Выдано',s.issued?fmtD(s.issued):'—')}
    ${infoRow('Действует до',(s.expiry?fmtD(s.expiry):'—')+' · '+st[2])}
    ${infoRow('Статус',`<span class="pill ${st[0]}">${st[1]}</span>`)}
    ${s.note?infoRow('Примечание',esc(s.note)):''}
    <div style="margin-top:12px">${docsBlock('signage',id,s.documents)}</div>
  </div>
  <div class="modal-f">${ed?`<button class="btn ghost" onclick="signageModal('${id}')">✎ Редактировать</button>`:''}<div class="spacer"></div><button class="btn" onclick="closeM()">Закрыть</button></div>`);
}

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
  <div class="card" style="margin-top:18px"><div class="panel-title"><h3>Матрица прав доступа</h3>
    ${isAdmin()?(_permEditing?`<span style="display:flex;gap:8px"><button class="btn ghost sm" onclick="cancelPermEdit()">Отмена</button><button class="btn sm" onclick="savePermEdit()">💾 Сохранить права</button></span>`:`<button class="btn ghost sm" onclick="startPermEdit()">✎ Изменить права</button>`):'<span class="muted">по ролям</span>'}</div>
  ${permMatrix()}</div>`);
}
const PERM_MODS=[['objects','Объекты'],['tenants','Аренд.'],['contracts','Догов.'],['payments','Платежи'],['utilities','Комм.'],['salaries','ФОТ'],['budget','Бюджет'],['tasks','Задачи'],['requests','Заявки'],['upkeep','ТО'],['ads','Реклама'],['reports','Отчёты'],['integrations','Синхр.'],['employees','Сотруд.']];
const PERM_ROLES_EDITABLE=['manager','accountant','leasing','maintenance'];
let _permEditing=false,_permWork=null;
function permState(role,mod){ // 'edit' | 'view' | 'none'
  if(_permEditing&&_permWork[role]){ return _permWork[role].edit.has(mod)?'edit':_permWork[role].view.has(mod)?'view':'none'; }
  const r=ROLES[role]; return r.edit.includes(mod)?'edit':r.view.includes(mod)?'view':'none';
}
function permIcon(s){ return s==='edit'?'<span title="Редактирование" style="color:var(--green)">✎</span>':s==='view'?'<span title="Просмотр" style="color:var(--muted)">👁</span>':'<span style="color:var(--muted2)">—</span>'; }
function permMatrix(){
  const roles=Object.keys(ROLES);
  return `<div style="overflow-x:auto"><table><thead><tr><th>Роль</th>${PERM_MODS.map(m=>`<th style="text-align:center">${m[1]}</th>`).join('')}</tr></thead><tbody>
  ${roles.map(k=>{ const r=ROLES[k]; const locked=(k==='admin'||k==='owner'); const editable=_permEditing&&!locked;
    return `<tr><td><span class="pill role-${k}">${esc(r.title)}</span>${locked&&_permEditing?'<div class="t-sub">всегда полный</div>':''}</td>
    ${PERM_MODS.map(([mk])=>{const s=locked?'edit':permState(k,mk);
      return `<td style="text-align:center${editable?';cursor:pointer;user-select:none':''}"${editable?` onclick="cyclePerm('${k}','${mk}')"`:''}>${permIcon(s)}</td>`;}).join('')}</tr>`;}).join('')}
  </tbody></table></div>
  <div class="t-sub" style="margin-top:10px">✎ — редактирование · 👁 — только просмотр · — нет доступа${_permEditing?' · нажимайте на ячейку, чтобы переключать (нет → просмотр → редактирование). Администратор и Собственник всегда с полным доступом.':''}</div>`;
}
function startPermEdit(){ _permWork={}; PERM_ROLES_EDITABLE.forEach(r=>{ if(ROLES[r]) _permWork[r]={view:new Set(ROLES[r].view),edit:new Set(ROLES[r].edit)}; }); _permEditing=true; render(); }
function cancelPermEdit(){ _permEditing=false; _permWork=null; render(); }
function cyclePerm(role,mod){ const w=_permWork[role]; if(!w)return; const v=w.view.has(mod),e=w.edit.has(mod);
  if(!v&&!e){ w.view.add(mod); } else if(v&&!e){ w.view.add(mod); w.edit.add(mod); } else { w.view.delete(mod); w.edit.delete(mod); } render(); }
async function savePermEdit(){ ensureState(); const mx={};
  PERM_ROLES_EDITABLE.forEach(r=>{ const w=_permWork[r]; if(!w)return; const edit=[...w.edit]; const view=[...new Set([...w.view,...w.edit,'dashboard'])]; mx[r]={view,edit}; });
  DB.roleMatrix=mx; _permEditing=false; _permWork=null; recordAudit(); await saveState(); applyRoleOverrides(); render(); alert('Права доступа сохранены.'); }
async function delUser(id){ if(!confirm('Удалить сотрудника? Его задачи останутся без исполнителя.'))return;
  try{ await api('/api/users/'+id,'DELETE'); USERS=await api('/api/users'); await reloadTasks(); render(); }catch(e){alert(e.message);} }

/* ============================================================
   ОТЧЁТЫ
   ============================================================ */
function reports(){
  const m=metrics();
  const bs = SCOPE==='all'? buildingsList() : [buildingOf(SCOPE)].filter(Boolean);
  el(head('Отчёты и аналитика',`Сводная отчётность · ${scopeSub()}`,`<button class="btn ghost sm" onclick="exportCSV()">⤓ Экспорт CSV</button>`)+
  `<div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
    ${miniStat('Собрано (всего)',money(m.collected),'green')}${miniStat('Операц. расходы',money(m.exp),'amber')}
    ${miniStat('NOI (чистый опер. доход)',money(m.net),'blue')}${miniStat('Маржа NOI',pct(m.net,m.collected)+'%','violet')}
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:18px">
    <div class="card"><div class="panel-title"><h3>Динамика NOI</h3><span class="muted">тыс ₽</span></div><canvas id="chNOI" height="130"></canvas></div>
    <div class="card"><div class="panel-title"><h3>Заполняемость по этажам</h3><span class="muted">%</span></div><canvas id="chFloor" height="130"></canvas></div>
  </div>
  <div id="rbcards"></div>`);
  document.getElementById('rbcards').innerHTML = bs.map(b=>{
    const ps=DB.payments.filter(p=>{const c=contractOf(p.contract);return c&&unitOf(c.unit)?.building===b.id;});
    const byTenant=ps.map(p=>{const c=contractOf(p.contract);const t=c&&tenantOf(c.tenant);return{name:t?t.name:'—',billed:p.amount,paid:p.paid,debt:p.amount-p.paid};}).sort((a,b)=>b.debt-a.debt);
    const be=DB.expenses.filter(e=>(e.building||'b1')===b.id);
    const exTot=be.reduce((s,e)=>s+e.amount,0);
    const billed=byTenant.reduce((s,r)=>s+r.billed,0), paid=byTenant.reduce((s,r)=>s+r.paid,0);
    const body=`
      <div class="sec-h" style="margin-top:0">Расчёты с арендаторами</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Арендатор</th><th>Начислено</th><th>Оплачено</th><th>Задолженность</th><th>% оплаты</th></tr></thead><tbody>
      ${byTenant.length?byTenant.map(r=>`<tr><td class="t-strong">${esc(r.name)}</td><td>${money(r.billed)}</td><td>${money(r.paid)}</td><td>${r.debt>0?`<span class="pill red">${money(r.debt)}</span>`:`<span class="pill green">0 ₽</span>`}</td><td><div class="prog" style="width:90px"><span style="width:${pct(r.paid,r.billed)}%"></span></div></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Нет данных</td></tr>'}
      <tr style="border-top:2px solid var(--line2)"><td class="t-strong">Итого по объекту</td><td class="t-strong">${money(billed)}</td><td class="t-strong">${money(paid)}</td><td class="t-strong">${money(billed-paid)}</td><td class="t-strong">${pct(paid,billed)}%</td></tr>
      </tbody></table></div>
      <div class="sec-h">Расходы на содержание · итого ${money(exTot)}</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Категория</th><th>Подрядчик</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>
      ${be.length?be.map(e=>{const clk=canEdit('utilities');return `<tr${clk?` style="cursor:pointer" onclick="expenseEdit('${esc(e.id)}')"`:''}><td class="t-strong">${esc(e.category)}${e.note?`<div class="t-sub">${esc(e.note)}</div>`:''}</td><td class="t-sub">${esc(e.vendor)}</td><td class="t-strong">${money(e.amount)}</td><td>${utilPill(e.status)}</td></tr>`;}).join(''):'<tr><td colspan="4" class="empty">Нет расходов</td></tr>'}
      </tbody></table>${canEdit('utilities')?'<div class="t-sub" style="padding:6px 2px">Нажмите на строку расхода, чтобы изменить или удалить.</div>':''}</div>`;
    return collapseCard('rep-'+b.id, buildingHeader(b, `доход ${money(paid)} · расходы ${money(exTot)} · NOI ${money(paid-exTot)}`), body, false);
  }).join('') || '<div class="card"><div class="empty">Объекты не найдены</div></div>';
  new Chart(document.getElementById('chNOI'),{type:'line',data:{labels:DB.history.map(h=>h.m),datasets:[{label:'NOI',data:DB.history.map(h=>h.income-h.expense),borderColor:cssVar('--green'),backgroundColor:cssVar('--green')+'22',fill:true,tension:.35,pointRadius:3}]},options:chOpts(false)});
  const su=sUnits(); const floors=[...new Set(su.map(u=>u.floor))].sort();
  new Chart(document.getElementById('chFloor'),{type:'bar',data:{labels:floors.map(f=>'Этаж '+f),datasets:[{data:floors.map(f=>{const us=su.filter(u=>u.floor===f);const t=us.reduce((s,u)=>s+u.area,0);const o=us.filter(u=>u.tenant).reduce((s,u)=>s+u.area,0);return pct(o,t);}),backgroundColor:cssVar('--accent'),borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{max:100,grid:{color:cssVar('--chart-grid')},ticks:{color:cssVar('--muted')}},x:{grid:{display:false},ticks:{color:cssVar('--muted')}}}}});
}
function exportCSV(){
  let rows=[['Объект','Арендатор','Помещение','Период','Начислено','Оплачено','Задолженность','Статус']];
  sPayments().forEach(p=>{const c=contractOf(p.contract);if(!c)return;const b=buildingOf(unitOf(c.unit)?.building);const t=tenantOf(c.tenant);rows.push([b?b.name:'',t?t.name:'',unitNum(c.unit),p.period,p.amount,p.paid,p.amount-p.paid,p.status]);});
  const csv='﻿'+rows.map(r=>r.map(csvCell).join(';')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='otchet_arenda_2026-06.csv';a.click();
}
async function resetDemo(){ if(!confirm('Сбросить все данные (помещения, договоры, платежи, задачи) к демо? Пользователи сохранятся.'))return;
  try{ await api('/api/reset','POST'); await loadData(); render(); }catch(e){alert(e.message);} }

/* ============================================================
   ЗАРПЛАТА (ФОТ)
   ============================================================ */
let salPeriod='2026-06';
function salPill(r){ return r.paid>=r.amount?'<span class="pill green">Выплачено</span>':(r.paid>0?'<span class="pill amber">Частично</span>':'<span class="pill blue">Начислено</span>'); }
function salaries(){
  const recs=(DB.salaries||[]).filter(s=>s.period===salPeriod);
  const accrued=recs.reduce((s,x)=>s+x.amount,0), paid=recs.reduce((s,x)=>s+x.paid,0);
  const pers=[...new Set((DB.salaries||[]).map(s=>s.period))].sort().reverse(); if(!pers.includes(salPeriod))pers.unshift(salPeriod);
  el(head('Зарплата (ФОТ)',`${fmtPeriod(salPeriod)} · ${USERS.length} сотрудников`, `${canEdit('employees')?`<button class="btn ghost" onclick="userModal()">+ Сотрудник</button> `:''}${canEdit('salaries')?`<button class="btn" onclick="bulkAccrue()">Начислить всем</button>`:''}`)+
   `<div class="toolbar"><span class="t-sub">Период:</span><select class="search" style="width:auto;min-width:160px" onchange="salPeriod=this.value;render()">${pers.map(p=>`<option value="${p}"${p===salPeriod?' selected':''}>${fmtPeriod(p)}</option>`).join('')}</select></div>
   <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
     ${miniStat('ФОТ начислено',money(accrued),'violet')}${miniStat('Выплачено',money(paid),'green')}${miniStat('К выплате',money(accrued-paid),'red')}
   </div>
   <div class="card" style="padding:0"><div style="overflow-x:auto"><table><thead><tr><th>Сотрудник</th><th>Должность</th><th>Начислено</th><th>Выплачено</th><th>Статус</th>${(canEdit('salaries')||canEdit('employees'))?'<th></th>':''}</tr></thead><tbody>
   ${USERS.map(u=>{const rec=recs.find(s=>s.user_id===u.id);
     return `<tr><td class="t-strong">${esc(u.full_name)}</td><td class="t-sub">${esc(u.position||'—')}</td>
     <td>${rec?money(rec.amount):'<span class="t-sub">не начислено</span>'}</td>
     <td>${rec&&rec.paid?money(rec.paid):'—'}</td><td>${rec?salPill(rec):'<span class="pill gray">—</span>'}</td>
     ${(canEdit('salaries')||canEdit('employees'))?`<td style="text-align:right;white-space:nowrap">${canEdit('salaries')?(rec?`${rec.paid<rec.amount?`<button class="btn sm" onclick="salPayModal('${rec.id}')">Выплатить</button>`:'<span class="t-sub">выплачено</span>'} <button class="btn ghost sm" onclick="salEditModal('${rec.id}')" title="Изменить начисление">✎₽</button> <button class="btn ghost sm" onclick="delSalary('${rec.id}')" title="Удалить начисление">🗑</button>`:`<button class="btn ghost sm" onclick="salaryModal(${u.id})">Начислить</button>`):''}${canEdit('employees')?` <button class="btn ghost sm" onclick="userModal(${u.id})" title="Редактировать сотрудника">✎</button>`:''}</td>`:''}</tr>`;}).join('')}
   </tbody></table></div></div>`);
}
function salaryModal(uid){const u=userOf(uid);if(!u)return;
  openM(`<div class="modal-h"><h3>Начислить зарплату</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">${infoRow('Сотрудник',esc(u.full_name))}${infoRow('Должность',esc(u.position||'—'))}
  <div class="row2" style="margin-top:12px"><div class="field"><label>Сумма, ₽</label><input id="s-amt" type="number" value="100000"></div><div class="field"><label>Период</label><input id="s-per" type="month" value="${salPeriod}"></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveSalary(${uid})">Начислить</button></div>`);}
async function saveSalary(uid){const amt=+val('s-amt')||0;const per=val('s-per')||salPeriod;if(amt<=0)return alert('Укажите сумму');
  if(!DB.salaries)DB.salaries=[];
  if(DB.salaries.some(s=>s.user_id===uid&&s.period===per))return alert('За этот период сотруднику уже начислено');
  DB.salaries.push({id:'sal'+Date.now(),user_id:uid,period:per,amount:amt,paid:0,status:'accrued',paidDate:null,method:null});
  salPeriod=per; closeM(); await afterStateChange();}
function salTx(r){ if(Array.isArray(r.transactions)&&r.transactions.length) return r.transactions; return r.paid>0?[{amount:r.paid,date:r.paidDate,method:r.method}]:[]; }
function salPayModal(id){const r=(DB.salaries||[]).find(s=>s.id===id);if(!r)return;const u=userOf(r.user_id);const rem=r.amount-r.paid;const tx=salTx(r);
  openM(`<div class="modal-h"><h3>Выплата зарплаты / аванс</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">${infoRow('Сотрудник',esc(u?u.full_name:''))}${infoRow('Период',fmtPeriod(r.period))}${infoRow('Начислено',money(r.amount))}${infoRow('Выплачено',money(r.paid))}${infoRow('Остаток',rem>0?`<span style="color:var(--red)">${money(rem)}</span>`:'<span style="color:var(--green)">0 ₽</span>')}
  ${tx.length?`<div class="sec-h">История выплат</div>`+tx.map(x=>`<div class="doc"><div class="di">💸</div><div style="flex:1;min-width:0"><div class="t-strong">${money(x.amount)} · ${esc(payLabel(x.method))}${x.note?` · ${esc(x.note)}`:''}</div><div class="t-sub">${x.date?fmtD(x.date):'—'}</div></div></div>`).join(''):''}
  ${rem>0?`<div class="sec-h">Внести выплату или аванс</div>
  <div class="row2"><div class="field"><label>Сумма, ₽</label><input id="sp-amt" type="number" value="${rem}"></div><div class="field"><label>Дата</label><input id="sp-date" type="date" value="${TODAY.toISOString().slice(0,10)}"></div></div>
  <div class="field"><label>Способ</label><select id="sp-method">${payMethodOpts('bank')}</select></div>
  <div class="t-sub">Меньше остатка — это <b>аванс</b> (статус «Частично»). Можно вносить несколько авансов; при полной сумме статус станет «Выплачено».</div>`:'<div class="t-sub" style="margin-top:8px">Выплачено полностью.</div>'}</div>
  <div class="modal-f">${rem>0?`<button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveSalPay('${id}')">Провести</button>`:'<button class="btn" onclick="closeM()">Закрыть</button>'}</div>`);}
async function saveSalPay(id){const r=(DB.salaries||[]).find(s=>s.id===id);if(!r)return;const add=+val('sp-amt')||0;if(add<=0)return alert('Укажите сумму');
  if(!Array.isArray(r.transactions)) r.transactions = r.paid>0?[{amount:r.paid,date:r.paidDate,method:r.method}]:[];
  const date=val('sp-date')||TODAY.toISOString().slice(0,10); const method=val('sp-method');
  const isAdvance=(r.paid+add)<r.amount;
  r.transactions.push({amount:add,date,method,note:isAdvance?'аванс':'окончательный расчёт'});
  r.paid=Math.min(r.amount,r.transactions.reduce((s,x)=>s+(+x.amount||0),0));
  r.paidDate=date;r.method=method;r.status=r.paid>=r.amount?'paid':'partial';
  closeM(); await afterStateChange();}
async function bulkAccrue(){if(!confirm('Начислить зарплату всем сотрудникам за '+fmtPeriod(salPeriod)+'? (тем, у кого ещё не начислено за этот период)'))return;
  if(!DB.salaries)DB.salaries=[];
  USERS.forEach(u=>{ if(!DB.salaries.some(s=>s.user_id===u.id&&s.period===salPeriod)){ const last=[...DB.salaries].reverse().find(s=>s.user_id===u.id);
    DB.salaries.push({id:'sal'+Date.now()+'_'+u.id,user_id:u.id,period:salPeriod,amount:last?last.amount:100000,paid:0,status:'accrued',paidDate:null,method:null}); }});
  await afterStateChange();}
// изменить сумму начисления (нельзя ниже уже выплаченного)
function salEditModal(id){const r=(DB.salaries||[]).find(s=>s.id===id);if(!r)return;const u=userOf(r.user_id);
  openM(`<div class="modal-h"><h3>Изменить начисление</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">${infoRow('Сотрудник',esc(u?u.full_name:''))}${infoRow('Период',fmtPeriod(r.period))}${r.paid?infoRow('Уже выплачено',money(r.paid)):''}
  <div class="field" style="margin-top:12px"><label>Сумма начисления, ₽</label><input id="se-amt" type="number" value="${r.amount}"></div>
  ${r.paid?`<div class="t-sub">Сумму нельзя сделать меньше уже выплаченного (${money(r.paid)}).</div>`:''}</div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveSalEdit('${id}')">Сохранить</button></div>`);}
async function saveSalEdit(id){const r=(DB.salaries||[]).find(s=>s.id===id);if(!r)return;const amt=+val('se-amt')||0;
  if(amt<=0)return alert('Укажите сумму больше 0');
  if(amt<r.paid)return alert('Сумма начисления не может быть меньше уже выплаченного ('+money(r.paid)+'). Сначала измените выплату или удалите начисление.');
  r.amount=amt; r.status=r.paid>=r.amount?'paid':(r.paid>0?'partial':'accrued');
  closeM(); await afterStateChange();}
// удалить начисление (с предупреждением, если по нему была выплата)
async function delSalary(id){const r=(DB.salaries||[]).find(s=>s.id===id);if(!r)return;const u=userOf(r.user_id);
  const warn=r.paid>0?`\n\nВнимание: по начислению уже проведена выплата ${money(r.paid)} — она тоже будет удалена.`:'';
  if(!confirm(`Удалить начисление ${money(r.amount)} сотруднику ${u?u.full_name:''} за ${fmtPeriod(r.period)}?${warn}`))return;
  DB.salaries=(DB.salaries||[]).filter(s=>s.id!==id); await afterStateChange();}

/* ============================================================
   ИНТЕГРАЦИИ / СИНХРОНИЗАЦИЯ
   ============================================================ */
function fmtDateTime(iso){ try{ return new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch{ return iso; } }
/* ============================================================
   ЖУРНАЛ ДЕЙСТВИЙ (аудит)
   ============================================================ */
function auditPage(){
  if(!isAdmin()){ el('<div class="card"><div class="t-sub">Журнал доступен только администратору/собственнику.</div></div>'); return; }
  const log=(DB.audit||[]);
  el(head('Журнал действий','Кто, что и когда изменил в системе',
    log.length?`<button class="btn ghost sm" onclick="clearAudit()">Очистить журнал</button>`:'')+
  (log.length? log.map(e=>{
    const initials=(e.user||'?').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
    return `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div class="avatar" style="width:30px;height:30px;font-size:12px">${esc(initials)}</div>
        <div style="flex:1;min-width:0"><span class="t-strong">${esc(e.user||'—')}</span> <span class="t-sub">· ${esc(e.role||'')}</span></div>
        <span class="t-sub">${fmtDateTime(e.ts)}</span></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${(e.entries||[]).map(x=>{const col=/удал/.test(x)?'var(--red)':/создан/.test(x)?'var(--green)':'var(--accent2)';
          return `<div style="border-left:3px solid ${col};padding-left:10px;font-size:13px">${esc(x)}</div>`;}).join('')}
      </div></div>`;
  }).join('') : '<div class="card"><div class="empty" style="padding:30px">Журнал пуст. Действия будут записываться по мере работы (создание, изменение, удаление записей).</div></div>'));
}
async function clearAudit(){ if(!confirm('Очистить весь журнал действий? Это нельзя отменить.'))return; ensureState(); DB.audit=[]; await afterStateChange(); }

/* ============================================================
   НАСТРОЙКИ КЛИЕНТА (брендинг, модули, справочники)
   ============================================================ */
let _logoData='';
function settingsPage(){
  if(!isAdmin()){ el('<div class="card"><div class="t-sub">Раздел доступен только администратору/собственнику.</div></div>'); return; }
  const s=stg(); _logoData=s.logo||'';
  el(head('Настройки системы','Брендинг, модули и справочники — применяются только к этому клиенту','')+
  `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(330px,1fr))">
    <div class="card">
      <div class="sec-h">Брендинг</div>
      <div class="field"><label>Название компании</label><input id="s-company" value="${esc(s.company)}" placeholder="СИТИ SRM"></div>
      <div class="field"><label>Подпись под названием</label><input id="s-subtitle" value="${esc(s.subtitle)}" placeholder="Коммерческая недвижимость"></div>
      <div class="field"><label>Фирменный цвет интерфейса</label>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer"><input type="checkbox" id="s-accent-on" ${s.accent?'checked':''}> Использовать свой цвет</label>
        <input id="s-accent" type="color" value="${/^#[0-9a-fA-F]{6}$/.test(s.accent)?s.accent:'#4f8cff'}" style="width:54px;height:38px;padding:2px;border:1px solid var(--line2);border-radius:8px;cursor:pointer"></div>
      <div class="field"><label>Логотип (PNG/JPG, до 500 КБ)</label>
        <input id="s-logo" type="file" accept="image/png,image/jpeg" onchange="onLogoFile(this)">
        <div id="logoPrev" style="margin-top:8px">${_logoData?`<img src="${_logoData}" style="max-height:64px;border-radius:8px;background:#fff;padding:6px;box-shadow:var(--shadow)">`:'<span class="t-sub">Логотип по умолчанию (городской силуэт)</span>'}</div>
        ${_logoData?`<button class="btn ghost sm" style="margin-top:6px" onclick="clearLogo()">Убрать логотип</button>`:''}</div>
    </div>
    <div class="card">
      <div class="sec-h">Модули (показывать в меню)</div>
      ${TOGGLEABLE.map(([k,label])=>`<label style="display:flex;align-items:center;gap:10px;padding:7px 2px;cursor:pointer;border-bottom:1px solid var(--line)">
        <input type="checkbox" class="s-mod" data-k="${k}" ${modOn(k)?'checked':''}> <span>${label}</span></label>`).join('')}
      <div class="t-sub" style="margin-top:10px">«Дашборд» и «Настройки» скрыть нельзя. Права ролей действуют поверх этих настроек.</div>
    </div>
    <div class="card">
      <div class="sec-h">Справочники</div>
      <div class="t-sub" style="margin-bottom:10px">По одному значению в строке. Используются в выпадающих списках и подсказках.</div>
      <div class="field"><label>Категории расходов</label>
        <textarea id="s-expcats" rows="6" class="search" style="width:100%;resize:vertical;font-family:inherit">${esc((s.expenseCats||[]).join('\n'))}</textarea></div>
      <div class="field"><label>Типы помещений</label>
        <textarea id="s-unittypes" rows="4" class="search" style="width:100%;resize:vertical;font-family:inherit">${esc((s.unitTypes||[]).join('\n'))}</textarea></div>
      <div class="field"><label>Доп. способы оплаты <span class="t-sub">(к встроенным: Наличные, Безналичный, Карта, Перевод)</span></label>
        <textarea id="s-paymethods" rows="3" class="search" style="width:100%;resize:vertical;font-family:inherit" placeholder="Например: СБП&#10;Взаимозачёт">${esc((s.payMethodsExtra||[]).join('\n'))}</textarea></div>
    </div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="sec-h">💬 AI-помощник</div>
    <div class="t-sub" style="margin-bottom:10px">Встроенный помощник отвечает на вопросы по работе с системой и простым вопросам по данным («кто не заплатил»). Только подсказки — ничего не меняет. Ключ модели задаётся в окружении сервера (в настройках не хранится).</div>
    <div class="t-sub" style="margin-bottom:8px">Ключ модели в окружении: <b style="color:${ASSIST_KEY?'var(--green)':'var(--red)'}">${ASSIST_KEY?'задан ✓':'не задан'}</b> · провайдер: <b>${esc(ASSIST_PROVIDER)}</b></div>
    <label style="display:flex;align-items:center;gap:10px;padding:7px 0;cursor:pointer"><input type="checkbox" id="s-assist-on" ${s.assistant?.enabled?'checked':''} ${ASSIST_KEY?'':'disabled'}> <span>Включить помощника${ASSIST_KEY?'':' <span class="t-sub">(сначала задайте ключ в окружении клиента)</span>'}</span></label>
    <label style="display:flex;align-items:center;gap:10px;padding:7px 0;cursor:pointer"><input type="checkbox" id="s-assist-act" ${s.assistant?.actions!==false?'checked':''}> <span>Разрешить выполнять действия <span class="t-sub">(оплата, задачи, заявки, договоры — всегда с кнопкой подтверждения; в рамках прав сотрудника, с записью в аудит)</span></span></label>
    <div class="row2">
      <div class="field"><label>Провайдер модели</label><select id="s-assist-prov"><option value="gigachat"${(s.assistant?.provider||'gigachat')==='gigachat'?' selected':''}>GigaChat (Сбер)</option><option value="yandexgpt"${s.assistant?.provider==='yandexgpt'?' selected':''}>YandexGPT</option></select></div>
      <div class="field"><label>Лимит вопросов в день (на клиента)</label><input id="s-assist-limit" type="number" min="1" max="100000" value="${Math.max(1,+s.assistant?.dailyLimit||250)}"></div>
    </div>
    <div class="t-sub">Провайдер выбирается переменной окружения <code>LLM_PROVIDER</code>; здесь — отметка для удобства. По умолчанию помощник выключен.</div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="sec-h" style="display:flex;align-items:center;justify-content:space-between"><span>📨 Уведомления в Telegram</span><button class="btn ghost sm" onclick="botHelp()">ℹ️ Как настроить бота</button></div>
    <div class="t-sub" style="margin-bottom:10px">Бот присылает сводку утром и/или мгновенные оповещения о новых заявках и задачах. Не знаете, как подключить — нажмите «ℹ️ Как настроить бота».</div>
    <label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer"><input type="checkbox" id="s-tg-on" ${s.notify?.telegram?.enabled?'checked':''}> Включить ежедневную сводку (по московскому времени)</label>
    <label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer"><input type="checkbox" id="s-tg-instant" ${s.notify?.telegram?.instant?'checked':''}> Мгновенные оповещения о новых заявках и задачах</label>
    <div class="row2"><div class="field"><label>Токен бота (от @BotFather)</label><input id="s-tg-token" value="${esc(s.notify?.telegram?.token||'')}" placeholder="123456:ABC-..."></div>
      <div class="field"><label>Chat ID (куда слать)</label><input id="s-tg-chat" value="${esc(s.notify?.telegram?.chatId||'')}" placeholder="напр. 123456789 или -100..."></div></div>
    <div class="row2"><div class="field"><label>Время отправки</label><input id="s-tg-time" type="time" value="${esc(s.notify?.telegram?.time||'08:00')}"></div>
      <div class="field" style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap"><button class="btn ghost" onclick="testNotify()">📨 Сохранить и проверить связь</button><button class="btn" onclick="sendDigestNow()">📊 Отправить сводку сейчас</button></div></div>
    <div class="t-sub" style="margin-top:8px">Как настроить: 1) в Telegram напишите <b>@BotFather</b> → /newbot → получите <b>токен</b>. 2) Напишите своему боту любое сообщение (или добавьте его в группу). 3) Узнайте <b>Chat ID</b> через бота <b>@userinfobot</b> (для себя) или @getidsbot (для группы). 4) Вставьте сюда и нажмите «Отправить тест».</div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="sec-h">⚙ Автоматизация</div>
    <div class="t-sub" style="margin-bottom:10px">Чтобы убрать ручную рутину. По умолчанию выключено — включайте по необходимости. Работает идемпотентно: повторный запуск не создаёт дублей.</div>
    <label style="display:flex;align-items:center;gap:10px;padding:7px 0;cursor:pointer;border-bottom:1px solid var(--line)"><input type="checkbox" id="s-autorent" ${s.autoRent?.enabled?'checked':''}> <span><b>Автоначисление аренды по графику</b><div class="t-sub">Каждый месяц система сама создаёт начисления по всем активным договорам (ставка × площадь). Ручное «+ Начисление» продолжает работать.</div></span></label>
    <div class="row2" style="margin-top:10px">
      <div class="field"><label>День начисления (число месяца)</label><input id="s-autorent-day" type="number" min="1" max="28" value="${Math.min(28,Math.max(1,+s.autoRent?.accrualDay||1))}"></div>
      <div class="field"><label>День срока оплаты (число месяца)</label><input id="s-autorent-due" type="number" min="1" max="28" value="${Math.min(28,Math.max(1,+s.autoRent?.dueDay||5))}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:10px;padding:10px 0 7px;cursor:pointer;border-top:1px solid var(--line);margin-top:10px"><input type="checkbox" id="s-autoremind" ${s.autoRemind?.enabled?'checked':''}> <span><b>Авто-напоминания должникам</b><div class="t-sub">По просроченным платежам система готовит сводку должников (и шлёт в Telegram, если подключён). Не чаще одного напоминания на долг в заданное число дней.</div></span></label>
    <div class="field" style="max-width:240px"><label>Не чаще, чем раз в (дней)</label><input id="s-autoremind-days" type="number" min="1" max="90" value="${Math.max(1,+s.autoRemind?.everyDays||7)}"></div>
    <label style="display:flex;align-items:center;gap:10px;padding:10px 0 7px;cursor:pointer;border-top:1px solid var(--line);margin-top:10px"><input type="checkbox" id="s-autoindex" ${s.autoIndex?.enabled?'checked':''}> <span><b>Автоиндексация ставок</b><div class="t-sub">В годовщину начала договора ставка повышается на заложенный % индексации. История изменений видна в карточке договора. По умолчанию выключено (повышение ставки — чувствительно).</div></span></label>
    <label style="display:flex;align-items:center;gap:10px;padding:10px 0 7px;cursor:pointer;border-top:1px solid var(--line);margin-top:10px"><input type="checkbox" id="s-autoowner" ${s.autoOwnerUtil?.enabled?'checked':''}> <span><b>Автоначисление коммуналки собственникам</b><div class="t-sub">Каждый месяц в заданный день система начисляет коммуналку (отопление) сторонним собственникам по фиксированной сумме, заданной в карточке помещения. Помещения без проданного статуса и без суммы — пропускаются.</div></span></label>
    <div class="field" style="max-width:240px"><label>День начисления (число месяца)</label><input id="s-autoowner-day" type="number" min="1" max="28" value="${Math.min(28,Math.max(1,+s.autoOwnerUtil?.day||1))}"></div>
  </div>
  ${isAdmin()?`<div class="card" style="margin-top:16px">
    <div class="sec-h">💾 Резервное копирование базы</div>
    <div class="t-sub" style="margin-bottom:10px">Скачайте копию всех данных одним файлом: объекты, помещения, арендаторы, договоры, платежи, коммуналка, ФОТ, бюджет, заявки, ТО, реклама, задачи и настройки. Храните файл у себя — из него в любой момент можно восстановить базу.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn" onclick="downloadBackup()">⤓ Скачать бэкап</button>
      <label class="btn ghost" style="cursor:pointer;margin:0">↥ Восстановить из бэкапа<input type="file" accept=".json,application/json" style="display:none" onchange="restoreBackup(this)"></label>
    </div>
    <div class="t-sub" style="margin-top:8px;color:var(--amber)">⚠️ Восстановление ПОЛНОСТЬЮ заменит текущие данные данными из файла. Перед восстановлением сделайте свежий бэкап.</div>
  </div>`:''}
  <div class="card" style="margin-top:16px">
    <div class="sec-h">📟 Тарифы для показаний счётчиков</div>
    <div class="t-sub" style="margin-bottom:10px">Используются при вводе показаний (Коммуналка → «📟 Показания»): сумма = (текущее − предыдущее) × тариф. В форме можно переопределить.</div>
    <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px">
      <div class="field" style="margin:0"><label>Электро, ₽/кВт·ч</label><input id="s-tar-electricity" type="number" step="any" value="${+s.tariffs?.electricity||0}"></div>
      <div class="field" style="margin:0"><label>Вода, ₽/м³</label><input id="s-tar-water" type="number" step="any" value="${+s.tariffs?.water||0}"></div>
      <div class="field" style="margin:0"><label>Отопление, ₽/м²</label><input id="s-tar-heating" type="number" step="any" value="${+s.tariffs?.heating||0}"></div>
    </div>
  </div>
  <div style="margin-top:16px;display:flex;gap:10px"><button class="btn" onclick="saveSettings()">💾 Сохранить настройки</button>
    <span class="t-sub" style="align-self:center">Изменения видят все пользователи этого клиента.</span></div>`);
}
function botHelp(){
  const steps=[
    'Откройте Telegram и в поиске найдите <b>@BotFather</b> (official, с галочкой). Напишите ему <b>/newbot</b>.',
    'Придумайте имя бота (любое) и логин — он должен заканчиваться на <b>bot</b> (например <i>citisrm_alerts_bot</i>). BotFather пришлёт <b>токен</b> вида <code>123456789:AAH...xyz</code> — скопируйте его.',
    'Найдите своего нового бота по логину и нажмите <b>«Запустить» / Start</b> (или напишите ему любое сообщение). Без этого бот не сможет вам писать.',
    'Узнайте свой <b>Chat ID</b>: напишите боту <b>@userinfobot</b> — он пришлёт ваш ID (число, например 123456789).',
    'Если хотите слать в <b>рабочую группу</b>: добавьте своего бота в группу, затем добавьте туда же <b>@getidsbot</b> — он покажет ID группы (начинается с <b>-100…</b>).',
    'Вернитесь в СИТИ SRM → «Настройки» → раздел Telegram. Вставьте <b>токен</b> и <b>Chat ID</b>, выберите время сводки, включите нужные галочки.',
    'Нажмите <b>«Сохранить и отправить тест сейчас»</b> — в чат с ботом должна прийти тестовая сводка. Готово!'
  ];
  openM(`<div class="modal-h"><h3>📨 Как настроить Telegram-бота</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-sub" style="margin-bottom:12px">Пошагово, для новичка. Займёт ~5 минут, всё бесплатно.</div>
    <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px;line-height:1.55">${steps.map(s=>`<li>${s}</li>`).join('')}</ol>
    <div class="card" style="margin-top:14px;background:var(--bg2)"><div class="t-strong" style="margin-bottom:4px">Если тест не пришёл:</div>
      <div class="t-sub">• Проверьте, что вы нажали Start/написали боту хотя бы раз.<br>• Токен скопирован полностью, без пробелов.<br>• Chat ID — это число (для группы — с минусом, начинается на -100).<br>• Для группы бот должен быть её участником.</div></div>
  </div>
  <div class="modal-f"><button class="btn" onclick="closeM()">Понятно</button></div>`);
}
async function testNotify(){ ensureState();
  DB.settings.notify={telegram:{enabled:document.getElementById('s-tg-on').checked,instant:!!document.getElementById('s-tg-instant')?.checked,token:val('s-tg-token').trim(),chatId:val('s-tg-chat').trim(),time:val('s-tg-time')||'08:00'}};
  if(!DB.settings.notify.telegram.token||!DB.settings.notify.telegram.chatId){ return alert('Сначала введите токен бота и Chat ID.'); }
  await saveState();
  try{ const r=await api('/api/notify/test','POST'); alert(r.ok?'✅ Проверка связи прошла — сообщение отправлено в Telegram. Проверьте чат с ботом.':('❌ Не удалось отправить.\n\nПричина: '+(r.error||'неизвестна')+'\n\nПроверьте токен и Chat ID и что вы написали боту хотя бы раз.')); }
  catch(e){ alert('Ошибка: '+(e.message||e)); }
}
async function sendDigestNow(){ ensureState();
  DB.settings.notify={telegram:{enabled:document.getElementById('s-tg-on').checked,instant:!!document.getElementById('s-tg-instant')?.checked,token:val('s-tg-token').trim(),chatId:val('s-tg-chat').trim(),time:val('s-tg-time')||'08:00'}};
  if(!DB.settings.notify.telegram.token||!DB.settings.notify.telegram.chatId){ return alert('Сначала введите токен бота и Chat ID.'); }
  await saveState();
  try{ const r=await api('/api/notify/digest','POST'); alert(r.ok?'✅ Сводка отправлена в Telegram. Проверьте чат с ботом.':('❌ Не удалось отправить.\n\nПричина: '+(r.error||'неизвестна')+'\n\nПроверьте токен и Chat ID и что вы написали боту хотя бы раз.')); }
  catch(e){ alert('Ошибка: '+(e.message||e)); }
}
function onLogoFile(input){ const f=input.files&&input.files[0]; if(!f)return;
  if(!/^image\/(png|jpeg)$/.test(f.type)){ alert('Только PNG или JPG.'); input.value=''; return; }
  if(f.size>500*1024){ alert('Файл больше 500 КБ — выберите меньше.'); input.value=''; return; }
  const r=new FileReader(); r.onload=()=>{ _logoData=String(r.result||'');
    const p=document.getElementById('logoPrev'); if(p)p.innerHTML=`<img src="${_logoData}" style="max-height:64px;border-radius:8px;background:#fff;padding:6px;box-shadow:var(--shadow)">`; };
  r.readAsDataURL(f); }
function clearLogo(){ _logoData=''; settingsPage(); }

/* ---------- Резервное копирование базы (только админ) ---------- */
// Скачать бэкап: всё состояние (объекты/помещения/договоры/платежи/…/настройки) + задачи, одним JSON-файлом.
function downloadBackup(){
  if(!isAdmin()) return alert('Бэкап доступен только администратору.');
  try{
    const data={ app:'СИТИ SRM', version:1, date:new Date().toISOString(), state:DB, tasks:Array.isArray(window.TASKS)?TASKS:[] };
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='citi-srm-backup-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  }catch(e){ alert('Не удалось сформировать бэкап: '+(e.message||e)); }
}
// Восстановить из бэкапа: заменяет данные целиком (с двойным подтверждением).
async function restoreBackup(input){
  const f=input.files&&input.files[0]; input.value=''; if(!f)return;
  if(!isAdmin()) return alert('Восстановление доступно только администратору.');
  if(f.size>30*1024*1024) return alert('Файл больше 30 МБ — похоже, это не бэкап.');
  let data; try{ data=JSON.parse(await f.text()); }catch{ return alert('Файл не читается как бэкап (ожидается JSON).'); }
  const st=data&&data.state;
  if(!st||typeof st!=='object'||!Array.isArray(st.buildings)||!Array.isArray(st.units))
    return alert('Это не похоже на бэкап СИТИ SRM (нет объектов/помещений).');
  const info=`Объектов: ${st.buildings.length}\nПомещений: ${st.units.length}\nАрендаторов: ${(st.tenants||[]).length}\nДоговоров: ${(st.contracts||[]).length}\nПлатежей: ${(st.payments||[]).length}\nЗадач: ${Array.isArray(data.tasks)?data.tasks.length:0}`;
  if(!confirm(`ВНИМАНИЕ! Восстановление ПОЛНОСТЬЮ заменит текущие данные.\n\nВ файле (бэкап от ${data.date?String(data.date).slice(0,10):'—'}):\n${info}\n\nТекущие данные будут потеряны безвозвратно. Продолжить?`)) return;
  if(!confirm('Последнее предупреждение: перезаписать текущую базу данными из файла?')) return;
  try{
    await api('/api/backup/restore','POST',{state:st,tasks:Array.isArray(data.tasks)?data.tasks:[]});
    alert('База восстановлена из бэкапа. Страница будет перезагружена.');
    location.reload();
  }catch(e){ alert('Не удалось восстановить: '+(e.message||e)); }
}

async function saveSettings(){
  ensureState(); const S=DB.settings;
  S.company=(val('s-company')||'').trim()||'СИТИ SRM';
  S.subtitle=(val('s-subtitle')||'').trim();
  const useAccent=document.getElementById('s-accent-on').checked; const ac=val('s-accent');
  S.accent=(useAccent && /^#[0-9a-fA-F]{6}$/.test(ac))?ac:'';
  S.logo=_logoData||'';
  const mods={}; document.querySelectorAll('.s-mod').forEach(c=>{ mods[c.dataset.k]=c.checked; }); S.modules=mods;
  const lines=id=>(val(id)||'').split('\n').map(x=>x.trim()).filter(Boolean);
  S.expenseCats=lines('s-expcats');
  S.unitTypes=lines('s-unittypes');
  S.payMethodsExtra=lines('s-paymethods');
  if(document.getElementById('s-tg-on')) S.notify={telegram:{enabled:document.getElementById('s-tg-on').checked,instant:!!document.getElementById('s-tg-instant')?.checked,token:val('s-tg-token').trim(),chatId:val('s-tg-chat').trim(),time:val('s-tg-time')||'08:00'}};
  if(document.getElementById('s-autorent')) S.autoRent={enabled:document.getElementById('s-autorent').checked,accrualDay:Math.min(28,Math.max(1,+val('s-autorent-day')||1)),dueDay:Math.min(28,Math.max(1,+val('s-autorent-due')||5))};
  if(document.getElementById('s-autoremind')) S.autoRemind={enabled:document.getElementById('s-autoremind').checked,everyDays:Math.max(1,+val('s-autoremind-days')||7)};
  if(document.getElementById('s-tar-electricity')) S.tariffs={electricity:+val('s-tar-electricity')||0,water:+val('s-tar-water')||0,heating:+val('s-tar-heating')||0};
  if(document.getElementById('s-autoindex')) S.autoIndex={enabled:document.getElementById('s-autoindex').checked};
  if(document.getElementById('s-autoowner')) S.autoOwnerUtil={enabled:document.getElementById('s-autoowner').checked,day:Math.min(28,Math.max(1,+val('s-autoowner-day')||1))};
  if(document.getElementById('s-assist-on')) S.assistant={enabled:document.getElementById('s-assist-on').checked,provider:val('s-assist-prov')||'gigachat',actions:!!document.getElementById('s-assist-act')?.checked,dailyLimit:Math.max(1,+val('s-assist-limit')||250)};
  await afterStateChange();
  applyAccent(); showApp();
}
/* ============================================================
   C1. ИМПОРТ ИЗ CSV (объекты / помещения / арендаторы / договоры)
   ============================================================ */
const IMPORT_DEFS={
  buildings:{title:'Объекты',cols:[{k:'name',label:'Название'},{k:'address',label:'Адрес'}],need:'objects'},
  units:{title:'Помещения',cols:[{k:'id',label:'Номер'},{k:'building',label:'Объект'},{k:'floor',label:'Этаж'},{k:'area',label:'Площадь'},{k:'type',label:'Тип'}],need:'objects'},
  tenants:{title:'Арендаторы',cols:[{k:'name',label:'Название'},{k:'inn',label:'ИНН'},{k:'contact',label:'Контакт'},{k:'phone',label:'Телефон'},{k:'email',label:'Email'},{k:'industry',label:'Отрасль'}],need:'tenants'},
  contracts:{title:'Договоры',cols:[{k:'tenant',label:'Арендатор (название/ИНН)'},{k:'unit',label:'Помещение'},{k:'rate',label:'Ставка ₽/м²'},{k:'start',label:'Начало (ГГГГ-ММ-ДД)'},{k:'end',label:'Окончание (ГГГГ-ММ-ДД)'},{k:'indexation',label:'Индексация %'}],need:'contracts'},
};
function parseCSV(text){
  const rows=[]; let i=0, field='', row=[], inQ=false; text=String(text||'').replace(/\r\n?/g,'\n');
  while(i<text.length){ const ch=text[i];
    if(inQ){ if(ch==='"'){ if(text[i+1]==='"'){field+='"';i+=2;continue;} inQ=false;i++;continue;} field+=ch;i++;continue; }
    if(ch==='"'){ inQ=true;i++;continue; }
    if(ch===','||ch===';'){ row.push(field);field='';i++;continue; }
    if(ch==='\n'){ row.push(field);rows.push(row);row=[];field='';i++;continue; }
    field+=ch;i++; }
  if(field.length||row.length){ row.push(field);rows.push(row); }
  return rows.filter(r=>r.some(c=>String(c).trim()!==''));
}
let _importPrep=null;
function importModal(type){
  type=type||'buildings'; const ed=canEdit(IMPORT_DEFS[type].need); if(!ed && !isAdmin()){ return alert('Недостаточно прав для импорта.'); }
  _importPrep=null;
  const opts=Object.entries(IMPORT_DEFS).filter(([k,d])=>canEdit(d.need)||isAdmin()).map(([k,d])=>`<option value="${k}"${k===type?' selected':''}>${d.title}</option>`).join('');
  openM(`<div class="modal-h"><h3>⤓ Импорт из таблицы (Excel / CSV)</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="field"><label>Что импортируем</label><select id="imp-type" onchange="importModal(this.value)">${opts}</select></div>
    ${type==='units'?`<div class="field"><label>Импортировать в объект</label>
      <select id="imp-target" onchange="importPreview('units')"><option value="">— брать из столбца «Объект» (создаст новый, если такого нет)</option>${buildingsList().map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
      <div class="t-sub" style="margin-top:3px">Если выбрать объект — все строки попадут в него, независимо от столбца «Объект».</div></div>`:''}
    <div class="t-sub" style="margin-bottom:8px">Скачайте шаблон, заполните в Excel/Google Таблицах и загрузите файл <b>.xlsx</b> или <b>.csv</b> (либо вставьте текстом). Берётся первый лист. Импорт только добавляет новые строки; дубли по ключу пропускаются.</div>
    <button class="btn ghost sm" onclick="downloadTemplate('${type}')">⤓ Скачать шаблон ${IMPORT_DEFS[type].title}</button>
    <div class="field" style="margin-top:10px"><label>Файл Excel (.xlsx) или CSV</label><input type="file" accept=".xlsx,.xls,.csv,text/csv" onchange="importFile(this)"></div>
    <div class="field"><label>…или вставьте содержимое таблицы</label><textarea id="imp-text" rows="6" class="search" style="width:100%;resize:vertical;font-family:monospace;font-size:12px" placeholder="${IMPORT_DEFS[type].cols.map(c=>c.label).join(',')}"></textarea></div>
    <button class="btn ghost" onclick="importPreview('${type}')">Проверить</button>
    <div id="imp-preview" style="margin-top:12px"></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Закрыть</button><button class="btn" id="imp-apply" disabled onclick="importApply('${type}')">Импортировать</button></div>`);
}
function downloadTemplate(type){ const d=IMPORT_DEFS[type]; const header=d.cols.map(c=>c.label).join(',');
  const sample={buildings:'БЦ Пример,"г. Москва, ул. Примерная, 1"',units:'1-01,БЦ Пример,1,100,Офис',tenants:'ООО Ромашка,7700000000,Иванов Иван,+7 900 000-00-00,mail@romashka.ru,IT',contracts:'ООО Ромашка,1-01,2200,2026-07-01,2029-06-30,6'}[type]||'';
  const blob=new Blob(['﻿'+header+'\n'+sample+'\n'],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='shablon_'+type+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
let _xlsxPromise=null;
async function ensureXLSX(){ if(window.XLSX) return window.XLSX;
  if(!_xlsxPromise) _xlsxPromise=loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  await _xlsxPromise; if(!window.XLSX) throw new Error('Библиотека Excel не загрузилась'); return window.XLSX; }
async function importFile(input){ const f=input.files&&input.files[0]; if(!f)return; if(f.size>4*1024*1024){alert('Файл больше 4 МБ');return;}
  const ta=document.getElementById('imp-text'); const sel=document.getElementById('imp-type');
  const isXlsx=/\.(xlsx|xlsm|xls)$/i.test(f.name)||/spreadsheet|excel/i.test(f.type||'');
  try{
    if(isXlsx){
      const XLSX=await ensureXLSX(); const buf=await f.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
      if(!ws) throw new Error('в файле нет листа с данными');
      if(ta) ta.value=XLSX.utils.sheet_to_csv(ws);   // первый лист → CSV, дальше обычный путь импорта
    } else {
      const txt=await f.text().catch(()=> ''); if(ta) ta.value=txt;
    }
  }catch(e){ alert('Не удалось прочитать файл: '+(e.message||e)); return; }
  if(sel) importPreview(sel.value);   // сразу показать предпросмотр
}
function importPreview(type){
  const d=IMPORT_DEFS[type]; const rows=parseCSV(val('imp-text')); const box=document.getElementById('imp-preview'); const applyBtn=document.getElementById('imp-apply');
  if(rows.length<2){ box.innerHTML='<div class="t-sub" style="color:var(--red)">Нет данных. Нужна строка заголовков и хотя бы одна строка.</div>'; applyBtn.disabled=true; return; }
  const hdr=rows[0].map(h=>String(h).trim().toLowerCase());
  const idx={}; d.cols.forEach(c=>{ idx[c.k]=hdr.findIndex(h=>h===c.k||h===c.label.toLowerCase()||h.startsWith(c.label.toLowerCase().split(' ')[0])); });
  const toAdd=[], errors=[];
  for(let r=1;r<rows.length;r++){ const row=rows[r]; const get=k=>idx[k]>=0?String(row[idx[k]]||'').trim():'';
    const rec=buildImportRec(type,get,errors,r+1); if(rec) toAdd.push(rec); }
  _importPrep={type,toAdd};
  // новые объекты, которые импорт создаст автоматически (для помещений с неизвестным объектом)
  const newObjs=[...new Set(toAdd.filter(r=>typeof r.building==='string'&&r.building.startsWith('__new__:')).map(r=>r.building.slice(8)))];
  box.innerHTML=`<div class="card" style="background:var(--bg2)"><div class="t-strong">Будет добавлено: ${toAdd.length}</div>
    ${newObjs.length?`<div class="t-sub" style="color:var(--accent2);margin-top:4px">Будет создан новый объект: ${newObjs.map(esc).join(', ')}</div>`:''}
    ${errors.length?`<div class="t-sub" style="color:var(--amber);margin-top:6px">Пропущено строк: ${errors.length}<br>${errors.slice(0,8).map(esc).join('<br>')}${errors.length>8?'<br>…':''}</div>`:'<div class="t-sub" style="color:var(--green);margin-top:6px">Ошибок не найдено.</div>'}</div>`;
  applyBtn.disabled = toAdd.length===0;
}
function buildImportRec(type,get,errors,line){
  if(type==='buildings'){ const name=get('name'); if(!name){errors.push(`Строка ${line}: пустое название`);return null;}
    if(buildingsList().some(b=>b.name.toLowerCase()===name.toLowerCase())){errors.push(`Строка ${line}: объект «${name}» уже есть`);return null;}
    return {id:'b'+Date.now()+'_'+line,name,address:get('address')}; }
  if(type==='units'){ const num=get('id').replace(/[<>"'`&]/g,''); if(!num){errors.push(`Строка ${line}: пустой номер`);return null;}
    const targetId=(typeof val==='function'?val('imp-target'):'')||'';   // выбранный объект переопределяет столбец
    let b=null, buildingRef, seed;
    if(targetId){ b=buildingOf(targetId)||null; buildingRef=b?b.id:targetId; seed=targetId; }
    else { const bn=(get('building')||'').trim(); if(!bn){errors.push(`Строка ${line}: не указан объект`);return null;}
      b=buildingsList().find(x=>x.name.toLowerCase()===bn.toLowerCase()||x.id===bn)||null;
      buildingRef = b ? b.id : ('__new__:'+bn.replace(/[<>"'`&]/g,''));   // если нет — автосоздание при импорте
      seed=bn; }
    // дубликат — только В ЭТОМ объекте (для нового объекта дублей нет)
    if(b && DB.units.some(u=>u.building===b.id && (u.num||u.id)===num)){errors.push(`Строка ${line}: помещение «${num}» уже есть в этом объекте`);return null;}
    const id=genUnitId(num,seed);   // глобально-уникальный внутренний id; при коллизии между объектами id≠num
    return {id,num,building:buildingRef,floor:+get('floor')||1,area:+String(get('area')).replace(',','.')||0,type:get('type')||'Офис',tenant:null,status:'free',ownership:'own',owner:null,responsible:null,documents:[]}; }
  if(type==='tenants'){ const name=get('name'); if(!name){errors.push(`Строка ${line}: пустое название`);return null;}
    if(DB.tenants.some(t=>t.name.toLowerCase()===name.toLowerCase()||(get('inn')&&t.inn===get('inn')))){errors.push(`Строка ${line}: арендатор «${name}» уже есть`);return null;}
    return {id:'t'+Date.now()+'_'+line,name,inn:get('inn'),contact:get('contact'),phone:get('phone'),email:get('email'),industry:get('industry')}; }
  if(type==='contracts'){ const tn=get('tenant'); const un=get('unit');
    const t=DB.tenants.find(x=>x.name.toLowerCase()===tn.toLowerCase()||x.inn===tn); if(!t){errors.push(`Строка ${line}: арендатор «${tn}» не найден`);return null;}
    const u=DB.units.find(x=>x.id===un); if(!u){errors.push(`Строка ${line}: помещение «${un}» не найдено`);return null;}
    if(DB.contracts.some(c=>c.unit===un&&c.status!=='ended')){errors.push(`Строка ${line}: по помещению «${un}» уже есть договор`);return null;}
    const rate=+String(get('rate')).replace(',','.')||0; const start=get('start'),end=get('end');
    return {id:'c'+Date.now()+'_'+line,tenant:t.id,unit:un,rate,start,end,deposit:Math.round(rate*(u.area||0)),indexation:+get('indexation')||0,status:'active',_setTenant:t.id}; }
  return null;
}
async function importApply(type){
  if(!_importPrep||_importPrep.type!==type||!_importPrep.toAdd.length) return;
  const add=_importPrep.toAdd;
  let newObjNames=[];
  if(type==='buildings') DB.buildings.push(...add);
  else if(type==='units'){
    // автосоздание объектов, которых ещё нет (building='__new__:<имя>')
    const nameToId={};
    add.forEach(u=>{ if(typeof u.building==='string' && u.building.startsWith('__new__:')){
      const nm=u.building.slice(8);
      let id=nameToId[nm.toLowerCase()];
      if(!id){ const ex=buildingsList().find(x=>x.name.toLowerCase()===nm.toLowerCase());
        if(ex){ id=ex.id; } else { id='b'+Date.now()+'_'+Math.random().toString(36).slice(2,6); DB.buildings.push({id,name:nm,address:''}); newObjNames.push(nm); }
        nameToId[nm.toLowerCase()]=id; }
      u.building=id;
    }});
    DB.units.push(...add);
  }
  else if(type==='tenants') DB.tenants.push(...add);
  else if(type==='contracts'){ add.forEach(c=>{ const u=unitOf(c.unit); if(u)u.tenant=c._setTenant; delete c._setTenant; }); DB.contracts.push(...add); }
  _importPrep=null; closeM(); await afterStateChange();
  alert(`Импортировано: ${add.length}.${newObjNames.length?` Создан объект: ${newObjNames.join(', ')}.`:''} Готово.`);
}

/* ============================================================
   C2. МАСТЕР ПЕРВОГО ЗАПУСКА (онбординг)
   ============================================================ */
const WIZ_KEY='citi_srm_wizard_done';
let _wiz=null;
function startWizard(){ _wiz={step:1,buildingId:(buildingsList()[0]||{}).id||null,unitId:null,tenantId:null}; wizardModal(); }
function wizardModal(){
  if(!_wiz) _wiz={step:1}; const s=_wiz.step, total=5;
  const prog=`<div style="display:flex;gap:6px;margin-bottom:14px">${[1,2,3,4,5].map(i=>`<div style="flex:1;height:6px;border-radius:3px;background:${i<=s?'var(--accent)':'var(--line2)'}"></div>`).join('')}</div>`;
  let body='';
  if(s===1) body=`<div class="sec-h">Шаг 1 из ${total}: Объект</div><div class="t-sub" style="margin-bottom:8px">Добавьте первое здание.</div>
    <div class="field"><label>Название объекта</label><input id="wz-bname" placeholder="БЦ «Пример»"></div>
    <div class="field"><label>Адрес</label><input id="wz-baddr" placeholder="г. Москва, ул. …"></div>`;
  else if(s===2) body=`<div class="sec-h">Шаг 2 из ${total}: Помещение</div>
    <div class="field"><label>Номер помещения</label><input id="wz-uid" placeholder="1-01"></div>
    <div class="row2"><div class="field"><label>Этаж</label><input id="wz-ufloor" type="number" value="1"></div><div class="field"><label>Площадь, м²</label><input id="wz-uarea" type="number" value="100"></div></div>
    <div class="field"><label>Тип</label><input id="wz-utype" value="Офис"></div>`;
  else if(s===3) body=`<div class="sec-h">Шаг 3 из ${total}: Арендатор</div>
    <div class="field"><label>Название</label><input id="wz-tname" placeholder="ООО «Ромашка»"></div>
    <div class="row2"><div class="field"><label>ИНН</label><input id="wz-tinn"></div><div class="field"><label>Контактное лицо</label><input id="wz-tcontact"></div></div>
    <div class="field"><label>Телефон</label><input id="wz-tphone"></div>`;
  else if(s===4) body=`<div class="sec-h">Шаг 4 из ${total}: Договор</div>
    <div class="row2"><div class="field"><label>Тип ставки</label>${rateTypeSelect('wz-cratetype','sqm')}</div><div class="field"><label id="wz-cratetype-lbl">Ставка ₽/м²/мес</label><input id="wz-crate" type="number" value="2200"></div></div>
    <div class="field"><label>Индексация %/год</label><input id="wz-cidx" type="number" value="6"></div>
    <div class="row2"><div class="field"><label>Начало</label><input id="wz-cstart" type="date" value="${TODAY.toISOString().slice(0,10)}"></div><div class="field"><label>Окончание</label><input id="wz-cend" type="date" value="${addMonths(TODAY.toISOString().slice(0,10),36)}"></div></div>
    <div class="t-sub">Свяжет созданные помещение и арендатора.</div>`;
  else body=`<div style="text-align:center"><div style="font-size:42px">🎉</div><div class="t-strong" style="font-size:17px;margin:6px 0">Готово! Первый объект заведён.</div>
    <div class="t-sub" style="line-height:1.7;text-align:left;margin-top:10px">Что делать каждый день:<br>• Открывайте <b>«Сегодня»</b> — все дела с действиями в один клик.<br>• Включите автоматизации в «Настройках» (автоначисление аренды, напоминания).<br>• Остальное загрузите пачкой через <b>«Импорт»</b> в разделах Объекты/Арендаторы.</div></div>`;
  openM(`<div class="modal-h"><h3>🚀 Мастер первого запуска</h3><span class="x" onclick="wizClose()">×</span></div>
  <div class="modal-b">${prog}${body}</div>
  <div class="modal-f">
    ${s<5?`<button class="btn ghost" onclick="wizClose()">Позже</button><div class="spacer"></div>${s<4?`<button class="btn ghost" onclick="wizSkip()">Пропустить</button>`:''}<button class="btn" onclick="wizNext()">${s===4?'Создать договор':'Далее →'}</button>`
      :`<div class="spacer"></div><button class="btn ghost" onclick="importModal('units')">⤓ Импорт</button><button class="btn" onclick="wizClose();gotoPage('today')">Перейти к «Сегодня»</button>`}
  </div>`);
}
async function wizNext(){ const s=_wiz.step;
  if(s===1){ const name=val('wz-bname').trim(); if(!name) return alert('Укажите название объекта'); const id='b'+Date.now(); DB.buildings.push({id,name,address:val('wz-baddr').trim()}); _wiz.buildingId=id; }
  if(s===2){ const num=val('wz-uid').trim().replace(/[<>"'`&]/g,''); if(!num) return alert('Укажите номер помещения'); const bld=_wiz.buildingId||(buildingsList()[0]||{}).id; if(DB.units.some(u=>u.building===bld&&(u.num||u.id)===num)) return alert('Такое помещение уже есть в этом объекте'); const id=genUnitId(num,bld); DB.units.push({id,num,building:bld,floor:+val('wz-ufloor')||1,area:+val('wz-uarea')||0,type:val('wz-utype')||'Офис',tenant:null,status:'free',ownership:'own',owner:null,responsible:null,documents:[]}); _wiz.unitId=id; }
  if(s===3){ const name=val('wz-tname').trim(); if(!name) return alert('Укажите название арендатора'); const id='t'+Date.now(); DB.tenants.push({id,name,inn:val('wz-tinn').trim(),contact:val('wz-tcontact').trim(),phone:val('wz-tphone').trim(),email:'',industry:''}); _wiz.tenantId=id; }
  if(s===4){ if(_wiz.tenantId&&_wiz.unitId){ const u=unitOf(_wiz.unitId); const rate=+val('wz-crate')||0; const rt=val('wz-cratetype')||'sqm'; const monthly=rt==='flat'?rate:rate*(u?u.area:0); DB.contracts.push({id:'c'+Date.now(),tenant:_wiz.tenantId,unit:_wiz.unitId,rate,rateType:rt,start:val('wz-cstart'),end:val('wz-cend'),deposit:Math.round(monthly),indexation:+val('wz-cidx')||0,status:'active'}); if(u)u.tenant=_wiz.tenantId; } }
  _wiz.step++; recordAudit(); await saveState(); wizardModal();
}
function wizSkip(){ _wiz.step++; wizardModal(); }
function wizClose(){ try{ localStorage.setItem(WIZ_KEY,'1'); }catch{} closeM(); render(); }
function maybeWizard(){
  if(!isAdmin()) return; let done=false; try{ done=localStorage.getItem(WIZ_KEY)==='1'; }catch{}
  if(done) return;
  if((DB.tenants||[]).length===0 && (DB.contracts||[]).length===0) startWizard();
}
function integrations(){
  const I=DB.integrations||{};
  const unpaid=DB.payments.filter(p=>p.amount-p.paid>0); const unpaidSum=unpaid.reduce((s,p)=>s+(p.amount-p.paid),0);
  el(head('Синхронизация и интеграции','Банк и поставщики коммунальных услуг','')+
   `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
     ${intCard('bank','🏦','Банк','Автосверка платежей, импорт выписки',I.bank,`Синхронизируется: ${scopeSummary('bank')}`,`<button class="btn ghost sm" onclick="syncScopeModal('bank')">⚙ Что синхронизировать</button>`)}
     ${intCard('energy','⚡','Мособлэнергосбыт','Электроэнергия — приём начислений',I.energy,'Передача показаний и приём начислений за свет')}
     ${intCard('water','💧','Водоканал','Вода и водоотведение — приём начислений',I.water,'Передача показаний и приём начислений за воду')}
     ${intCard('onec','🧾','1С: Бухгалтерия','Обмен документами с 1С',I.onec,`Синхронизируется: ${scopeSummary('onec')}`,`<button class="btn ghost sm" onclick="syncScopeModal('onec')">⚙ Что синхронизировать</button> <button class="btn ghost sm" onclick="export1C()">⤓ Выгрузить в 1С (CSV)</button>`)}
   </div>
   ${syncLogBlock()}
   <div class="card" style="margin-top:16px"><div class="t-sub">⚠️ Демонстрационные интеграции: подключение и синхронизация имитируются на тестовых данных приложения. В боевой версии подключаются реальные API банка и поставщиков (договор, ключи доступа, передача показаний счётчиков).</div></div>`);
}
function syncLogBlock(){
  const log=(DB.integrations&&Array.isArray(DB.integrations.log))?DB.integrations.log:[];
  const head=`<div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px"><h3 style="font-size:16px">Журнал обмена</h3>${log.length&&canEdit('integrations')?`<button class="btn ghost sm" onclick="clearSyncLog()">Очистить</button>`:''}</div>`;
  if(!log.length) return head+`<div class="card"><div class="t-sub">Здесь будет история: что и когда выгружено/получено. Нажмите «Синхронизировать» или «Выгрузить в 1С», чтобы появилась первая запись.</div></div>`;
  const rows=log.map(e=>{
    const dir=e.dir==='out'?`<span class="pill" style="background:rgba(79,140,255,.14);color:var(--accent2)">⤴ выгрузка</span>`:`<span class="pill green">⤵ приём</span>`;
    const det=(e.items&&e.items.length)?`<div class="t-sub" style="margin-top:4px">${e.items.map(esc).join(' · ')}</div>`:'';
    return `<div class="doc" style="border:1px solid var(--line2);border-radius:11px;padding:11px 13px;margin-bottom:9px;align-items:flex-start">
      <div class="di" style="font-size:17px">${e.icon||'🔗'}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="t-strong">${esc(e.title||'')}</span>${dir}<span class="t-sub">${fmtDateTime(e.ts)}</span></div>
        <div style="margin-top:2px">${esc(e.text||'')}${e.count?` — <b>${e.count}</b> док.`:''}${e.sum?` · ${money(e.sum)}`:''}</div>
        ${det}
      </div></div>`;
  }).join('');
  return head+`<div class="card">${rows}</div>`;
}
async function clearSyncLog(){ if(!confirm('Очистить журнал обмена?'))return; ensureState(); DB.integrations.log=[]; await afterStateChange(); }
/* Пошаговые инструкции «как подключить» — для полного новичка */
const SYNC_GUIDES={
  bank:{icon:'🏦',title:'Как подключить банк',
    steps:[
      'Войдите в интернет-банк для бизнеса (СберБизнес / ВТБ Бизнес / Точка) под учётной записью с правами руководителя или администратора.',
      'Найдите раздел «Интеграции» или «API» (в Сбере — «СберБизнес API», в Точке — «Открытое API» в настройках, в ВТБ — «API ВТБ Бизнес»).',
      'Подключите услугу «API для бухгалтерии / выгрузка выписки» (обычно бесплатно).',
      'Создайте приложение / ключ доступа — банк выдаст <b>Client ID</b> и <b>Client Secret</b> (или API-токен).',
      'В правах доступа (scope) отметьте: «Выписка по счёту» (statements) и «Остаток по счёту» (balance).',
      'Запишите номер вашего расчётного счёта.',
      'Передайте нам (или введите в боевой версии): Client ID, Client Secret/токен и номер счёта — мы настроим автоматическую выгрузку выписки и сверку платежей.'
    ],
    ask:'«Подключите, пожалуйста, API для выгрузки банковской выписки (statements API). Нужны Client ID, Client Secret и доступ к выписке по счёту № ____».',
    tip:'Проще всего у Точки и Сбера. Альтернатива — сервис «1С:ДиректБанк»: выписка приходит прямо в учётную систему без программирования.'},
  onec:{icon:'🧾',title:'Как подключить 1С',
    steps:[
      'Уточните, какая у вас 1С (Бухгалтерия 8.3, Управление недвижимостью и т.д.) и где она работает: на вашем компьютере/сервере или в облаке «1С:Fresh».',
      'Выберите способ обмена. Простой (уже работает): выгрузка из СИТИ SRM в файл CSV → загрузка в 1С вручную. Кнопка «⤓ Выгрузить в 1С (CSV)».',
      'Для автоматического обмена обратитесь к вашему 1С-специалисту (франчайзи 1С или штатному программисту).',
      'Попросите его опубликовать веб-сервис 1С (HTTP-сервис или OData) и дать: <b>адрес базы (URL публикации)</b>, <b>логин</b> и <b>пароль</b> служебного пользователя.',
      'Уточните формат обмена — рекомендуется <b>EnterpriseData</b> (стандарт 1С для обмена документами).',
      'Передайте нам URL, логин, пароль и формат — настроим автоматическую выгрузку аренды, расходов и ФОТ.'
    ],
    ask:'«Опубликуйте, пожалуйста, веб-сервис (OData) нашей базы 1С и дайте URL публикации, логин и пароль для обмена документами (аренда, расходы, зарплата) в формате EnterpriseData».',
    tip:'Если 1С в облаке «1С:Fresh» — обмен делается через сервис 1С:Шина или выгрузкой файла. Спросите поддержку 1С:Fresh.'},
  energy:{icon:'⚡',title:'Как подключить Мособлэнергосбыт',
    steps:[
      'Зайдите на сайт поставщика и войдите в «Личный кабинет юридического лица» (или зарегистрируйтесь по ИНН).',
      'Привяжите лицевые счета всех ваших объектов (номера есть в квитанциях).',
      'Найдите раздел «ЭДО» (электронный документооборот) или «Электронные счета» и подайте заявку на подключение.',
      'Уточните, через какого оператора ЭДО идёт обмен (Диадок, СБИС или Контур) — возможно, понадобится договор с ним.',
      'Запишите номера лицевых счетов и данные оператора ЭДО.',
      'Передайте нам — настроим приём начислений за электроэнергию и передачу показаний счётчиков.'
    ],
    ask:'«Подключите, пожалуйста, ЭДО для приёма начислений и передачи показаний по лицевым счетам № ____. Через какого оператора идёт обмен?».',
    tip:'Для электронного обмена обычно нужна электронная подпись (КЭП) на руководителя — её оформляют в налоговой или у оператора ЭДО.'},
  water:{icon:'💧',title:'Как подключить Водоканал',
    steps:[
      'Войдите в личный кабинет юрлица на сайте вашего водоканала (или зарегистрируйтесь по ИНН).',
      'Привяжите лицевые счета объектов (из квитанций за воду и водоотведение).',
      'Подайте заявку на «ЭДО» / «Электронные счета» — приём начислений и передача показаний в электронном виде.',
      'Уточните оператора ЭДО (Диадок / СБИС / Контур) и при необходимости заключите с ним договор.',
      'Передайте нам номера лицевых счетов и данные оператора — настроим обмен.'
    ],
    ask:'«Подключите ЭДО для приёма начислений за воду и водоотведение и передачи показаний по лицевым счетам № ____».',
    tip:'Часто и Энергосбыт, и Водоканал работают через одного оператора ЭДО — подключение можно сделать заодно.'}
};
function syncHelp(key){ const g=SYNC_GUIDES[key]; if(!g)return;
  openM(`<div class="modal-h"><h3>${g.icon} ${g.title}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="t-sub" style="margin-bottom:12px">Пошаговая инструкция. Делайте по порядку — не нужно быть программистом.</div>
    <ol style="margin:0 0 4px 0;padding-left:20px;display:flex;flex-direction:column;gap:9px">
      ${g.steps.map(s=>`<li style="line-height:1.5">${s}</li>`).join('')}
    </ol>
    <div class="card" style="margin-top:14px;background:var(--bg2)"><div class="t-sub" style="margin-bottom:4px">📞 Что сказать/написать дословно:</div><div style="font-style:italic">${g.ask}</div></div>
    <div class="t-sub" style="margin-top:12px">💡 ${g.tip}</div>
    <div class="t-sub" style="margin-top:12px">⚠️ Сейчас интеграции в демо-режиме (имитация на тестовых данных). Когда соберёте доступы — пришлите их нам, и мы включим реальное подключение.</div>
  </div>
  <div class="modal-f"><button class="btn" onclick="closeM()">Понятно</button></div>`);
}
function intCard(key,icon,title,desc,st,extra,extraActions){ st=st||{};
  return `<div class="card"><div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
    <div class="kpi-ic" style="width:42px;height:42px;font-size:21px;background:rgba(79,140,255,.14);color:var(--accent2)">${icon}</div>
    <div style="flex:1;min-width:0"><h3 style="font-size:15px">${title}</h3><div class="t-sub">${desc}</div></div>
    ${st.connected?'<span class="pill green">Подключено</span>':'<span class="pill gray">Не подключено</span>'}</div>
    <div class="t-sub" style="margin-bottom:12px">${extra}${st.name?` · ${esc(st.name)}`:''}${st.base?` · ${esc(st.base)}`:''}${st.lastSync?`<br>Последняя синхронизация: ${fmtDateTime(st.lastSync)}`:''}</div>
    ${canEdit('integrations')?`<div style="display:flex;gap:8px;flex-wrap:wrap">
      ${st.connected?`<button class="btn" onclick="intSync('${key}')">↻ Синхронизировать</button>${extraActions||''}<button class="btn ghost sm" onclick="intDisconnect('${key}')">Отключить</button>`
        :`<button class="btn" onclick="intConnect('${key}')">Подключить</button>`}</div>`:'<div class="t-sub">Нет прав на управление интеграциями</div>'}
    ${SYNC_GUIDES[key]?`<div style="margin-top:8px"><button class="btn ghost sm" onclick="syncHelp('${key}')">ℹ️ Как подключить — инструкция</button></div>`:''}
  </div>`;
}
const BANKS=[
  {id:'sber',name:'Сбер Бизнес',color:'#21A038'},
  {id:'tbank',name:'Т-Банк (Тинькофф Бизнес)',color:'#FFB800'},
  {id:'alfa',name:'Альфа-Банк',color:'#EF3124'},
  {id:'vtb',name:'ВТБ',color:'#0A2896'},
  {id:'tochka',name:'Точка',color:'#7A5CFA'},
  {id:'raif',name:'Райффайзен Банк',color:'#FEE600'},
  {id:'gazprom',name:'Газпромбанк',color:'#0079C2'},
  {id:'psb',name:'ПСБ (Промсвязьбанк)',color:'#EE3124'},
  {id:'sovcom',name:'Совкомбанк',color:'#1F4E9E'},
  {id:'modul',name:'Модульбанк',color:'#00A3E0'},
  {id:'ozon',name:'Озон Банк',color:'#005BFF'},
  {id:'rshb',name:'Россельхозбанк',color:'#006837'},
  {id:'mts',name:'МТС Банк',color:'#E30611'},
  {id:'other',name:'Другой банк',color:'#64748B'},
];
function bankConnectModal(){
  openM(`<div class="modal-h"><h3>Подключить банк</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="t-sub" style="margin-bottom:12px">Выберите банк для импорта выписки и автосверки платежей:</div>
  ${BANKS.map(b=>`<div class="doc" style="cursor:pointer;border:1px solid var(--line2);border-radius:11px;padding:12px;margin-bottom:10px" onclick="connectBank('${b.id}')">
    <div class="di" style="background:${b.color}22;color:${b.color};font-size:18px">🏦</div>
    <div style="flex:1;min-width:0"><div class="t-strong">${b.name}</div><div class="t-sub">Импорт выписки · автосверка начислений</div></div>
    <span class="btn sm">Выбрать</span></div>`).join('')}
  <div class="t-sub" style="margin-top:6px">Демо-подключение: реальные ключи доступа к банку не требуются.</div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button></div>`);
}
async function connectBank(id){ const b=BANKS.find(x=>x.id===id); if(!b)return;
  ensureState(); DB.integrations.bank={...DB.integrations.bank,connected:true,name:b.name,bankId:id,lastSync:null};
  closeM(); await afterStateChange(); }
const ONEC_BASES=['1С:Бухгалтерия 8.3','1С:Управление недвижимостью','1С:Управление холдингом','1С:Аренда и управление имуществом'];
function onecConnectModal(){
  openM(`<div class="modal-h"><h3>Подключить 1С</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="t-sub" style="margin-bottom:12px">Выберите конфигурацию 1С для обмена документами:</div>
  ${ONEC_BASES.map(b=>`<div class="doc" style="cursor:pointer;border:1px solid var(--line2);border-radius:11px;padding:12px;margin-bottom:10px" onclick="connectOnec('${esc(b)}')">
    <div class="di" style="background:rgba(255,184,77,.18);color:var(--amber);font-size:18px">🧾</div>
    <div style="flex:1;min-width:0"><div class="t-strong">${b}</div><div class="t-sub">Выгрузка/загрузка документов</div></div>
    <span class="btn sm">Выбрать</span></div>`).join('')}
  <div class="t-sub" style="margin-top:6px">Демо-подключение: реальный обмен через формат 1С (CommerceML/EnterpriseData) — в боевой версии.</div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button></div>`);
}
async function connectOnec(base){ ensureState(); DB.integrations.onec={...DB.integrations.onec,connected:true,base,lastSync:null}; closeM(); await afterStateChange(); }
async function intConnect(key){ if(!DB.integrations)ensureState();
  if(key==='bank'){ bankConnectModal(); return; }
  if(key==='onec'){ onecConnectModal(); return; }
  DB.integrations[key]={connected:true,lastSync:null};
  await afterStateChange();
}
function export1C(){
  const sc=syncScope('onec');
  if(!sc.rent && !sc.expenses && !sc.salaries) return alert('Для 1С не выбран ни один тип документов.\nНажмите «⚙ Что синхронизировать» на карточке 1С.');
  const rows=[['Тип документа','Дата','Период','Контрагент/Сотрудник','Объект','Помещение','Назначение','Сумма','Статус']];
  if(sc.rent) DB.payments.filter(p=>passScope(sc,'rent',p)).forEach(p=>{const c=contractOf(p.contract);if(!c)return;const t=tenantOf(c.tenant);const u=unitOf(c.unit);
    rows.push(['Аренда (начисление)',p.paidDate||'',p.period,t?t.name:'',(buildingOf(u&&u.building)?.name)||'',unitNum(c.unit),'Аренда за '+p.period,p.amount,p.status]);});
  if(sc.expenses) DB.expenses.filter(e=>passScope(sc,'expense',e)).forEach(e=>rows.push(['Расход на содержание','',e.period||'',e.vendor||'',(buildingOf(e.building)?.name)||'','',e.category,e.amount,e.status]));
  if(sc.salaries) (DB.salaries||[]).filter(s=>passScope(sc,'salary',s)).forEach(s=>{const u=userOf(s.user_id);rows.push(['Зарплата',s.paidDate||'',s.period,u?u.full_name:'','','','ФОТ '+s.period,s.amount,s.status]);});
  const csv='﻿'+rows.map(r=>r.map(csvCell).join(';')).join('\n');
  const fname='1c_export_'+TODAY.toISOString().slice(0,10)+'.csv';
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=fname;a.click();
  logSync('onec','⤓','Выгрузка в 1С','out',`Сформирован файл ${fname} — строк: ${rows.length-1}`,rows.length-1,0,
    [`Файл: ${fname}`,`Аренда: ${DB.payments.length}`,`Расходы: ${DB.expenses.length}`,`ФОТ: ${(DB.salaries||[]).length}`]);
  afterStateChange();
}
async function intDisconnect(key){ if(!confirm('Отключить интеграцию?'))return; DB.integrations[key]={...(DB.integrations[key]||{}),connected:false}; await afterStateChange(); }
function logSync(key,icon,title,dir,text,count,sum,items){
  ensureState(); if(!Array.isArray(DB.integrations.log)) DB.integrations.log=[];
  DB.integrations.log.unshift({ts:new Date().toISOString(),key,icon,title,dir,text,count:count||0,sum:sum||0,items:items||[]});
  DB.integrations.log=DB.integrations.log.slice(0,50);
}
// какие типы документов можно выбрать для синхронизации
const SYNC_DOCS={
  bank:[['rent','Поступления — платежи аренды'],['expenses','Списания — расходы на содержание']],
  onec:[['rent','Аренда (платежи)'],['expenses','Расходы на содержание'],['salaries','Зарплата (ФОТ)']],
};
const syncScope=key=>((DB.integrations&&DB.integrations[key]&&DB.integrations[key].scope)||{});
// объект документа: аренда → через договор/помещение; расход → e.building; ФОТ → нет объекта
function syncBuildingOf(kind,doc){ if(kind==='rent'){const c=contractOf(doc.contract);const u=c&&unitOf(c.unit);return u?u.building:null;} if(kind==='expense') return doc.building||null; return null; }
function passScope(sc,kind,doc){
  if(sc.building && sc.building!=='all' && kind!=='salary'){ if(syncBuildingOf(kind,doc)!==sc.building) return false; }
  const per=doc.period; if(per){ if(sc.periodFrom && per<sc.periodFrom) return false; if(sc.periodTo && per>sc.periodTo) return false; }
  return true;
}
function scopeSummary(key){ const sc=syncScope(key); const on=(SYNC_DOCS[key]||[]).filter(([k])=>sc[k]).map(([,l])=>l);
  if(!on.length) return '<span style="color:var(--red)">ничего не выбрано</span>';
  let extra=''; if(sc.building&&sc.building!=='all'){ const b=buildingOf(sc.building); extra+=` · объект: ${esc(b?b.name:sc.building)}`; }
  if(sc.periodFrom||sc.periodTo) extra+=` · период: ${sc.periodFrom?fmtPeriod(sc.periodFrom):'…'}–${sc.periodTo?fmtPeriod(sc.periodTo):'…'}`;
  return esc(on.join(', '))+extra; }
function syncScopeModal(key){
  const sc=syncScope(key); const docs=SYNC_DOCS[key]||[];
  openM(`<div class="modal-h"><h3>Что синхронизировать — ${key==='bank'?'Банк':'1С'}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="t-sub" style="margin-bottom:12px">Отметьте типы документов, которые участвуют в синхронизации и выгрузке:</div>
  ${docs.map(([k,label])=>`<label style="display:flex;align-items:center;gap:10px;padding:9px 2px;cursor:pointer;border-bottom:1px solid var(--line)">
    <input type="checkbox" class="sc-doc" data-k="${k}" ${sc[k]?'checked':''}> <span>${label}</span></label>`).join('')}
  <div class="sec-h" style="margin-top:16px">Фильтры</div>
  <div class="field"><label>Объект</label><select id="sc-building">
    <option value="all"${(!sc.building||sc.building==='all')?' selected':''}>Все объекты</option>
    ${buildingsList().map(b=>`<option value="${b.id}"${sc.building===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select>
    <div class="t-sub" style="margin-top:4px">Зарплата (ФОТ) общая по компании — фильтр по объекту на неё не влияет.</div></div>
  <div class="row2"><div class="field"><label>Период с</label><input id="sc-from" type="month" value="${esc(sc.periodFrom||'')}"></div>
    <div class="field"><label>Период по</label><input id="sc-to" type="month" value="${esc(sc.periodTo||'')}"></div></div>
  <div class="t-sub">Пустой период = без ограничения по датам.</div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveSyncScope('${key}')">Сохранить</button></div>`);
}
async function saveSyncScope(key){ ensureState();
  const sc={}; document.querySelectorAll('.sc-doc').forEach(c=>{ sc[c.dataset.k]=c.checked; });
  sc.building=val('sc-building')||'all'; sc.periodFrom=val('sc-from')||''; sc.periodTo=val('sc-to')||'';
  DB.integrations[key]={...DB.integrations[key],scope:sc};
  closeM(); await afterStateChange(); }
async function intSync(key){
  const now=new Date().toISOString();
  if(key==='bank'){
    const sc=syncScope('bank');
    if(!sc.rent && !sc.expenses) return alert('Для банка не выбран ни один тип документов.\nНажмите «⚙ Что синхронизировать» на карточке банка.');
    const rentList=sc.rent?DB.payments.filter(p=>p.amount-p.paid>0 && passScope(sc,'rent',p)):[];
    const expList=sc.expenses?DB.expenses.filter(e=>e.status!=='paid' && passScope(sc,'expense',e)):[];
    const total=rentList.length+expList.length;
    const sum=rentList.reduce((s,p)=>s+(p.amount-p.paid),0)+expList.reduce((s,e)=>s+(Number(e.amount)||0),0);
    if(!total){ DB.integrations.bank={...DB.integrations.bank,lastSync:now};
      logSync('bank','🏦','Банк','in','Сверка выписки: новых операций нет',0,0,[]);
      await afterStateChange(); return alert('Синхронизация завершена. Новых операций для сверки нет.'); }
    const what=[sc.rent?'поступления аренды':'',sc.expenses?'списания расходов':''].filter(Boolean).join(' + ');
    if(!confirm(`Из банковской выписки найдено ${total} операций на ${money(sum)} (${what}).\n\nОтметить их проведёнными?`))return;
    const items=[];
    rentList.forEach(p=>{ const add=p.amount-p.paid; p.paid=p.amount; p.status='paid'; p.paidDate=TODAY.toISOString().slice(0,10);
      (p.transactions=p.transactions||[]).push({amount:add,date:p.paidDate,method:'bank',bank:true});
      const c=contractOf(p.contract); const t=c&&tenantOf(c.tenant);
      items.push(`Аренда · ${p.period} · ${t?t.name:('Договор '+p.contract)} · +${money(add)}`); });
    expList.forEach(e=>{ e.status='paid'; items.push(`Расход · ${e.category||'—'} · −${money(e.amount)}`); });
    DB.integrations.bank={...DB.integrations.bank,lastSync:now};
    logSync('bank','🏦','Банк','in',`Проведено ${total} операций из выписки`,total,sum,items);
    await afterStateChange(); return alert(`Готово. Проведено ${total} операций на ${money(sum)}.`);
  }
  if(key==='onec'){
    const sc=syncScope('onec'); const items=[]; const parts=[]; let docs=0;
    if(sc.rent){ const n=DB.payments.filter(p=>passScope(sc,'rent',p)).length; docs+=n; items.push(`Аренда: ${n}`); parts.push('аренда'); }
    if(sc.expenses){ const n=DB.expenses.filter(e=>passScope(sc,'expense',e)).length; docs+=n; items.push(`Расходы: ${n}`); parts.push('расходы'); }
    if(sc.salaries){ const n=(DB.salaries||[]).filter(s=>passScope(sc,'salary',s)).length; docs+=n; items.push(`ФОТ: ${n}`); parts.push('ФОТ'); }
    if(!parts.length) return alert('Для 1С не выбран ни один тип документов.\nНажмите «⚙ Что синхронизировать» на карточке 1С.');
    DB.integrations.onec={...DB.integrations.onec,lastSync:now};
    logSync('onec','🧾','1С: Бухгалтерия','out',`Подготовлено к обмену: ${docs} (${parts.join(' + ')})`,docs,0,items);
    await afterStateChange(); return alert(`Синхронизация с 1С завершена.\nК обмену готово документов: ${docs} (${parts.join(' + ')}).\nДля файла выгрузки нажмите «Выгрузить в 1С (CSV)».`);
  }
  if(key==='energy'||key==='water'){
    const field=key==='energy'?'electricity':'water'; let n=0; let sum=0;
    DB.utilities.forEach(u=>{ if(u[field]){ if(u.status!=='paid') u.status='invoiced'; n++; sum+=Number(u[field])||0; } });
    const title=key==='energy'?'Мособлэнергосбыт':'Водоканал';
    DB.integrations[key]={...DB.integrations[key],lastSync:now};
    logSync(key,key==='energy'?'⚡':'💧',title,'in',`Получено/обновлено начислений: ${n}`,n,sum,[]);
    await afterStateChange(); return alert(`Синхронизация с ${title} завершена.\nПолучено/обновлено начислений: ${n}.`);
  }
}

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
  <div class="row2"><div class="field"><label>Номер</label><input id="f-id" placeholder="3-03"></div><div class="field"><label>Название <span class="t-sub">(необязательно)</span></label><input id="f-name" placeholder="Переговорная"></div></div>
  <div class="row2"><div class="field"><label>Этаж</label><input id="f-floor" type="number" value="1"></div><div class="field"><label>Площадь, м²</label><input id="f-area" type="number" value="100"></div></div>
  <div class="field"><label>Тип</label><select id="f-type">${(stg().unitTypes||['Офис','Склад']).map(t=>`<option>${esc(t)}</option>`).join('')}</select></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveUnit()">Добавить</button></div>`);}
async function saveUnit(){const num=val('f-id').trim().replace(/[<>"'`&]/g,''); if(!num)return alert('Укажите номер');
  const building=val('f-building');
  if(DB.units.some(x=>x.building===building && (x.num||x.id)===num))return alert('В этом объекте уже есть помещение с номером '+num);
  const id=genUnitId(num,building);   // id уникален глобально; при колл[изии между объектами id≠num
  const u={id,num,name:val('f-name').trim(),building,floor:+val('f-floor'),area:+val('f-area'),type:val('f-type'),tenant:null,status:'free',ownership:'own',owner:null,
    responsible:{name:ME.full_name,role:ME.position,phone:ME.phone,email:ME.email},
    documents:[{name:'План_помещения_'+num+'.pdf',type:'plan',kind:'Поэтажный план'},{name:'Выписка_ЕГРН_'+num+'.pdf',type:'ownership',kind:'Право собственности'}]};
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
function editBuildingModal(id){const b=buildingOf(id);if(!b)return; const t=b.tariffs||{}; const g=stg().tariffs||{};
  openM(`<div class="modal-h"><h3>Редактировать объект</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Наименование</label><input id="b-name" value="${esc(b.name)}"></div>
  <div class="field"><label>Адрес</label><input id="b-addr" value="${esc(b.address||'')}"></div>
  <div class="row2"><div class="field"><label>Этажей</label><input id="b-floors" type="number" value="${b.floors||1}"></div>
    <div class="field"><label>Общая площадь, м²</label><input id="b-area" type="number" value="${b.totalArea||0}"></div></div>
  <div class="sec-h">Тарифы коммунальных услуг (для этого объекта)</div>
  <div class="t-sub" style="margin-bottom:8px">Применяются при вводе показаний по помещениям и ОДПУ этого объекта. Если оставить 0 — берётся общий тариф из «Настроек».</div>
  <div class="row2">
    <div class="field"><label>Электроэнергия, ₽/кВт·ч</label><input id="b-tar-e" type="number" step="any" value="${+t.electricity||0}" placeholder="общий: ${+g.electricity||0}"></div>
    <div class="field"><label>Расчётный коэффициент (электро)</label><input id="b-coef-e" type="number" step="any" value="${+b.elecCoef||1}"></div>
  </div>
  <div class="row2">
    <div class="field"><label>Вода, ₽/м³</label><input id="b-tar-w" type="number" step="any" value="${+t.water||0}" placeholder="общий: ${+g.water||0}"></div>
    <div class="field"><label>Отопление, ₽/м²</label><input id="b-tar-h" type="number" step="any" value="${+t.heating||0}" placeholder="общий: ${+g.heating||0}"></div>
  </div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveBuildingEdit('${id}')">Сохранить</button></div>`);}
async function saveBuildingEdit(id){const b=buildingOf(id);if(!b)return;
  const name=val('b-name').trim(); if(!name)return alert('Укажите наименование');
  b.name=name; b.address=val('b-addr').trim(); b.floors=+val('b-floors')||1; b.totalArea=+val('b-area')||0;
  b.tariffs={electricity:+val('b-tar-e')||0,water:+val('b-tar-w')||0,heating:+val('b-tar-h')||0};
  b.elecCoef=+val('b-coef-e')||1;
  closeM(); await afterStateChange(); showApp();}
async function delBuilding(id){const b=buildingOf(id);if(!b)return;
  const units=DB.units.filter(u=>u.building===id);
  if(units.length) return alert(`Нельзя удалить объект «${b.name}»: в нём ${units.length} помещ. Сначала удалите или перенесите помещения.`);
  if(!confirm(`Удалить объект «${b.name}»?`))return;
  DB.buildings=DB.buildings.filter(x=>x.id!==id);
  // чистим связанные с объектом записи, чтобы не осталось «мусора» в ОДПУ/ТО/рекламе/бюджете
  DB.buildingMeters=(DB.buildingMeters||[]).filter(m=>m.building!==id);
  DB.equipment=(DB.equipment||[]).filter(e=>e.building!==id);
  DB.listings=(DB.listings||[]).filter(a=>a.building!==id);
  DB.signage=(DB.signage||[]).filter(s=>s.building!==id);
  if(DB.budgets) delete DB.budgets[id];
  if(SCOPE===id){SCOPE='all';localStorage.setItem('citi_srm_scope','all');}
  closeM(); await afterStateChange(); showApp();}

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
  <div class="row2"><div class="field"><label>Тип ставки</label>${rateTypeSelect('f-tratetype','sqm')}</div><div class="field"><label id="f-tratetype-lbl">Ставка ₽/м²/мес</label><input id="f-trate" type="number" value="2200"></div></div>
  <div class="field"><label>Договор до</label><input id="f-tend" type="date" value="2029-06-30"></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveTenant()">Добавить</button></div>`);
  fillTenantUnits();
}
function fillTenantUnits(){
  const bid=val('f-tbuilding');
  const free=DB.units.filter(u=>u.building===bid && !u.tenant);
  const sel=document.getElementById('f-tunit'); if(!sel)return;
  sel.innerHTML=`<option value="">— не размещать сейчас —</option>`+free.map(u=>`<option value="${u.id}">${esc(u.num||u.id)} · ${u.type} · ${u.area} м²</option>`).join('');
}
async function saveTenant(){
  if(!val('f-name').trim())return alert('Укажите наименование');
  const id='t'+Date.now();
  DB.tenants.push({id,name:val('f-name'),contact:val('f-contact'),phone:val('f-phone'),email:val('f-email'),inn:val('f-inn'),industry:val('f-industry')});
  const uid=val('f-tunit');
  if(uid){ const u=unitOf(uid); const rate=+val('f-trate')||0; const rt=val('f-tratetype')||'sqm'; const monthly=rt==='flat'?rate:rate*(u?u.area:0);
    DB.contracts.push({id:'c'+Date.now(),tenant:id,unit:uid,rate,rateType:rt,start:TODAY.toISOString().slice(0,10),end:val('f-tend')||'2029-06-30',deposit:Math.round(monthly),indexation:6,status:'active'});
    if(u) u.tenant=id;
  }
  closeM();await afterStateChange();
}

/* договор */
function contractModal(){const free=sUnits().filter(u=>!u.tenant);const pool=free.length?free:sUnits();openM(`<div class="modal-h"><h3>Новый договор</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Арендатор</label><select id="f-ten">${DB.tenants.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
  <div class="field"><label>Помещение (свободные)</label><select id="f-unit">${pool.map(u=>`<option value="${u.id}">${esc(u.num||u.id)} · ${u.area} м² · ${esc(buildingOf(u.building)?.name||'')}</option>`).join('')}</select></div>
  <div class="row2"><div class="field"><label>Тип ставки</label>${rateTypeSelect('f-ratetype','sqm')}</div><div class="field"><label id="f-ratetype-lbl">Ставка ₽/м²/мес</label><input id="f-rate" type="number" value="2200"></div></div>
  <div class="row2"><div class="field"><label>Индексация %/год</label><input id="f-idx" type="number" value="6"></div><div class="field"><label>День начисления аренды (число 1–28)</label><input id="f-accrualday" type="number" min="1" max="28" placeholder="общий из настроек"></div></div>
  <div class="row2"><div class="field"><label>Начало</label><input id="f-start" type="date" value="2026-07-01"></div><div class="field"><label>Окончание</label><input id="f-end" type="date" value="2029-06-30"></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveContract()">Создать</button></div>`);}
async function saveContract(){const u=val('f-unit');const unit=unitOf(u); if(!unit) return alert('Выберите помещение (в портфеле нет доступных помещений).');
  const ten=val('f-ten'); if(!ten) return alert('Выберите арендатора.');
  const rate=+val('f-rate')||0;const rt=val('f-ratetype')||'sqm';const monthly=rt==='flat'?rate:rate*(unit.area||0);
  const ad=+val('f-accrualday');
  DB.contracts.push({id:'c'+Date.now(),tenant:ten,unit:u,rate,rateType:rt,start:val('f-start'),end:val('f-end'),deposit:Math.round(monthly),indexation:+val('f-idx')||0,accrualDay:(ad>=1&&ad<=28)?ad:null,status:'active'});
  unit.tenant=ten;closeM();await afterStateChange();}

/* платёж */
function paymentModal(){const cs=sContracts();openM(`<div class="modal-h"><h3>Новый платёж</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Договор</label><select id="f-c">${cs.map(c=>{const t=tenantOf(c.tenant);return `<option value="${c.id}">${(c.id||'').toUpperCase()} · ${esc(t?t.name:'—')} · ${esc(unitNum(c.unit))}</option>`;}).join('')}</select></div>
  <div class="row2"><div class="field"><label>Период</label><input id="f-period" type="month" value="${payPeriod||'2026-07'}"></div><div class="field"><label>Сумма, ₽</label><input id="f-amount" type="number" min="0"></div></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="savePayment()">Добавить</button></div>`);}
async function savePayment(){const cid=val('f-c'); if(!cid)return alert('Выберите договор');
  const amount=+val('f-amount')||0; if(amount<=0)return alert('Укажите сумму начисления');
  const per=val('f-period')||'2026-07';const due=per+'-05';
  DB.payments.push({id:'p'+Date.now(),contract:cid,period:per,amount,due,paid:0,paidDate:null,status:daysLeft(due)<0?'overdue':'pending'});
  closeM();await afterStateChange();}

/* расход */
function expenseModal(){const def=SCOPE!=='all'?SCOPE:(buildingsList()[0]||{}).id;
  openM(`<div class="modal-h"><h3>Новый расход</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b"><div class="field"><label>Объект</label><select id="f-ebuilding">${buildingsList().map(b=>`<option value="${b.id}"${b.id===def?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
  <div class="row2"><div class="field"><label>Категория</label><input id="f-cat" list="catList" placeholder="Клининг"><datalist id="catList">${(stg().expenseCats||[]).map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div><div class="field"><label>Сумма</label><input id="f-amt" type="number"></div></div>
  <div class="row2"><div class="field"><label>Подрядчик</label><input id="f-vendor"></div><div class="field"><label>Период</label><input id="f-eperiod" type="month" value="${utilPeriod||'2026-06'}"></div></div>
  <div class="field"><label>Назначение <span class="t-sub">на что потрачено</span></label><input id="f-enote" placeholder="напр. ремонт кровли, замена насоса"></div></div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveExpense()">Добавить</button></div>`);}
async function saveExpense(){DB.expenses.push({id:'e'+Date.now(),building:val('f-ebuilding'),category:val('f-cat'),vendor:val('f-vendor'),note:val('f-enote').trim(),period:val('f-eperiod')||'2026-06',amount:+val('f-amt'),status:'planned'});closeM();await afterStateChange();}

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
  ${u?`<div class="field"><label>Логин</label><input id="u-email" value="${esc(u.email)}" disabled style="opacity:.6"></div>`
     :`<div class="field"><label>Логин</label><div style="display:flex"><input id="u-email" placeholder="ivanov" style="border-top-right-radius:0;border-bottom-right-radius:0"><span style="padding:9px 11px;border:1px solid var(--line2);border-left:none;border-radius:0 10px 10px 0;background:var(--bg2);color:var(--muted);white-space:nowrap;display:flex;align-items:center">@citisrm.ru</span></div><div class="t-sub" style="margin-top:4px">Введите только имя — домен подставится. Можно и полный email.</div></div>`}
  <div class="field"><label>${u?'Новый пароль (если менять)':'Пароль'}</label><input id="u-pw" type="password" placeholder="${u?'оставьте пустым':'не короче 6 символов'}"></div>
  <div class="field"><label>Роль (права доступа)</label><select id="u-role">${roleOpts}</select></div>
  <div class="field"><label>Объект <span class="t-sub">(необязательно; для кочегара — объект, чью котельную он обслуживает)</span></label>
    <select id="u-building"><option value="">— не привязан —</option>${buildingsList().map(b=>`<option value="${b.id}"${u&&u.building===b.id?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
  ${u?`<div class="field"><label>Доступ</label><select id="u-active"><option value="1"${u.active?' selected':''}>Активен</option><option value="0"${!u.active?' selected':''}>Отключён</option></select></div>`:''}
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="closeM()">Отмена</button><button class="btn" onclick="saveUser(${id||0})">${u?'Сохранить':'Добавить'}</button></div>`);}
async function saveUser(id){
  try{
    if(id){
      const body={full_name:val('u-name'),position:val('u-pos'),phone:val('u-phone'),role:val('u-role'),building:val('u-building'),active:val('u-active')==='1'};
      if(val('u-pw'))body.password=val('u-pw');
      await api('/api/users/'+id,'PATCH',body);
    }else{
      const pw=val('u-pw'); if(pw.length<6)return alert('Пароль не короче 6 символов');
      const email=mkLogin(val('u-email')); if(!email)return alert('Укажите логин');
      await api('/api/users','POST',{full_name:val('u-name'),position:val('u-pos'),phone:val('u-phone'),email,password:pw,role:val('u-role'),building:val('u-building')});
    }
    closeM(); USERS=await api('/api/users'); if(id===ME.id){const me=await api('/api/auth/me');ME=me.user;} render();
  }catch(e){alert(e.message);}
}

/* info-модалки */
const DOC_TYPES={plan:'План помещения',contract:'Договор аренды',ownership:'Право собственности / ЕГРН',act:'Акт приёма-передачи',sale:'Договор купли-продажи',owner:'Документы собственника',req:'Реквизиты / уставные',other:'Прочее'};
function docIcon(t){return {plan:'📐',contract:'📄',ownership:'🏷️',act:'🧾',sale:'📑',owner:'👥',req:'📋',other:'📎'}[t]||'📎';}
function docEntity(type,id){return ({unit:()=>unitOf(id),tenant:()=>tenantOf(id),listing:()=>(DB.listings||[]).find(x=>x.id===id),signage:()=>(DB.signage||[]).find(x=>x.id===id)}[type]||(()=>null))();}
function reopenInfo(type,id){({unit:unitInfo,tenant:tenantInfo,listing:listingInfo,signage:signageInfo}[type]||(()=>{}))(id);}
function backToInfo(type,id){return `reopenInfo('${type}','${id}')`;}
function canEditDocs(type){return (type==='unit')?canEdit('objects'):(type==='tenant')?canEdit('tenants'):canEdit('ads');}
function docsBlock(type,id,docs){
  return `<div class="sec-h">Связанные документы ${canEditDocs(type)?`<button class="btn sm" onclick="addDocModal('${type}','${id}')">+ Документ</button>`:''}</div>
  ${(docs&&docs.length)?docs.map((d,i)=>`<div class="doc"><div class="di">${docIcon(d.type)}</div>
    <div style="flex:1;min-width:0"><div class="t-strong" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div><div class="t-sub">${esc(d.kind||DOC_TYPES[d.type]||'')}${d.date?' · '+fmtD(d.date):''}</div></div>
    <button class="btn ghost sm" onclick="openDoc('${type}','${id}',${i})">Открыть</button>
    ${canEditDocs(type)?`<span class="trash" onclick="delDoc('${type}','${id}',${i})" title="Удалить">🗑</span>`:''}</div>`).join(''):'<div class="empty" style="padding:16px">Документы не прикреплены</div>'}`;
}
const SAFE_DOC_MIME=/^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;
function downloadDoc(d){ const url=String(d.url||''); // только безопасные источники
  if(!(url.startsWith('data:')&&SAFE_DOC_MIME.test(url.slice(5).split(/[;,]/)[0])) && !safeUrl(url)){ alert('Этот файл нельзя открыть в браузере (небезопасный формат).'); return; }
  const a=document.createElement('a');a.href=url;a.download=d.name||'file';a.rel='noopener';document.body.appendChild(a);a.click();a.remove();}
function openDoc(type,id,i){const e=docEntity(type,id); const d=e&&e.documents&&e.documents[i]; if(!d){ return alert('Документ не найден.'); }
  if(d.url&&d.url.startsWith('data:')){ // загруженный файл
    const mime=d.url.slice(5).split(/[;,]/)[0];
    if(SAFE_DOC_MIME.test(mime)){ // безопасно показать в новой вкладке (pdf/картинки)
      fetch(d.url).then(r=>r.blob()).then(b=>window.open(URL.createObjectURL(b),'_blank')).catch(()=>downloadDoc(d));
    } else { downloadDoc(d); } // прочие типы — только скачивание (svg/html не открываем)
    return; }
  const safe=safeUrl(d.url);
  if(safe){ window.open(safe,'_blank','noopener,noreferrer'); return; }
  if(d.url){ return alert('Ссылка на документ небезопасна (разрешены только http/https). Откройте через «Редактировать».'); }
  alert('Документ «'+d.name+'»: файл не прикреплён и ссылка не указана. Откройте документ через «Редактировать» и приложите файл.');
}
let _docFile=null;
function onDocFile(input){ _docFile=null; const f=input.files&&input.files[0]; if(!f)return;
  if(f.size>3*1024*1024){ alert('Файл больше 3 МБ — для демо это много. Выберите файл поменьше или укажите ссылку.'); input.value=''; return; }
  if(/(html|svg|xml|xhtml|javascript)/i.test(f.type) || /\.(html?|svg|xml|xhtml|js|mjs)$/i.test(f.name)){
    alert('Файлы HTML/SVG/скрипты загружать нельзя из соображений безопасности. Используйте PDF, изображение или офисный документ.'); input.value=''; return; }
  const nm=document.getElementById('d-name'); if(nm&&!nm.value) nm.value=f.name;
  const r=new FileReader(); r.onload=()=>{ _docFile={name:f.name,data:r.result}; }; r.readAsDataURL(f);
}
function addDocModal(type,id){_docFile=null;openM(`<div class="modal-h"><h3>Добавить документ</h3><span class="x" onclick="${backToInfo(type,id)}">×</span></div>
  <div class="modal-b">
  <div class="field"><label>Файл с компьютера</label><input type="file" id="d-file" onchange="onDocFile(this)" style="width:100%;font-size:13px;padding:8px;border:1px dashed var(--line2);border-radius:9px;background:var(--bg2)"></div>
  <div class="field"><label>Название</label><input id="d-name" placeholder="Договор_аренды.pdf"></div>
  <div class="row2"><div class="field"><label>Тип документа</label><select id="d-type">${Object.entries(DOC_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div class="field"><label>Дата</label><input id="d-date" type="date"></div></div>
  <div class="field"><label>Или ссылка на файл (если он уже где-то хранится)</label><input id="d-url" placeholder="https://…"></div>
  <div class="t-sub">Выберите файл с компьютера — он сохранится и будет открываться по кнопке «Открыть». Либо укажите ссылку. До 3 МБ.</div></div>
  <div class="modal-f"><button class="btn ghost" onclick="${backToInfo(type,id)}">Отмена</button><button class="btn" onclick="saveDoc('${type}','${id}')">Прикрепить</button></div>`);}
function docFolder(type,id){
  if(type==='unit'){ const u=unitOf(id); return ((u&&u.building)||'obj')+'/'+id; }
  if(type==='tenant'){ return 'tenants/'+id; }
  if(type==='listing'){ const a=(DB.listings||[]).find(x=>x.id===id); return 'ads/'+((a&&a.building)||'_')+'/'+id; }
  if(type==='signage'){ const s=(DB.signage||[]).find(x=>x.id===id); return 'signage/'+((s&&s.building)||'_')+'/'+id; }
  return 'misc/'+id;
}
async function saveDoc(type,id){const e=docEntity(type,id);if(!e)return;if(!e.documents)e.documents=[];
  const name=val('d-name')||(_docFile&&_docFile.name)||'Документ.pdf';
  let url=val('d-url')||null, stored='link';
  if(_docFile){
    try{ const r=await api('/api/files','POST',{folder:docFolder(type,id),name:_docFile.name,dataUrl:_docFile.data}); url=r.url; stored=r.stored||'file'; }
    catch(err){ return alert('Не удалось загрузить файл: '+(err.message||err)); }
  } else if(!val('d-url')){ if(!confirm('Файл не выбран и ссылка не указана — прикрепить только запись о документе?'))return; }
  e.documents.push({name,type:val('d-type'),kind:DOC_TYPES[val('d-type')],date:val('d-date')||null,url,uploaded:!!_docFile,stored});
  _docFile=null; await saveState(); render(); reopenInfo(type,id);}
async function delDoc(type,id,i){const e=docEntity(type,id);if(!e||!e.documents)return;if(!confirm('Удалить документ «'+e.documents[i].name+'»?'))return;
  e.documents.splice(i,1); await saveState(); render(); reopenInfo(type,id);}
function unitInfo(id){const u=unitOf(id);const c=DB.contracts.find(c=>c.unit===id);const t=u.tenant?tenantOf(u.tenant):null;const r=u.responsible||{};
  openM(`<div class="modal-h"><h3>Помещение ${esc(u.num||u.id)}${u.name?' · '+esc(u.name):''}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="sec-h">Характеристики</div>
    ${u.name?infoRow('Название',esc(u.name)):''}${infoRow('Объект',esc(buildingOf(u.building)?.name||'—'))}${infoRow('Тип',esc(u.type))}${infoRow('Площадь',esc(u.area)+' м²')}${infoRow('Этаж',esc(u.floor))}
    ${infoRow('Форма владения',u.ownership==='sold'?'<span class="pill amber">Продано · сторонний собственник</span>':'<span class="pill green">В собственности компании</span>')}
    ${t?infoRow('Арендатор',esc(t.name))+infoRow('Ставка',fmt(c.rate)+(c.rateType==='flat'?' ₽/мес (за помещение)':' ₽/м²'))+infoRow('Аренда/мес',money(monthlyRent(c)))+infoRow('Договор до',fmtD(c.end)):infoRow('Статус',u.status==='reserved'?'Бронь':'Свободно / доступно к сдаче')}
    ${u.ownership==='sold'&&u.owner?`<div class="sec-h">Собственник помещения</div>${infoRow('Собственник',esc(u.owner.name))}${infoRow('ИНН / реквизиты',u.owner.inn||'—')}${infoRow('Контакт',esc(u.owner.contact||'—'))}${infoRow('Фикс. платёж за коммуналку',u.ownerUtilFee?money(u.ownerUtilFee)+' /мес':'не задан')}`:''}
    <div class="sec-h">Ответственное лицо</div>
    ${infoRow('ФИО',esc(r.name||'—'))}${r.role?infoRow('Должность',esc(r.role)):''}${infoRow('Телефон',r.phone||'—')}${infoRow('Email',esc(r.email||'—'))}
    ${docsBlock('unit',u.id,u.documents)}
  </div>
  <div class="modal-f">
    ${(!t && canEdit('contracts'))?`<button class="btn" onclick="assignTenantModal('${u.id}')">🏠 Заселить арендатора</button>`:''}
    ${(t && canEdit('contracts'))?`<button class="btn ghost" onclick="editContractModal('${c.id}')">✎ Изменить аренду</button>`:''}
    ${(t && canEdit('contracts'))?`<button class="btn ghost" onclick="evictTenant('${u.id}')">🚪 Выселить арендатора</button>`:''}
    ${canEdit('objects')?`<button class="btn ghost" onclick="editUnitModal('${u.id}')">✎ Редактировать</button><button class="btn danger" onclick="delUnit('${u.id}')">Удалить</button>`:''}<button class="btn" onclick="closeM()">Закрыть</button></div>`);}
// выселить арендатора: завершить договор, освободить помещение (история платежей сохраняется)
async function evictTenant(uid){ if(!canEdit('contracts'))return; const u=unitOf(uid); if(!u||!u.tenant) return;
  const t=tenantOf(u.tenant);
  if(!confirm(`Выселить арендатора${t?` «${t.name}»`:''} из помещения ${u.num||u.id}?\n\nДоговор будет завершён, помещение станет свободным.\nАрендатор и история платежей сохранятся.`)) return;
  const c=DB.contracts.find(c=>c.unit===uid && c.status!=='ended');
  if(c){ c.status='ended'; c.end=TODAY.toISOString().slice(0,10); }
  u.tenant=null; u.status='vacant';
  closeM(); await afterStateChange(); }
// заселить арендатора в свободное помещение (выбрать существующего или создать нового) + договор
function assignTenantModal(uid){ const u=unitOf(uid); if(!u) return; if(u.tenant) return alert('Помещение уже занято.');
  const today=TODAY.toISOString().slice(0,10);
  openM(`<div class="modal-h"><h3>Заселить арендатора — ${esc(unitNum(uid))}</h3><span class="x" onclick="unitInfo('${uid}')">×</span></div>
  <div class="modal-b">
    <div class="field"><label>Арендатор</label><select id="as-ten" onchange="asToggleNew()"><option value="__new">➕ Новый арендатор…</option>${DB.tenants.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
    <div id="as-newbox"><div class="field"><label>Название нового арендатора</label><input id="as-name" placeholder="ООО «Компания»"></div>
      <div class="row2"><div class="field"><label>Контактное лицо</label><input id="as-contact"></div><div class="field"><label>Телефон</label><input id="as-phone"></div></div></div>
    <div class="row2"><div class="field"><label>Тип ставки</label>${rateTypeSelect('as-ratetype','sqm')}</div><div class="field"><label id="as-ratetype-lbl">Ставка ₽/м²/мес</label><input id="as-rate" type="number" value="2200"></div></div>
    <div class="row2"><div class="field"><label>Начало</label><input id="as-start" type="date" value="${today}"></div><div class="field"><label>Окончание</label><input id="as-end" type="date" value="${addMonths(today,12)}"></div></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="unitInfo('${uid}')">Отмена</button><button class="btn" onclick="assignTenant('${uid}')">Заселить</button></div>`);
  asToggleNew();
}
function asToggleNew(){ const box=document.getElementById('as-newbox'); if(box) box.style.display = (val('as-ten')==='__new')?'block':'none'; }
async function assignTenant(uid){ const u=unitOf(uid); if(!u||u.tenant) return; let tid=val('as-ten');
  if(tid==='__new'){ const nm=val('as-name').trim(); if(!nm) return alert('Укажите название нового арендатора');
    tid='t'+Date.now(); DB.tenants.push({id:tid,name:nm,contact:val('as-contact').trim(),phone:val('as-phone').trim(),email:'',inn:'',industry:''}); }
  const rate=+val('as-rate')||0; const rt=val('as-ratetype')||'sqm'; const monthly=rt==='flat'?rate:rate*(u.area||0);
  DB.contracts.push({id:'c'+Date.now(),tenant:tid,unit:uid,rate,rateType:rt,start:val('as-start'),end:val('as-end'),deposit:Math.round(monthly),indexation:6,status:'active'});
  u.tenant=tid; closeM(); await afterStateChange(); }

function editUnitModal(id){const u=unitOf(id);if(!u)return;const r=u.responsible||{};const o=u.owner||{};
  openM(`<div class="modal-h"><h3>Редактировать помещение ${esc(u.num||u.id)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">
    <div class="sec-h">Характеристики</div>
    <div class="row2"><div class="field"><label>Номер помещения</label><input id="e-uid" value="${esc(u.num||u.id)}" placeholder="напр. 1-01"></div>
      <div class="field"><label>Название <span class="t-sub">(необязательно)</span></label><input id="e-uname" value="${esc(u.name||'')}" placeholder="Переговорная"></div></div>
    <div class="t-sub" style="margin:-4px 0 6px">Номер уникален в пределах объекта — в разных объектах номера могут совпадать. Он обновится во всех договорах, платежах, коммуналке, заявках и документах.</div>
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
      <div class="row2"><div class="field"><label>ИНН / реквизиты</label><input id="e-oinn" value="${esc(o.inn||'')}"></div><div class="field"><label>Контакт</label><input id="e-ocontact" value="${esc(o.contact||'')}"></div></div>
      <div class="field"><label>Фикс. платёж за коммуналку (отопление), ₽/мес</label><input id="e-ownerfee" type="number" min="0" value="${+u.ownerUtilFee||''}" placeholder="напр. 5000"><div class="t-sub" style="margin-top:4px">Если задан и включено «Автоначисление коммуналки собственникам» (Настройки → Автоматизация) — эта сумма начисляется каждый месяц.</div></div></div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="unitInfo('${u.id}')">Отмена</button><button class="btn" onclick="saveUnitEdit('${u.id}')">Сохранить</button></div>`);}
async function saveUnitEdit(id){const u=unitOf(id);if(!u)return;
  // Меняем ОТОБРАЖАЕМЫЙ номер (num), уникальный в пределах объекта. Внутренний id НЕ трогаем —
  // поэтому все связи (договоры/платежи/коммуналка/заявки/задачи) остаются целыми автоматически.
  const newNum=(val('e-uid')||'').trim().replace(/[<>"'`&]/g,'');
  const newBuilding=val('e-building')||u.building;
  if(newNum && (newNum!==(u.num||u.id) || newBuilding!==u.building)){
    if(DB.units.some(x=>x.id!==id && x.building===newBuilding && (x.num||x.id)===newNum))
      return alert('В этом объекте уже есть помещение с номером «'+newNum+'». Выберите другой номер.');
  }
  if(newNum) u.num=newNum;
  u.name=val('e-uname').trim();
  u.building=newBuilding; u.type=val('e-type'); u.floor=+val('e-floor'); u.area=+val('e-area');
  u.responsible={name:val('e-rname'),role:val('e-rrole'),phone:val('e-rphone'),email:val('e-remail')};
  u.ownership=val('e-own');
  u.owner=u.ownership==='sold'?{name:val('e-oname'),inn:val('e-oinn'),contact:val('e-ocontact')}:null;
  u.ownerUtilFee=u.ownership==='sold'?(Math.max(0,+val('e-ownerfee')||0)||null):null;
  closeM(); await afterStateChange();}
async function delUnit(id){const u=unitOf(id);if(!u)return;
  const c=DB.contracts.find(c=>c.unit===id);
  const warn=c?`\n\nВнимание: по помещению есть договор — он и связанные платежи тоже будут удалены.`:'';
  if(!confirm(`Удалить помещение ${u.num||id}?${warn}`))return;
  const cids=DB.contracts.filter(c=>c.unit===id).map(c=>c.id);
  DB.contracts=DB.contracts.filter(c=>c.unit!==id);
  DB.payments=DB.payments.filter(p=>!cids.includes(p.contract));
  DB.utilities=DB.utilities.filter(x=>x.unit!==id);
  DB.listings=(DB.listings||[]).filter(a=>a.unit!==id);
  DB.signage=(DB.signage||[]).filter(s=>s.unit!==id);
  DB.units=DB.units.filter(x=>x.id!==id);
  closeM(); await afterStateChange();}

function tenantInfo(id){const t=tenantOf(id);const c=DB.contracts.find(c=>c.tenant===id);const u=c?unitOf(c.unit):null;
  openM(`<div class="modal-h"><h3>${esc(t.name)}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">${infoRow('Контакт',esc(t.contact))}${infoRow('Телефон',esc(t.phone))}${infoRow('Email',esc(t.email))}${infoRow('ИНН',esc(t.inn))}${infoRow('Отрасль',esc(t.industry))}
  ${c?infoRow('Объект',esc(buildingOf(u?.building)?.name||'—'))+infoRow('Помещение',c.unit)+infoRow('Ставка',fmt(c.rate)+(c.rateType==='flat'?' ₽/мес (за помещение)':' ₽/м²/мес'))+infoRow('Аренда/мес',money(monthlyRent(c)))+infoRow('Договор',fmtD(c.start)+' — '+fmtD(c.end))+infoRow('День начисления аренды',c.accrualDay?('число '+c.accrualDay+' каждого месяца'):'общий (Настройки → Автоматизация)'):infoRow('Размещение','не размещён в помещении')}
  ${docsBlock('tenant',id,t.documents)}
  ${tenantSignageBlock(id)}</div>
  <div class="modal-f">${c&&canEdit('payments')?`<button class="btn ghost" onclick="accrueRentModal('${c.id}')">➕ Начислить аренду</button>`:''}${c&&canEdit('contracts')?`<button class="btn ghost" onclick="editContractModal('${c.id}')">✎ Изменить аренду</button>`:''}${canEdit('tenants')?`<button class="btn ghost" onclick="editTenantModal('${id}')">✎ Редактировать</button><button class="btn danger" onclick="delTenant('${id}')">Удалить</button>`:''}<button class="btn" onclick="closeM()">Закрыть</button></div>`);}
function tenantSignageBlock(id){
  const items=(DB.signage||[]).filter(s=>s.owner==='tenant'&&s.tenant===id);
  const canAdd=canEdit('ads');
  return `<div class="sec-h" style="margin-top:14px">Разрешения на вывески ${canAdd?`<button class="btn sm" onclick="closeM();signFilter='tenant';current='ads';markActive();render()">Открыть «Реклама»</button>`:''}</div>
  ${items.length?items.map(s=>{const st=signageStatus(s);
    return `<div class="doc"><div class="di">📣</div>
      <div style="flex:1;min-width:0"><div class="t-strong">${esc(s.kind||'Вывеска')}${s.permitNo?` · ${esc(s.permitNo)}`:''}</div>
        <div class="t-sub">${s.expiry?'до '+fmtD(s.expiry):'бессрочно'}${s.unit?' · '+esc(s.unit):''}${s.note?' · '+esc(s.note):''}</div></div>
      <span class="pill ${st[0]}">${st[1]}</span></div>`;}).join(''):'<div class="empty" style="padding:14px">Разрешений на вывески нет</div>'}`;
}
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
function contractInfo(id){const c=contractOf(id);if(!c)return;const t=tenantOf(c.tenant);const u=unitOf(c.unit);
  openM(`<div class="modal-h"><h3>Договор ${(c.id||'').toUpperCase()}</h3><span class="x" onclick="closeM()">×</span></div>
  <div class="modal-b">${infoRow('Арендатор',esc(t?t.name:'—'))}${infoRow('Помещение',esc(c.unit)+(u?' · '+esc(u.area)+' м²':''))}${infoRow('Ставка',fmt(c.rate)+(c.rateType==='flat'?' ₽/мес (за помещение)':' ₽/м²/мес'))}${infoRow('Аренда/мес',money(monthlyRent(c)))}${infoRow('Депозит',money(c.deposit))}${infoRow('Индексация',c.indexation+'% / год')}${infoRow('Период',fmtD(c.start)+' — '+fmtD(c.end))}${infoRow('Осталось',daysLeft(c.end)+' дн')}${infoRow('День начисления аренды',c.accrualDay?('число '+c.accrualDay+' каждого месяца'):'общий (Настройки → Автоматизация)')}
  ${(Array.isArray(c.rateHistory)&&c.rateHistory.length)?`<div class="sec-h">История индексаций ставки</div>${c.rateHistory.slice().reverse().map(h=>`<div class="doc"><div class="di">📈</div><div style="flex:1;min-width:0"><div class="t-strong">${money(h.oldRate)} → ${money(h.newRate)} /м²</div><div class="t-sub">${h.date?fmtD(h.date):''}</div></div></div>`).join('')}`:''}</div>
  <div class="modal-f">${canEdit('payments')?`<button class="btn ghost" onclick="accrueRentModal('${c.id}')">➕ Начислить аренду</button>`:''}${canEdit('contracts')?`<button class="btn ghost" onclick="editContractModal('${c.id}')">✎ Изменить аренду</button><button class="btn ghost" onclick="renewModal('${c.id}')">Продлить</button>`:''}<button class="btn" onclick="closeM()">Закрыть</button></div>`);}
function editContractModal(id){ const c=contractOf(id); if(!c) return; const t=tenantOf(c.tenant); const u=unitOf(c.unit);
  openM(`<div class="modal-h"><h3>Изменить договор аренды</h3><span class="x" onclick="contractInfo('${id}')">×</span></div>
  <div class="modal-b">
    ${infoRow('Арендатор',esc(t?t.name:'—'))}${infoRow('Помещение',esc(c.unit)+(u?' · '+esc(u.area)+' м²':''))}
    <div class="row2"><div class="field"><label>Тип ставки</label>${rateTypeSelect('ec-ratetype',c.rateType)}</div><div class="field"><label id="ec-ratetype-lbl">${rateLblText(c.rateType)}</label><input id="ec-rate" type="number" value="${+c.rate||0}"></div></div>
    <div class="row2"><div class="field"><label>Индексация %/год</label><input id="ec-idx" type="number" value="${+c.indexation||0}"></div><div class="field"><label>Депозит, ₽ <span class="t-sub">пусто = аренда за месяц</span></label><input id="ec-dep" type="number" value="${Math.round(+c.deposit||0)}" placeholder="${Math.round(monthlyRent(c))}"><div class="t-sub" style="margin-top:4px"><button class="btn ghost sm" type="button" onclick="document.getElementById('ec-dep').value=''">= аренда за месяц</button></div></div></div>
    <div class="row2"><div class="field"><label>День начисления аренды (число месяца, 1–28)</label><input id="ec-accrualday" type="number" min="1" max="28" placeholder="общий из настроек" value="${c.accrualDay?+c.accrualDay:''}"></div><div class="field"><label>&nbsp;</label><div class="t-sub" style="padding-top:10px">Пусто — берётся общий день из «Настройки → Автоматизация».</div></div></div>
    <div class="row2"><div class="field"><label>Начало</label><input id="ec-start" type="date" value="${c.start||''}"></div><div class="field"><label>Окончание</label><input id="ec-end" type="date" value="${c.end||''}"></div></div>
    <div class="t-sub">Аренда/мес пересчитается автоматически по типу ставки.</div>
  </div>
  <div class="modal-f"><button class="btn ghost" onclick="contractInfo('${id}')">Отмена</button><button class="btn" onclick="saveContractEdit('${id}')">Сохранить</button></div>`);}
async function saveContractEdit(id){ const c=contractOf(id); if(!c) return;
  const oldRate=c.rate; const newRate=+val('ec-rate')||0;
  if(oldRate!==newRate){ c.rateHistory=Array.isArray(c.rateHistory)?c.rateHistory:[]; c.rateHistory.push({date:TODAY.toISOString().slice(0,10),oldRate,newRate,by:ME.full_name}); }
  c.rate=newRate; c.rateType=val('ec-ratetype')||'sqm'; c.indexation=+val('ec-idx')||0;
  // депозит: пусто → по умолчанию аренда за месяц; иначе указанное (без дробного хвоста)
  const depRaw=val('ec-dep'); c.deposit = (depRaw==='' ? Math.round(monthlyRent(c)) : Math.round(+depRaw||0));
  const ad=+val('ec-accrualday'); c.accrualDay=(ad>=1&&ad<=28)?ad:null;
  if(val('ec-start')) c.start=val('ec-start'); if(val('ec-end')) c.end=val('ec-end');
  closeM(); await afterStateChange(); }
function accrueRentModal(cid){const c=contractOf(cid);if(!c)return;const t=tenantOf(c.tenant);
  openM(`<div class="modal-h"><h3>Начислить аренду</h3><span class="x" onclick="tenantInfo('${c.tenant}')">×</span></div>
  <div class="modal-b">${infoRow('Арендатор',esc(t?t.name:'—'))}${infoRow('Помещение',esc(c.unit))}${infoRow('Сумма аренды/мес',money(monthlyRent(c)))}
  <div class="row2" style="margin-top:12px"><div class="field"><label>Период — с месяца</label><input id="ar-per" type="month" value="${payPeriod||new Date().toISOString().slice(0,7)}"></div><div class="field"><label>Срок оплаты (число 1–28)</label><input id="ar-due" type="number" min="1" max="28" value="5"></div></div>
  <div class="field"><label>На сколько месяцев</label><input id="ar-count" type="number" min="1" max="24" value="1"></div>
  <div class="t-sub">Создаст начисления аренды за выбранные месяцы (начиная с указанного). Периоды, по которым начисление уже есть, пропускаются.</div></div>
  <div class="modal-f"><button class="btn ghost" onclick="tenantInfo('${c.tenant}')">Отмена</button><button class="btn" onclick="saveAccrueRent('${cid}')">Начислить</button></div>`);}
async function saveAccrueRent(cid){const c=contractOf(cid);if(!c)return;const per=val('ar-per');if(!per)return alert('Укажите период');
  const amount=monthlyRent(c);if(amount<=0)return alert('Сумма аренды не определена — проверьте ставку договора');
  const count=Math.min(24,Math.max(1,+val('ar-count')||1));
  const dd=Math.min(28,Math.max(1,+val('ar-due')||5));
  if(!DB.payments)DB.payments=[];
  const [y,m]=per.split('-').map(Number); let created=0, skipped=0;
  for(let i=0;i<count;i++){ const idx=y*12+(m-1)+i; const p2=Math.floor(idx/12)+'-'+String(idx%12+1).padStart(2,'0');
    if((DB.payments||[]).some(p=>p.contract===cid&&p.period===p2)){skipped++;continue;}
    const due=p2+'-'+String(dd).padStart(2,'0');
    DB.payments.push({id:'p'+Date.now()+'_'+i+'_'+cid,contract:cid,period:p2,amount,due,paid:0,paidDate:null,status:daysLeft(due)<0?'overdue':'pending'});
    created++;
  }
  closeM();await afterStateChange();
  if(created===0) alert('Начисления за выбранные месяцы уже есть — ничего не создано.');
  else if(skipped>0) alert(`Создано начислений: ${created}. Пропущено (уже были): ${skipped}.`);}
function infoRow(k,v){return `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line);gap:14px"><span class="t-sub">${k}</span><span class="t-strong" style="text-align:right">${v}</span></div>`;}

// ============================================================
// СИТИ SRM — серверная версия (Этап 2)
// Многопользовательский режим, аутентификация, права доступа.
// Без внешних зависимостей: node:http + node:sqlite + node:crypto.
// ============================================================
import http from 'node:http';
import { readFile, writeFile, mkdir, statfs } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep } from 'node:path';
import {
  db, seed, resetData, hashPassword, verifyPassword,
  ROLES, ROLE_KEYS, perms, canView, canEdit
} from './db.js';
import { ask as llmAsk, hasModelKey, providerName } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const FILES_PATH = process.env.FILES_PATH || join(__dirname, 'files');  // локальное хранилище документов (монтируется томом на клиента)
const PORT = process.env.PORT || 4000;
// санитизация сегмента пути (буквы/цифры/._- , кириллица), без выхода вверх
const sanSeg = s => String(s||'').replace(/[^\w.\-а-яёА-ЯЁ ]+/gi,'_').replace(/^\.+/,'').slice(0,60);
const sanitizeRel = p => String(p||'').split('/').map(sanSeg).filter(Boolean).join('/') || 'misc';

seed();

// ---------- секрет для подписи токенов ----------
function getSecret(){
  let row = db.prepare(`SELECT json FROM state WHERE key='_secret'`).get();
  if(!row){
    const s = randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO state(key,json,updated_at) VALUES('_secret',?,?)`).run(s, new Date().toISOString());
    return s;
  }
  return row.json;
}
const SECRET = getSecret();
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const unb64 = s => JSON.parse(Buffer.from(s,'base64url').toString());
function signToken(payload){
  const body = b64(payload);
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token){
  if(!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a=Buffer.from(sig), e=Buffer.from(expect);
  if(a.length!==e.length || !timingSafeEqual(a,e)) return null;
  try{
    const p = unb64(body);
    if(p.exp && Date.now() > p.exp) return null;
    return p;
  }catch{ return null; }
}

// ---------- helpers ----------
const TASK_SELECT = `
  SELECT t.*, u.full_name AS assignee_name, u.position AS assignee_position,
         cu.full_name AS creator_name
  FROM tasks t
  LEFT JOIN users u  ON u.id = t.assignee_id
  LEFT JOIN users cu ON cu.id = t.created_by`;

const publicUser = u => u && ({
  id:u.id, email:u.email, full_name:u.full_name, position:u.position,
  role:u.role, roleTitle:(ROLES[u.role]||{}).title, phone:u.phone,
  active:!!u.active, created_at:u.created_at,
  permissions: perms(u.role)
});
// проекция без контактов — для пользователей без доступа к разделу «Сотрудники»
const liteUser = u => u && ({
  id:u.id, full_name:u.full_name, position:u.position,
  role:u.role, roleTitle:(ROLES[u.role]||{}).title, active:!!u.active,
  permissions: perms(u.role)
});
// карта: коллекция состояния → модуль прав (для серверной авторизации записи/чтения)
const STATE_MOD = { buildings:'objects', units:'objects', tenants:'tenants', contracts:'contracts',
  payments:'payments', utilities:'utilities', expenses:'utilities', buildingMeters:'utilities', salaries:'salaries',
  requests:'requests', equipment:'upkeep', listings:'ads', signage:'ads',
  budgets:'budget', penaltyRate:'budget', integrations:'integrations' };
const isFull = role => role==='admin' || role==='owner';
// убираем из состояния разделы, которые роль не имеет права видеть (защита чтения)
function filterStateForRole(state, role){
  if(isFull(role)) return state;
  const s = {...state};
  if(!canView(role,'salaries')) s.salaries = [];
  if(!canView(role,'budget')) s.budgets = {};
  // токен Telegram-бота — только админу/собственнику
  if(s.settings && s.settings.notify && s.settings.notify.telegram){
    s.settings = {...s.settings, notify:{...s.settings.notify, telegram:{...s.settings.notify.telegram, token:''}}};
  }
  return s;
}

// ============================================================
// AI-помощник (Фаза 1: только чтение и подсказки, ничего не меняет)
// ============================================================
// Краткая справка по разделам — грунтовка ответов (чтобы модель не выдумывала).
const ASSISTANT_KNOWLEDGE = `СИТИ SRM — система управления коммерческой недвижимостью (объекты, помещения, арендаторы, договоры, платежи, коммуналка, бюджет, задачи, заявки, плановое ТО, реклама, отчёты, настройки).
Разделы и подсказки:
- Сегодня — дела дня с действием в один клик (оплатить, продлить, ТО выполнено, взять заявку, завершить задачу).
- Дашборд — ключевые показатели; настраивается (⚙ Настроить), блоки перетаскиваются.
- Объекты и занятость — здания и помещения; «+ Объект», «+ Помещение»; у помещения есть номер, название, тип, площадь, статус. Тарифы коммуналки и расчётный коэффициент электро задаются в карточке объекта (✎ Редактировать).
- Арендаторы — компании-арендаторы, контакты, договоры, документы. Заселить арендатора можно из карточки свободного помещения (🏠 Заселить арендатора).
- Договоры — ставка (за м²/мес или фиксированная за помещение/мес), срок, индексация, депозит. Изменить аренду — «✎ Изменить аренду». Продлить — «Продлить».
- Платежи аренды — начисления и оплаты. Оплата: «✓ Оплачено» (полная в один тап) или «Оплата» (частичная, способ, дата). Автоначисление аренды включается в Настройках → Автоматизация.
- Коммуналка и расходы — начисления по помещениям и расходы на содержание. «📟 Показания помещений»: электро = (текущее−предыдущее)×коэффициент×тариф, вода = (текущее−предыдущее)×тариф, отопление = площадь×тариф ₽/м². «🏢 Показания ОДПУ» — общедомовые приборы учёта; сводка «Нагорело (ОДПУ) / Собрали (с помещений) / Разница (общедомовые нужды)». Тарифы — в карточке объекта или Настройках.
- Бюджет и долги — план/факт доходов и расходов, NOI = доходы минус расходы (факт), % выполнения; старение задолженности (1–30/31–60/61–90/90+ дней) и пени.
- Задачи — канбан, исполнители, сроки. Заявки на обслуживание — новые→в работе→выполнено. Плановое ТО — реестр оборудования, «✅ ТО выполнено».
- Центр сроков (🔔) — всё срочное в одном месте. Реклама — объявления ЦИАН/Авито и разрешения на вывески.
- Отчёты — доход/расход/NOI/маржа, заполняемость, экспорт CSV. Настройки — брендинг, модули, справочники, тарифы, Telegram, автоматизации (по умолчанию выключены).
- Документы (PDF/фото) прикрепляются в карточках помещений, арендаторов, объявлений, разрешений; план объекта — несколько файлов и PDF.`;

const ASSISTANT_SYS = `Ты встроенный помощник СИТИ SRM — системы управления коммерческой недвижимостью. Отвечай кратко, простым языком, по-русски. Опирайся ТОЛЬКО на предоставленные справку и данные. Если данных нет — честно скажи и предложи, где посмотреть. Где уместно — давай короткие шаги (1, 2, 3) и называй раздел меню. Никаких выдумок. Ты НИЧЕГО не меняешь в системе и не выполняешь действий — только подсказываешь, как сделать это пользователю.`;

const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
// Компактная выжимка данных по текущему scope и роли (state уже отфильтрован filterStateForRole).
function buildAssistantData(state, role, scope){
  const inB = b => !scope || scope==='all' || b===scope;
  const tName = Object.fromEntries((state.tenants||[]).map(t=>[t.id,t.name]));
  const uB = Object.fromEntries((state.units||[]).map(u=>[u.id,u.building]));
  const cU = Object.fromEntries((state.contracts||[]).map(c=>[c.id,c.unit]));
  const L=[];
  const today = new Date(new Date().toISOString().slice(0,10));
  const dl = d => d ? Math.round((new Date(d)-today)/864e5) : 9999;
  L.push(`Объектов: ${(state.buildings||[]).length}, помещений: ${(state.units||[]).length}, арендаторов: ${(state.tenants||[]).length}, договоров: ${(state.contracts||[]).length}.`);
  // должники (просроченные/неоплаченные)
  const debt=(state.payments||[]).filter(p=>(p.amount-p.paid)>0).filter(p=>inB(uB[cU[p.contract]]));
  if(debt.length){
    const sum=debt.reduce((s,p)=>s+(p.amount-p.paid),0);
    L.push(`Неоплаченные платежи: ${debt.length} на ${Math.round(sum)} ₽.`);
    debt.slice(0,15).forEach(p=>{ const c=(state.contracts||[]).find(x=>x.id===p.contract); const od=dl(p.due);
      L.push(`  • ${tName[c&&c.tenant]||p.contract} — ${Math.round(p.amount-p.paid)} ₽ за ${p.period}, срок ${fmtDate(p.due)}${od<0?` (просрочено ${-od} дн)`:''}.`); });
  } else L.push('Неоплаченных платежей нет.');
  // договоры на исходе (≤60 дн)
  const exp=(state.contracts||[]).filter(c=>c.status!=='ended' && inB(uB[c.unit]) && dl(c.end)<=60 && dl(c.end)>-3650).sort((a,b)=>dl(a.end)-dl(b.end));
  if(exp.length){ L.push(`Договоры истекают/истекли (≤60 дн): ${exp.length}.`); exp.slice(0,10).forEach(c=>L.push(`  • ${tName[c.tenant]||c.id} (${c.unit}) — до ${fmtDate(c.end)}.`)); }
  // ТО и заявки
  const to=(state.equipment||[]).filter(e=>inB(e.building) && dl(e.nextService)<=14);
  if(to.length){ L.push(`Плановое ТО скоро/просрочено: ${to.length}.`); to.slice(0,8).forEach(e=>L.push(`  • ${e.name} — ${fmtDate(e.nextService)}.`)); }
  const req=(state.requests||[]).filter(r=>(r.status==='new'||r.status==='in_progress') && inB(r.building));
  if(req.length) L.push(`Открытые заявки на обслуживание: ${req.length}.`);
  return L.join('\n');
}
// анти-злоупотребление: лимит запросов на пользователя
const assistHits = new Map();
function assistAllowed(uid){ const now=Date.now(); const r=assistHits.get(uid)||{c:0,ts:now};
  if(now-r.ts>60_000){ r.c=0; r.ts=now; } r.c++; assistHits.set(uid,r); return r.c<=15; }

// ---------- ежедневная сводка в Telegram ----------
const fmtMoney = n => new Intl.NumberFormat('ru-RU').format(Math.round(n||0)) + ' ₽';
const daysTo = d => d ? Math.round((new Date(d) - new Date(new Date().toISOString().slice(0,10)))/864e5) : 9999;
function buildDigest(){
  const st = JSON.parse(db.prepare(`SELECT json FROM state WHERE key='main'`).get().json);
  const tName = Object.fromEntries((st.tenants||[]).map(t=>[t.id,t.name]));
  const lines=[];
  const overdue=(st.payments||[]).filter(p=>p.amount-p.paid>0 && daysTo(p.due)<0);
  if(overdue.length) lines.push(`\u{1F534} Просроченные платежи: ${overdue.length} на ${fmtMoney(overdue.reduce((s,p)=>s+(p.amount-p.paid),0))}`);
  const tasks=db.prepare(`SELECT * FROM tasks WHERE status!='done'`).all().filter(t=>daysTo(t.due)<=0);
  if(tasks.length){ lines.push(`✅ Задачи на сегодня/просрочено: ${tasks.length}`); tasks.slice(0,6).forEach(t=>lines.push(`   • ${t.title}${daysTo(t.due)<0?' (просрочено)':''}`)); }
  const exp=(st.contracts||[]).filter(c=>c.status!=='ended' && daysTo(c.end)>=0 && daysTo(c.end)<=30);
  if(exp.length){ lines.push(`\u{1F4C4} Договоры истекают (≤30 дн): ${exp.length}`); exp.slice(0,5).forEach(c=>lines.push(`   • ${tName[c.tenant]||c.id} — до ${c.end}`)); }
  const to=(st.equipment||[]).filter(e=>daysTo(e.nextService)<=7);
  if(to.length){ lines.push(`\u{1F9F0} Плановое ТО (скоро/просрочено): ${to.length}`); to.slice(0,5).forEach(e=>lines.push(`   • ${e.name}`)); }
  const req=(st.requests||[]).filter(r=>r.status==='new'||r.status==='in_progress');
  if(req.length) lines.push(`\u{1F6E0} Открытые заявки: ${req.length}`);
  const head=`\u{1F4CA} СИТИ SRM — сводка на ${new Date().toLocaleDateString('ru-RU')}`;
  return lines.length ? head+'\n\n'+lines.join('\n') : head+'\n\n✅ Срочных дел на сегодня нет.';
}
async function sendTelegram(token, chatId, text){
  try{
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`,
      { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text }) });
    return r.ok;
  }catch{ return false; }
}
function notifyCfg(){ try{ const st=JSON.parse(db.prepare(`SELECT json FROM state WHERE key='main'`).get().json); return (st.settings&&st.settings.notify&&st.settings.notify.telegram)||null; }catch{ return null; } }
// мгновенное оповещение (если включено instant) — не блокирует ответ
function notifyInstant(text){ const tg=notifyCfg(); if(tg&&tg.instant&&tg.token&&tg.chatId) sendTelegram(tg.token, tg.chatId, text); }

// ---------- автоматизации (ежедневная проверка, серверная запись состояния) ----------
function loadMain(){ return JSON.parse(db.prepare(`SELECT json FROM state WHERE key='main'`).get().json); }
function saveMain(st, by){ db.prepare(`UPDATE state SET json=?, updated_at=?, updated_by=? WHERE key='main'`).run(JSON.stringify(st), new Date().toISOString(), by||'system'); }
const pad2 = n => String(n).padStart(2,'0');
// A1. Автоначисление аренды: в день начисления создаём начисления по активным договорам за текущий период.
// Идемпотентно (ключ договор+период) — повторный прогон и ручное начисление не плодят дублей.
function autoAccrueRent(st, today){
  const cfg = st.settings && st.settings.autoRent;
  if(!cfg || !cfg.enabled) return {created:0};
  const accrualDay = Math.min(28, Math.max(1, +cfg.accrualDay || 1));
  if(today.getDate() !== accrualDay) return {created:0};
  const period = today.getFullYear()+'-'+pad2(today.getMonth()+1);
  const dueDay = Math.min(28, Math.max(1, +cfg.dueDay || 5));
  const due = period+'-'+pad2(dueDay);
  const units = Object.fromEntries((st.units||[]).map(u=>[u.id,u]));
  const has = new Set((st.payments||[]).filter(p=>p.period===period).map(p=>p.contract));
  let created=0;
  (st.contracts||[]).forEach(c=>{
    if(c.status==='ended') return;
    if(c.end && new Date(c.end) < new Date(period+'-01')) return;   // договор уже завершился
    if(has.has(c.id)) return;                                       // начисление за период уже есть
    const u = units[c.unit]; if(!u) return;
    const amount = Math.round(c.rateType==='flat' ? (c.rate||0) : (c.rate||0)*(u.area||0)); if(amount<=0) return;
    st.payments.push({ id:'p'+Date.now()+'_'+c.id, contract:c.id, period, amount, due,
      paid:0, paidDate:null, status:(new Date(due)<today?'overdue':'pending'), auto:true });
    has.add(c.id); created++;
  });
  return {created, period};
}
// A3. Авто-напоминания должникам: по просрочкам, не чаще раза в N дней на долг (анти-спам по remindedAt).
function autoRemindDebtors(st, today){
  const cfg = st.settings && st.settings.autoRemind;
  if(!cfg || !cfg.enabled) return {sent:0};
  const everyDays = Math.max(1, +cfg.everyDays || 7);
  const tName = Object.fromEntries((st.tenants||[]).map(t=>[t.id,t.name]));
  const due=[];
  (st.payments||[]).forEach(p=>{
    if((p.amount-p.paid)<=0) return;
    if(new Date(p.due) >= today) return;                                   // только просроченные
    if(p.remindedAt){ const diff=(today-new Date(p.remindedAt))/864e5; if(diff<everyDays) return; }
    due.push(p);
  });
  if(!due.length) return {sent:0};
  const stamp = today.toISOString().slice(0,10);
  due.forEach(p=>{ p.remindedAt=stamp; });
  const tg = st.settings && st.settings.notify && st.settings.notify.telegram;
  if(tg && tg.token && tg.chatId){
    const lines = due.slice(0,20).map(p=>{ const c=(st.contracts||[]).find(x=>x.id===p.contract); const tn=c?tName[c.tenant]:''; return `• ${tn||p.contract} — ${fmtMoney(p.amount-p.paid)} (${p.period})`; });
    sendTelegram(tg.token, tg.chatId, `\u{1F4E8} Напоминание: должники (${due.length})\n`+lines.join('\n'));
  }
  return {sent:due.length};
}
// A2. Автоиндексация ставок: в годовщину начала договора повышаем ставку на indexation%. Анти-дубль по году в rateHistory.
function autoIndexRates(st, today){
  const cfg = st.settings && st.settings.autoIndex;
  if(!cfg || !cfg.enabled) return {applied:0};
  const y = today.getFullYear();
  const tName = Object.fromEntries((st.tenants||[]).map(t=>[t.id,t.name]));
  const out=[];
  (st.contracts||[]).forEach(c=>{
    if(c.status==='ended' || !c.indexation || !c.start) return;
    const s=new Date(c.start); if(isNaN(s)) return;
    if(s.getMonth()!==today.getMonth() || s.getDate()!==today.getDate()) return;   // не годовщина
    if(s.getFullYear()>=y) return;                                                 // в год начала не индексируем
    c.rateHistory = Array.isArray(c.rateHistory)?c.rateHistory:[];
    if(c.rateHistory.some(h=>String(h.date||'').slice(0,4)===String(y))) return;   // уже индексировали в этом году
    const oldRate=c.rate||0; const newRate=Math.round(oldRate*(1+(+c.indexation||0)/100));
    if(newRate===oldRate) return;
    c.rateHistory.push({date:today.toISOString().slice(0,10), oldRate, newRate});
    c.rate=newRate;
    out.push(`${tName[c.tenant]||c.id}: ${oldRate}→${newRate} ₽/м²`);
  });
  if(out.length){ const tg=st.settings&&st.settings.notify&&st.settings.notify.telegram;
    if(tg&&tg.token&&tg.chatId) sendTelegram(tg.token, tg.chatId, `\u{1F4C8} Индексация ставок (${out.length})\n`+out.join('\n')); }
  return {applied:out.length, list:out};
}
let _lastAuto=null;
function runDailyAutomations(){
  const today=new Date(); const dstr=today.toISOString().slice(0,10);
  if(_lastAuto===dstr) return; _lastAuto=dstr;
  try{
    const st=loadMain(); const entries=[];
    const idx=autoIndexRates(st, today);
    if(idx.applied>0) entries.push(`Автоиндексация ставок: ${idx.applied} (${idx.list.join('; ')})`);
    const rent=autoAccrueRent(st, today);
    if(rent.created>0) entries.push(`Автоначисление аренды за ${rent.period}: ${rent.created} начисл.`);
    const rem=autoRemindDebtors(st, today);
    if(rem.sent>0) entries.push(`Авто-напоминания должникам: ${rem.sent}`);
    if(entries.length){
      st.audit = Array.isArray(st.audit)?st.audit:[];
      st.audit.unshift({ts:today.toISOString(), user:'Система', role:'Автоматизация', entries});
      st.audit=st.audit.slice(0,200);
      saveMain(st,'auto');
      const tg=notifyCfg(); if(tg&&tg.instant&&tg.token&&tg.chatId) sendTelegram(tg.token, tg.chatId, '⚙ Автоматизация СИТИ SRM\n'+entries.join('\n'));
    }
  }catch(e){ console.error('automation', e.message); }
}

// планировщик: раз в минуту проверяем время отправки (раз в день) + ежедневные автоматизации
let _lastDigest=null;
setInterval(async ()=>{
  runDailyAutomations();
  const tg=notifyCfg();
  if(!tg||!tg.enabled||!tg.token||!tg.chatId) return;
  const now=new Date(); const hhmm=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const today=now.toISOString().slice(0,10);
  if(hhmm===(tg.time||'08:00') && _lastDigest!==today){ _lastDigest=today; await sendTelegram(tg.token, tg.chatId, buildDigest()); }
}, 60*1000);
setTimeout(runDailyAutomations, 5000); // прогон вскоре после старта
// роли, которые можно выбрать при самостоятельной регистрации (без привилегированных)
const SELF_ROLES = ['leasing','accountant','maintenance'];
// Самостоятельная регистрация по умолчанию ВЫКЛЮЧЕНА (безопасность боевого режима).
// Включить можно переменной окружения ALLOW_REGISTRATION=1 (для теста/демо).
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === '1';

// простой лимит попыток входа (анти-брутфорс)
const loginFails = new Map();
function loginKey(req, email){ return (req.headers['x-forwarded-for']||req.socket.remoteAddress||'')+'|'+email; }
function isLocked(key){ const r=loginFails.get(key); if(!r) return false; if(Date.now()-r.ts > 15*60*1000){ loginFails.delete(key); return false; } return r.count>=8; }
function noteFail(key){ const r=loginFails.get(key)||{count:0,ts:0}; r.count++; r.ts=Date.now(); loginFails.set(key,r); }

function parseCookies(req){
  const out={}; const h=req.headers.cookie; if(!h) return out;
  for(const part of h.split(';')){ const i=part.indexOf('='); if(i>-1) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim()); }
  return out;
}
function readBody(req){
  return new Promise((resolve)=>{
    let data=''; req.on('data',c=>{ data+=c; if(data.length>2.2e7) req.destroy(); });
    req.on('end',()=>{ try{ resolve(data?JSON.parse(data):{}); }catch{ resolve({}); } });
  });
}
function send(res, code, obj, headers={}){
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', ...headers });
  res.end(body);
}
function authUser(req){
  const t = parseCookies(req).srm_token;
  const p = verifyToken(t);
  if(!p) return null;
  return db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(p.uid) || null;
}
function setAuthCookie(req, res, uid){
  const token = signToken({ uid, exp: Date.now() + 7*864e5 });
  const secure = (req.headers['x-forwarded-proto']==='https') ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `srm_token=${token}; HttpOnly;${secure} Path=/; Max-Age=${7*86400}; SameSite=Lax`);
}

// ============================================================
// API
// ============================================================
async function api(req, res, url){
  const path = url.pathname;
  const method = req.method;
  const seg = path.split('/').filter(Boolean); // ['api', ...]

  // ---- AUTH (без токена) ----
  // Публичный флаг: разрешена ли самостоятельная регистрация (по умолчанию — нет).
  if(path==='/api/config' && method==='GET'){
    // assistantKey — задан ли ключ модели в окружении (UI помощника показывается только тогда + при включении в Настройках)
    return send(res,200,{ allowRegistration: ALLOW_REGISTRATION, assistantKey: hasModelKey(), assistantProvider: providerName() });
  }
  if(path==='/api/auth/register' && method==='POST'){
    if(!ALLOW_REGISTRATION) return send(res,403,{error:'Регистрация закрыта. Учётную запись создаёт администратор.'});
    const b = await readBody(req);
    const email=(b.email||'').trim().toLowerCase();
    if(!email || !b.password || !b.full_name) return send(res,400,{error:'Заполните email, пароль и ФИО'});
    if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return send(res,409,{error:'Пользователь с таким email уже существует'});
    if(String(b.password).length < 6) return send(res,400,{error:'Пароль не короче 6 символов'});
    // самостоятельно нельзя получить привилегированную роль — только админ назначает
    const role = SELF_ROLES.includes(b.role) ? b.role : 'maintenance';
    const info = db.prepare(`INSERT INTO users(email,password,full_name,position,role,phone,active,created_at)
                             VALUES(?,?,?,?,?,?,1,?)`)
      .run(email, hashPassword(b.password), b.full_name.trim(), (b.position||'').trim(), role, (b.phone||'').trim(), new Date().toISOString());
    setAuthCookie(req, res, info.lastInsertRowid);
    return send(res,200,{ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)) });
  }
  if(path==='/api/auth/login' && method==='POST'){
    const b = await readBody(req);
    const email=(b.email||'').trim().toLowerCase();
    const key = loginKey(req, email);
    if(isLocked(key)) return send(res,429,{error:'Слишком много попыток. Попробуйте через 15 минут.'});
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!u || !u.active || !verifyPassword(b.password||'', u.password)){ noteFail(key); return send(res,401,{error:'Неверный email или пароль'}); }
    loginFails.delete(key);
    setAuthCookie(req, res, u.id);
    return send(res,200,{ user: publicUser(u) });
  }
  if(path==='/api/auth/logout' && method==='POST'){
    res.setHeader('Set-Cookie', 'srm_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    return send(res,200,{ ok:true });
  }

  // ---- всё ниже требует аутентификации ----
  const me = authUser(req);
  if(!me) return send(res,401,{error:'Требуется вход'});

  if(path==='/api/auth/me' && method==='GET') return send(res,200,{ user: publicUser(me) });

  if(path==='/api/bootstrap' && method==='GET'){
    const state = JSON.parse(db.prepare(`SELECT json FROM state WHERE key='main'`).get().json);
    const tasks = db.prepare(TASK_SELECT + ' ORDER BY t.id').all();
    const proj = canView(me.role,'employees') ? publicUser : liteUser; // контакты — только кадровым ролям
    const users = db.prepare('SELECT * FROM users ORDER BY full_name').all().map(proj);
    return send(res,200,{
      user: publicUser(me),
      roles: ROLES,
      state: filterStateForRole(state, me.role), tasks, users
    });
  }

  // ---- общее состояние (помещения/арендаторы/договоры/платежи/коммуналка/расходы) ----
  if(path==='/api/state'){
    const cur = JSON.parse(db.prepare(`SELECT json FROM state WHERE key='main'`).get().json);
    if(method==='GET'){
      return send(res,200, filterStateForRole(cur, me.role));
    }
    if(method==='POST'){
      const b = await readBody(req);
      const REQ = ['buildings','units','tenants','contracts','payments','utilities','expenses','history'];
      const okShape = b && REQ.every(k => k in b) &&
        REQ.every(k => Array.isArray(b[k])) &&
        b.units.length > 0 && b.buildings.length > 0; // защита от случайной перезаписи пустыми данными
      if(!okShape) return send(res,400,{error:'Некорректная структура данных состояния'});
      // СЕРВЕРНАЯ авторизация (БЕЛЫЙ список): для не-админа начинаем с текущего состояния
      // и накладываем ТОЛЬКО те коллекции, которые роли разрешено редактировать. Всё прочее
      // (settings, roleMatrix, history, _secret и любые неучтённые ключи) остаётся серверным.
      let toSave = b;
      if(!isFull(me.role)){
        const merged = {...cur};
        for(const [k,mod] of Object.entries(STATE_MOD)){ if(canEdit(me.role, mod)) merged[k] = b[k]; }
        if(Array.isArray(b.audit)) merged.audit = b.audit; // журнал действий дописывают все роли
        toSave = merged;
      }
      db.prepare(`UPDATE state SET json=?, updated_at=?, updated_by=? WHERE key='main'`)
        .run(JSON.stringify(toSave), new Date().toISOString(), me.email);
      // мгновенные оповещения о новых заявках
      try{
        const oldIds=new Set((cur.requests||[]).map(r=>r.id));
        const bn=Object.fromEntries((toSave.buildings||[]).map(x=>[x.id,x.name]));
        const PR={high:'высокий',medium:'средний',low:'низкий'};
        (toSave.requests||[]).filter(r=>!oldIds.has(r.id)).forEach(r=>
          notifyInstant(`\u{1F195} Новая заявка на обслуживание\n${r.title}\nТип: ${r.category||'—'} · приоритет: ${PR[r.priority]||r.priority||''}\nОбъект: ${bn[r.building]||r.building||'—'}${r.unit?', помещ. '+r.unit:''}`));
      }catch{}
      return send(res,200,{ ok:true });
    }
  }

  // ---- задачи ----
  if(path==='/api/tasks'){
    if(method==='GET') return send(res,200, db.prepare(TASK_SELECT+' ORDER BY t.id').all());
    if(method==='POST'){
      if(!canEdit(me.role,'tasks')) return send(res,403,{error:'Нет прав на создание задач'});
      const b = await readBody(req);
      if(!b.title) return send(res,400,{error:'Укажите описание задачи'});
      const info = db.prepare(`INSERT INTO tasks(title,description,unit,assignee_id,created_by,due,priority,status,created_at)
                               VALUES(?,?,?,?,?,?,?,'open',?)`)
        .run(b.title.trim(), (b.description||'').trim(), b.unit||'—',
             b.assignee_id||null, me.id, b.due||null, b.priority||'medium', new Date().toISOString());
      const asg = b.assignee_id ? db.prepare('SELECT full_name FROM users WHERE id=?').get(b.assignee_id) : null;
      notifyInstant(`\u{2705} Новая задача\n${b.title.trim()}${b.unit&&b.unit!=='—'?'\nПомещение: '+b.unit:''}${asg?'\nИсполнитель: '+asg.full_name:''}${b.due?'\nСрок: '+b.due:''}`);
      return send(res,200, db.prepare(TASK_SELECT+' WHERE t.id=?').get(info.lastInsertRowid));
    }
  }
  if(seg[1]==='tasks' && seg[2]){
    const id = +seg[2];
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if(!task) return send(res,404,{error:'Задача не найдена'});
    if(method==='PATCH'){
      const b = await readBody(req);
      const isOwnerOfTask = task.assignee_id===me.id || task.created_by===me.id;
      if(!canEdit(me.role,'tasks') && !isOwnerOfTask) return send(res,403,{error:'Нет прав на изменение задачи'});
      const fields=[], vals=[];
      for(const k of ['title','description','unit','priority','status']) if(k in b){ fields.push(`${k}=?`); vals.push(b[k]); }
      if('assignee_id' in b){ fields.push('assignee_id=?'); vals.push(b.assignee_id||null); }
      if('due' in b){ fields.push('due=?'); vals.push(b.due||null); }
      if('status' in b){ fields.push('done_at=?'); vals.push(b.status==='done'? new Date().toISOString() : null); }
      if(fields.length){ vals.push(id); db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id=?`).run(...vals); }
      return send(res,200, db.prepare(TASK_SELECT+' WHERE t.id=?').get(id));
    }
    if(method==='DELETE'){
      if(!canEdit(me.role,'tasks')) return send(res,403,{error:'Нет прав'});
      db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      return send(res,200,{ ok:true });
    }
  }

  // ---- сотрудники / пользователи ----
  if(path==='/api/users'){
    if(method==='GET'){
      if(!canView(me.role,'employees')) return send(res,403,{error:'Нет доступа к сотрудникам'});
      return send(res,200, db.prepare('SELECT * FROM users ORDER BY full_name').all().map(publicUser));
    }
    if(method==='POST'){
      if(!canEdit(me.role,'employees')) return send(res,403,{error:'Только администратор может добавлять сотрудников'});
      const b = await readBody(req);
      const email=(b.email||'').trim().toLowerCase();
      if(!email || !b.password || !b.full_name) return send(res,400,{error:'Заполните email, пароль и ФИО'});
      if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return send(res,409,{error:'Email уже занят'});
      const role = ROLE_KEYS.includes(b.role)?b.role:'maintenance';
      const info = db.prepare(`INSERT INTO users(email,password,full_name,position,role,phone,active,created_at)
                               VALUES(?,?,?,?,?,?,1,?)`)
        .run(email, hashPassword(b.password), b.full_name.trim(), (b.position||'').trim(), role, (b.phone||'').trim(), new Date().toISOString());
      return send(res,200, publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)));
    }
  }
  if(seg[1]==='users' && seg[2]){
    if(!canEdit(me.role,'employees')) return send(res,403,{error:'Только администратор'});
    const id=+seg[2];
    const u=db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if(!u) return send(res,404,{error:'Сотрудник не найден'});
    if(method==='PATCH'){
      const b=await readBody(req);
      const fields=[],vals=[];
      for(const k of ['full_name','position','phone']) if(k in b){ fields.push(`${k}=?`); vals.push((b[k]||'').trim()); }
      if('role' in b && ROLE_KEYS.includes(b.role)){ fields.push('role=?'); vals.push(b.role); }
      if('active' in b){ fields.push('active=?'); vals.push(b.active?1:0); }
      if('password' in b && b.password){ fields.push('password=?'); vals.push(hashPassword(b.password)); }
      if(fields.length){ vals.push(id); db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...vals); }
      return send(res,200, publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
    }
    if(method==='DELETE'){
      if(id===me.id) return send(res,400,{error:'Нельзя удалить самого себя'});
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      return send(res,200,{ ok:true });
    }
  }

  // ---- сброс к демо-данным (админ) ----
  if(path==='/api/reset' && method==='POST'){
    if(me.role!=='admin' && me.role!=='owner') return send(res,403,{error:'Недостаточно прав'});
    resetData();
    return send(res,200,{ ok:true });
  }

  // ---- тестовая отправка сводки в Telegram (админ) ----
  if(path==='/api/notify/test' && method==='POST'){
    if(!isFull(me.role)) return send(res,403,{error:'Только администратор'});
    const tg=notifyCfg();
    if(!tg||!tg.token||!tg.chatId) return send(res,400,{error:'Не заданы токен бота и chat_id. Сохраните настройки.'});
    const ok=await sendTelegram(tg.token, tg.chatId, buildDigest());
    return send(res,200,{ ok });
  }

  // ---- AI-помощник (Фаза 1: только чтение/подсказки) ----
  if(path==='/api/assistant' && method==='POST'){
    const st = JSON.parse(db.prepare(`SELECT json FROM state WHERE key='main'`).get().json);
    const cfg = (st.settings && st.settings.assistant) || {};
    if(!hasModelKey() || !cfg.enabled) return send(res,200,{ enabled:false });   // ключа нет или выключен в Настройках
    if(!assistAllowed(me.id)) return send(res,429,{ error:'Слишком много вопросов подряд. Подождите минуту.' });
    const b = await readBody(req);
    const question = String(b.question||'').trim().slice(0,1000);
    if(!question) return send(res,400,{ error:'Пустой вопрос' });
    const scope = (typeof b.scope==='string') ? b.scope : 'all';
    // контекст: только данные, доступные роли (filterStateForRole), без секретов
    const safe = filterStateForRole(st, me.role);
    const data = buildAssistantData(safe, me.role, scope);
    const messages = [
      { role:'system', content: ASSISTANT_SYS + '\n\nСПРАВКА ПО СИСТЕМЕ:\n' + ASSISTANT_KNOWLEDGE },
      { role:'system', content: 'ДАННЫЕ (текущий объект/портфель, по правам пользователя; не показывай чужого):\n' + data },
      ...(Array.isArray(b.history) ? b.history.filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string').slice(-6).map(m=>({role:m.role,content:String(m.content).slice(0,1500)})) : []),
      { role:'user', content: question },
    ];
    const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), 30_000);
    try{
      const answer = await llmAsk(messages, { signal: ctrl.signal, temperature:0.3 });
      console.log(`[assistant] uid=${me.id} role=${me.role} q.len=${question.length}`);
      return send(res,200,{ enabled:true, answer: String(answer||'').trim() || 'Не удалось сформировать ответ. Попробуйте переформулировать.' });
    }catch(e){
      console.error('[assistant] error', e.message);
      return send(res,200,{ enabled:true, error:'Помощник временно недоступен, попробуйте позже.' });
    }finally{ clearTimeout(timer); }
  }

  // ---- загрузка документа в локальное файловое хранилище ----
  if(path==='/api/files' && method==='POST'){
    if(!isFull(me.role) && !canEdit(me.role,'objects') && !canEdit(me.role,'tenants') && !canEdit(me.role,'ads'))
      return send(res,403,{error:'Нет прав на загрузку документов'});
    const b = await readBody(req);
    if(!b.dataUrl || !/^data:/.test(b.dataUrl)) return send(res,400,{error:'Нет файла'});
    const mime = (/^data:([^;,]+)[;,]/.exec(b.dataUrl)||[])[1] || '';
    if(/(html|svg|xml|xhtml|javascript|ecmascript)/i.test(mime) || /\.(html?|svg|xml|js|mjs)$/i.test(b.name||''))
      return send(res,403,{error:'Тип файла запрещён (html/svg/скрипты)'});
    const base64 = b.dataUrl.split(',')[1] || '';
    const buf = Buffer.from(base64, 'base64');
    if(buf.length > 12*1024*1024) return send(res,413,{error:'Файл больше 12 МБ'});
    // защита от заполнения диска: не принимаем, если свободно меньше 500 МБ
    try{ const s = await statfs(FILES_PATH); if(s.bsize*s.bavail < 500*1024*1024) return send(res,507,{error:'Недостаточно места на диске'}); }catch{}
    const folder = sanitizeRel(b.folder || 'misc');
    const safeName = sanSeg(b.name || 'file').slice(0,80) || 'file';
    const fname = Date.now() + '_' + safeName;
    const abs = join(FILES_PATH, folder, fname);
    if(!abs.startsWith(FILES_PATH + sep)) return send(res,400,{error:'Некорректный путь'});
    try{
      await mkdir(dirname(abs), { recursive:true });
      await writeFile(abs, buf);
      return send(res,200,{ url:'/api/files/'+folder+'/'+encodeURIComponent(fname), stored:'file', size:buf.length });
    }catch(e){ console.error('file upload', e.message); return send(res,500,{error:'Не удалось сохранить файл'}); }
  }
  // ---- отдача документа (только залогиненным) ----
  if(seg[1]==='files' && method==='GET' && seg.length>2){
    const rel = decodeURIComponent(seg.slice(2).join('/'));
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/,'');
    const abs = join(FILES_PATH, safe);
    if(!abs.startsWith(FILES_PATH + sep)) { res.writeHead(403); return res.end('Forbidden'); }
    try{
      const data = await readFile(abs);
      const ct = MIME[extname(abs).toLowerCase()];
      // безопасно показывать в браузере только pdf/картинки; остальное — только скачивание
      const inlineOk = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i.test(ct||'');
      const headers = { 'Content-Type': ct || 'application/octet-stream', 'Cache-Control':'private, max-age=3600',
        'X-Content-Type-Options':'nosniff' };
      if(!inlineOk) headers['Content-Disposition'] = 'attachment';
      res.writeHead(200, headers);
      return res.end(data);
    }catch{ res.writeHead(404); return res.end('Not found'); }
  }

  return send(res,404,{error:'Не найдено'});
}

// ============================================================
// Статика
// ============================================================
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webmanifest':'application/manifest+json','.webp':'image/webp','.pdf':'application/pdf','.gif':'image/gif','.heic':'image/heic','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.txt':'text/plain; charset=utf-8','.zip':'application/zip'};
async function serveStatic(req,res,url){
  let p = decodeURIComponent(url.pathname);
  if(p==='/') p='/index.html';
  const safe = normalize(p).replace(/^(\.\.[/\\])+/,'');
  const file = join(PUBLIC, safe);
  if(!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  try{
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(data);
  }catch{
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('Not found');
  }
}

// ============================================================
http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  try{
    if(url.pathname.startsWith('/api/')) return await api(req,res,url);
    return await serveStatic(req,res,url);
  }catch(err){
    console.error(err);
    send(res,500,{error:'Внутренняя ошибка сервера'});
  }
}).listen(PORT, '0.0.0.0', ()=>{
  console.log(`\n  СИТИ SRM (серверная версия) — http://localhost:${PORT}`);
  if(!process.env.SEED_PASSWORD) console.warn('  ⚠ SEED_PASSWORD не задан — используются демо-пароли. Для боевого режима задайте SEED_PASSWORD.');
  console.log('');
});

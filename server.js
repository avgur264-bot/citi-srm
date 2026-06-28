// ============================================================
// СИТИ SRM — серверная версия (Этап 2)
// Многопользовательский режим, аутентификация, права доступа.
// Без внешних зависимостей: node:http + node:sqlite + node:crypto.
// ============================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import {
  db, seed, resetData, hashPassword, verifyPassword,
  ROLES, ROLE_KEYS, perms, canView, canEdit
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 4000;

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
  payments:'payments', utilities:'utilities', expenses:'utilities', salaries:'salaries',
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
// планировщик: раз в минуту проверяем время отправки (раз в день)
let _lastDigest=null;
setInterval(async ()=>{
  const tg=notifyCfg();
  if(!tg||!tg.enabled||!tg.token||!tg.chatId) return;
  const now=new Date(); const hhmm=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const today=now.toISOString().slice(0,10);
  if(hhmm===(tg.time||'08:00') && _lastDigest!==today){ _lastDigest=today; await sendTelegram(tg.token, tg.chatId, buildDigest()); }
}, 60*1000);
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
    let data=''; req.on('data',c=>{ data+=c; if(data.length>1e7) req.destroy(); });
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
    return send(res,200,{ allowRegistration: ALLOW_REGISTRATION });
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
      // СЕРВЕРНАЯ авторизация: роль не может изменять разделы, на которые у неё нет права edit.
      // Для защищённых коллекций сохраняем серверное (текущее) значение, игнорируя присланное.
      let toSave = b;
      if(!isFull(me.role)){
        const merged = {...b};
        for(const [k,mod] of Object.entries(STATE_MOD)){ if(!canEdit(me.role, mod)) merged[k] = cur[k]; }
        merged.settings = cur.settings;     // оформление меняет только админ
        merged.roleMatrix = cur.roleMatrix; // права меняет только админ
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

  return send(res,404,{error:'Не найдено'});
}

// ============================================================
// Статика
// ============================================================
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webmanifest':'application/manifest+json','.webp':'image/webp'};
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

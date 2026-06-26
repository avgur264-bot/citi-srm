// ============================================================
// СИТИ SRM — серверная версия (Этап 2)
// Многопользовательский режим, аутентификация, права доступа.
// Без внешних зависимостей: node:http + node:sqlite + node:crypto.
// ============================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import {
  db, seed, resetData, hashPassword, verifyPassword,
  ROLES, ROLE_KEYS, perms, canView, canEdit
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 4000;
const OPERATIONAL = ['objects','tenants','contracts','payments','utilities'];

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
  if(sig !== expect) return null;
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
function setAuthCookie(res, uid){
  const token = signToken({ uid, exp: Date.now() + 7*864e5 });
  res.setHeader('Set-Cookie', `srm_token=${token}; HttpOnly; Path=/; Max-Age=${7*86400}; SameSite=Lax`);
}

// ============================================================
// API
// ============================================================
async function api(req, res, url){
  const path = url.pathname;
  const method = req.method;
  const seg = path.split('/').filter(Boolean); // ['api', ...]

  // ---- AUTH (без токена) ----
  if(path==='/api/auth/register' && method==='POST'){
    const b = await readBody(req);
    const email=(b.email||'').trim().toLowerCase();
    if(!email || !b.password || !b.full_name) return send(res,400,{error:'Заполните email, пароль и ФИО'});
    if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return send(res,409,{error:'Пользователь с таким email уже существует'});
    const role = ROLE_KEYS.includes(b.role) ? b.role : 'maintenance';
    const info = db.prepare(`INSERT INTO users(email,password,full_name,position,role,phone,active,created_at)
                             VALUES(?,?,?,?,?,?,1,?)`)
      .run(email, hashPassword(b.password), b.full_name.trim(), (b.position||'').trim(), role, (b.phone||'').trim(), new Date().toISOString());
    setAuthCookie(res, info.lastInsertRowid);
    return send(res,200,{ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)) });
  }
  if(path==='/api/auth/login' && method==='POST'){
    const b = await readBody(req);
    const email=(b.email||'').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!u || !u.active || !verifyPassword(b.password||'', u.password)) return send(res,401,{error:'Неверный email или пароль'});
    setAuthCookie(res, u.id);
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
    const users = db.prepare('SELECT * FROM users ORDER BY full_name').all().map(publicUser);
    return send(res,200,{
      user: publicUser(me),
      roles: ROLES,
      state, tasks, users
    });
  }

  // ---- общее состояние (помещения/арендаторы/договоры/платежи/коммуналка/расходы) ----
  if(path==='/api/state'){
    if(method==='GET'){
      return send(res,200, JSON.parse(db.prepare(`SELECT json FROM state WHERE key='main'`).get().json));
    }
    if(method==='POST'){
      const hasEdit = OPERATIONAL.some(m=>canEdit(me.role,m));
      if(!hasEdit) return send(res,403,{error:'Нет прав на изменение данных'});
      const b = await readBody(req);
      const REQ = ['buildings','units','tenants','contracts','payments','utilities','expenses','history'];
      const okShape = b && REQ.every(k => k in b) &&
        ['buildings','units','tenants','contracts','payments','utilities','expenses','history'].every(k => Array.isArray(b[k])) &&
        b.units.length > 0 && b.buildings.length > 0; // защита от случайной перезаписи пустыми данными
      if(!okShape) return send(res,400,{error:'Некорректная структура данных состояния'});
      db.prepare(`UPDATE state SET json=?, updated_at=?, updated_by=? WHERE key='main'`)
        .run(JSON.stringify(b), new Date().toISOString(), me.email);
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

  return send(res,404,{error:'Не найдено'});
}

// ============================================================
// Статика
// ============================================================
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
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
}).listen(PORT, ()=>{
  console.log(`\n  СИТИ SRM (серверная версия) — http://localhost:${PORT}\n`);
  console.log('  Демо-аккаунты (email / пароль):');
  console.log('   admin@citisrm.ru / admin123   — Администратор (полный доступ)');
  console.log('   owner@citisrm.ru / owner123   — Собственник (только чтение)');
  console.log('   lease@citisrm.ru / lease123   — Отдел аренды');
  console.log('   buh@citisrm.ru   / buh123     — Бухгалтер');
  console.log('   exp@citisrm.ru   / exp123     — Эксплуатация\n');
});

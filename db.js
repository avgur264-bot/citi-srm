// ============================================================
// СИТИ SRM — слой данных (SQLite, встроенный node:sqlite)
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const db = new DatabaseSync(join(__dirname, 'srm.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ---------- Роли и права доступа ----------
// view  — какие модули видны (read)
// edit  — какие модули можно изменять (write)
// Модули: dashboard, objects, tenants, contracts, payments, utilities, tasks, reports, employees
const ALL = ['dashboard','objects','tenants','contracts','payments','utilities','tasks','reports','employees'];

export const ROLES = {
  admin:       { title:'Администратор',             view: ALL, edit: ALL },
  owner:       { title:'Собственник / Руководитель', view: ALL, edit: ALL },
  manager:     { title:'Управляющий объектом',       view: ALL, edit: ['dashboard','objects','tenants','contracts','payments','utilities','tasks','reports'] },
  accountant:  { title:'Бухгалтер / Финансист',      view: ['dashboard','objects','tenants','contracts','payments','utilities','tasks','reports'], edit: ['payments','utilities'] },
  leasing:     { title:'Отдел аренды',               view: ['dashboard','objects','tenants','contracts','payments','tasks'], edit: ['objects','tenants','contracts','tasks'] },
  maintenance: { title:'Эксплуатация',               view: ['dashboard','objects','utilities','tasks'], edit: ['utilities','tasks'] },
};
export const ROLE_KEYS = Object.keys(ROLES);
export const perms = role => ROLES[role] || ROLES.maintenance;
export const canView = (role, mod) => perms(role).view.includes(mod);
export const canEdit = (role, mod) => perms(role).edit.includes(mod);

// ---------- Пароли ----------
export function hashPassword(pw){
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored){
  if(!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Схема ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  position TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'maintenance',
  phone TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  unit TEXT DEFAULT '—',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS state(
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT
);
`);

// ============================================================
// Наполнение демо-данными (один раз)
// ============================================================
function seedUsers(){
  const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if(count > 0) return;
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT INTO users(email,password,full_name,position,role,phone,active,created_at)
                          VALUES(?,?,?,?,?,?,1,?)`);
  const demo = [
    ['admin@citisrm.ru','admin123','Минин Сергей','Управляющий объектом','admin','+7 901 770-88-07'],
    ['owner@citisrm.ru','owner123','Иванов Иван','Собственник','owner','+7 916 700-80-90'],
    ['manager@citisrm.ru','manager123','Зайцева Ольга','Управляющий объектом','manager','+7 917 880-99-08'],
    ['lease@citisrm.ru','lease123','Лебедева Анна','Менеджер по аренде','leasing','+7 925 110-22-01'],
    ['buh@citisrm.ru','buh123','Карпов Дмитрий','Главный бухгалтер','accountant','+7 903 330-44-03'],
    ['exp@citisrm.ru','exp123','Сидоров Павел','Инженер эксплуатации','maintenance','+7 909 660-77-06'],
  ];
  for(const [email,pw,name,pos,role,phone] of demo)
    ins.run(email, hashPassword(pw), name, pos, role, phone, now);
}

function seedState(){
  const exists = db.prepare(`SELECT 1 FROM state WHERE key='main'`).get();
  if(exists) return;
  db.prepare(`INSERT INTO state(key,json,updated_at,updated_by) VALUES('main',?,?, 'seed')`)
    .run(JSON.stringify(buildSeedState()), new Date().toISOString());
}

function seedTasks(){
  const count = db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  if(count > 0) return;
  const now = new Date().toISOString();
  const uid = email => db.prepare('SELECT id FROM users WHERE email=?').get(email)?.id || null;
  const admin = uid('admin@citisrm.ru'), exp = uid('exp@citisrm.ru'), lease = uid('lease@citisrm.ru'), buh = uid('buh@citisrm.ru');
  const ins = db.prepare(`INSERT INTO tasks(title,description,unit,assignee_id,created_by,due,priority,status,created_at,done_at)
                          VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const T = [
    ['Согласовать индексацию аренды c3 (ТехноСофт)','','2-01',admin,admin,'2026-06-29','high','open',null],
    ['Подготовить продление договора c4 (Юрбюро Лекс)','','2-02',admin,admin,'2026-07-10','high','open',null],
    ['Ремонт кондиционера в помещении 4-01','','4-01',exp,admin,'2026-06-28','medium','in_progress',null],
    ['Показ помещения 1-03 потенциальному арендатору','','1-03',lease,admin,'2026-06-27','high','open',null],
    ['Взыскать задолженность по c6 (ФинКонсалт)','','3-02',buh,admin,'2026-06-30','high','open',null],
    ['Плановая проверка пожарной сигнализации','','—',exp,admin,'2026-07-05','medium','open',null],
    ['Заключить договор клининга на 2 полугодие','','—',admin,admin,'2026-06-24','medium','done','2026-06-23'],
    ['Подготовить помещение 4-02 к сдаче','','4-02',exp,admin,'2026-07-15','low','open',null],
  ];
  for(const t of T) ins.run(t[0],t[1],t[2],t[3],t[4],t[5],t[6],t[7],now,t[8]);
}

export function resetData(){
  db.exec('DELETE FROM tasks; DELETE FROM state;');
  // пользователей не трогаем — иначе потеряется текущая сессия/аккаунты
  seedState();
  seedTasks();
}

export function seed(){
  seedUsers();
  seedState();
  migrate();
  seedTasks();
}

// Миграция: одиночное здание -> массив объектов (для ранее созданных БД)
export function migrate(){
  const row=db.prepare(`SELECT json FROM state WHERE key='main'`).get();
  if(!row) return;
  let s; try{ s=JSON.parse(row.json); }catch{ return; }
  let changed=false;
  if(s.building && !s.buildings){
    s.buildings=[{id:'b1', ...s.building}];
    s.units.forEach(u=>{ if(!u.building) u.building='b1'; });
    (s.expenses||[]).forEach(e=>{ if(!e.building) e.building='b1'; });
    delete s.building; changed=true;
  }
  if(changed) db.prepare(`UPDATE state SET json=? WHERE key='main'`).run(JSON.stringify(s));
}

// Второй демонстрационный объект (для портфеля)
export const DEMO2 = {
  building:{id:'b2', name:'Бизнес-парк «Север»', address:'г. Москва, ул. Складочная, 7', floors:3, totalArea:3200},
  units:[
    {id:'С1-01',building:'b2',floor:1,area:180,type:'Склад',tenant:'tb1'},
    {id:'С1-02',building:'b2',floor:1,area:120,type:'Ритейл',tenant:null,status:'free'},
    {id:'С2-01',building:'b2',floor:2,area:240,type:'Офис',tenant:'tb2'},
    {id:'С2-02',building:'b2',floor:2,area:160,type:'Офис',tenant:null,status:'reserved'},
    {id:'С3-01',building:'b2',floor:3,area:300,type:'Офис',tenant:null,status:'free'},
  ],
  tenants:[
    {id:'tb1',name:'ООО «ЛогистикПро»',contact:'Виктор Сенин',phone:'+7 495 700-10-20',email:'senin@logpro.ru',inn:'7720123450',industry:'Логистика'},
    {id:'tb2',name:'ООО «ДатаКор»',contact:'Алла Жукова',phone:'+7 495 700-30-40',email:'zhukova@datacor.ru',inn:'7720654321',industry:'IT'},
  ],
  contracts:[
    {id:'cb1',tenant:'tb1',unit:'С1-01',rate:1200,start:'2025-01-01',end:'2027-12-31',deposit:432000,indexation:5,status:'active'},
    {id:'cb2',tenant:'tb2',unit:'С2-01',rate:1750,start:'2024-06-01',end:'2026-08-31',deposit:840000,indexation:6,status:'active'},
  ],
  payments:[
    {id:'pb1',contract:'cb1',period:'2026-06',amount:216000,due:'2026-06-05',paid:216000,paidDate:'2026-06-03',status:'paid'},
    {id:'pb2',contract:'cb2',period:'2026-06',amount:420000,due:'2026-06-05',paid:0,paidDate:null,status:'overdue'},
  ],
  expenses:[
    {id:'eb1',building:'b2',category:'Клининг',vendor:'ООО «Чистый Дом»',period:'2026-06',amount:90000,status:'paid'},
    {id:'eb2',building:'b2',category:'Охрана',vendor:'ЧОП «Барьер»',period:'2026-06',amount:150000,status:'invoiced'},
  ],
};

// ---------- Демо-состояние (помещения/арендаторы/договоры/платежи/коммуналка/расходы) ----------
function buildSeedState(){
  const S = {
    building:{name:'БЦ «СИТИ Плаза»', address:'г. Москва, Пресненская наб., 12', floors:5, totalArea:8400},
    units:[
      {id:'1-01',floor:1,area:120,type:'Ритейл',tenant:'t1'},
      {id:'1-02',floor:1,area:85,type:'Ритейл',tenant:'t2'},
      {id:'1-03',floor:1,area:64,type:'Кафе',tenant:null,status:'free'},
      {id:'2-01',floor:2,area:210,type:'Офис',tenant:'t3'},
      {id:'2-02',floor:2,area:150,type:'Офис',tenant:'t4'},
      {id:'2-03',floor:2,area:95,type:'Офис',tenant:null,status:'reserved'},
      {id:'3-01',floor:3,area:320,type:'Офис',tenant:'t5'},
      {id:'3-02',floor:3,area:140,type:'Офис',tenant:'t6'},
      {id:'4-01',floor:4,area:280,type:'Офис',tenant:'t7'},
      {id:'4-02',floor:4,area:160,type:'Офис',tenant:null,status:'free'},
      {id:'5-01',floor:5,area:400,type:'Офис',tenant:'t8'},
      {id:'5-02',floor:5,area:130,type:'Коворкинг',tenant:'t9'},
    ],
    tenants:[
      {id:'t1',name:'ООО «Кофехауз»',contact:'Анна Лебедева',phone:'+7 925 110-22-01',email:'a.lebedeva@coffeehouse.ru',inn:'7701234561',industry:'Общепит'},
      {id:'t2',name:'ИП Орлова (Цветы)',contact:'Мария Орлова',phone:'+7 916 220-33-02',email:'orlova@flowers.ru',inn:'771512345602',industry:'Ритейл'},
      {id:'t3',name:'ООО «ТехноСофт»',contact:'Дмитрий Карпов',phone:'+7 903 330-44-03',email:'d.karpov@technosoft.ru',inn:'7703234563',industry:'IT'},
      {id:'t4',name:'АО «Юрбюро Лекс»',contact:'Игорь Соколов',phone:'+7 985 440-55-04',email:'sokolov@lex.ru',inn:'7704234564',industry:'Юр.услуги'},
      {id:'t5',name:'ООО «Медиа Группа»',contact:'Елена Власова',phone:'+7 926 550-66-05',email:'vlasova@media.ru',inn:'7705234565',industry:'Реклама'},
      {id:'t6',name:'ООО «ФинКонсалт»',contact:'Павел Гущин',phone:'+7 909 660-77-06',email:'gushchin@fincons.ru',inn:'7706234566',industry:'Консалтинг'},
      {id:'t7',name:'ООО «БилдПро»',contact:'Сергей Минин',phone:'+7 901 770-88-07',email:'minin@buildpro.ru',inn:'7707234567',industry:'Строительство'},
      {id:'t8',name:'АО «ГлобалТрейд»',contact:'Ольга Зайцева',phone:'+7 917 880-99-08',email:'zaytseva@gtrade.ru',inn:'7708234568',industry:'Торговля'},
      {id:'t9',name:'ООО «Старт Хаб»',contact:'Никита Фомин',phone:'+7 999 990-00-09',email:'fomin@starthub.ru',inn:'7709234569',industry:'Коворкинг'},
    ],
    contracts:[
      {id:'c1',tenant:'t1',unit:'1-01',rate:3200,start:'2024-03-01',end:'2027-02-28',deposit:768000,indexation:7,status:'active'},
      {id:'c2',tenant:'t2',unit:'1-02',rate:3500,start:'2023-09-01',end:'2026-08-31',deposit:595000,indexation:5,status:'active'},
      {id:'c3',tenant:'t3',unit:'2-01',rate:2100,start:'2024-01-15',end:'2027-01-14',deposit:882000,indexation:6,status:'active'},
      {id:'c4',tenant:'t4',unit:'2-02',rate:2300,start:'2025-02-01',end:'2026-07-31',deposit:690000,indexation:6,status:'expiring'},
      {id:'c5',tenant:'t5',unit:'3-01',rate:1950,start:'2023-06-01',end:'2026-05-31',deposit:1248000,indexation:5,status:'active'},
      {id:'c6',tenant:'t6',unit:'3-02',rate:2200,start:'2024-11-01',end:'2027-10-31',deposit:616000,indexation:7,status:'active'},
      {id:'c7',tenant:'t7',unit:'4-01',rate:2050,start:'2024-08-01',end:'2026-07-31',deposit:1148000,indexation:6,status:'expiring'},
      {id:'c8',tenant:'t8',unit:'5-01',rate:1850,start:'2022-12-01',end:'2027-11-30',deposit:1480000,indexation:5,status:'active'},
      {id:'c9',tenant:'t9',unit:'5-02',rate:2400,start:'2025-03-01',end:'2026-09-30',deposit:374000,indexation:8,status:'active'},
    ],
    payments:[
      {id:'p1',contract:'c1',period:'2026-06',amount:384000,due:'2026-06-05',paid:384000,paidDate:'2026-06-03',status:'paid'},
      {id:'p2',contract:'c2',period:'2026-06',amount:297500,due:'2026-06-05',paid:297500,paidDate:'2026-06-04',status:'paid'},
      {id:'p3',contract:'c3',period:'2026-06',amount:441000,due:'2026-06-05',paid:0,paidDate:null,status:'overdue'},
      {id:'p4',contract:'c4',period:'2026-06',amount:345000,due:'2026-06-05',paid:345000,paidDate:'2026-06-05',status:'paid'},
      {id:'p5',contract:'c5',period:'2026-06',amount:624000,due:'2026-06-05',paid:624000,paidDate:'2026-06-02',status:'paid'},
      {id:'p6',contract:'c6',period:'2026-06',amount:308000,due:'2026-06-05',paid:0,paidDate:null,status:'overdue'},
      {id:'p7',contract:'c7',period:'2026-06',amount:574000,due:'2026-06-05',paid:300000,paidDate:'2026-06-06',status:'partial'},
      {id:'p8',contract:'c8',period:'2026-06',amount:740000,due:'2026-06-05',paid:740000,paidDate:'2026-06-01',status:'paid'},
      {id:'p9',contract:'c9',period:'2026-06',amount:312000,due:'2026-06-05',paid:0,paidDate:null,status:'pending'},
    ],
    utilities:[
      {id:'u1',unit:'1-01',period:'2026-06',electricity:18400,water:4200,heating:9100,status:'invoiced'},
      {id:'u2',unit:'2-01',period:'2026-06',electricity:24600,water:5100,heating:14300,status:'paid'},
      {id:'u3',unit:'3-01',period:'2026-06',electricity:31200,water:6800,heating:21800,status:'invoiced'},
      {id:'u4',unit:'4-01',period:'2026-06',electricity:27300,water:5900,heating:19000,status:'overdue'},
      {id:'u5',unit:'5-01',period:'2026-06',electricity:38900,water:8400,heating:27200,status:'paid'},
    ],
    expenses:[
      {id:'e1',category:'Клининг',vendor:'ООО «Чистый Дом»',period:'2026-06',amount:185000,status:'paid'},
      {id:'e2',category:'Охрана',vendor:'ЧОП «Барьер»',period:'2026-06',amount:240000,status:'paid'},
      {id:'e3',category:'Лифты (ТО)',vendor:'ООО «ЛифтСервис»',period:'2026-06',amount:78000,status:'invoiced'},
      {id:'e4',category:'Текущий ремонт',vendor:'ООО «РемСтрой»',period:'2026-06',amount:132000,status:'invoiced'},
      {id:'e5',category:'Вывоз ТКО',vendor:'Эко-Транс',period:'2026-06',amount:46000,status:'paid'},
      {id:'e6',category:'Озеленение',vendor:'ИП Гринин',period:'2026-06',amount:29000,status:'planned'},
    ],
    history:[
      {m:'Янв',income:3680,expense:1240},{m:'Фев',income:3720,expense:1180},
      {m:'Мар',income:3850,expense:1310},{m:'Апр',income:3910,expense:1260},
      {m:'Май',income:3980,expense:1290},{m:'Июн',income:4025,expense:1340},
    ],
  };
  // обогащение помещений: документы, форма владения, ответственное лицо
  const defaultDocs = u => {
    const docs=[
      {name:'План_помещения_'+u.id+'.pdf',type:'plan',kind:'Поэтажный план'},
      {name:'Выписка_ЕГРН_'+u.id+'.pdf',type:'ownership',kind:'Право собственности'},
    ];
    const c=S.contracts.find(c=>c.unit===u.id);
    if(c){docs.push({name:'Договор_аренды_'+c.id.toUpperCase()+'.pdf',type:'contract',kind:'Договор аренды'});
          docs.push({name:'Акт_приёма-передачи_'+u.id+'.pdf',type:'act',kind:'Акт приёма-передачи'});}
    return docs;
  };
  const META={
    '1-01':{ownership:'sold',owner:{name:'ООО «Инвест-Капитал»',inn:'7710456789',contact:'Романов Андрей · +7 495 120-30-40'},
      responsible:{name:'Лебедева Анна',role:'Менеджер по аренде',phone:'+7 925 110-22-01',email:'a.lebedeva@citisrm.ru'}},
    '5-01':{ownership:'sold',owner:{name:'Иванов Иван Иванович (физ. лицо)',inn:'771801234567',contact:'+7 916 700-80-90'},
      responsible:{name:'Зайцева Ольга',role:'Менеджер по аренде',phone:'+7 917 880-99-08',email:'o.zaytseva@citisrm.ru'}},
    '2-01':{responsible:{name:'Карпов Дмитрий',role:'Управляющий 2 этажа',phone:'+7 903 330-44-03',email:'d.karpov@citisrm.ru'}},
    '3-01':{responsible:{name:'Власова Елена',role:'Управляющий 3 этажа',phone:'+7 926 550-66-05',email:'e.vlasova@citisrm.ru'}},
  };
  // объединяем со вторым объектом (портфель)
  S.expenses.forEach(e=>e.building='b1');
  S.units.push(...DEMO2.units.map(u=>({...u})));
  S.tenants.push(...DEMO2.tenants);
  S.contracts.push(...DEMO2.contracts);
  S.payments.push(...DEMO2.payments);
  S.expenses.push(...DEMO2.expenses);
  S.units.forEach(u=>{
    if(!u.building) u.building='b1';
    const m=META[u.id]||{};
    u.ownership=m.ownership||'own';
    u.owner=m.owner||null;
    u.responsible=m.responsible||{name:'Минин Сергей',role:'Управляющий объектом',phone:'+7 901 770-88-07',email:'manager@citisrm.ru'};
    u.documents=defaultDocs(u);
    if(u.ownership==='sold'){
      u.documents.push({name:'Договор_купли-продажи_'+u.id+'.pdf',type:'contract',kind:'Договор купли-продажи (ДКП)'});
      u.documents.push({name:'Документы_собственника_'+u.id+'.pdf',type:'owner',kind:'Документы собственника'});
    }
  });
  S.buildings=[{id:'b1', ...S.building}, DEMO2.building];
  delete S.building;
  return S;
}

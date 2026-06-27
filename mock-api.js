/* ---------- ВСТРОЕННЫЙ «БЭКЕНД» (автономный демо-режим, данные в localStorage браузера) ---------- */
const SRM_KEY='srm_demo_db';
const _ALL=['dashboard','objects','tenants','contracts','payments','utilities','tasks','reports','employees','salaries','integrations'];
const SRM_ROLES={
  admin:{title:'Администратор',view:_ALL,edit:_ALL},
  owner:{title:'Собственник / Руководитель',view:_ALL,edit:_ALL},
  manager:{title:'Управляющий объектом',view:_ALL,edit:['dashboard','objects','tenants','contracts','payments','utilities','tasks','reports','salaries','integrations']},
  accountant:{title:'Бухгалтер / Финансист',view:['dashboard','objects','tenants','contracts','payments','utilities','tasks','reports','salaries','integrations'],edit:['payments','utilities','salaries','integrations']},
  leasing:{title:'Отдел аренды',view:['dashboard','objects','tenants','contracts','payments','tasks'],edit:['objects','tenants','contracts','tasks']},
  maintenance:{title:'Эксплуатация',view:['dashboard','objects','utilities','tasks'],edit:['utilities','tasks']},
};
const _perms=r=>SRM_ROLES[r]||SRM_ROLES.maintenance;
const _pubUser=u=>u&&({id:u.id,email:u.email,full_name:u.full_name,position:u.position,role:u.role,roleTitle:(SRM_ROLES[u.role]||{}).title,phone:u.phone,active:!!u.active,created_at:u.created_at,permissions:_perms(u.role)});

function srmBuildState(){
  const S={
    units:[
      {id:'1-01',floor:1,area:120,type:'Ритейл',tenant:'t1'},{id:'1-02',floor:1,area:85,type:'Ритейл',tenant:'t2'},
      {id:'1-03',floor:1,area:64,type:'Кафе',tenant:null,status:'free'},{id:'2-01',floor:2,area:210,type:'Офис',tenant:'t3'},
      {id:'2-02',floor:2,area:150,type:'Офис',tenant:'t4'},{id:'2-03',floor:2,area:95,type:'Офис',tenant:null,status:'reserved'},
      {id:'3-01',floor:3,area:320,type:'Офис',tenant:'t5'},{id:'3-02',floor:3,area:140,type:'Офис',tenant:'t6'},
      {id:'4-01',floor:4,area:280,type:'Офис',tenant:'t7'},{id:'4-02',floor:4,area:160,type:'Офис',tenant:null,status:'free'},
      {id:'5-01',floor:5,area:400,type:'Офис',tenant:'t8'},{id:'5-02',floor:5,area:130,type:'Коворкинг',tenant:'t9'},
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
      {m:'Янв',income:3680,expense:1240},{m:'Фев',income:3720,expense:1180},{m:'Мар',income:3850,expense:1310},
      {m:'Апр',income:3910,expense:1260},{m:'Май',income:3980,expense:1290},{m:'Июн',income:4025,expense:1340},
    ],
    salaries:[
      {id:'sal1',user_id:1,period:'2026-06',amount:180000,paid:180000,status:'paid',paidDate:'2026-06-05',method:'bank'},
      {id:'sal2',user_id:2,period:'2026-06',amount:250000,paid:250000,status:'paid',paidDate:'2026-06-05',method:'bank'},
      {id:'sal3',user_id:3,period:'2026-06',amount:160000,paid:160000,status:'paid',paidDate:'2026-06-05',method:'bank'},
      {id:'sal4',user_id:4,period:'2026-06',amount:120000,paid:0,status:'accrued',paidDate:null,method:null},
      {id:'sal5',user_id:5,period:'2026-06',amount:140000,paid:140000,status:'paid',paidDate:'2026-06-05',method:'bank'},
      {id:'sal6',user_id:6,period:'2026-06',amount:110000,paid:0,status:'accrued',paidDate:null,method:null},
    ],
    integrations:{ bank:{connected:false,name:'',lastSync:null}, energy:{connected:false,lastSync:null}, water:{connected:false,lastSync:null}, onec:{connected:false,base:'',lastSync:null} },
  };
  const D2={
    building:{id:'b2',name:'Бизнес-парк «Север»',address:'г. Москва, ул. Складочная, 7',floors:3,totalArea:3200},
    units:[
      {id:'С1-01',building:'b2',floor:1,area:180,type:'Склад',tenant:'tb1'},{id:'С1-02',building:'b2',floor:1,area:120,type:'Ритейл',tenant:null,status:'free'},
      {id:'С2-01',building:'b2',floor:2,area:240,type:'Офис',tenant:'tb2'},{id:'С2-02',building:'b2',floor:2,area:160,type:'Офис',tenant:null,status:'reserved'},
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
  const META={
    '1-01':{ownership:'sold',owner:{name:'ООО «Инвест-Капитал»',inn:'7710456789',contact:'Романов Андрей · +7 495 120-30-40'},responsible:{name:'Лебедева Анна',role:'Менеджер по аренде',phone:'+7 925 110-22-01',email:'a.lebedeva@citisrm.ru'}},
    '5-01':{ownership:'sold',owner:{name:'Иванов Иван Иванович (физ. лицо)',inn:'771801234567',contact:'+7 916 700-80-90'},responsible:{name:'Зайцева Ольга',role:'Менеджер по аренде',phone:'+7 917 880-99-08',email:'o.zaytseva@citisrm.ru'}},
    '2-01':{responsible:{name:'Карпов Дмитрий',role:'Управляющий 2 этажа',phone:'+7 903 330-44-03',email:'d.karpov@citisrm.ru'}},
    '3-01':{responsible:{name:'Власова Елена',role:'Управляющий 3 этажа',phone:'+7 926 550-66-05',email:'e.vlasova@citisrm.ru'}},
  };
  const docs=u=>{const d=[{name:'План_помещения_'+u.id+'.pdf',type:'plan',kind:'Поэтажный план'},{name:'Выписка_ЕГРН_'+u.id+'.pdf',type:'ownership',kind:'Право собственности'}];
    const c=S.contracts.find(c=>c.unit===u.id); if(c){d.push({name:'Договор_аренды_'+c.id.toUpperCase()+'.pdf',type:'contract',kind:'Договор аренды'});d.push({name:'Акт_приёма-передачи_'+u.id+'.pdf',type:'act',kind:'Акт приёма-передачи'});} return d;};
  S.expenses.forEach(e=>e.building='b1');
  S.units.push(...D2.units.map(u=>({...u}))); S.tenants.push(...D2.tenants); S.contracts.push(...D2.contracts); S.payments.push(...D2.payments); S.expenses.push(...D2.expenses);
  S.units.forEach(u=>{ if(!u.building)u.building='b1'; const m=META[u.id]||{}; u.ownership=m.ownership||'own'; u.owner=m.owner||null;
    u.responsible=m.responsible||{name:'Минин Сергей',role:'Управляющий объектом',phone:'+7 901 770-88-07',email:'manager@citisrm.ru'};
    u.documents=docs(u);
    if(u.ownership==='sold'){u.documents.push({name:'Договор_купли-продажи_'+u.id+'.pdf',type:'contract',kind:'Договор купли-продажи (ДКП)'});u.documents.push({name:'Документы_собственника_'+u.id+'.pdf',type:'owner',kind:'Документы собственника'});}
  });
  S.buildings=[{id:'b1',name:'БЦ «СИТИ Плаза»',address:'г. Москва, Пресненская наб., 12',floors:5,totalArea:8400}, D2.building];
  return S;
}
function srmSeed(){
  const now=new Date().toISOString();
  const du=[
    ['admin@citisrm.ru','admin123','Минин Сергей','Управляющий объектом','admin','+7 901 770-88-07'],
    ['owner@citisrm.ru','owner123','Иванов Иван','Собственник','owner','+7 916 700-80-90'],
    ['manager@citisrm.ru','manager123','Зайцева Ольга','Управляющий объектом','manager','+7 917 880-99-08'],
    ['lease@citisrm.ru','lease123','Лебедева Анна','Менеджер по аренде','leasing','+7 925 110-22-01'],
    ['buh@citisrm.ru','buh123','Карпов Дмитрий','Главный бухгалтер','accountant','+7 903 330-44-03'],
    ['exp@citisrm.ru','exp123','Сидоров Павел','Инженер эксплуатации','maintenance','+7 909 660-77-06'],
  ];
  const users=du.map((u,i)=>({id:i+1,email:u[0],password:u[1],full_name:u[2],position:u[3],role:u[4],phone:u[5],active:1,created_at:now}));
  const T=[
    ['Согласовать индексацию аренды c3 (ТехноСофт)','2-01',1,'2026-06-29','high','open',null],
    ['Подготовить продление договора c4 (Юрбюро Лекс)','2-02',1,'2026-07-10','high','open',null],
    ['Ремонт кондиционера в помещении 4-01','4-01',6,'2026-06-28','medium','in_progress',null],
    ['Показ помещения 1-03 потенциальному арендатору','1-03',4,'2026-06-27','high','open',null],
    ['Взыскать задолженность по c6 (ФинКонсалт)','3-02',5,'2026-06-30','high','open',null],
    ['Плановая проверка пожарной сигнализации','—',6,'2026-07-05','medium','open',null],
    ['Заключить договор клининга на 2 полугодие','—',1,'2026-06-24','medium','done','2026-06-23'],
    ['Подготовить помещение 4-02 к сдаче','4-02',6,'2026-07-15','low','open',null],
  ];
  const tasks=T.map((t,i)=>({id:i+1,title:t[0],description:'',unit:t[1],assignee_id:t[2],created_by:1,due:t[3],priority:t[4],status:t[5],created_at:now,done_at:t[6]}));
  return {users,state:srmBuildState(),tasks,session:null,seq:{user:users.length,task:tasks.length}};
}
function _srmLoad(){ let d=null; try{d=JSON.parse(localStorage.getItem(SRM_KEY));}catch{} if(!d||!d.users){ d=srmSeed(); localStorage.setItem(SRM_KEY,JSON.stringify(d)); } return d; }
function _srmSave(d){ localStorage.setItem(SRM_KEY,JSON.stringify(d)); }

async function api(path, method='GET', body){
  const db=_srmLoad();
  const E=m=>{throw new Error(m);};
  const seg=path.split('/').filter(Boolean);
  const me=()=>db.users.find(u=>u.id===db.session)||null;
  const join=t=>{const a=db.users.find(u=>u.id===t.assignee_id),c=db.users.find(u=>u.id===t.created_by);
    return {...t,assignee_name:a?a.full_name:null,assignee_position:a?a.position:null,creator_name:c?c.full_name:null};};

  // В автономном демо регистрация и демо-доступ остаются открытыми.
  if(path==='/api/config') return {allowRegistration:true};
  if(path==='/api/auth/register'&&method==='POST'){
    const email=(body.email||'').toLowerCase().trim();
    if(!email||!body.password||!body.full_name) E('Заполните email, пароль и ФИО');
    if(db.users.some(u=>u.email===email)) E('Пользователь с таким email уже существует');
    const id=++db.seq.user;
    const u={id,email,password:body.password,full_name:body.full_name.trim(),position:(body.position||'').trim(),role:SRM_ROLES[body.role]?body.role:'maintenance',phone:(body.phone||'').trim(),active:1,created_at:new Date().toISOString()};
    db.users.push(u); db.session=id; _srmSave(db); return {user:_pubUser(u)};
  }
  if(path==='/api/auth/login'&&method==='POST'){
    const email=(body.email||'').toLowerCase().trim();
    const u=db.users.find(x=>x.email===email);
    if(!u||!u.active||u.password!==body.password) E('Неверный email или пароль');
    db.session=u.id; _srmSave(db); return {user:_pubUser(u)};
  }
  if(path==='/api/auth/logout'&&method==='POST'){ db.session=null; _srmSave(db); return {ok:true}; }

  const M=me(); if(!M) E('Требуется вход');
  if(path==='/api/auth/me') return {user:_pubUser(M)};
  if(path==='/api/bootstrap') return {user:_pubUser(M),roles:SRM_ROLES,state:db.state,tasks:db.tasks.map(join),users:db.users.map(_pubUser)};
  if(path==='/api/state'){ if(method==='GET') return db.state; if(method==='POST'){ db.state=body; _srmSave(db); return {ok:true}; } }
  if(path==='/api/tasks'){
    if(method==='GET') return db.tasks.map(join);
    if(method==='POST'){ const id=++db.seq.task;
      const t={id,title:body.title,description:body.description||'',unit:body.unit||'—',assignee_id:body.assignee_id||null,created_by:M.id,due:body.due||null,priority:body.priority||'medium',status:'open',created_at:new Date().toISOString(),done_at:null};
      db.tasks.push(t); _srmSave(db); return join(t); }
  }
  if(seg[1]==='tasks'&&seg[2]){ const id=+seg[2]; const t=db.tasks.find(x=>x.id===id); if(!t) E('Задача не найдена');
    if(method==='PATCH'){ for(const k of ['title','description','unit','priority','status']) if(k in body) t[k]=body[k];
      if('assignee_id' in body) t.assignee_id=body.assignee_id||null; if('due' in body) t.due=body.due||null;
      if('status' in body) t.done_at=body.status==='done'?new Date().toISOString():null; _srmSave(db); return join(t); }
    if(method==='DELETE'){ db.tasks=db.tasks.filter(x=>x.id!==id); _srmSave(db); return {ok:true}; }
  }
  if(path==='/api/users'){
    if(method==='GET') return db.users.map(_pubUser);
    if(method==='POST'){ const email=(body.email||'').toLowerCase().trim();
      if(!email||!body.password||!body.full_name) E('Заполните email, пароль и ФИО');
      if(db.users.some(u=>u.email===email)) E('Email уже занят'); const id=++db.seq.user;
      const u={id,email,password:body.password,full_name:body.full_name.trim(),position:(body.position||'').trim(),role:SRM_ROLES[body.role]?body.role:'maintenance',phone:(body.phone||'').trim(),active:1,created_at:new Date().toISOString()};
      db.users.push(u); _srmSave(db); return _pubUser(u); }
  }
  if(seg[1]==='users'&&seg[2]){ const id=+seg[2]; const u=db.users.find(x=>x.id===id); if(!u) E('Сотрудник не найден');
    if(method==='PATCH'){ for(const k of ['full_name','position','phone']) if(k in body) u[k]=(body[k]||'').trim();
      if('role' in body&&SRM_ROLES[body.role]) u.role=body.role; if('active' in body) u.active=body.active?1:0;
      if('password' in body&&body.password) u.password=body.password; _srmSave(db); return _pubUser(u); }
    if(method==='DELETE'){ if(id===M.id) E('Нельзя удалить самого себя'); db.users=db.users.filter(x=>x.id!==id); _srmSave(db); return {ok:true}; }
  }
  if(path==='/api/reset'&&method==='POST'){ const f=srmSeed(); db.tasks=f.tasks; db.state=f.state; db.seq.task=f.seq.task; _srmSave(db); return {ok:true}; }
  E('Не найдено');
}

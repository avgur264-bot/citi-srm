// ============================================================
// СИТИ SRM — интеграция со Сбербанком (Sber API / СберБизнес).
// Назначение: получение банковской выписки по расчётному счёту для автосверки
// поступлений с начислениями аренды. ТОЛЬКО ЧТЕНИЕ (scope GET_STATEMENT_ACCOUNT,
// GET_CLIENT_ACCOUNTS) — прав на платежи не запрашиваем и не используем.
//
// Без внешних зависимостей: node:https (mTLS), node:crypto, node:fs.
//
// Особенности Sber API, заложенные здесь:
//  • Обязательный TLS-сертификат клиента (mTLS). Node умеет .p12 напрямую: pfx + passphrase.
//  • access_token живёт 60 мин  → обновляем по refresh_token.
//  • refresh_token живёт 180 дней и ПРИ ОБНОВЛЕНИИ РОТИРУЕТСЯ → новый обязательно сохраняем.
//  • client_secret живёт 40 дней → метод /v1/change-client-secret; новый secret тоже сохраняем.
//  • Выписка постраничная (links rel=next).
//
// Секреты — только в окружении/файлах клиента. В браузер и в БД не попадают.
// Токены и текущий client_secret хранит вызывающая сторона (server.js) в служебном
// ключе состояния (не отдаётся в API) — сюда передаётся через store.
// ============================================================
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.SBER_API_BASE || 'https://fintech.sberbank.ru:9443';   // боевой контур
// тестовый: https://iftfintech.testsbi.sberbank.ru:9443

export function sberConfigured(){
  return !!(process.env.SBER_CLIENT_ID && process.env.SBER_PFX_PATH && process.env.SBER_ACCOUNT);
}
export function sberAccount(){ return process.env.SBER_ACCOUNT || ''; }

// ---------- mTLS-транспорт ----------
let _pfx = null;
function pfxBuf(){
  if(_pfx) return _pfx;
  const p = process.env.SBER_PFX_PATH;
  if(!p) throw new Error('Не задан SBER_PFX_PATH (сертификат .p12)');
  _pfx = readFileSync(p);
  return _pfx;
}

// Низкоуровневый запрос с клиентским сертификатом. Возвращает {status, headers, text, json}.
function req(path, { method='GET', headers={}, body=null, timeoutMs=30000 } = {}){
  const url = new URL(BASE + path);
  const opts = {
    method,
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    headers: { 'Accept':'application/json', 'RqUID': randomUUID().replace(/-/g,''), ...headers },
    pfx: pfxBuf(),
    passphrase: process.env.SBER_PFX_PASS || '',
    // TLS-проверку банка НЕ отключаем. Если понадобится цепочка Минцифры — она уже
    // добавлена в образ (NODE_EXTRA_CA_CERTS), как для GigaChat.
  };
  return new Promise((resolve, reject) => {
    const r = httpsRequest(opts, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; if(data.length > 8e6) { r.destroy(); reject(new Error('Слишком большой ответ банка')); } });
      res.on('end', () => {
        let json = null;
        try{ json = data ? JSON.parse(data) : null; }catch{}
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    r.on('error', e => reject(new Error('Соединение со Сбером: ' + e.message)));
    r.setTimeout(timeoutMs, () => { r.destroy(); reject(new Error('Таймаут запроса к Сберу')); });
    if(body) r.write(body);
    r.end();
  });
}

const form = o => Object.entries(o).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');

// ---------- Токены ----------
// store: { load(): {access_token, refresh_token, expires_at, client_secret, secret_updated_at},
//          save(obj): Promise }
// Возвращает актуальный access_token, при необходимости обновив его по refresh_token.
export async function accessToken(store){
  const st = (await store.load()) || {};
  const now = Date.now();
  if(st.access_token && st.expires_at && now < st.expires_at - 60_000) return st.access_token;   // запас 1 мин
  const refresh = st.refresh_token || process.env.SBER_REFRESH_TOKEN;
  if(!refresh) throw new Error('Нет refresh_token — нужно получить токены в личном кабинете Sber API');

  const secret = st.client_secret || process.env.SBER_CLIENT_SECRET || '';
  const r = await req('/ic/sso/api/v2/oauth/token', {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body: form({ grant_type:'refresh_token', client_id: process.env.SBER_CLIENT_ID, client_secret: secret, refresh_token: refresh }),
  });
  if(r.status !== 200 || !r.json || !r.json.access_token){
    throw new Error('Не удалось обновить токен Сбера (' + r.status + '): ' + String(r.text||'').slice(0,300));
  }
  const j = r.json;
  const next = {
    ...st,
    access_token: j.access_token,
    // ВАЖНО: refresh_token ротируется — сохраняем новый, иначе через раз всё сломается
    refresh_token: j.refresh_token || refresh,
    expires_at: now + (Number(j.expires_in || 3600) * 1000),
  };
  await store.save(next);
  return next.access_token;
}

// Перевыпуск client_secret (живёт 40 дней). Вызывать по расписанию заранее (например на 30-й день).
export async function rotateClientSecret(store){
  const st = (await store.load()) || {};
  const cur = st.client_secret || process.env.SBER_CLIENT_SECRET || '';
  if(!cur) throw new Error('Нет текущего client_secret');
  const token = await accessToken(store);
  const r = await req('/v1/change-client-secret', {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
    body: JSON.stringify({ client_id: process.env.SBER_CLIENT_ID, client_secret: cur }),
  });
  const ns = r.json && (r.json.client_secret || r.json.clientSecret);
  if(r.status !== 200 || !ns){
    throw new Error('Не удалось перевыпустить client_secret (' + r.status + '): ' + String(r.text||'').slice(0,300));
  }
  await store.save({ ...(await store.load()||{}), client_secret: ns, secret_updated_at: Date.now() });
  return true;
}
// Пора ли обновлять секрет (живёт 40 дней — обновляем на 30-й, с запасом).
export function secretNeedsRotation(st){
  const t = st && st.secret_updated_at;
  if(!t) return false;                       // не знаем дату первой выдачи — ротируем по расписанию отдельно
  return (Date.now() - t) > 30*864e5;
}

// ---------- Выписка ----------
// Возвращает массив нормализованных операций за дату (со всех страниц).
// date: 'YYYY-MM-DD'. account: номер счёта (20 цифр).
export async function getStatement(store, account, date, { maxPages=20 } = {}){
  const token = await accessToken(store);
  const out = [];
  let page = 1, raw0 = null;
  while(page <= maxPages){
    const q = `?accountNumber=${encodeURIComponent(account)}&statementDate=${encodeURIComponent(date)}&page=${page}`;
    const r = await req('/fintech/api/v2/statement/transactions' + q, {
      headers:{ 'Authorization':'Bearer '+token },
    });
    if(r.status === 202){                     // выписка ещё формируется
      const e = new Error('Выписка формируется банком, повторите через несколько минут');
      e.code = 'PROCESSING'; throw e;
    }
    if(r.status === 404){ break; }            // за эту дату операций нет
    if(r.status !== 200){
      throw new Error('Сбер: выписка (' + r.status + '): ' + String(r.text||'').slice(0,300));
    }
    if(page === 1) raw0 = r.json;
    const list = pickTransactions(r.json);
    list.forEach(t => out.push(normalizeTx(t, account)));
    if(!hasNext(r.json)) break;
    page++;
  }
  return { transactions: out, rawFirstPage: raw0 };
}

// В ответе банка список операций может лежать под разными ключами — берём первый подходящий массив.
function pickTransactions(j){
  if(!j || typeof j !== 'object') return [];
  for(const k of ['transactions','operations','items','data','content','list']){
    if(Array.isArray(j[k])) return j[k];
  }
  // иногда обёрнуто: {statement:{transactions:[...]}}
  for(const k of Object.keys(j)){
    const v = j[k];
    if(v && typeof v === 'object' && !Array.isArray(v)){
      for(const k2 of ['transactions','operations','items']) if(Array.isArray(v[k2])) return v[k2];
    }
  }
  return [];
}
function hasNext(j){
  const links = (j && (j.links || j._links)) || [];
  if(Array.isArray(links)) return links.some(l => l && l.rel === 'next' && l.href);
  if(links && typeof links === 'object') return !!links.next;
  return false;
}

// Приводим операцию банка к единому виду. Имена полей у Сбера могут отличаться —
// разбираем максимально терпимо (после первого боевого ответа при необходимости уточним).
function normalizeTx(t, account){
  const g = (...keys) => { for(const k of keys){ const v = deepGet(t, k); if(v!==undefined && v!==null && v!=='') return v; } return ''; };
  const amount = num(g('amount','amountRub','sum','operationAmount','amount.amount'));
  // Направление: поступление (кредит) или списание (дебет).
  const payerAcc = String(g('payerAccount','payer.account','payerAccountNumber','debitAccount') || '');
  const payeeAcc = String(g('payeeAccount','payee.account','payeeAccountNumber','creditAccount') || '');
  let direction = String(g('direction','operationType','type') || '').toUpperCase();
  let incoming;
  if(direction.includes('CREDIT') || direction === 'IN' || direction.includes('ПОСТУПЛ')) incoming = true;
  else if(direction.includes('DEBIT') || direction === 'OUT' || direction.includes('СПИСАН')) incoming = false;
  else incoming = !!(payeeAcc && account && payeeAcc.replace(/\s/g,'') === String(account).replace(/\s/g,''));
  return {
    id: String(g('id','uuid','transactionId','operationId','documentId') || ''),
    date: String(g('operationDate','statementDate','date','documentDate','valueDate') || '').slice(0,10),
    amount,
    incoming,
    purpose: String(g('purpose','paymentPurpose','description','operationPurpose','purposeText') || ''),
    payerName: String(g('payerName','payer.name','payerNameFull','counterpartyName') || ''),
    payerInn: String(g('payerInn','payer.inn','counterpartyInn') || ''),
    docNumber: String(g('documentNumber','docNumber','number') || ''),
    payerAcc, payeeAcc,
  };
}
function deepGet(o, path){
  return String(path).split('.').reduce((a,k)=> (a && typeof a==='object') ? a[k] : undefined, o);
}
function num(v){
  if(typeof v === 'number') return v;
  if(v && typeof v === 'object' && v.amount !== undefined) return num(v.amount);
  const n = parseFloat(String(v==null?'':v).replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : 0;
}

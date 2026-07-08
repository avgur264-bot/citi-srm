// ============================================================
// СИТИ SRM — интеграция раздела «Реклама» с площадками (Фаза 1: Авито).
// Без внешних зависимостей: глобальный fetch (Node 24).
// Секреты — только в окружении клиента; в браузер/состояние не передаются.
//   AVITO_CLIENT_ID, AVITO_CLIENT_SECRET, AVITO_USER_ID  — доступ к API Авито.
//   FEED_TOKEN (опц.) — секрет в URL XML-фида, чтобы фид не был публично угадываемым.
// Эндпоинты/поля берутся из официальной документации developers.avito.ru и
// могут переопределяться переменными окружения (на случай изменений API).
// ============================================================

// ---------- гейтинг: заданы ли ключи площадок ----------
export function avitoConfigured(){
  return !!(process.env.AVITO_CLIENT_ID && process.env.AVITO_CLIENT_SECRET && process.env.AVITO_USER_ID);
}
export function cianConfigured(){            // Фаза 2 — задел
  return !!process.env.CIAN_REPORT_KEY;
}
export function feedTokenOk(token){
  const need = process.env.FEED_TOKEN || '';
  if(!need) return true;                     // токен не задан — фид открыт
  return typeof token === 'string' && token === need;
}
// готовые ссылки на фид (для вставки в кабинет площадки). token включаем, если задан.
export function feedUrls(origin){
  const t = process.env.FEED_TOKEN ? ('?token=' + encodeURIComponent(process.env.FEED_TOKEN)) : '';
  return { avito: `${origin}/feed/avito.xml${t}`, cian: `${origin}/feed/cian.xml${t}` };
}

// ---------- Авито OAuth2 (client_credentials) с кэшем токена ----------
const AV_TOKEN_URL = process.env.AVITO_TOKEN_URL || 'https://api.avito.ru/token';
const AV_API_BASE  = (process.env.AVITO_API_BASE || 'https://api.avito.ru').replace(/\/+$/,'');
let _avToken = null, _avExp = 0;
async function avitoToken(signal){
  const now = Date.now();
  if(_avToken && now < _avExp - 60_000) return _avToken;            // запас 1 мин
  const body = 'grant_type=client_credentials'
    + '&client_id='     + encodeURIComponent(process.env.AVITO_CLIENT_ID)
    + '&client_secret=' + encodeURIComponent(process.env.AVITO_CLIENT_SECRET);
  const r = await fetch(AV_TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json' },
    body, signal,
  });
  if(!r.ok){ const t = await r.text().catch(()=>''); throw new Error('Avito OAuth '+r.status+' '+t.slice(0,180)); }
  const j = await r.json();
  _avToken = j.access_token;
  _avExp = now + ((Number(j.expires_in)||3000) * 1000);            // expires_in — секунды
  return _avToken;
}

// ---------- статистика Авито по объявлениям ----------
// itemIds — массив числовых id объявлений на Авито (listing.extId).
// Возвращает Map extId(строка) → { views, contacts } (суммарно за период).
export async function avitoStats(itemIds, dateFrom, dateTo, signal){
  const ids = [...new Set((itemIds||[]).map(x=>parseInt(x,10)).filter(Number.isFinite))];
  const out = new Map();
  if(!ids.length) return out;
  const token = await avitoToken(signal);
  const userId = encodeURIComponent(process.env.AVITO_USER_ID);
  // Авито ограничивает размер запроса — бьём на пачки по 200 id.
  for(let i=0;i<ids.length;i+=200){
    const chunk = ids.slice(i, i+200);
    const r = await fetch(`${AV_API_BASE}/stats/v1/accounts/${userId}/items`, {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify({ dateFrom, dateTo, fields:['views','contacts','uniqViews','uniqContacts'], itemIds: chunk, periodGrouping:'day' }),
      signal,
    });
    if(r.status===401){ _avToken=null; throw new Error('Avito 401 (токен/доступ)'); }
    if(!r.ok){ const t = await r.text().catch(()=>''); throw new Error('Avito stats '+r.status+' '+t.slice(0,180)); }
    const j = await r.json();
    const items = (j && j.result && Array.isArray(j.result.items)) ? j.result.items : [];
    items.forEach(it=>{
      const days = Array.isArray(it.stats) ? it.stats : [];
      let views=0, contacts=0;
      days.forEach(d=>{ views += (+d.views||0); contacts += (+d.contacts||0); });
      out.set(String(it.itemId), { views, contacts });
    });
  }
  return out;
}

// ---------- XML-фид автозагрузки Авито ----------
function xmlEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
// listings — активные объявления; opts.address(bid)→строка адреса, opts.phone — контакт из настроек, opts.origin — база для абсолютных ссылок на фото.
// ВНИМАНИЕ: набор полей у Авито зависит от категории недвижимости. Здесь — базовый каркас
// (Id/Title/Description/Price/Address/Images/ContactPhone). Перед боевой автозагрузкой поля
// нужно дополнить по актуальному шаблону Авито для нужной категории (см. developers.avito.ru).
export function buildAvitoFeedXml(listings, opts={}){
  const addr = opts.address || (()=> '');
  const phone = opts.phone || '';
  const origin = (opts.origin||'').replace(/\/+$/,'');
  const ads = (listings||[]).filter(a=>a && a.status==='active').map(a=>{
    const id = a.extId || a.id;
    const imgs = (Array.isArray(a.documents)?a.documents:[])
      .map(d=>d && d.url).filter(u=>typeof u==='string' && /^https?:\/\//.test(u) || (typeof u==='string' && u.startsWith('/api/files/')))
      .map(u=> u.startsWith('/') ? origin+u : u);
    const imagesTag = imgs.length ? `\n    <Images>${imgs.map(u=>`<Image url="${xmlEsc(u)}"/>`).join('')}</Images>` : '';
    return `  <Ad>
    <Id>${xmlEsc(id)}</Id>
    <Title>${xmlEsc(a.title)}</Title>
    <Description><![CDATA[${String(a.description||a.title||'')}]]></Description>
    <Price>${Math.max(0, Math.round(+a.price||0))}</Price>
    <Address>${xmlEsc(addr(a.building) || a.building || '')}</Address>${a.unit?`\n    <Unit>${xmlEsc(a.unit)}</Unit>`:''}${phone?`\n    <ContactPhone>${xmlEsc(phone)}</ContactPhone>`:''}${imagesTag}
  </Ad>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Ads formatVersion="3" target="Avito.ru">\n${ads}\n</Ads>\n`;
}

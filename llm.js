// ============================================================
// СИТИ SRM — тонкий слой доступа к языковой модели (model-agnostic).
// Единый интерфейс ask(messages, opts) → text. Провайдер выбирается переменной
// окружения LLM_PROVIDER (gigachat по умолчанию; yandexgpt — задел на будущее).
// Без внешних зависимостей: используется глобальный fetch (Node 24).
// TLS: для GigaChat в образ добавляется российский корневой сертификат
// (NODE_EXTRA_CA_CERTS в Dockerfile) — проверку TLS НЕ отключаем.
// ============================================================
import { randomUUID } from 'node:crypto';

const PROVIDER = (process.env.LLM_PROVIDER || 'gigachat').toLowerCase();
const MODEL = process.env.LLM_MODEL || (PROVIDER === 'gigachat' ? 'GigaChat' : 'yandexgpt-lite');

// есть ли ключ модели в окружении (помощник «спит» без ключа)
export function hasModelKey(){
  if(PROVIDER === 'gigachat') return !!process.env.GIGACHAT_AUTH_KEY;
  if(PROVIDER === 'yandexgpt') return !!process.env.YANDEX_API_KEY && !!process.env.YANDEX_FOLDER_ID;
  return false;
}
export function providerName(){ return PROVIDER; }

// ---------- GigaChat ----------
const GC_OAUTH = process.env.GIGACHAT_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GC_CHAT  = process.env.GIGACHAT_API_URL   || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
let _gcToken = null, _gcExp = 0;
async function gigachatToken(){
  const now = Date.now();
  if(_gcToken && now < _gcExp - 60_000) return _gcToken;        // запас 1 мин
  const scope = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
  const r = await fetch(GC_OAUTH, {
    method:'POST',
    headers:{
      'Authorization':'Basic '+process.env.GIGACHAT_AUTH_KEY,
      'RqUID': randomUUID(),
      'Content-Type':'application/x-www-form-urlencoded',
      'Accept':'application/json',
    },
    body: 'scope='+encodeURIComponent(scope),
  });
  if(!r.ok) throw new Error('GigaChat OAuth '+r.status);
  const j = await r.json();
  _gcToken = j.access_token;
  _gcExp = j.expires_at ? Number(j.expires_at) : (now + 25*60*1000);   // expires_at — мс эпохи
  if(_gcExp < 1e12) _gcExp = now + _gcExp*1000;                        // на случай секунд/относительного
  return _gcToken;
}
async function gigachatAsk(messages, opts){
  const token = await gigachatToken();
  const r = await fetch(GC_CHAT, {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens ?? 700 }),
    signal: opts.signal,
  });
  if(r.status === 401){ _gcToken = null; throw new Error('GigaChat 401 (токен/ключ)'); }
  if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('GigaChat '+r.status+' '+t.slice(0,200)); }
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

// ---------- YandexGPT (задел; включается LLM_PROVIDER=yandexgpt) ----------
async function yandexAsk(messages, opts){
  const key = process.env.YANDEX_API_KEY, folder = process.env.YANDEX_FOLDER_ID;
  const modelUri = `gpt://${folder}/${(process.env.LLM_MODEL||'yandexgpt-lite')}/latest`;
  const r = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
    method:'POST',
    headers:{ 'Authorization':'Api-Key '+key, 'Content-Type':'application/json', 'x-folder-id': folder },
    body: JSON.stringify({ modelUri, completionOptions:{ stream:false, temperature: opts.temperature ?? 0.3, maxTokens: String(opts.maxTokens ?? 700) },
      messages: messages.map(m=>({ role: m.role==='system'?'system':(m.role==='assistant'?'assistant':'user'), text: m.content })) }),
    signal: opts.signal,
  });
  if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('YandexGPT '+r.status+' '+t.slice(0,200)); }
  const j = await r.json();
  return (j.result && j.result.alternatives && j.result.alternatives[0] && j.result.alternatives[0].message && j.result.alternatives[0].message.text) || '';
}

// ---------- единый интерфейс ----------
// messages: [{role:'system'|'user'|'assistant', content:'...'}]
export async function ask(messages, opts={}){
  if(PROVIDER === 'yandexgpt') return yandexAsk(messages, opts);
  return gigachatAsk(messages, opts);
}

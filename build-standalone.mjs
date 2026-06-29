// Сборка автономного однофайлового демо (открывается двойным кликом, без сервера).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const P = p => join(__dirname, p);

const indexHtml = await readFile(P('public/index.html'), 'utf8');
let appJs = await readFile(P('public/app.js'), 'utf8');
const mock = await readFile(P('mock-api.js'), 'utf8');

// заменяем серверный fetch-API на встроенный localStorage-мок
const API_BLOCK = `/* ---------- API ---------- */
async function api(path, method='GET', body){
  const res = await fetch(path, {
    method, credentials:'same-origin',
    headers: body? {'Content-Type':'application/json'} : undefined,
    body: body? JSON.stringify(body) : undefined
  });
  let data=null; try{ data = await res.json(); }catch{}
  if(!res.ok) throw new Error((data&&data.error) || \`Ошибка \${res.status}\`);
  return data;
}`;

if(!appJs.includes(API_BLOCK)) { console.error('ОШИБКА: блок API в app.js не найден — проверьте app.js'); process.exit(1); }
appJs = appJs.replace(API_BLOCK, mock.trim());

// включаем режим демо (лимит записей + окно «приобретите полную версию»)
if(!appJs.includes('let IS_DEMO=false;')){ console.error('ОШИБКА: флаг IS_DEMO в app.js не найден'); process.exit(1); }
appJs = appJs.replace('let IS_DEMO=false;', 'let IS_DEMO=true;');

// встраиваем логотип (logo.jpg) как data-URI, чтобы файл был самодостаточным
const logoB64 = (await readFile(P('public/logo.jpg'))).toString('base64');
appJs = appJs.replace("const LOGO_FULL='logo.jpg';", `const LOGO_FULL='data:image/jpeg;base64,${logoB64}';`);

// вклеиваем всё в один HTML
const out = indexHtml.replace('<script src="app.js"></script>', `<script>\n${appJs}\n</script>`);
await writeFile(P('srm-demo.html'), out, 'utf8');
console.log('Готово: srm-demo.html (' + Math.round(out.length/1024) + ' КБ)');

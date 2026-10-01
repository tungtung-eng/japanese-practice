/**
 * 英日雙語學習機 —— 每日三句推播伺服器（Cloudflare Worker）
 * （Worker 名稱沿用最早的 japanese-practice-push，改名的話網址會變）
 *
 * 網頁放在 GitHub Pages，這裡只負責推播：
 *   GET  /key          給網頁 VAPID 公鑰，用來訂閱
 *   POST /subscribe    記下這支手機的訂閱和要收的語言（ja／en，App 切換語言時會再送一次）
 *   POST /unsubscribe  刪除訂閱
 *   POST /test         馬上送一則測試：第一次開啟時送「設定成功」，
 *                      之後按「送一則測試」送現在這個時段的今日一句（跟真的一樣）
 *   POST /tick         到時間就送今日一句（台灣時間 09:00、11:30、20:00）
 *
 * /tick 由工地氣象站的排程（每 10 分鐘）順便呼叫，這裡自己不佔排程名額
 * （Cloudflare 免費方案整個帳號最多 5 個排程，已經用滿）。
 * 同一個時段一天只會送一次，所以別人亂呼叫也不會多送。
 *
 * 金鑰用 Cloudflare secret 儲存（deploy.ps1 會自動產生並上傳）：
 *   VAPID_PUBLIC、VAPID_PRIVATE
 */

import { sendPush } from './push.js';
import { dailyPhrase, taiwanDay } from '../phrases.js';

// 只接受自己的網頁呼叫（本機測試用 localhost）
const ALLOWED_ORIGINS = [/^https:\/\/tungtung-eng\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

// 各時段的送出時間（UTC 的「時, 分」）。台灣時間 = UTC + 8。
const SLOT_AT = {
  morning: [1, 0],    // 09:00
  noon: [3, 30],      // 11:30
  evening: [12, 0],   // 20:00
};
// 呼叫端每 10 分鐘來一次，所以送出時間之後 10 分鐘內都算到了
const WINDOW_MIN = 10;

/** 現在該送哪個時段（沒有就回傳 null） */
function dueSlot(ms) {
  const t = new Date(ms);
  const now = t.getUTCHours() * 60 + t.getUTCMinutes();
  for (const [slot, [h, m]] of Object.entries(SLOT_AT)) {
    const d = now - (h * 60 + m);
    if (d >= 0 && d < WINDOW_MIN) return slot;
  }
  return null;
}

/** 到時間就送；同一天同一個時段只送一次 */
async function tick(env, ms = Date.now()) {
  const slot = dueSlot(ms);
  if (!slot) return { sent: false, reason: '還沒到時間' };
  const key = 'sent:' + taiwanDay(ms) + ':' + slot;
  if (await env.SUBS.get(key)) return { sent: false, reason: '這個時段今天送過了', slot };
  await env.SUBS.put(key, '1', { expirationTtl: 2 * 86400 });
  await broadcast(slot, ms, env);
  return { sent: true, slot };
}

const TITLES = {
  morning: '☀️ 早安！今日第一句',
  noon: '🍱 午餐時間，今日第二句',
  evening: '🌙 晚上好，今日第三句',
};
const LANG_TAG = { ja: '🇯🇵 ', en: '🇺🇸 ' };
const langOk = (l) => (l === 'en' ? 'en' : 'ja');

function cors(request) {
  const origin = request.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.some((re) => re.test(origin))) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (data, status, request) => new Response(JSON.stringify(data), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', ...cors(request) },
});

/** 把長長的端點網址縮成一個固定長度的鍵值（同一支手機重複訂閱不會變兩筆） */
function keyOf(endpoint) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < endpoint.length; i++) {
    h1 = Math.imul(h1 ^ endpoint.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + endpoint.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return 'sub:' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** 只收看起來正常的訂閱資料，避免被塞奇怪的東西 */
function validSub(sub) {
  return sub && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://') && sub.endpoint.length < 1000
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
}

/** 現在（台灣時間）是哪個時段：11:30 前算早、20:00 前算中、之後算晚 */
function slotNow(ms) {
  const t = new Date(ms + 8 * 3600 * 1000);
  const mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  return mins < 11 * 60 + 30 ? 'morning' : mins < 20 * 60 ? 'noon' : 'evening';
}

function message(slot, ms, titlePrefix = '', lang = 'ja') {
  const p = dailyPhrase(slot, taiwanDay(ms), lang);
  let body = p.text + '\n' + (lang === 'ja' ? p.romaji + '\n' : '') + p.zh;
  if (p.tip) body += '\n💡 ' + p.tip;
  if (slot === 'evening') body += '\n睡前也複習一下早上和中午的句子吧！';
  return JSON.stringify({ title: titlePrefix + LANG_TAG[lang] + TITLES[slot], body, tag: 'daily-' + slot, slot, lang });
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

  if (url.pathname === '/key') return json({ key: env.VAPID_PUBLIC || null }, 200, request);
  if (url.pathname === '/') return new Response('英日雙語學習機 推播伺服器運作中', { headers: { 'content-type': 'text/plain; charset=utf-8' } });

  if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405, request);
  if (url.pathname === '/tick') return json(await tick(env), 200, request);
  const body = await request.json().catch(() => null);
  if (!body || !validSub(body.sub)) return json({ error: '缺少訂閱資料' }, 400, request);
  const id = keyOf(body.sub.endpoint);

  if (url.pathname === '/subscribe') {
    const old = await env.SUBS.get(id, 'json');
    await env.SUBS.put(id, JSON.stringify({ sub: body.sub, lang: langOk(body.lang), since: old?.since || Date.now() }));
    return json({ ok: true }, 200, request);
  }
  if (url.pathname === '/unsubscribe') {
    await env.SUBS.delete(id);
    return json({ ok: true }, 200, request);
  }
  if (url.pathname === '/test') {
    // 只替已訂閱的手機送，不讓別人拿這支 API 亂送
    const rec = await env.SUBS.get(id, 'json');
    if (!rec) return json({ error: '還沒訂閱' }, 404, request);
    const payload = body.preview
      // 「送一則測試」：送現在這個時段的今日一句，長得跟每天收到的一樣
      ? message(slotNow(Date.now()), Date.now(), '🧪 測試｜', langOk(body.lang || rec.lang))
      // 第一次開啟通知
      : JSON.stringify({
        title: '🔔 通知設定成功｜英日雙語學習機',
        body: langOk(body.lang) === 'en'
          ? '每天 09:00、11:30、20:00 會各送一句英文。\nLet\'s do our best!（一起加油吧！）'
          : '每天 09:00、11:30、20:00 會各送一句日文。\nがんばりましょう！（一起加油吧！）',
        tag: 'test',
      });
    const r = await sendPush(body.sub, payload, env);
    return json({ ok: r.ok, status: r.status }, 200, request);
  }
  return json({ error: '沒有這個路徑' }, 404, request);
}

async function broadcast(slot, ms, env) {
  const payloads = { ja: message(slot, ms, '', 'ja'), en: message(slot, ms, '', 'en') };
  let sent = 0, removed = 0, failed = 0, cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const rec = await env.SUBS.get(k.name, 'json');
      if (!rec) continue;
      try {
        const r = await sendPush(rec.sub, payloads[langOk(rec.lang)], env);
        if (r.gone) { await env.SUBS.delete(k.name); removed++; } else if (r.ok) sent++; else failed++;
      } catch (e) {
        failed++;
        console.error('推播失敗', e.message);
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  console.log(`每日一句 ${slot}：送出 ${sent}，失敗 ${failed}，清掉已取消的 ${removed}`);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return json({ error: e.message }, 500, request);
    }
  },

  // 萬一以後有排程名額，也可以直接在 wrangler.toml 設 crons（例如每 10 分鐘），效果一樣
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, event.scheduledTime));
  },
};

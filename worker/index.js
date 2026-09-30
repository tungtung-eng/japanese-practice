/**
 * 日語隨身練 —— 每日三句推播伺服器（Cloudflare Worker）
 *
 * 網頁放在 GitHub Pages，這裡只負責推播：
 *   GET  /key          給網頁 VAPID 公鑰，用來訂閱
 *   POST /subscribe    記下這支手機的訂閱
 *   POST /unsubscribe  刪除訂閱
 *   POST /test         馬上送一則測試通知
 *   排程（wrangler.toml 的 crons）每天台灣時間 09:00、11:30、20:00 各送一句
 *
 * 金鑰用 Cloudflare secret 儲存（deploy.ps1 會自動產生並上傳）：
 *   VAPID_PUBLIC、VAPID_PRIVATE
 */

import { sendPush } from './push.js';
import { dailyPhrase, taiwanDay } from '../phrases.js';

// 只接受自己的網頁呼叫（本機測試用 localhost）
const ALLOWED_ORIGINS = [/^https:\/\/tungtung-eng\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

// 排程時間（UTC）→ 時段。台灣時間 = UTC + 8。
const CRON_SLOT = {
  '0 1 * * *': 'morning',   // 09:00
  '30 3 * * *': 'noon',     // 11:30
  '0 12 * * *': 'evening',  // 20:00
};

const TITLES = {
  morning: '☀️ 早安！今日第一句',
  noon: '🍱 午餐時間，今日第二句',
  evening: '🌙 晚上好，今日第三句',
};

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

function message(slot, ms) {
  const p = dailyPhrase(slot, taiwanDay(ms));
  let body = p.text + '\n' + p.romaji + '\n' + p.zh;
  if (slot === 'evening') body += '\n睡前也複習一下早上和中午的句子吧！';
  return JSON.stringify({ title: TITLES[slot], body, tag: 'daily-' + slot, slot });
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

  if (url.pathname === '/key') return json({ key: env.VAPID_PUBLIC || null }, 200, request);
  if (url.pathname === '/') return new Response('日語隨身練 推播伺服器運作中', { headers: { 'content-type': 'text/plain; charset=utf-8' } });

  if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405, request);
  const body = await request.json().catch(() => null);
  if (!body || !validSub(body.sub)) return json({ error: '缺少訂閱資料' }, 400, request);
  const id = keyOf(body.sub.endpoint);

  if (url.pathname === '/subscribe') {
    await env.SUBS.put(id, JSON.stringify({ sub: body.sub, since: Date.now() }));
    return json({ ok: true }, 200, request);
  }
  if (url.pathname === '/unsubscribe') {
    await env.SUBS.delete(id);
    return json({ ok: true }, 200, request);
  }
  if (url.pathname === '/test') {
    // 只替已訂閱的手機送，不讓別人拿這支 API 亂送
    if (!(await env.SUBS.get(id))) return json({ error: '還沒訂閱' }, 404, request);
    const r = await sendPush(body.sub, JSON.stringify({
      title: '🔔 通知設定成功｜日語隨身練',
      body: '每天 09:00、11:30、20:00 會各送一句日文。\nがんばりましょう！（一起加油吧！）',
      tag: 'test',
    }), env);
    return json({ ok: r.ok, status: r.status }, 200, request);
  }
  return json({ error: '沒有這個路徑' }, 404, request);
}

async function broadcast(slot, ms, env) {
  const payload = message(slot, ms);
  let sent = 0, removed = 0, failed = 0, cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const rec = await env.SUBS.get(k.name, 'json');
      if (!rec) continue;
      try {
        const r = await sendPush(rec.sub, payload, env);
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

  async scheduled(event, env, ctx) {
    const slot = CRON_SLOT[event.cron];
    if (!slot) { console.error('不認得的排程：' + event.cron); return; }
    ctx.waitUntil(broadcast(slot, event.scheduledTime, env));
  },
};

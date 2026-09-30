import { SCENES, PHRASE_BY_ID, SLOTS, taiwanDay, dailyThree } from './phrases.js';
import { KANA_GROUPS, KANA } from './kana.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Storage (never let storage errors break the app) ----------
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// 推播伺服器（Cloudflare Worker）。測試時可在 localStorage 放 pushApi 換掉。
const PUSH_API = load('pushApi', null) || 'https://japanese-practice-push.qianzhen-site.workers.dev';

const settings = Object.assign({
  scene: 'greet', autoSpeak: true, slow: false, big: false, furi: true, romaji: true,
  kanaScript: 'hira', kanaDir: 'k2r', kanaGroups: ['basic'],
}, load('settings', {}));
const saveSettings = () => save('settings', settings);

let favs = load('favs', []);            // 收藏的句子 id
let custom = load('custom', {});        // 「我說中文」查到後收藏的句子
let srs = load('srs', {});              // 複習排程 { id: { lvl, due } }，due 是台灣日期的天數編號
let practiced = load('practiced', { day: 0, ids: [] }); // 今天練過哪些句子
let kanaMiss = load('kanaMiss', {});    // 五十音每個字錯了幾次（答對會慢慢減少）
let kanaToday = load('kanaToday', { day: 0, right: 0, total: 0 });

const today = () => taiwanDay();
const getPhrase = (id) => PHRASE_BY_ID[id] || custom[id] || lookupCache[id] || null;
const sceneOf = (id) => SCENES.find((s) => s.id === id);

function markPracticed(id) {
  if (practiced.day !== today()) practiced = { day: today(), ids: [] };
  if (!practiced.ids.includes(id)) practiced.ids.push(id);
  save('practiced', practiced);
}
const wasPracticed = (id) => practiced.day === today() && practiced.ids.includes(id);

// ---------- Review schedule (spaced repetition) ----------
const INTERVALS = [1, 2, 4, 7, 15, 30, 60];

function addToReview(id, due = today() + 1) {
  if (srs[id]) return;
  srs[id] = { lvl: 0, due };
  save('srs', srs);
  updateReviewBadge();
}
function dueIds() {
  const d = today();
  return Object.entries(srs)
    .filter(([id, s]) => s.due <= d && getPhrase(id))
    .sort((a, b) => a[1].due - b[1].due)
    .map(([id]) => id);
}
function gradeReview(id, remembered) {
  const s = srs[id] || { lvl: 0, due: today() };
  if (remembered) {
    s.due = today() + INTERVALS[Math.min(s.lvl, INTERVALS.length - 1)];
    s.lvl += 1;
  } else {
    s.lvl = 0;
    s.due = today() + 1;
  }
  srs[id] = s;
  save('srs', srs);
  updateReviewBadge();
}
function updateReviewBadge() {
  const n = dueIds().length;
  $('reviewBtn').innerHTML = '📅 今日複習' + (n ? '<span class="badge">' + n + '</span>' : '');
}

// ---------- Text to speech ----------
let voices = [];
function refreshVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}
function pickVoice(lang) {
  const norm = (l) => l.replace('_', '-').toLowerCase();
  const want = lang.toLowerCase();
  const prefix = want.split('-')[0];
  return voices.find((x) => norm(x.lang) === want) || voices.find((x) => norm(x.lang).startsWith(prefix)) || null;
}

// Resolves when speaking finishes, so auto mode doesn't listen to its own voice.
function speak(text, lang = 'ja-JP', slow = settings.slow) {
  if (!window.speechSynthesis || !text) return Promise.resolve();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.rate = slow ? 0.6 : 0.9;
  return new Promise((resolve) => {
    // Some browsers never fire onend; don't wait forever.
    const safety = setTimeout(resolve, 3000 + text.length * 350);
    u.onend = u.onerror = () => { clearTimeout(safety); resolve(); };
    speechSynthesis.speak(u);
  });
}
// 用假名唸比較準（例如「一日」不會被唸成「ついたち」）；查詢來的句子沒有假名就唸原文。
const sayPhrase = (p, slow) => speak(p.kana || p.text, 'ja-JP', slow);

// iOS only allows speech that started from a tap; speaking once inside a tap unlocks it.
let ttsUnlocked = false;
function unlockTts() {
  if (ttsUnlocked || !window.speechSynthesis) return;
  ttsUnlocked = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

// ---------- Phrase cards ----------
function rubyHTML(jp) {
  return esc(jp).replace(/\[([^|\]]+)\|([^\]]+)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
}

let currentId = null;

function makeCard(p, { tag = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (p.id === currentId ? ' current' : '');
  el.dataset.id = p.id;
  const scene = sceneOf(p.scene);
  el.innerHTML = (tag && scene ? '<div class="tag">' + scene.icon + ' ' + esc(scene.name) + '</div>' : '')
    + '<div class="jp" lang="ja">' + rubyHTML(p.jp) + '</div>'
    + (p.romaji ? '<div class="romaji">' + esc(p.romaji) + '</div>' : '')
    + '<div class="zh">' + esc(p.zh) + '</div>'
    + '<div class="acts"></div><div class="result" hidden></div>';
  const acts = el.querySelector('.acts');
  const btn = (text, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = text;
    if (cls) b.className = cls;
    b.onclick = (e) => { e.stopPropagation(); unlockTts(); fn(b); };
    acts.appendChild(b);
    return b;
  };
  btn('🔊 聽', '', () => { select(p.id, false); sayPhrase(p, false); });
  btn('🐢 慢速', '', () => { select(p.id, false); sayPhrase(p, true); });
  btn('🎤 跟著念', 'say', () => { select(p.id, false); practice(p); });
  const star = btn('', 'star', () => toggleFav(p));
  paintStar(star, p.id);
  el.onclick = () => { unlockTts(); select(p.id, settings.autoSpeak); };
  return el;
}

function paintStar(b, id) {
  const on = favs.includes(id);
  b.classList.toggle('on', on);
  b.textContent = on ? '⭐ 已收藏' : '☆ 收藏';
}

function cardsFor(id) { return document.querySelectorAll('.card[data-id="' + CSS.escape(id) + '"]'); }

function select(id, speakIt) {
  currentId = id;
  for (const c of document.querySelectorAll('.card')) c.classList.toggle('current', c.dataset.id === id);
  const p = getPhrase(id);
  if (p && speakIt) sayPhrase(p);
}

function toggleFav(p) {
  if (favs.includes(p.id)) {
    favs = favs.filter((x) => x !== p.id);
  } else {
    favs.push(p.id);
    if (!PHRASE_BY_ID[p.id]) { custom[p.id] = p; save('custom', custom); }
    addToReview(p.id);
  }
  save('favs', favs);
  for (const c of cardsFor(p.id)) paintStar(c.querySelector('.star'), p.id);
  if (view === 'favs') renderList();
}

// ---------- Pronunciation check ----------
// 語音辨識回來的可能是漢字也可能是假名，所以同時跟「原文」和「全假名」比，取比較像的那個。
const NUM = '〇一二三四五六七八九';
const normChar = (c) => {
  c = c.normalize('NFKC');
  if (/[0-9]/.test(c)) return NUM[+c];
  if (/[ァ-ヶ]/.test(c)) return String.fromCharCode(c.charCodeAt(0) - 0x60); // カタカナ → ひらがな
  if (/[\s、。，,.．！!？?「」『』（）()・…~〜ー\-]/.test(c)) return '';
  return c.toLowerCase();
};
const normStr = (s) => [...s].map(normChar).join('');

/** 最長共同子序列：回傳 target 裡哪些位置有對上 */
function lcsMatch(heard, target) {
  const n = heard.length, m = target.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = heard[i - 1] === target[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const hit = new Array(m).fill(false);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (heard[i - 1] === target[j - 1]) { hit[j - 1] = true; i--; j--; } else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  return hit;
}

function compare(heard, form) {
  const chars = [...form];
  const norm = chars.map(normChar);
  const idx = []; // 有意義的字（去掉標點）在原字串裡的位置
  norm.forEach((c, i) => { if (c) idx.push(i); });
  const target = idx.map((i) => norm[i]);
  const hitT = lcsMatch([...normStr(heard)], target);
  const hits = new Array(chars.length).fill(null);
  idx.forEach((i, k) => { hits[i] = hitT[k]; });
  const score = target.length ? hitT.filter(Boolean).length / target.length : 0;
  return { chars, hits, score };
}

function grade(p, heard) {
  const forms = [p.text];
  if (p.kana && p.kana !== p.text) forms.push(p.kana);
  return forms.map((f) => compare(heard, f)).sort((a, b) => b.score - a.score)[0];
}

function showResult(p, html) {
  for (const c of cardsFor(p.id)) {
    const r = c.querySelector('.result');
    r.hidden = !html;
    r.innerHTML = html || '';
    for (const b of r.querySelectorAll('[data-act]')) {
      b.onclick = (e) => {
        e.stopPropagation();
        unlockTts();
        const act = b.dataset.act;
        if (act === 'listen') sayPhrase(p);
        else if (act === 'slow') sayPhrase(p, true);
        else if (act === 'again') practice(p);
        else if (act === 'good') { markPracticed(p.id); showResult(p, '<div class="verdict">😀 很好！</div>'); updateTodayTabs(); }
        else if (act === 'bad') { addToReview(p.id); showResult(p, '<div class="verdict">😅 已加入複習，明天再練一次</div>'); }
      };
    }
  }
  const first = cardsFor(p.id)[0];
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 幾分算過關：自動跟讀要念到這個分數才會換下一句
const PASS = 0.8;

function resultHTML(p, heard, { buttons = true } = {}) {
  const g = grade(p, heard);
  const marks = g.chars.map((c, i) => (g.hits[i] == null ? esc(c) : '<span class="' + (g.hits[i] ? 'hit' : 'miss') + '">' + esc(c) + '</span>')).join('');
  let verdict;
  if (g.score >= 0.9) verdict = '🎉 很標準！';
  else if (g.score >= PASS) verdict = '👍 過關！紅色的字可以再練一下';
  else if (g.score >= 0.5) verdict = '💪 有幾個地方不一樣，再試一次';
  else verdict = '🤔 聽不太出來，靠近手機、慢慢念一次';
  return {
    score: g.score,
    html: '<div class="verdict">' + verdict + '（' + Math.round(g.score * 100) + ' 分）</div>'
      + '<div class="marks" lang="ja">' + marks + '</div>'
      + '<div class="heard">你念的：<span lang="ja">' + esc(heard) + '</span></div>'
      + (buttons ? '<div class="self"><button data-act="listen">🔊 再聽</button><button data-act="slow">🐢 慢速</button><button data-act="again">🎤 再念一次</button></div>' : ''),
  };
}

// 語音辨識不能用或失敗時：聽標準發音，自己評分
function selfCheckHTML(msg) {
  return '<div class="verdict">' + esc(msg) + '</div>'
    + '<div class="heard">聽完標準發音、自己念一次，覺得怎麼樣？</div>'
    + '<div class="self"><button data-act="listen">🔊 再聽一次</button><button data-act="good">😀 念對了</button><button data-act="bad">😅 還要練</button></div>';
}

async function practice(p) {
  if (autoMode) return;
  unlockTts();
  if (!SR) { showResult(p, selfCheckHTML('這個瀏覽器不能比對發音')); await sayPhrase(p); return; }
  if (rec) { rec.stop(); return; }
  try {
    const heard = await recognize('ja-JP', 'ja');
    if (!heard) { showResult(p, selfCheckHTML('沒有聽到聲音')); return; }
    const r = resultHTML(p, heard);
    if (r.score >= PASS) {
      showResult(p, r.html);
      markPracticed(p.id);
      updateTodayTabs();
    } else {
      // 沒過：自動放慢速度示範一次，再讓你念
      showResult(p, r.html + '<div class="retry">🐢 放慢速度示範一次，聽完按「🎤 再念一次」</div>');
      addToReview(p.id);
      await sayPhrase(p, true);
    }
  } catch (e) {
    showResult(p, selfCheckHTML(e.message));
  }
}

// ---------- Speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

const REC_ERRORS = {
  'not-allowed': '請允許使用麥克風（iPhone：設定 → Safari → 麥克風）',
  'service-not-allowed': '請允許使用麥克風與語音辨識（iPhone 需開啟「設定 → Siri」的聽寫）',
  'network': '語音辨識需要網路，請確認網路',
  'audio-capture': '找不到麥克風',
};

/** 聽一段話，停頓就結束。回傳聽到的文字（沒聽到回傳空字串）。 */
function recognize(lang, who) {
  return new Promise((resolve, reject) => {
    if (window.speechSynthesis) speechSynthesis.cancel();
    const r = new SR();
    rec = r;
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = '';
    let interim = '';
    let error = null;
    r.onresult = (e) => {
      interim = '';
      finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      showLive('🎤 ' + (finalText + interim));
    };
    r.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') error = REC_ERRORS[e.error] || ('語音辨識失敗（' + e.error + '）'); };
    r.onend = () => {
      if (rec === r) rec = null;
      setListening(null);
      showLive('');
      if (error) reject(new Error(error));
      else resolve((finalText || interim).trim());
    };
    setListening(who);
    showLive(who === 'me' ? '🎤 請說中文…說完停一下' : '🎤 請念日文…念完停一下');
    try {
      r.start();
    } catch (e) {
      rec = null;
      setListening(null);
      showLive('');
      reject(new Error('無法開始錄音，請再按一次'));
    }
  });
}

function setListening(who) {
  $('micMe').classList.toggle('listening', who === 'me');
  $('micJa').classList.toggle('listening', who === 'ja');
  $('micMe').disabled = who === 'ja';
  $('micJa').disabled = who === 'me';
  $('micMe').querySelector('.mic-sub').textContent = who === 'me' ? '正在聽…說完再按一下' : '查日文說法';
  $('jaSub').textContent = autoMode ? '念不過可以先跳過' : who === 'ja' ? '正在聽…念完停一下' : '比對發音';
}

function showLive(text) {
  const live = $('live');
  live.hidden = !text;
  live.textContent = text || '';
}

let toastTimer;
function toast(msg) {
  showLive('⚠️ ' + msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (!rec) showLive(''); }, 4000);
}

// ---------- Auto follow-along: listen, say it, pass before moving on ----------
// 念到 PASS 分才換下一句；沒過就同一句再來，第二次起放慢速度示範。
// 真的卡住可以按「跟著念日文」大按鈕跳過這句。
let autoMode = false;
let autoSkip = false;

async function runAuto() {
  const ids = listIds();
  if (!ids.length) { setAuto(false); return; }
  let i = Math.max(0, ids.indexOf(currentId));
  let attempt = 0; // 這一句念了幾次沒過
  let silent = 0;  // 連續幾次沒聽到聲音
  const next = () => { i = (i + 1) % ids.length; attempt = 0; silent = 0; autoSkip = false; };
  while (autoMode) {
    const p = getPhrase(ids[i]);
    select(p.id, false);
    cardsFor(p.id)[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sayPhrase(p, attempt > 0 || settings.slow);
    if (!autoMode) break;
    if (autoSkip) { showResult(p, '<div class="verdict">⏭ 跳過，已加入複習</div>'); addToReview(p.id); next(); continue; }
    await sleep(300);
    let heard = '';
    try { heard = await recognize('ja-JP', 'ja'); } catch (e) { toast(e.message); setAuto(false); break; }
    if (!autoMode) break;
    if (autoSkip) { showResult(p, '<div class="verdict">⏭ 跳過，已加入複習</div>'); addToReview(p.id); next(); await sleep(800); continue; }

    if (!heard) {
      silent++;
      if (silent >= 3) { toast('連續 3 次沒聽到聲音，自動跟讀先停下來'); setAuto(false); break; }
      showResult(p, '<div class="verdict">😶 沒聽到，再念一次</div>');
      await sleep(1200);
      continue;
    }
    silent = 0;
    const r = resultHTML(p, heard, { buttons: false });
    if (r.score >= PASS) {
      showResult(p, r.html + '<div class="retry pass">✅ 過關！換下一句</div>');
      markPracticed(p.id);
      updateTodayTabs();
      await sleep(1800);
      next();
    } else {
      attempt++;
      if (attempt === 2) addToReview(p.id);
      showResult(p, r.html + '<div class="retry">🔁 第 ' + (attempt + 1) + ' 次：放慢速度再聽一次，跟著念'
        + (attempt >= 3 ? '<br>念不過的話，按下方「⏭ 跳過這句」' : '') + '</div>');
      await sleep(2500);
    }
  }
}

function setAuto(on) {
  autoMode = on;
  autoSkip = false;
  const btn = $('autoBtn');
  btn.classList.toggle('on', on);
  btn.textContent = on ? '⏹️ 自動跟讀中（按這裡停止）' : '🔁 自動跟讀（念對才換下一句）';
  $('micJa').querySelector('.mic-main').textContent = on ? '⏭ 跳過這句' : '跟著念日文';
  $('jaSub').textContent = on ? '念不過可以先跳過' : '比對發音';
  if (on) {
    unlockTts();
    runAuto();
  } else {
    if (rec) rec.abort();
    if (window.speechSynthesis) speechSynthesis.cancel();
  }
}

function skipAuto() {
  autoSkip = true;
  if (rec) rec.abort();
  if (window.speechSynthesis) speechSynthesis.cancel();
}

// ---------- "I say it in Chinese" → how to say it in Japanese ----------
// 1st choice: Google Translate's free public endpoint (also gives romaji). Fallback: MyMemory free API.
async function googleTranslate(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dt=rm&sl=zh-TW&tl=ja&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error('google ' + res.status);
  const data = await res.json();
  const segs = data[0] || [];
  const ja = segs.filter((s) => s[0] != null).map((s) => s[0]).join('');
  const rm = segs.find((s) => s[0] == null && s[2]);
  if (!ja) throw new Error('google empty');
  return { ja, romaji: rm ? rm[2] : '' };
}
async function myMemoryTranslate(text) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=zh-TW|ja';
  const res = await fetch(url);
  if (!res.ok) throw new Error('mymemory ' + res.status);
  const data = await res.json();
  if (String(data.responseStatus) !== '200') throw new Error(data.responseDetails || 'mymemory');
  return { ja: data.responseData.translatedText, romaji: '' };
}
async function toJapanese(text) {
  try { return await googleTranslate(text); } catch { return myMemoryTranslate(text); }
}

// 句庫裡意思相近的句子（中文字的兩兩組合重疊越多越像）
function bigrams(s) {
  const t = s.replace(/（[^）]*）/g, '').replace(/[\s，。？！、,.?!／/]/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}
function similar(text, max = 2) {
  const a = bigrams(text);
  if (!a.size) return [];
  return Object.values(PHRASE_BY_ID)
    .map((p) => {
      const b = bigrams(p.zh);
      let same = 0;
      for (const x of a) if (b.has(x)) same++;
      return { p, score: (2 * same) / (a.size + b.size) };
    })
    .filter((x) => x.score >= 0.4)
    .sort((x, y) => y.score - x.score)
    .slice(0, max)
    .map((x) => x.p);
}

const lookupCache = {};
function customId(ja) {
  let h = 0;
  for (const c of ja) h = (Math.imul(h, 31) + c.codePointAt(0)) >>> 0;
  return 'c-' + h.toString(36);
}

async function lookupZh(text) {
  text = text.trim();
  if (!text) return;
  const box = document.createElement('div');
  box.className = 'box';
  box.innerHTML = '<button class="close" aria-label="關閉">✕</button><div class="who">我說的中文</div><div class="q"></div><div class="body">查詢中…</div>';
  box.querySelector('.q').textContent = text;
  box.querySelector('.close').onclick = () => box.remove();
  const wrap = $('lookup');
  wrap.prepend(box);
  while (wrap.children.length > 3) wrap.lastChild.remove();
  $('talk').scrollTo({ top: 0, behavior: 'smooth' });

  const body = box.querySelector('.body');
  try {
    const { ja, romaji } = await toJapanese(text);
    const id = customId(ja);
    const p = custom[id] || { id, scene: 'custom', jp: ja.replace(/[[\]|]/g, ''), text: ja, kana: '', romaji, zh: text };
    lookupCache[id] = p;
    body.innerHTML = '';
    let alike = similar(text);
    // 句庫裡剛好有一模一樣的日文：直接用句庫的（有假名注音）
    const same = alike.find((q) => normStr(q.text) === normStr(ja));
    const main = same || p;
    alike = alike.filter((q) => q !== same);
    body.appendChild(makeCard(main, { tag: !!same }));
    if (alike.length) {
      const h = document.createElement('div');
      h.className = 'who';
      h.style.marginTop = '8px';
      h.textContent = '📚 句庫裡相近的句子（有假名和拼音）';
      body.appendChild(h);
      for (const q of alike) body.appendChild(makeCard(q, { tag: true }));
    }
    select(main.id, true);
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div class="err">查詢失敗，請確認有網路後再試一次</div>';
  }
}

async function sayChinese() {
  unlockTts();
  if (autoMode) setAuto(false);
  if (!SR) { $('noSpeech').hidden = false; $('typeRow').hidden = false; return; }
  if (rec) { rec.stop(); return; }
  try {
    const text = await recognize('zh-TW', 'me');
    if (text) lookupZh(text);
    else toast('沒有聽到聲音，請靠近手機再說一次');
  } catch (e) {
    toast(e.message);
  }
}

// ---------- Today's three ----------
function slotNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 台灣時間
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins < 11 * 60 + 30) return 'morning';
  if (mins < 20 * 60) return 'noon';
  return 'evening';
}
let todaySlot = slotNow();

function renderToday() {
  const three = dailyThree();
  const el = $('today');
  el.innerHTML = '<div class="today-head"><b>今日三句</b><div class="today-tabs"></div></div>';
  const tabs = el.querySelector('.today-tabs');
  for (const { slot, phrase } of three) {
    const s = SLOTS[slot];
    const b = document.createElement('button');
    b.className = slot === todaySlot ? 'active' : '';
    b.dataset.slot = slot;
    b.dataset.id = phrase.id;
    b.title = s.time;
    b.onclick = () => { unlockTts(); todaySlot = slot; renderToday(); select(phrase.id, settings.autoSpeak); };
    tabs.appendChild(b);
  }
  updateTodayTabs();
  const cur = three.find((x) => x.slot === todaySlot).phrase;
  addToReview(cur.id); // 當天看過的句子，明天自動出現在複習
  el.appendChild(makeCard(cur, { tag: true }));
  if (todaySlot === 'evening') {
    const more = document.createElement('div');
    more.className = 'today-more';
    more.textContent = '睡前複習今天的另外兩句：';
    for (const { slot, phrase } of three.filter((x) => x.slot !== 'evening')) {
      const b = document.createElement('button');
      b.lang = 'ja';
      b.textContent = SLOTS[slot].icon + ' ' + phrase.text;
      b.onclick = () => { todaySlot = slot; renderToday(); select(phrase.id, true); };
      more.appendChild(b);
    }
    el.appendChild(more);
  }
}

/** 只更新「練過了」的勾勾，不重畫卡片（重畫會把剛出來的分數洗掉） */
function updateTodayTabs() {
  for (const b of document.querySelectorAll('.today-tabs button')) {
    const s = SLOTS[b.dataset.slot];
    b.textContent = (wasPracticed(b.dataset.id) ? '✅' : s.icon) + ' ' + s.name;
  }
}

function showToday(slot) {
  if (SLOTS[slot]) todaySlot = slot;
  switchTab('talk');
  renderToday();
  $('talk').scrollTo({ top: 0, behavior: 'smooth' });
  const p = dailyThree().find((x) => x.slot === todaySlot).phrase;
  select(p.id, false);
}

// ---------- Scene / favourites / review list ----------
let view = 'scene'; // scene | favs | review

function renderScenes() {
  const grid = $('sceneGrid');
  grid.innerHTML = '';
  for (const s of SCENES) {
    const b = document.createElement('button');
    b.className = 'scene-btn' + (view === 'scene' && s.id === settings.scene ? ' active' : '');
    b.innerHTML = '<span class="ico">' + s.icon + '</span><span>' + esc(s.name) + '</span>';
    b.onclick = () => {
      settings.scene = s.id;
      saveSettings();
      setView('scene');
      $('listHead').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    grid.appendChild(b);
  }
}

function setView(v) {
  view = v;
  $('favBtn').classList.toggle('active', v === 'favs');
  $('reviewBtn').classList.toggle('active', v === 'review');
  renderScenes();
  renderList();
}

function listIds() {
  if (view === 'favs') return favs.filter(getPhrase);
  if (view === 'review') return reviewQueue.slice(reviewPos, reviewPos + 1);
  return sceneOf(settings.scene).phrases.map((_, i) => settings.scene + '-' + (i + 1));
}

function listHead(title, sub, back) {
  const h = $('listHead');
  h.innerHTML = '<span>' + title + ' <span class="sub">' + (sub || '') + '</span></span>';
  if (back) {
    const b = document.createElement('button');
    b.textContent = '← 回到場景';
    b.onclick = () => setView('scene');
    h.appendChild(b);
  }
}

let reviewQueue = [];
let reviewPos = 0;

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  if (view === 'scene') {
    const s = sceneOf(settings.scene);
    listHead(s.icon + ' ' + esc(s.name), s.phrases.length + ' 句・點句子就會唸');
    for (const id of listIds()) list.appendChild(makeCard(getPhrase(id)));
  } else if (view === 'favs') {
    const ids = listIds();
    listHead('⭐ 收藏', ids.length + ' 句', true);
    if (!ids.length) list.innerHTML = '<div class="empty">還沒有收藏的句子。<br>在句子下面按「☆ 收藏」就會出現在這裡，也會排進複習。</div>';
    for (const id of ids) list.appendChild(makeCard(getPhrase(id), { tag: true }));
  } else {
    renderReview();
  }
}

function startReview() {
  reviewQueue = dueIds();
  reviewPos = 0;
  setView('review');
}

function renderReview() {
  const list = $('list');
  list.innerHTML = '';
  const left = reviewQueue.length - reviewPos;
  listHead('📅 今日複習', left > 0 ? '還有 ' + left + ' 句' : '', true);
  const card = document.createElement('div');
  card.className = 'flash';
  if (left <= 0) {
    const next = Object.values(srs).filter((s) => s.due > today()).length;
    card.innerHTML = '<div class="ask">🎉 今天的複習都完成了！</div>'
      + '<div class="count">' + (next ? '之後還排了 ' + next + ' 句，時間到會再出現' : '收藏句子或練習今日三句，就會排進複習') + '</div>';
    list.appendChild(card);
    return;
  }
  const p = getPhrase(reviewQueue[reviewPos]);
  card.innerHTML = '<div class="count">第 ' + (reviewPos + 1) + ' / ' + reviewQueue.length + ' 句</div>'
    + '<div class="ask"></div><div class="answer" hidden></div>'
    + '<button class="reveal">👀 想好了，看答案</button>'
    + '<div class="grade" hidden><button class="no">😅 忘了</button><button class="yes">😀 記得</button></div>';
  card.querySelector('.ask').textContent = '「' + p.zh + '」日文怎麼說？';
  card.querySelector('.reveal').onclick = () => {
    unlockTts();
    card.querySelector('.reveal').hidden = true;
    const ans = card.querySelector('.answer');
    ans.hidden = false;
    ans.appendChild(makeCard(p));
    card.querySelector('.grade').hidden = false;
    select(p.id, true);
  };
  const next = (ok) => { gradeReview(p.id, ok); reviewPos++; renderReview(); };
  card.querySelector('.no').onclick = () => next(false);
  card.querySelector('.yes').onclick = () => next(true);
  list.appendChild(card);
}

// ---------- Kana quiz ----------
let quizLast = null;

function kanaPool() {
  const groups = settings.kanaGroups.length ? settings.kanaGroups : ['basic'];
  return KANA.filter((k) => groups.includes(k.group));
}
const kanaChar = (k, script) => (script === 'kata' ? k.kata : k.hira);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function pickWeighted(items, weight) {
  const total = items.reduce((n, x) => n + weight(x), 0);
  let r = Math.random() * total;
  for (const x of items) { r -= weight(x); if (r <= 0) return x; }
  return items[items.length - 1];
}

function nextQuiz() {
  const pool = kanaPool();
  const script = settings.kanaScript === 'mix' ? (Math.random() < 0.5 ? 'hira' : 'kata') : settings.kanaScript;
  const cands = pool.filter((k) => kanaChar(k, script) !== quizLast);
  // 常錯的字比較常出現
  const k = pickWeighted(cands, (x) => 1 + 4 * (kanaMiss[kanaChar(x, script)] || 0));
  const ch = kanaChar(k, script);
  quizLast = ch;
  const others = shuffle(KANA.filter((x) => x.romaji !== k.romaji && (pool.includes(x) || x.group === k.group)));
  const picks = [];
  for (const x of others) {
    if (picks.length === 3) break;
    if (!picks.some((y) => y.romaji === x.romaji)) picks.push(x);
  }
  const options = shuffle([k, ...picks]);
  const dir = settings.kanaDir;

  const q = $('quiz');
  q.innerHTML = '<div class="q' + (dir === 'r2k' ? ' roma' : '') + '"' + (dir === 'k2r' ? ' lang="ja"' : '') + '></div>'
    + '<div class="hint">' + (dir === 'k2r' ? '這個字怎麼念？' : '哪一個是這個音？') + '</div><div class="choices"></div>';
  q.querySelector('.q').textContent = dir === 'k2r' ? ch : k.romaji;
  const box = q.querySelector('.choices');
  let done = false;
  for (const o of options) {
    const b = document.createElement('button');
    b.textContent = dir === 'k2r' ? o.romaji : kanaChar(o, script);
    if (dir === 'r2k') b.lang = 'ja';
    b.onclick = () => {
      if (done) return;
      done = true;
      unlockTts();
      const right = o.romaji === k.romaji;
      if (kanaToday.day !== today()) kanaToday = { day: today(), right: 0, total: 0 };
      kanaToday.total++;
      if (right) {
        kanaToday.right++;
        kanaMiss[ch] = Math.max(0, (kanaMiss[ch] || 0) - 1);
        if (!kanaMiss[ch]) delete kanaMiss[ch];
        b.classList.add('right');
      } else {
        kanaMiss[ch] = Math.min(5, (kanaMiss[ch] || 0) + 1);
        b.classList.add('wrong');
        for (const x of box.children) if (x.textContent === (dir === 'k2r' ? k.romaji : ch)) x.classList.add('right');
        q.querySelector('.hint').textContent = '正確是：' + ch + '（' + k.romaji + '）';
      }
      save('kanaMiss', kanaMiss);
      save('kanaToday', kanaToday);
      renderKanaStats();
      speak(ch);
      setTimeout(nextQuiz, right ? 1000 : 2200);
    };
    box.appendChild(b);
  }
}

function renderKanaStats() {
  const el = $('kanaStats');
  const t = kanaToday.day === today() ? kanaToday : { right: 0, total: 0 };
  const weak = Object.entries(kanaMiss).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
  el.innerHTML = '今天答對 <b>' + t.right + '</b> / ' + t.total + ' 題'
    + (weak.length ? '<div>常錯的字（點一下聽發音，答對會慢慢消失）：</div><div class="weak"></div>' : '<div>還沒有常錯的字 👍</div>');
  const w = el.querySelector('.weak');
  if (w) {
    for (const [ch] of weak) {
      const k = KANA.find((x) => x.hira === ch || x.kata === ch);
      const b = document.createElement('button');
      b.lang = 'ja';
      b.textContent = ch + (k ? ' ' + k.romaji : '');
      b.onclick = () => { unlockTts(); speak(ch); };
      w.appendChild(b);
    }
  }
  if (!$('chart').hidden) renderChart();
}

function renderChart() {
  const el = $('chart');
  el.innerHTML = '';
  const script = settings.kanaScript;
  for (const g of KANA_GROUPS) {
    const h = document.createElement('h4');
    h.textContent = g.name;
    el.appendChild(h);
    const table = document.createElement('table');
    for (const row of g.rows) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        if (!cell) { td.className = 'none'; tr.appendChild(td); continue; }
        const [hira, kata, romaji] = cell;
        const shown = script === 'kata' ? kata : script === 'mix' ? hira + kata : hira;
        if ((kanaMiss[hira] || 0) + (kanaMiss[kata] || 0) > 0) td.className = 'weak';
        td.innerHTML = '<span class="k" lang="ja">' + shown + '</span><span class="r">' + romaji + '</span>';
        td.onclick = () => { unlockTts(); speak(hira); };
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    el.appendChild(table);
  }
}

function initKana() {
  const seg = (id, key, multi) => {
    const box = $(id);
    const paint = () => {
      for (const b of box.children) {
        b.classList.toggle('on', multi ? settings[key].includes(b.dataset.v) : settings[key] === b.dataset.v);
      }
    };
    for (const b of box.children) {
      b.onclick = () => {
        if (multi) {
          const set = new Set(settings[key]);
          if (set.has(b.dataset.v)) { if (set.size > 1) set.delete(b.dataset.v); } else set.add(b.dataset.v);
          settings[key] = [...set];
        } else {
          settings[key] = b.dataset.v;
        }
        saveSettings();
        paint();
        quizLast = null;
        nextQuiz();
        if (!$('chart').hidden) renderChart();
      };
    }
    paint();
  };
  seg('kanaScript', 'kanaScript');
  seg('kanaDir', 'kanaDir');
  seg('kanaGroups', 'kanaGroups', true);
  $('chartBtn').onclick = () => {
    $('chart').hidden = !$('chart').hidden;
    if (!$('chart').hidden) renderChart();
  };
  nextQuiz();
  renderKanaStats();
}

// ---------- Tabs ----------
function switchTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  $('talk').hidden = name !== 'talk';
  $('kana').hidden = name !== 'kana';
  $('talkBar').hidden = name !== 'talk';
  if (name !== 'talk' && autoMode) setAuto(false);
}

// ---------- Daily push ----------
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function b64ToU8(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function pushPost(path, body) {
  const r = await fetch(PUSH_API + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('伺服器回應 ' + r.status);
  return r.json();
}

function pushSay(html, btnText, onClick, showTest) {
  $('pushState').innerHTML = html;
  const b = $('pushBtn');
  b.hidden = !btnText;
  b.disabled = false;
  b.textContent = btnText || '';
  b.onclick = onClick;
  $('pushTest').hidden = !showTest;
}

async function pushInit() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIOS && !standalone) {
      pushSay('<span class="off">還不能開啟</span><br>iPhone 要先把這個網頁<b>加入主畫面</b>：<br>Safari 下方的「分享」⬆️ →「加入主畫面」，<br>再從主畫面的「日語隨身練」圖示打開，回到這裡開啟通知。（需要 iOS 16.4 以上）');
    } else {
      pushSay('<span class="off">這個瀏覽器不支援通知</span>');
    }
    return;
  }
  let reg;
  try {
    reg = await navigator.serviceWorker.ready;
  } catch {
    pushSay('<span class="off">通知功能無法啟動</span>');
    return;
  }
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (sub && Notification.permission === 'granted') {
    pushSay('<span class="on">✅ 已開啟</span>：每天 09:00、11:30、20:00 各送一句。', '關閉通知', pushOff, true);
  } else if (Notification.permission === 'denied') {
    pushSay('<span class="off">通知被擋掉了</span><br>iPhone 請到「設定 → 通知 → 日語隨身練」打開。', '再試一次', pushOn);
  } else {
    pushSay('<span class="off">尚未開啟</span>', '🔔 開啟每日三句', pushOn);
  }
}

async function pushOn() {
  const b = $('pushBtn');
  b.disabled = true;
  b.textContent = '處理中…';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { await pushInit(); return; }
    const info = await fetch(PUSH_API + '/key').then((r) => r.json());
    if (!info.key) throw new Error('推播伺服器還沒設定好金鑰');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(info.key) });
    await pushPost('/subscribe', { sub: sub.toJSON() });
    await pushPost('/test', { sub: sub.toJSON() });
    await pushInit();
  } catch (e) {
    console.error(e);
    pushSay('<span class="off">開啟失敗</span><br>推播伺服器連不上，請確認有網路後再試一次。<br><small>' + esc(e.message) + '</small>', '再試一次', pushOn);
  }
}

async function pushOff() {
  $('pushBtn').disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await pushPost('/unsubscribe', { sub: sub.toJSON() }).catch(() => {});
      await sub.unsubscribe();
    }
  } finally {
    await pushInit();
  }
}

async function pushTest() {
  const b = $('pushTest');
  b.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await pushPost('/test', { sub: sub.toJSON(), preview: true });
    b.textContent = '已送出今日一句，等幾秒';
  } catch {
    b.textContent = '送出失敗';
  }
  setTimeout(() => { b.disabled = false; b.textContent = '送一則測試（今日一句）'; }, 3000);
}

// ---------- Wiring ----------
function applySettings() {
  document.body.classList.toggle('big', settings.big);
  document.body.classList.toggle('no-furi', !settings.furi);
  document.body.classList.toggle('no-romaji', !settings.romaji);
  $('optAutoSpeak').checked = settings.autoSpeak;
  $('optSlow').checked = settings.slow;
  $('optBig').checked = settings.big;
  $('optFuri').checked = settings.furi;
  $('optRomaji').checked = settings.romaji;
}

function init() {
  if (!sceneOf(settings.scene)) settings.scene = SCENES[0].id;
  applySettings();
  renderScenes();
  renderToday();
  renderList();
  select(dailyThree().find((x) => x.slot === todaySlot).phrase.id, false);
  updateReviewBadge();
  initKana();
  if (!SR) $('noSpeech').hidden = false;

  $('micMe').onclick = sayChinese;
  $('micJa').onclick = () => {
    if (autoMode) { skipAuto(); return; }
    const p = getPhrase(currentId) || getPhrase(listIds()[0]);
    if (!p) return;
    select(p.id, false);
    practice(p);
  };
  $('autoBtn').onclick = () => {
    if (!SR) { toast('這個瀏覽器不能用語音辨識，自動跟讀無法使用'); return; }
    if (rec) rec.abort();
    setAuto(!autoMode);
  };
  // Never keep the microphone on in the background.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { renderToday(); updateReviewBadge(); return; }
    if (autoMode) setAuto(false);
    if (rec) rec.abort();
  });

  $('favBtn').onclick = () => setView(view === 'favs' ? 'scene' : 'favs');
  $('reviewBtn').onclick = () => (view === 'review' ? setView('scene') : startReview());
  $('typeBtn').onclick = () => { $('typeRow').hidden = !$('typeRow').hidden; if (!$('typeRow').hidden) $('typeInput').focus(); };
  $('typeGo').onclick = () => { unlockTts(); lookupZh($('typeInput').value); $('typeInput').value = ''; };

  for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => switchTab(tab.dataset.tab);

  $('settingsBtn').onclick = () => { $('settings').showModal(); pushInit(); };
  $('settingsClose').onclick = () => $('settings').close();
  const opt = (id, key) => { $(id).onchange = (e) => { settings[key] = e.target.checked; saveSettings(); applySettings(); }; };
  opt('optAutoSpeak', 'autoSpeak');
  opt('optSlow', 'slow');
  opt('optBig', 'big');
  opt('optFuri', 'furi');
  opt('optRomaji', 'romaji');
  $('pushTest').onclick = pushTest;

  const net = () => { $('offline').hidden = navigator.onLine; };
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  net();

  // 從通知點進來：網址帶 ?today=morning|noon|evening
  const fromPush = new URLSearchParams(location.search).get('today');
  if (fromPush) {
    showToday(fromPush);
    history.replaceState(null, '', location.pathname);
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.today) showToday(e.data.today); });
    // When a new version takes over, reload once so the new screen shows up right away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || autoMode || rec) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => {});
  }
}

init();

import { LANGS, PHRASES, PHRASE_BY_ID, SLOTS, taiwanDay, dailyThree } from './phrases.js';
import { KANA_GROUPS, KANA } from './kana.js';
import { TRAP_GROUPS } from './traps.js';
import { VOCAB_GROUPS } from './vocab.js';

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
  lang: 'ja', sceneByLang: { ja: 'greet', en: 'greet' },
  autoSpeak: true, slow: false, big: false, furi: true, romaji: true,
  kanaScript: 'hira', kanaDir: 'k2r', kanaGroups: ['basic'],
  trapMode: 'listen', trapGroups: TRAP_GROUPS.map((g) => g.id),
  vocabDir: 'zh2en', vocabGroup: VOCAB_GROUPS[0].id,
}, load('settings', {}));
// 舊版只有日文，場景存在 settings.scene
if (typeof settings.scene === 'string') { settings.sceneByLang = { ...settings.sceneByLang, ja: settings.scene }; delete settings.scene; }
if (!LANGS[settings.lang]) settings.lang = 'ja';
const saveSettings = () => save('settings', settings);

let favs = load('favs', []);            // 收藏的句子 id
let custom = load('custom', {});        // 「我說中文」查到後收藏的句子
let srs = load('srs', {});              // 複習排程 { id: { lvl, due } }，due 是台灣日期的天數編號
let practiced = load('practiced', { day: 0, ids: [] }); // 今天練過哪些句子
let kanaMiss = load('kanaMiss', {});    // 五十音每個字錯了幾次（答對會慢慢減少）
let kanaToday = load('kanaToday', { day: 0, right: 0, total: 0 });
let trapMiss = load('trapMiss', {});    // 發音陷阱：每個字錯了幾次
let trapToday = load('trapToday', { day: 0, right: 0, total: 0 });
let vocabMiss = load('vocabMiss', {});  // 單字：每個字錯了幾次
let vocabToday = load('vocabToday', { day: 0, right: 0, total: 0 });

const today = () => taiwanDay();
const getPhrase = (id) => PHRASE_BY_ID[id] || custom[id] || lookupCache[id] || null;
const langOf = (p) => p.lang || 'ja';    // 舊的收藏沒有 lang，都是日文
const L = () => LANGS[settings.lang];
const curScene = () => settings.sceneByLang[settings.lang] || L().scenes[0].id;
const sceneOf = (id, lang = settings.lang) => LANGS[lang].scenes.find((s) => s.id === id);
const inLang = (id) => { const p = getPhrase(id); return !!p && langOf(p) === settings.lang; };

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
    .filter(([id, s]) => s.due <= d && inLang(id))
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
function speak(text, lang = L().speech, slow = settings.slow) {
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
// 日文用假名唸比較準（例如「一日」不會被唸成「ついたち」）；英文和查詢來的句子沒有假名就唸原文。
const sayPhrase = (p, slow) => speak(p.kana || p.text, LANGS[langOf(p)].speech, slow);

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
  const lang = langOf(p);
  const scene = sceneOf(p.scene, lang);
  el.innerHTML = (tag && scene ? '<div class="tag">' + scene.icon + ' ' + esc(scene.name) + '</div>' : '')
    + '<div class="jp" lang="' + lang + '">' + (lang === 'ja' ? rubyHTML(p.jp) : esc(p.text)) + '</div>'
    + (p.romaji ? '<div class="romaji">' + esc(p.romaji) + '</div>' : '')
    + (p.tip ? '<div class="tip">💡 ' + esc(p.tip) + '</div>' : '')
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

// 英文以「單字」為單位比對：大小寫、標點、縮寫的撇號都不算錯；數字 12 當成 twelve。
const NUM_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const normWord = (w) => {
  const x = w.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]/g, '');
  return /^\d+$/.test(x) && NUM_EN[+x] ? NUM_EN[+x] : x;
};

function compareWords(heard, form) {
  const chars = form.split(/(\s+)/).filter((t) => t !== '');
  const norm = chars.map((t) => (/^\s+$/.test(t) ? '' : normWord(t)));
  const idx = [];
  norm.forEach((w, i) => { if (w) idx.push(i); });
  const target = idx.map((i) => norm[i]);
  const hitT = lcsMatch(heard.split(/\s+/).map(normWord).filter(Boolean), target);
  const hits = new Array(chars.length).fill(null);
  idx.forEach((i, k) => { hits[i] = hitT[k]; });
  const score = target.length ? hitT.filter(Boolean).length / target.length : 0;
  return { chars, hits, score };
}

function grade(p, heard) {
  if (langOf(p) === 'en') return compareWords(heard, p.text);
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
      + '<div class="marks" lang="' + langOf(p) + '">' + marks + '</div>'
      + '<div class="heard">你念的：<span lang="' + langOf(p) + '">' + esc(heard) + '</span></div>'
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
    const heard = await recognize(LANGS[langOf(p)].speech, 'ja');
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
    showLive(who === 'me' ? '🎤 請說中文…說完停一下' : '🎤 請念' + L().name + '…念完停一下');
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
  $('micMe').querySelector('.mic-sub').textContent = who === 'me' ? '正在聽…說完再按一下' : '查' + L().name + '說法';
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
    try { heard = await recognize(LANGS[langOf(p)].speech, 'ja'); } catch (e) { toast(e.message); setAuto(false); break; }
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
  $('micJa').querySelector('.mic-main').textContent = on ? '⏭ 跳過這句' : '跟著念' + L().name;
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

// ---------- "I say it in Chinese" → how to say it in Japanese / English ----------
// 1st choice: Google Translate's free public endpoint (also gives romaji for Japanese). Fallback: MyMemory free API.
async function googleTranslate(text, to) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dt=rm&sl=zh-TW&tl=' + to + '&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error('google ' + res.status);
  const data = await res.json();
  const segs = data[0] || [];
  const ja = segs.filter((s) => s[0] != null).map((s) => s[0]).join('');
  const rm = segs.find((s) => s[0] == null && s[2]);
  if (!ja) throw new Error('google empty');
  return { out: ja, romaji: to === 'ja' && rm ? rm[2] : '' };
}
async function myMemoryTranslate(text, to) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=zh-TW|' + to;
  const res = await fetch(url);
  if (!res.ok) throw new Error('mymemory ' + res.status);
  const data = await res.json();
  if (String(data.responseStatus) !== '200') throw new Error(data.responseDetails || 'mymemory');
  return { out: data.responseData.translatedText, romaji: '' };
}
async function translateTo(text, to) {
  try { return await googleTranslate(text, to); } catch { return myMemoryTranslate(text, to); }
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
  return PHRASES.filter((p) => p.lang === settings.lang)
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
  const lang = settings.lang;
  try {
    const { out, romaji } = await translateTo(text, lang);
    const id = customId(lang + ':' + out);
    const p = custom[id] || { id, lang, scene: 'custom', jp: out.replace(/[[\]|]/g, ''), text: out, kana: '', romaji, zh: text };
    lookupCache[id] = p;
    body.innerHTML = '';
    let alike = similar(text);
    // 句庫裡剛好有一模一樣的句子：直接用句庫的（日文有假名注音、英文有發音提示）
    const flat = (s) => (lang === 'en' ? s.split(/\s+/).map(normWord).join(' ') : normStr(s));
    const same = alike.find((q) => flat(q.text) === flat(out));
    const main = same || p;
    alike = alike.filter((q) => q !== same);
    body.appendChild(makeCard(main, { tag: !!same }));
    if (alike.length) {
      const h = document.createElement('div');
      h.className = 'who';
      h.style.marginTop = '8px';
      h.textContent = '📚 句庫裡相近的句子' + (lang === 'ja' ? '（有假名和拼音）' : '');
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
  const three = dailyThree(today(), settings.lang);
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
      b.lang = settings.lang;
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

function showToday(slot, lang) {
  if (SLOTS[slot]) todaySlot = slot;
  if (LANGS[lang] && lang !== settings.lang) setLang(lang);
  switchTab('talk');
  renderToday();
  $('talk').scrollTo({ top: 0, behavior: 'smooth' });
  const p = dailyThree(today(), settings.lang).find((x) => x.slot === todaySlot).phrase;
  select(p.id, false);
}

// ---------- Scene / favourites / review list ----------
let view = 'scene'; // scene | favs | review

function renderScenes() {
  const grid = $('sceneGrid');
  grid.innerHTML = '';
  for (const s of L().scenes) {
    const b = document.createElement('button');
    b.className = 'scene-btn' + (view === 'scene' && s.id === curScene() ? ' active' : '');
    b.innerHTML = '<span class="ico">' + s.icon + '</span><span>' + esc(s.name) + '</span>';
    b.onclick = () => {
      settings.sceneByLang = { ...settings.sceneByLang, [settings.lang]: s.id };
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
  if (view === 'favs') return favs.filter(inLang);
  if (view === 'review') return reviewQueue.slice(reviewPos, reviewPos + 1);
  return PHRASES.filter((p) => p.lang === settings.lang && p.scene === curScene()).map((p) => p.id);
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
    const s = sceneOf(curScene());
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
    const next = Object.entries(srs).filter(([id, s]) => s.due > today() && inLang(id)).length;
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
  card.querySelector('.ask').textContent = '「' + p.zh + '」' + LANGS[langOf(p)].name + '怎麼說？';
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

// ---------- Shared helpers for the English quizzes ----------
const EN = 'en-US';
const sayEn = (w, slow) => speak(w, EN, slow);

/** 答對／答錯的計數：今天幾題、哪些字常錯（答對會慢慢減少） */
function tally(store, todayRec, key, right) {
  if (todayRec.day !== today()) { todayRec.day = today(); todayRec.right = 0; todayRec.total = 0; }
  todayRec.total++;
  if (right) {
    todayRec.right++;
    store[key] = Math.max(0, (store[key] || 0) - 1);
    if (!store[key]) delete store[key];
  } else {
    store[key] = Math.min(5, (store[key] || 0) + 1);
  }
}

function statsHTML(todayRec, unit) {
  const t = todayRec.day === today() ? todayRec : { right: 0, total: 0 };
  return '今天答對 <b>' + t.right + '</b> / ' + t.total + ' ' + unit;
}

function weakChips(el, store, label, onTap) {
  const weak = Object.entries(store).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 12);
  if (!weak.length) { el.insertAdjacentHTML('beforeend', '<div>還沒有常錯的 👍</div>'); return; }
  el.insertAdjacentHTML('beforeend', '<div>' + label + '</div><div class="weak"></div>');
  const w = el.querySelector('.weak');
  for (const [key] of weak) {
    const b = document.createElement('button');
    b.textContent = key;
    b.onclick = () => { unlockTts(); onTap(key); };
    w.appendChild(b);
  }
}

/** 多選／單選的分段按鈕 */
function segButtons(box, items, isOn, onTap) {
  box.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.dataset.v = it.id;
    b.textContent = it.label;
    b.onclick = () => { onTap(it.id); paint(); };
    box.appendChild(b);
  }
  const paint = () => { for (const b of box.children) b.classList.toggle('on', isOn(b.dataset.v)); };
  paint();
}

// ---------- Pronunciation traps (minimal pairs) ----------
// 聽力題：App 念其中一個字，選是哪一個。口說題：你念，語音辨識聽起來是哪一個。
const TRAPS = TRAP_GROUPS.flatMap((g) => g.pairs.map(([a, az, b, bz]) => ({ group: g.id, a, az, b, bz })));
let trapLast = null;
let trapTimer = null; // 答對後自動換題的計時器；手動換題或切換模式時要先取消，免得把新題目蓋掉

function trapPool() {
  return TRAPS.filter((t) => settings.trapGroups.includes(t.group));
}

function nextTrap() {
  clearTimeout(trapTimer);
  const pool = trapPool().filter((t) => t !== trapLast);
  const t = pickWeighted(pool.length ? pool : trapPool(), (x) => 1 + 3 * ((trapMiss[x.a] || 0) + (trapMiss[x.b] || 0)));
  trapLast = t;
  const g = TRAP_GROUPS.find((x) => x.id === t.group);
  $('trapTip').innerHTML = '<b>' + esc(g.title) + '</b>　' + esc(g.tip);
  const pickA = Math.random() < 0.5;
  const word = pickA ? t.a : t.b, zh = pickA ? t.az : t.bz;
  const other = pickA ? t.b : t.a, otherZh = pickA ? t.bz : t.az;
  if (settings.trapMode === 'listen') renderTrapListen(t, word, other);
  else renderTrapSpeak(t, word, zh, other, otherZh);
}

function renderTrapListen(t, word, other) {
  const q = $('trapQuiz');
  q.innerHTML = '<div class="hint">👂 仔細聽，是哪一個字？</div>'
    + '<button class="play big">🔊 再聽一次</button>'
    + '<button class="play">🐢 慢速</button>'
    + '<div class="choices"></div><div class="after"></div>';
  const [play, slow] = q.querySelectorAll('.play');
  play.onclick = () => { unlockTts(); sayEn(word); };
  slow.onclick = () => { unlockTts(); sayEn(word, true); };
  const box = q.querySelector('.choices');
  let done = false;
  for (const [w, z] of shuffle([[t.a, t.az], [t.b, t.bz]])) {
    const b = document.createElement('button');
    b.lang = 'en';
    b.innerHTML = esc(w) + '<small>' + esc(z) + '</small>';
    b.onclick = () => {
      if (done) return;
      done = true;
      const right = w === word;
      tally(trapMiss, trapToday, word, right);
      save('trapMiss', trapMiss);
      save('trapToday', trapToday);
      b.classList.add(right ? 'right' : 'wrong');
      if (!right) for (const x of box.children) if (x.firstChild.textContent === word) x.classList.add('right');
      renderTrapStats();
      const after = q.querySelector('.after');
      if (right) {
        after.innerHTML = '<div class="ok">✅ 答對了！</div>';
        trapTimer = setTimeout(nextTrap, 1200);
      } else {
        // 答錯：兩個字各念一次讓你比較，再自己按下一題
        after.innerHTML = '<div class="ng">剛剛念的是 <b lang="en">' + esc(word) + '</b>，你選了 <b lang="en">' + esc(other) + '</b></div>'
          + '<div class="row"><button class="cmp">🔊 比較兩個字</button><button class="next">下一題 ▶</button></div>';
        const cmp = async () => { await sayEn(word, true); await sleep(400); await sayEn(other, true); };
        after.querySelector('.cmp').onclick = () => { unlockTts(); cmp(); };
        after.querySelector('.next').onclick = nextTrap;
        cmp();
      }
    };
    box.appendChild(b);
  }
  if (ttsUnlocked) sayEn(word);
}

function renderTrapSpeak(t, word, zh, other, otherZh) {
  const q = $('trapQuiz');
  q.innerHTML = '<div class="hint">🎤 念這個字，看看 App 聽起來是哪一個</div>'
    + '<div class="q word" lang="en"></div><div class="zh"></div>'
    + '<div class="vs">小心別念成 <b lang="en"></b>（<span></span>）</div>'
    + '<div class="row"><button class="listen">🔊 聽標準</button><button class="slow">🐢 慢速</button><button class="skip">跳過 ▶</button></div>'
    + '<button class="say">🎤 念念看</button><div class="after"></div>';
  q.querySelector('.q').textContent = word;
  q.querySelector('.zh').textContent = zh;
  q.querySelector('.vs b').textContent = other;
  q.querySelector('.vs span').textContent = otherZh;
  q.querySelector('.listen').onclick = () => { unlockTts(); sayEn(word); };
  q.querySelector('.slow').onclick = () => { unlockTts(); sayEn(word, true); };
  q.querySelector('.skip').onclick = () => { if (rec) rec.abort(); nextTrap(); };
  const sayBtn = q.querySelector('.say');
  sayBtn.onclick = async () => {
    unlockTts();
    if (!SR) { toast('這個瀏覽器不能用語音辨識，請用聽力題'); return; }
    if (rec) { rec.stop(); return; }
    sayBtn.classList.add('listening');
    sayBtn.textContent = '正在聽…念完停一下';
    let heard = '';
    try { heard = await recognize(EN, 'trap'); } catch (e) { toast(e.message); }
    sayBtn.classList.remove('listening');
    sayBtn.textContent = '🎤 再念一次';
    const words = heard.split(/\s+/).map(normWord);
    const after = q.querySelector('.after');
    if (!heard) { after.innerHTML = '<div class="ng">😶 沒聽到，靠近手機再念一次</div>'; return; }
    const right = words.includes(normWord(word));
    const confused = !right && words.includes(normWord(other));
    tally(trapMiss, trapToday, word, right);
    save('trapMiss', trapMiss);
    save('trapToday', trapToday);
    renderTrapStats();
    if (right) {
      after.innerHTML = '<div class="ok">✅ 聽起來就是 <b lang="en">' + esc(word) + '</b>，很標準！</div><button class="next">下一題 ▶</button>';
    } else {
      after.innerHTML = '<div class="ng">' + (confused
        ? '😅 聽起來像 <b lang="en">' + esc(other) + '</b>（' + esc(otherZh) + '）'
        : '🤔 聽成：<b lang="en">' + esc(heard) + '</b>') + '</div>'
        + '<div class="tipline">' + esc(TRAP_GROUPS.find((g) => g.id === t.group).tip) + '</div>'
        + '<button class="next">下一題 ▶</button>';
      sayEn(word, true);
    }
    after.querySelector('.next').onclick = nextTrap;
  };
}

function renderTrapStats() {
  const el = $('trapStats');
  el.innerHTML = statsHTML(trapToday, '題');
  weakChips(el, trapMiss, '常錯的字（點一下聽發音）：', (w) => sayEn(w, true));
  if (!$('trapList').hidden) renderTrapList();
}

function renderTrapList() {
  const el = $('trapList');
  el.innerHTML = '';
  for (const g of TRAP_GROUPS) {
    el.insertAdjacentHTML('beforeend', '<h4>' + esc(g.title) + '</h4><p class="list-tip">' + esc(g.tip) + '</p>');
    const table = document.createElement('table');
    table.className = 'words';
    for (const [a, az, b, bz] of g.pairs) {
      const tr = document.createElement('tr');
      for (const [w, z] of [[a, az], [b, bz]]) {
        const td = document.createElement('td');
        if (trapMiss[w]) td.className = 'weak';
        td.innerHTML = '<span class="k" lang="en">' + esc(w) + '</span><span class="r">' + esc(z) + '</span>';
        td.onclick = () => { unlockTts(); sayEn(w, true); };
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    el.appendChild(table);
  }
}

function initTraps() {
  segButtons($('trapMode'), [{ id: 'listen', label: '👂 聽力題' }, { id: 'speak', label: '🎤 口說題' }],
    (v) => settings.trapMode === v,
    (v) => { settings.trapMode = v; saveSettings(); nextTrap(); });
  segButtons($('trapGroups'), TRAP_GROUPS.map((g) => ({ id: g.id, label: g.name })),
    (v) => settings.trapGroups.includes(v),
    (v) => {
      const set = new Set(settings.trapGroups);
      if (set.has(v)) { if (set.size > 1) set.delete(v); } else set.add(v);
      settings.trapGroups = [...set];
      saveSettings();
      nextTrap();
    });
  $('trapListBtn').onclick = () => { $('trapList').hidden = !$('trapList').hidden; if (!$('trapList').hidden) renderTrapList(); };
  nextTrap();
  renderTrapStats();
}

// ---------- Vocabulary ----------
let vocabLast = null;
let vocabTimer = null;
const vocabGroup = () => VOCAB_GROUPS.find((g) => g.id === settings.vocabGroup) || VOCAB_GROUPS[0];

function nextVocab() {
  clearTimeout(vocabTimer);
  const g = vocabGroup();
  const pool = g.words.filter(([w]) => w !== vocabLast);
  const [word, zh] = pickWeighted(pool, ([w]) => 1 + 4 * (vocabMiss[w] || 0));
  vocabLast = word;
  const options = shuffle([[word, zh], ...shuffle(g.words.filter(([w]) => w !== word)).slice(0, 3)]);
  const dir = settings.vocabDir;
  const q = $('vocabQuiz');
  q.innerHTML = (dir === 'zh2en'
    ? '<div class="hint">英文怎麼說？</div><div class="q zhq"></div>'
    : '<div class="hint">👂 聽英文，選中文意思</div><button class="play big">🔊 再聽一次</button>')
    + '<div class="choices"></div><div class="after"></div>';
  if (dir === 'zh2en') q.querySelector('.q').textContent = zh;
  else q.querySelector('.play').onclick = () => { unlockTts(); sayEn(word); };
  const box = q.querySelector('.choices');
  let done = false;
  for (const [w, z] of options) {
    const b = document.createElement('button');
    if (dir === 'zh2en') b.lang = 'en';
    b.textContent = dir === 'zh2en' ? w : z;
    b.dataset.w = w;
    b.onclick = () => {
      if (done) return;
      done = true;
      unlockTts();
      const right = w === word;
      tally(vocabMiss, vocabToday, word, right);
      save('vocabMiss', vocabMiss);
      save('vocabToday', vocabToday);
      b.classList.add(right ? 'right' : 'wrong');
      if (!right) for (const x of box.children) if (x.dataset.w === word) x.classList.add('right');
      q.querySelector('.after').innerHTML = '<div class="' + (right ? 'ok' : 'ng') + '">' + (right ? '✅ ' : '正確是：')
        + '<b lang="en">' + esc(word) + '</b>　' + esc(zh) + '</div>';
      renderVocabStats();
      sayEn(word);
      vocabTimer = setTimeout(nextVocab, right ? 1300 : 2600);
    };
    box.appendChild(b);
  }
  if (dir === 'en2zh' && ttsUnlocked) sayEn(word);
}

function renderVocabStats() {
  const el = $('vocabStats');
  el.innerHTML = statsHTML(vocabToday, '題');
  weakChips(el, vocabMiss, '常錯的單字（點一下聽發音）：', (w) => sayEn(w));
  if (!$('vocabList').hidden) renderVocabList();
}

function renderVocabList() {
  const el = $('vocabList');
  const g = vocabGroup();
  el.innerHTML = '<h4>' + g.icon + ' ' + esc(g.name) + '（' + g.words.length + ' 個）</h4>';
  const table = document.createElement('table');
  table.className = 'words';
  for (let i = 0; i < g.words.length; i += 2) {
    const tr = document.createElement('tr');
    for (const [w, z] of g.words.slice(i, i + 2)) {
      const td = document.createElement('td');
      if (vocabMiss[w]) td.className = 'weak';
      td.innerHTML = '<span class="k" lang="en">' + esc(w) + '</span><span class="r">' + esc(z) + '</span>';
      td.onclick = () => { unlockTts(); sayEn(w); };
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  el.appendChild(table);
}

function renderVocabGroups() {
  const grid = $('vocabGroups');
  grid.innerHTML = '';
  for (const g of VOCAB_GROUPS) {
    const b = document.createElement('button');
    b.className = 'scene-btn' + (g.id === settings.vocabGroup ? ' active' : '');
    b.innerHTML = '<span class="ico">' + g.icon + '</span><span>' + esc(g.name) + '</span>';
    b.onclick = () => {
      settings.vocabGroup = g.id;
      saveSettings();
      renderVocabGroups();
      vocabLast = null;
      nextVocab();
      if (!$('vocabList').hidden) renderVocabList();
    };
    grid.appendChild(b);
  }
}

function initVocab() {
  segButtons($('vocabDir'), [{ id: 'zh2en', label: '看中文選英文' }, { id: 'en2zh', label: '聽英文選中文' }],
    (v) => settings.vocabDir === v,
    (v) => { settings.vocabDir = v; saveSettings(); nextVocab(); });
  renderVocabGroups();
  $('vocabListBtn').onclick = () => { $('vocabList').hidden = !$('vocabList').hidden; if (!$('vocabList').hidden) renderVocabList(); };
  nextVocab();
  renderVocabStats();
}

// ---------- Tabs ----------
const TABS = { talk: null, kana: 'ja', traps: 'en', vocab: 'en' }; // 每個分頁屬於哪個語言（null = 共用）
let currentTab = 'talk';

function switchTab(name) {
  if (TABS[name] && TABS[name] !== settings.lang) name = 'talk';
  currentTab = name;
  for (const t of document.querySelectorAll('.tab')) {
    t.hidden = !!TABS[t.dataset.tab] && TABS[t.dataset.tab] !== settings.lang;
    t.classList.toggle('active', t.dataset.tab === name);
  }
  for (const id of Object.keys(TABS)) $(id).hidden = id !== name;
  $('talkBar').hidden = name !== 'talk';
  if (name !== 'talk' && autoMode) setAuto(false);
}

// ---------- Language switch ----------
function setLang(lang) {
  if (autoMode) setAuto(false);
  if (rec) rec.abort();
  if (window.speechSynthesis) speechSynthesis.cancel();
  settings.lang = lang;
  saveSettings();
  document.documentElement.dataset.lang = lang;
  for (const b of $('langSwitch').children) b.classList.toggle('on', b.dataset.v === lang);
  $('micJa').querySelector('.mic-main').textContent = '跟著念' + L().name;
  setListening(null);
  $('typeInput').placeholder = '打中文，查' + L().name + '怎麼說…';
  $('lookup').innerHTML = '';
  if (view === 'review') view = 'scene';
  renderScenes();
  renderToday();
  renderList();
  updateReviewBadge();
  select(dailyThree(today(), lang).find((x) => x.slot === todaySlot).phrase.id, false);
  switchTab(currentTab);
  pushLangSync();
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
      pushSay('<span class="off">還不能開啟</span><br>iPhone 要先把這個網頁<b>加入主畫面</b>：<br>Safari 下方的「分享」⬆️ →「加入主畫面」，<br>再從主畫面的圖示打開，回到這裡開啟通知。（需要 iOS 16.4 以上）');
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
    pushSay('<span class="on">✅ 已開啟</span>：每天 09:00、11:30、20:00 各送一句<b>' + L().name + '</b>。<br><small>送哪一種語言，跟著上方 🇯🇵／🇺🇸 切換。</small>', '關閉通知', pushOff, true);
  } else if (Notification.permission === 'denied') {
    pushSay('<span class="off">通知被擋掉了</span><br>iPhone 請到「設定 → 通知」找到這個 App 打開。', '再試一次', pushOn);
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
    await pushPost('/subscribe', { sub: sub.toJSON(), lang: settings.lang });
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
    if (sub) await pushPost('/test', { sub: sub.toJSON(), preview: true, lang: settings.lang });
    b.textContent = '已送出今日一句，等幾秒';
  } catch {
    b.textContent = '送出失敗';
  }
  setTimeout(() => { b.disabled = false; b.textContent = '送一則測試（今日一句）'; }, 3000);
}

/** 切換語言時，告訴推播伺服器之後改送哪一種語言（沒開通知就什麼都不做） */
async function pushLangSync() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await pushPost('/subscribe', { sub: sub.toJSON(), lang: settings.lang });
  } catch { /* 沒網路時下次切換再同步 */ }
}

/**
 * 點通知時背景程式會把「要練哪一句」記在快取裡。
 * App 一打開（或從背景切回來）就讀一次：30 分鐘內點的通知，就跳到那一句，讀完就清掉。
 */
async function checkPendingFromPush() {
  try {
    if (!('caches' in window)) return;
    const c = await caches.open('pending-today');
    const r = await c.match('pending');
    if (!r) return;
    await c.delete('pending');
    const d = await r.json();
    if (d.today && Date.now() - d.t < 30 * 60 * 1000) showToday(d.today, d.lang);
  } catch { /* 讀不到就算了 */ }
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
  for (const lang of Object.keys(LANGS)) {
    if (!sceneOf(settings.sceneByLang[lang], lang)) settings.sceneByLang[lang] = LANGS[lang].scenes[0].id;
  }
  applySettings();
  initKana();
  initTraps();
  initVocab();
  for (const b of $('langSwitch').children) b.onclick = () => { unlockTts(); if (b.dataset.v !== settings.lang) setLang(b.dataset.v); };
  // 從通知點進來：網址帶 ?today=morning|noon|evening&lang=ja|en
  const params = new URLSearchParams(location.search);
  if (LANGS[params.get('lang')]) settings.lang = params.get('lang');
  setLang(settings.lang);
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
    if (!document.hidden) { renderToday(); updateReviewBadge(); checkPendingFromPush(); return; }
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

  const fromPush = params.get('today');
  if (fromPush) {
    showToday(fromPush, params.get('lang'));
    history.replaceState(null, '', location.pathname);
    caches?.open('pending-today').then((c) => c.delete('pending')).catch(() => {});
  } else {
    checkPendingFromPush();
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.today) showToday(e.data.today, e.data.lang); });
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

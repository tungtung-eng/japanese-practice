/**
 * 網頁推播（Web Push）—— 跟工地氣象站用的是同一套
 *
 * 手機的推播服務（Apple、Google）不接受隨便一包資料，必須：
 *   1. 用 VAPID 私鑰簽一張 JWT，證明推播是我們發的（RFC 8292）
 *   2. 把內容用訂閱者的金鑰加密（RFC 8291，aes128gcm）
 *
 * 這兩件事都用 WebCrypto 做，沒有外部套件。
 */

const b64urlToBytes = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
};

const bytesToB64url = (b) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

const utf8 = (s) => new TextEncoder().encode(s);

// ---------------------------------------------------------------- VAPID

/** 用 VAPID 私鑰簽一張 JWT，告訴推播服務「這是誰發的」 */
async function vapidHeader(endpoint, publicKey, privateKey, subject) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(utf8(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const data = utf8(`${header}.${payload}`);

  const pub = b64urlToBytes(publicKey);       // 未壓縮的 P-256 公鑰，65 bytes
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: privateKey,
    ext: true,
  };
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);

  return {
    Authorization: `vapid t=${header}.${payload}.${bytesToB64url(sig)}, k=${publicKey}`,
  };
}

// ---------------------------------------------------------------- 內容加密

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** 依 RFC 8291 把內容加密成推播服務認得的格式 */
async function encrypt(payload, p256dhB64, authB64) {
  const clientPub = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);

  // 每則訊息用一組臨時金鑰
  const localKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', localKeys.publicKey));

  const clientKey = await crypto.subtle.importKey(
    'raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, localKeys.privateKey, 256));

  // 先用 auth secret 把共享祕密拉伸成 IKM
  const prkInfo = concat(
    utf8('WebPush: info\0'), clientPub, localPubRaw);
  const ikm = await hkdf(authSecret, shared, prkInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // aes128gcm 規定內容後面要接一個 0x02 當結尾標記
  const body = concat(utf8(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, key, body));

  // 標頭：salt(16) + 記錄長度(4) + 公鑰長度(1) + 公鑰(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([localPubRaw.length]), localPubRaw, cipher);
}

// ---------------------------------------------------------------- 對外

/**
 * 送出一則推播。
 * 回傳 { ok, status }。410/404 代表對方已取消訂閱，呼叫端應刪除該筆。
 */
export async function sendPush(sub, payload, env) {
  const body = await encrypt(payload, sub.keys.p256dh, sub.keys.auth);
  const auth = await vapidHeader(
    sub.endpoint, env.VAPID_PUBLIC, env.VAPID_PRIVATE,
    'mailto:a0931835684@gmail.com');

  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      ...auth,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '10800',               // 手機關機或沒訊號時，3 小時內開機還是收得到
      urgency: 'normal',
    },
    body,
  });
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410 };
}

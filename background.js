/* DoGet GitHub 下载加速 —— 后台 Service Worker
 * 作用：代替页面发起跨域请求，向 DoGet 接口换取 token，并拼出加速链接。
 * 页面（github.com）直接 fetch 会被 CORS 拦截，因此必须走这里。
 */

const DEFAULTS = {
  enabled: true,
  badge: true,
  includeRaw: false,
  base: "https://doget.nocsdn.com"
};

const CACHE_TTL = 24 * 60 * 60 * 1000; // token 无过期时间，缓存 24h 足够
const memoryCache = new Map();          // url|base -> { accelerated, ts }
const inflight = new Map();             // 去重：同一链接并发只请求一次
const tabCounts = new Map();            // tabId -> 已加速链接数

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return Object.assign({}, DEFAULTS, stored);
}

function normalizeBase(base) {
  return String(base || DEFAULTS.base).trim().replace(/\/+$/, "");
}

async function readCache(key) {
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.accelerated;
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    memoryCache.set(key, entry);
    return entry.accelerated;
  }
  return "";
}

async function writeCache(key, accelerated) {
  const entry = { accelerated, ts: Date.now() };
  memoryCache.set(key, entry);
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch (e) {
    /* 存储满了也不影响本次使用 */
  }
}

function pickToken(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.data === "string") return payload.data;
  if (typeof payload.token === "string") return payload.token;
  if (payload.data && typeof payload.data.token === "string") return payload.data.token;
  return "";
}

/** 向 DoGet 换取加速链接：/api/get_download_token -> /api/download?token=... */
async function convertUrl(rawUrl, base) {
  const url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("无效的下载地址");
  const root = normalizeBase(base);
  const key = `doget:${root}|${url}`;

  const cached = await readCache(key);
  if (cached) return { accelerated: cached, cached: true };

  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const api = `${root}/api/get_download_token?url=${encodeURIComponent(url)}`;
    const res = await fetch(api, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text ? text.slice(0, 120) : `接口返回 HTTP ${res.status}`);
    }
    const payload = await res.json().catch(() => null);
    const token = pickToken(payload);
    if (!token) throw new Error("接口未返回可用 token");
    const accelerated = `${root}/api/download?token=${encodeURIComponent(token)}`;
    await writeCache(key, accelerated);
    return { accelerated, cached: false };
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

async function bumpTabCount(tabId, count) {
  if (typeof tabId !== "number") return;
  tabCounts.set(tabId, count);
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#F59E0B" });
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
  } catch (e) {
    /* 标签页可能已关闭 */
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "doget:convert") {
    (async () => {
      try {
        const settings = await getSettings();
        const result = await convertUrl(msg.url, settings.base || DEFAULTS.base);
        sendResponse({ ok: true, accelerated: result.accelerated, cached: !!result.cached });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // 异步响应
  }

  if (msg.type === "doget:count") {
    if (sender.tab) bumpTabCount(sender.tab.id, Number(msg.count) || 0);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "doget:settings") {
    getSettings().then((s) => sendResponse({ ok: true, settings: s }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCounts.delete(tabId);
});

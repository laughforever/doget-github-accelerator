/* DoGet GitHub 下载加速 —— 内容脚本
 * 职责：
 *  1) 扫描 GitHub 页面上的真实文件下载链接（Release 资源 / 源码包 / codeload / objects 资源）；
 *  2) 通过后台换取加速链接，把 a.href 直接改写成 DoGet 加速地址；
 *  3) 若用户点得太快、链接还没转换完，则在点击时兜底转换后再跳转。
 */

(() => {
  if (window.__dogetAcceleratorLoaded) return;
  window.__dogetAcceleratorLoaded = true;

  const LOG_PREFIX = "[DoGet]";
  const DEFAULT_SETTINGS = {
    enabled: true,
    badge: true,
    includeRaw: false,
    base: "https://doget.nocsdn.com"
  };

  const state = Object.assign({}, DEFAULT_SETTINGS);
  const converting = new Set();
  const done = new Set();
  let convertedCount = 0;
  let scanTimer = null;

  /* ---------- 哪些链接算「文件下载」 ---------- */
  const FILE_PATTERNS = [
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//i,
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest\/download\//i,
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/[^/]+\/download\//i,
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/archive\//i,
    /^https:\/\/codeload\.github\.com\//i,
    /^https:\/\/objects\.githubusercontent\.com\//i,
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/releasses\/download\//i
  ];

  // 可选：raw / blob 原始文件（默认关闭，避免影响正常阅读）
  const RAW_PATTERNS = [
    /^https:\/\/raw\.githubusercontent\.com\//i,
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/raw\//i,
    /^https:\/\/media\.githubusercontent\.com\//i
  ];

  /** GitHub 的 href 常是相对路径（/owner/repo/releases/download/...），必须解析成绝对地址再判断 */
  function resolveHref(anchor) {
    const raw = (anchor && anchor.getAttribute("href")) || "";
    if (!raw) return "";
    if (/^(https?:)?\/\//i.test(raw)) return anchor.href || raw;
    try {
      return new URL(raw, location.origin).href;
    } catch (e) {
      return "";
    }
  }

  function isDownloadUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    const list = state.includeRaw ? FILE_PATTERNS.concat(RAW_PATTERNS) : FILE_PATTERNS;
    return list.some((re) => re.test(url));
  }

  function applyBadgeSetting() {
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle("doget-no-badge", !state.badge);
  }

  /* ---------- 与后台通信 ---------- */
  function requestConvert(url) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "doget:convert", url }, (res) => {
          if (chrome.runtime.lastError || !res || !res.ok) {
            resolve("");
            return;
          }
          resolve(res.accelerated || "");
        });
      } catch (e) {
        resolve("");
      }
    });
  }

  function reportCount() {
    try {
      chrome.runtime.sendMessage({ type: "doget:count", count: convertedCount });
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- 改写单个链接 ---------- */
  const queue = [];
  let running = 0;
  const MAX_CONCURRENT = 3;

  function enqueue(anchor) {
    queue.push(anchor);
    drain();
  }

  function drain() {
    while (running < MAX_CONCURRENT && queue.length) {
      const anchor = queue.shift();
      running += 1;
      processAnchor(anchor).finally(() => {
        running -= 1;
        drain();
      });
    }
  }

  async function processAnchor(anchor) {
    if (!anchor || !anchor.isConnected) return;
    const original = anchor.dataset.dogetOriginal || resolveHref(anchor);
    if (!original || !isDownloadUrl(original)) return;
    if (anchor.dataset.dogetDone === "1" || converting.has(original)) return;

    converting.add(original);
    try {
      const accelerated = await requestConvert(original);
      if (!accelerated) return;
      anchor.dataset.dogetOriginal = original;
      anchor.dataset.dogetDone = "1";
      anchor.href = accelerated;
      anchor.classList.add("doget-accelerated");
      anchor.title = "DoGet 加速下载：" + original;
      done.add(original);
      convertedCount += 1;
      reportCount();
    } catch (e) {
      console.warn(LOG_PREFIX, "转换失败", original, e);
    } finally {
      converting.delete(original);
    }
  }

  /* ---------- 扫描页面（GitHub 是局部刷新的，用 MutationObserver 增量处理） ---------- */
  function scan(root) {
    if (!state.enabled) return;
    const scope = root && root.querySelectorAll ? root : document;
    const anchors = scope.querySelectorAll(
      'a[href*="/releases/download/"], a[href*="/releases/latest/download/"], ' +
        'a[href*="/archive/"], a[href*="codeload.github.com"], ' +
        'a[href*="objects.githubusercontent.com"]' +
        (state.includeRaw
          ? ', a[href*="raw.githubusercontent.com"], a[href*="/raw/"], a[href*="media.githubusercontent.com"]'
          : "")
    );
    for (const anchor of anchors) {
      if (anchor.dataset.dogetDone === "1") continue;
      if (!isDownloadUrl(resolveHref(anchor))) continue;
      enqueue(anchor);
    }
  }

  function scheduleScan(root) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan(root);
    }, 120);
  }

  /* ---------- 点击兜底：还没转换完就点了，先拿加速链接再跳 ---------- */
  function onClickCapture(event) {
    if (!state.enabled) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;

    const href = anchor.dataset.dogetOriginal || resolveHref(anchor);
    if (!isDownloadUrl(href)) return;

    // 已改写完成的链接：直接放行，走浏览器原生下载
    if (anchor.dataset.dogetDone === "1" && anchor.classList.contains("doget-accelerated")) return;

    event.preventDefault();
    event.stopPropagation();

    requestConvert(href).then((accelerated) => {
      window.location.href = accelerated || href;
    });
  }

  /* ---------- 设置同步 ---------- */
  function applySettings(next) {
    const wasEnabled = state.enabled;
    Object.assign(state, next || {});
    applyBadgeSetting();
    if (state.enabled && !wasEnabled) scheduleScan(document);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const next = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (changes[key]) next[key] = changes[key].newValue;
    }
    if (Object.keys(next).length) applySettings(Object.assign({}, state, next));
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "doget:page-stats") {
      sendResponse({
        ok: true,
        count: convertedCount,
        enabled: state.enabled,
        host: location.host
      });
    }
    return false;
  });

  /* ---------- 启动 ---------- */
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    Object.assign(state, settings || {});
    applyBadgeSetting();
    if (!state.enabled) return;
    scheduleScan(document);
    document.addEventListener("click", onClickCapture, true);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          const target = record.target;
          if (target && target.tagName === "A") enqueue(target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "A") enqueue(node);
          else if (node.querySelector) scheduleScan(node);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"]
    });
  });
})();

/* DoGet GitHub 下载加速 —— 设置面板逻辑 */

const DEFAULTS = {
  enabled: true,
  badge: true,
  includeRaw: false,
  base: "https://doget.nocsdn.com"
};

const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const merged = Object.assign({}, DEFAULTS, settings);
  $("enabled").checked = !!merged.enabled;
  $("badge").checked = !!merged.badge;
  $("includeRaw").checked = !!merged.includeRaw;
  $("base").value = merged.base;
}

function saveSettings(patch) {
  chrome.storage.sync.set(patch);
}

async function renderStat() {
  const el = $("stat");
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab) {
      el.textContent = "当前没有可操作的标签页。";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "doget:page-stats" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        el.innerHTML = "当前页面未注入加速脚本。<br />请打开任意 GitHub 仓库 / Release 页面后再试。";
        return;
      }
      el.innerHTML = `本页已加速 <b>${res.count}</b> 个下载链接`;
    });
  } catch (e) {
    el.textContent = "无法读取当前页面状态。";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  renderStat();

  $("enabled").addEventListener("change", (e) => saveSettings({ enabled: e.target.checked }));
  $("badge").addEventListener("change", (e) => saveSettings({ badge: e.target.checked }));
  $("includeRaw").addEventListener("change", (e) => saveSettings({ includeRaw: e.target.checked }));
  $("base").addEventListener("change", (e) => saveSettings({ base: e.target.value }));
});

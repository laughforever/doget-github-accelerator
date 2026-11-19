# DoGet GitHub 下载加速（浏览器扩展）

把 [DoGet](https://doget.nocsdn.com) 的「输入链接 → 生成加速地址」动作自动化：
在 GitHub 上点击 Release 资源、源码包等**真实文件下载链接**时，链接会自动被改写成
`https://doget.nocsdn.com/api/download?token=...` 形式的加速地址再下载。

## 它做了什么

| 环节 | 实现 |
| --- | --- |
| 识别下载链接 | 内容脚本匹配 `github.com/*/*/releases/download/*`、`releases/latest/download`、`/archive/refs/*`、`codeload.github.com`、`objects.githubusercontent.com` |
| 生成加速链接 | 后台服务调用 DoGet 的 `GET /api/get_download_token?url=<原始地址>` 取 token，再拼成 `/api/download?token=<token>` |
| 改写链接 | 把 `a.href` 替换为加速地址，原始地址保存在 `data-doget-original`，加 `doget-accelerated` 类与 `⚡` 标记 |
| 抢跑兜底 | 若链接尚未转换完用户就点击，拦截这次点击、现场换好 token 再跳转 |
| 动态页面 | `MutationObserver` 处理 GitHub 的局部刷新（切换 Release、翻页、turbo 导航） |
| 缓存 | token 载荷不含过期时间，后台按 24 小时缓存，减少请求 |

> 为什么必须用后台服务请求：DoGet 的接口没有返回 `Access-Control-Allow-Origin`，
> 在 `github.com` 页面里直接 `fetch` 会被浏览器 CORS 拦掉；扩展的后台 Service Worker
> 持有 `host_permissions`，可以正常请求。

## 安装（Chrome / Edge）

1. 解压 `github-doget-accelerator.zip` 到任意目录（或直接使用本文件夹）。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
3. 右上角打开「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择解压后的文件夹（里面有 `manifest.json` 的那一层）。
5. 打开任意 GitHub 仓库的 Releases 页面，文件链接后会多出 `⚡`，即已切换到加速地址。

## 使用与设置

点扩展图标可打开设置面板：

- **自动加速下载链接**：总开关，关闭后 GitHub 恢复原始下载地址。
- **显示 ⚡ 标记**：是否在每个已加速链接后显示小图标。
- **也加速 raw / 大文件直链**：额外覆盖 `raw.githubusercontent.com`、`/raw/`、`media.githubusercontent.com`。
- **加速服务地址**：可选 `doget.nocsdn.com`（默认）或 `doget-api.oopscloud.xyz`。

面板底部会显示「本页已加速 N 个下载链接」，扩展图标上的角标是同一计数。

## 文件结构

```
manifest.json     # MV3 清单，声明 host_permissions 与内容脚本注入范围
background.js     # 换取 token、缓存、角标计数、消息路由
content.js        # 扫描/改写链接、点击兜底、动态页面监听、设置同步
content.css       # 仅一个 ⚡ 伪元素标记，不改动页面布局
popup.html/js     # 设置面板
icons/            # 16 / 48 / 128 图标
```

## 已知限制

- 只处理**点链接**的下载场景。GitHub 上「Code → Download ZIP」会走 `codeload.github.com`，
  已在覆盖范围内；但如果某个按钮是 JS 里动态构造 URL 且不写入 `a[href]`，则不会被改写。
- 依赖第三方服务 `doget.nocsdn.com` 可用性；它若失效，扩展会静默回退到原始 GitHub 地址。
- token 由 DoGet 服务端签发，扩展不伪造 token，也不代理、不缓存文件内容。
- 未处理 `download` 事件级别的 URL（如自定义下载器协议），此类场景可自行在设置里切换服务地址。

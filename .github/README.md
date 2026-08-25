# AI Consultant

把 ChatGPT、Claude、Gemini、Grok 的**網頁版**並排在同一個桌面視窗裡，一次提問四家同時作答，
或讓它們依照預設流程接力、互審、辯論。Tauri 2 ＋ React ＋ Rust。

## 沒有 API key

主視窗掛四個子 webview，載入你平常用的那四個網站。送出時不呼叫任何 API，而是**用你已登入的
網頁 session**——把字打進那個網站自己的輸入框、按它自己的送出鈕、再把回答抓回來。

所以帳號、額度、模型版本都是你自己的，沒有金鑰要保管。代價是 **provider 改版就會壞**，
壞掉的地方通常在 `adapters/*.json` 的選擇器。

機制細節（三層構造、bridge、連線狀態、送出路徑）見 [`docs/BASICS.md`](../docs/BASICS.md)。

## 六個模式

| 模式 | 形狀 |
|---|---|
| 自由模式 | 同時發給四家，各自獨立回答 |
| 多方諮詢 | 雙源先答 → 審查補充 → 總結研究 |
| 四方辯證 | 正方 → 反方 → 判官 → 總結 |
| Coding 模式 | 規劃 → 審查 → 實作 → 測試 → 驗收（8 步） |
| 道理辯證 | 5 輪辯證螺旋 × 4 席 |
| 腦力激盪 | 12 輪 · 48 次發言 · 5 階段 |

除了自由模式，其餘都是串行——**後續步驟拿得到前面的回答當材料**，這是它們與自由模式的根本差別。

送出後會留下 transcript 與 snapshot，可匯出 Markdown。「重播」是**沿原路重跑一次**，
AI 會重新回答，不是回放舊畫面。

## 執行

沒有發佈任何安裝檔，自己建一支來用。

前置需求：Node.js `^22.13.0 || >=24.0.0`、pnpm 11（`corepack enable`）、Rust stable
（Windows 需 MSVC Build Tools 的「Desktop development with C++」）、WebView2（Windows 10/11 通常已內建）。

```sh
pnpm install
pnpm build:injected   # 產生注入腳本，不能省
pnpm tauri dev        # 第一次 Rust 編譯較久
```

改完跑 `pnpm verify`（typecheck ＋ lint ＋ test ＋ agent 契約 ＋ adapter 檢查）。
建 release 版、可攜版、agent 腳本啟動法見 [`docs/RUN-AND-UPDATE.md`](../docs/RUN-AND-UPDATE.md)。

資料目錄在 `%APPDATA%\tw.micasa.aiconsultant`，四家各自獨立的登入 profile 都在裡面。

## 現況

repo 裡的版號永遠是 `0.0.0`，真正的版號由 CI 從 tag 注入。app 可以檢查有沒有新版，
但不會自己下載或安裝。

Windows x64 是實機驗證過的平台；macOS Apple Silicon 只有部分驗證（ad-hoc 簽章，Grok 曾卡在
Cloudflare 驗證）；Linux 目前只有 CI 建置，沒有實機回報。詳見
[`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md)。

回報漏洞請走 GitHub Security 的私人表單，不要開公開 issue：[`SECURITY.md`](../SECURITY.md)。

## 版本異動

| 版本 | 日期 | 異動 |
|---|---|---|
| [v0.0.3](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.3) | 2026-08-25 | 原生問答的回答也會進主畫面；時間改本地 24 小時制；AI 連線與傳送晶片加上 provider logo；記住上次的工作模式；字級拆成介面與主版面兩段 |
| [v0.0.2](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.2) | 2026-08-21 | 在 provider 自己的畫面打的問題會進逐字稿；設定新增等寬字型 |
| [v0.0.1](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.1) | 2026-08-21 | 首次發佈 |

完整內容看各版的 release 說明。


## 文件

| 檔案 | 內容 |
|---|---|
| [`docs/BASICS.md`](../docs/BASICS.md) | 這個 app 怎麼運作。機制說明，不是操作手冊 |
| [`docs/RUN-AND-UPDATE.md`](../docs/RUN-AND-UPDATE.md) | 執行、更新、產生執行檔 |
| [`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md) | 各平台實際驗證到哪 |
| [`docs/RELEASE.md`](../docs/RELEASE.md) | 發佈流程與凍結的發佈政策 |
| [`docs/AGENT-READY-SOURCE-RELEASE.md`](../docs/AGENT-READY-SOURCE-RELEASE.md) | 讓 agent 從原始碼啟動這支 app 的契約 |

`docs/` 有幾份是從來源專案帶過來的，描述的是**它**的產品，與本專案已經開始不同。

## 來源與授權

由 [teddashh/multi-ai-chat-desktop](https://github.com/teddashh/multi-ai-chat-desktop) 衍生的
獨立專案。程式碼在 2026-08-20 從上游的狀態分出來。

MIT，與來源專案相同。原始著作權屬 teddashh，歸屬說明見 [`NOTICE.md`](../NOTICE.md)。

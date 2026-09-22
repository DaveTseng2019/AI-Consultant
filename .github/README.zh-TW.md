[English](./README.md) | **繁體中文**

# AI Consultant

把 ChatGPT、Claude、Gemini、Grok 的**網頁版**並排在同一個桌面視窗裡，一次提問四家同時作答，
也可以把某一家的原生視窗叫到中央，直接在它自己的輸入框個別提問——那一問一答同樣會進逐字稿。
或讓它們依照預設流程接力、互審、辯論。Tauri 2 ＋ React ＋ Rust。

## 沒有 API key

主視窗掛四個子 webview，載入你平常用的那四個網站。送出時不呼叫任何 API，而是**用你已登入的
網頁 session**——把字打進那個網站自己的輸入框、按它自己的送出鈕、再把回答抓回來。

所以帳號、額度、模型版本都是你自己的，沒有金鑰要保管。代價是 **provider 改版就會壞**，
壞掉的地方通常在 `adapters/*.json` 的選擇器。

機制細節（三層構造、bridge、連線狀態、送出路徑）見 [`docs/BASICS.zh-TW.md`](../docs/BASICS.zh-TW.md)。

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

送出後會留下 transcript 與 snapshot，可匯出 Markdown。「重播」是**按提問重跑一次**，
AI 會重新回答，不是回放舊畫面。

snapshot 預設只存在記憶體裡，關掉 app 就沒了。要留到下次開機，得在設定開「持久化 snapshots」，
它會遮蔽後存進本機 app data（不含 cookies 與 provider storage）。存什麼由 redaction tier 決定：
`full-local` 才會把問題與 AI 回覆都以明文留下；`prompt-text` 只留問題明文，回覆存雜湊；
`metadata-only` 與 `hashes` 不留文字，重播時要自己把問題再打一次。

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
建 release 版、可攜版、agent 腳本啟動法見 [`docs/RUN-AND-UPDATE.zh-TW.md`](../docs/RUN-AND-UPDATE.zh-TW.md)。

資料目錄在 `%APPDATA%\tw.micasa.aiconsultant`，四家各自獨立的登入 profile 都在裡面。

## 現況

repo 裡的版號永遠是 `0.0.0`，真正的版號由 CI 從 tag 注入。app 可以檢查有沒有新版。
安裝版只會把你帶到下載頁；可攜版可以就地更新自己——下載新版、蓋掉自己那個資料夾、重新開啟。

Windows x64 是實機驗證過的平台；macOS Apple Silicon 只有部分驗證（ad-hoc 簽章，Grok 曾卡在
Cloudflare 驗證）；Linux 跑得起來：v0.0.17 在真正的 Linux
桌面 session 裡操作過，但那個 session 是 WSLg，跑的也是本機建置而不是 CI 掛上去的 `.AppImage`——
實體機器仍然沒有任何回報。詳見
[`docs/COMPATIBILITY.zh-TW.md`](../docs/COMPATIBILITY.zh-TW.md)。

回報漏洞請走 GitHub Security 的私人表單，不要開公開 issue：[`SECURITY.md`](../SECURITY.md)。

## Grok 的特殊狀況

Grok 有四件事是 app 看不到、因此也幫不上忙的，第一次用容易卡住：

1. **Grok 登入選項（Google／X／Apple／郵箱）必需經過啟用，才會生效。**
   只有你在 [x.ai 帳號頁](https://accounts.x.ai/account) 的「登入方法」啟用（連接）過的那幾種，
   才進得了你原本的帳號。每個人啟用的不一樣，所以「我用 Google 登不進去」不一定是 app 的問題。
2. **選 X 登入時，中間會多一頁 X 自己的授權畫面**（`xAI Single Sign-On wants to access…`），
   要按 `Authorize app` 才會回到 Grok。那一頁長得不像 Grok，容易以為走錯地方。
3. **登入或註冊完成後，Grok 會在對話裡問一次出生年份。** 不是彈窗、不是驗證頁，就是一則訊息，
   所以 app 分不出來：卡片照樣顯示「就緒」，但你送出的問題換回來的會是那句年齡詢問，
   而且串行的模式會把它當材料往下傳。把 Grok 置中、切到**真實頁面**答完那一題就好；
   換新 profile 或重新登入要再答一次。
4. **第一次註冊時 停在「開啟中…」不動，代表這一頁還沒回報過登入狀態，不代表你沒登入。**
   按卡片上方的「前往登入」，或把 app 關掉重開，多半就會轉成就緒。

未登入的 Grok 被放到中央舞台時，畫面上會直接顯示第 1、3、4 點；
完整說明在 [`docs/BASICS.zh-TW.md`](../docs/BASICS.zh-TW.md)。

## 文件

| 檔案 | 內容 |
|---|---|
| [`CHANGELOG.zh-TW.md`](../CHANGELOG.zh-TW.md) | 每一版改了什麼 |
| [`docs/BASICS.zh-TW.md`](../docs/BASICS.zh-TW.md) | 這個 app 怎麼運作。機制說明，不是操作手冊 |
| [`docs/RUN-AND-UPDATE.zh-TW.md`](../docs/RUN-AND-UPDATE.zh-TW.md) | 執行、更新、產生執行檔 |
| [`docs/COMPATIBILITY.zh-TW.md`](../docs/COMPATIBILITY.zh-TW.md) | 各平台實際驗證到哪 |
| [`docs/RELEASE.zh-TW.md`](../docs/RELEASE.zh-TW.md) | 發佈流程與凍結的發佈政策 |
| [`docs/AGENT-READY-SOURCE-RELEASE.zh-TW.md`](../docs/AGENT-READY-SOURCE-RELEASE.zh-TW.md) | 讓 agent 從原始碼啟動這支 app 的契約 |

`docs/` 有幾份是從來源專案帶過來的，描述的是**它**的產品，與本專案已經開始不同。

## 來源與授權

由 [teddashh/multi-ai-chat-desktop](https://github.com/teddashh/multi-ai-chat-desktop) 衍生的
獨立專案。程式碼在 2026-08-20 從上游的狀態分出來。

MIT，與來源專案相同。

Copyright © 2026 Ted Huang (teddashh) — multi-ai-chat-desktop 的原始作者。
Copyright © 2026 Dave Tseng — 本分支的修改。

授權全文見 [`LICENSE`](../LICENSE)，歸屬說明見 [`NOTICE.md`](../NOTICE.md)。

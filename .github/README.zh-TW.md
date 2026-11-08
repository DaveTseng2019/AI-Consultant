[English](./README.md) | **繁體中文**

# AI Consultant

AI Consultant 把 ChatGPT、Claude、Gemini、Grok、Meta AI 的**網頁版**放進同一個桌面視窗。你問一次，各家同時回答。
你也可以把其中一家放大到中央，直接在它自己的輸入框提問。這樣的問答一樣會記進對話紀錄。
另外還有幾種模式，讓各家 AI 依照固定流程接力回答、互相審查或辯論。技術架構是 Tauri 2 ＋ React ＋ Rust。

## 不需要 API key

主視窗裡有五個內嵌的瀏覽器畫面，各自開啟你平常用的那五個網站。送出問題時，程式不呼叫任何 API。
它使用你**在網頁上已經登入的帳號**：把問題打進該網站的輸入框，按它的送出鈕，再把回答抓回來。

因此帳號、額度與模型版本都是你自己的，也沒有金鑰要保管。缺點是**網站改版，程式就可能失效**。
失效的地方通常是 `adapters/*.json` 裡的選擇器。

運作方式的細節（三層架構、bridge、連線狀態、送出流程）請看 [`docs/BASICS.zh-TW.md`](../docs/BASICS.zh-TW.md)。

## 六種模式

| 模式 | 流程 |
|---|---|
| 自由模式 | 同時問勾選的幾家，各自獨立回答 |
| 多方諮詢 | 最多三家先回答 → 匿名互審 → 總結 |
| 四方辯證 | 正方 → 反方 → 判官 → 總結 |
| Coding 模式 | 規劃 → 審查 → 實作 → 測試 → 驗收（共 8 步） |
| 道理辯證 | 4 個席位，辯證 5 輪 |
| 腦力激盪 | 5 個階段，共 12 輪、48 次發言 |

除了自由模式，其他模式都依序進行。**後面的步驟會參考前面各家的回答**，這是它們和自由模式最大的差別。

每個角色由哪一家 AI 擔任，可以在設定裡更改。目前誰擔任哪個角色，看「傳送給已選的 AI」那一列：每家的 logo 旁邊會標出角色名稱。
在多方諮詢模式，你也可以直接在那一列取消或加回回答者與總結者。
設定裡可以選一家當**替補 AI**。某個角色的 AI 沒有登入或還沒就緒時，替補 AI 會自動接手。

送出問題後，程式會保留對話紀錄（transcript）與執行紀錄（snapshot），對話可以匯出成 Markdown。
「重播」會**用同一個問題重新問一次**，各家 AI 會重新回答。它不是播放舊的畫面。

執行紀錄預設只放在記憶體裡，關掉 app 就消失。要保留到下次開啟，請在設定裡開啟「把執行紀錄存到硬碟」。
程式會先遮蔽內容，再存到本機的 app data 資料夾（不存 cookies，也不存各網站的瀏覽器儲存資料）。
保留多少內容，由遮蔽等級決定：

- `full-local`：問題與 AI 的回答都以原文保存。
- `prompt-text`：只保存問題原文，回答只存雜湊值。
- `metadata-only` 與 `hashes`：不保存任何文字。重播時，你要自己再輸入一次問題。

## 安裝

到 [Releases](https://github.com/DaveTseng2019/AI-Consultant/releases/latest) 下載對應的檔案：

- Windows：安裝檔，或免安裝的可攜版 zip
- macOS（Apple Silicon）：`.dmg`
- Linux：`.AppImage`

程式沒有數位簽章，第一次開啟時系統會跳出警告，這是正常的。各平台怎麼允許執行，寫在每一版的發佈說明裡。

## 從原始碼執行

需要先安裝：

- Node.js `^22.13.0 || >=24.0.0`
- pnpm 11（執行 `corepack enable`）
- Rust stable（Windows 另外需要 MSVC Build Tools 的「Desktop development with C++」）
- WebView2（Windows 10/11 通常已經內建）

```sh
pnpm install
pnpm build:injected   # 產生注入腳本，不能省
pnpm tauri dev        # 第一次 Rust 編譯較久
```

修改程式後，執行 `pnpm verify`。它會跑型別檢查、lint、測試、agent 契約檢查與 adapter 檢查。
建置正式版與可攜版，以及用 agent 腳本啟動的方法，請看 [`docs/RUN-AND-UPDATE.zh-TW.md`](../docs/RUN-AND-UPDATE.zh-TW.md)。

資料存放在 `%APPDATA%\tw.micasa.aiconsultant`。五家 AI 各自獨立的登入資料都在這個資料夾裡。

## 目前狀態

repo 裡的版號固定是 `0.0.0`。正式的版號由 CI 在建置時依照 tag 寫入。

app 可以檢查有沒有新版本：

- Windows 版可以自動更新。安裝版會下載並執行新的安裝檔；可攜版會下載新版，覆蓋自己所在的資料夾。兩者更新完都會重新開啟。
- macOS 與 Linux 版只會開啟下載頁面。

在「設定 → 更新」裡，可以讓 app 每次啟動時自動檢查新版本。
Windows 版還可以在找到新版本時直接開始更新，關閉程式前會先請你確認。

各平台的驗證程度：

- Windows x64：已在實機上驗證。
- macOS Apple Silicon：只驗證了一部分（使用 ad-hoc 簽章；Grok 曾經卡在 Cloudflare 驗證）。
- Linux：可以執行。v0.0.17 曾在 Linux 桌面上實際操作過，但那是 WSLg 環境，用的也是本機建置的版本，不是 CI 產生的 `.AppImage`。目前還沒有任何實體 Linux 電腦的使用回報。

詳細內容請看 [`docs/COMPATIBILITY.zh-TW.md`](../docs/COMPATIBILITY.zh-TW.md)。

如果發現安全漏洞，請用 GitHub Security 的私人表單回報，不要開公開的 issue。說明請看 [`SECURITY.md`](../SECURITY.md)。

## Grok 的特殊狀況

下面四件事，app 偵測不到，也就無法幫你處理。第一次使用 Grok 時很容易卡在這裡：

1. **Grok 的登入方式（例如 Google、X、Apple、GitHub、email）必須先啟用才有效。**
   請到 [x.ai 帳號頁](https://accounts.x.ai/account) 的「登入方法」查看。你啟用（連接）過哪幾種，就只能用那幾種登入原本的帳號。
   每個人啟用的方式不同。所以「用 Google 登不進去」，不一定是 app 的問題。
2. **用 X 登入時，中間會多出一頁 X 的授權畫面**（`xAI Single Sign-On wants to access…`）。
   要按 `Authorize app` 才會回到 Grok。那一頁看起來不像 Grok，很容易讓人以為走錯了。
3. **登入或註冊後，Grok 會在對話裡問一次你的出生年份。**
   這個問題不是彈出視窗，也不是驗證頁面，只是一則一般訊息，所以 app 分辨不出來。
   卡片仍然會顯示「就緒」，但你送出問題後，得到的回答會是這個年齡問題。依序進行的模式還會把它當成參考，傳給下一步。
   解決方法：把 Grok 放大到中央，切換到**真實頁面**，回答這個問題。換新的登入資料或重新登入後，要再回答一次。
4. **第一次註冊後，卡片可能一直停在「開啟中…」。**
   這表示這一頁還沒回報登入狀態，不代表你沒有登入。
   按卡片上方的「前往登入」，或關掉 app 再重新開啟，通常就會變成「就緒」。

還沒登入的 Grok 被放到中央時，畫面上會直接顯示第 1、3、4 點。
完整說明請看 [`docs/BASICS.zh-TW.md`](../docs/BASICS.zh-TW.md)。

## 文件

| 檔案 | 內容 |
|---|---|
| [`CHANGELOG.zh-TW.md`](../CHANGELOG.zh-TW.md) | 每一版的變更 |
| [`docs/BASICS.zh-TW.md`](../docs/BASICS.zh-TW.md) | 這個 app 的運作原理（不是操作手冊） |
| [`docs/RUN-AND-UPDATE.zh-TW.md`](../docs/RUN-AND-UPDATE.zh-TW.md) | 執行、更新、建置執行檔 |
| [`docs/COMPATIBILITY.zh-TW.md`](../docs/COMPATIBILITY.zh-TW.md) | 各平台實際驗證的程度 |
| [`docs/RELEASE.zh-TW.md`](../docs/RELEASE.zh-TW.md) | 發佈流程與目前固定的發佈規則 |
| [`docs/AGENT-READY-SOURCE-RELEASE.zh-TW.md`](../docs/AGENT-READY-SOURCE-RELEASE.zh-TW.md) | 讓 agent 從原始碼啟動這個 app 的約定 |

`docs/` 裡有幾份文件是從來源專案帶過來的。那些文件寫的是**來源專案**，內容和本專案已經有差異。

## 來源與授權

本專案衍生自 [teddashh/multi-ai-chat-desktop](https://github.com/teddashh/multi-ai-chat-desktop)，是一個獨立的專案。
程式碼在 2026-08-20 從上游分出來。

授權採用 MIT，與來源專案相同。

Copyright © 2026 Ted Huang (teddashh) — multi-ai-chat-desktop 的原始作者。
Copyright © 2026 Dave Tseng — 本專案的修改。

授權全文請看 [`LICENSE`](../LICENSE)，歸屬說明請看 [`NOTICE.md`](../NOTICE.md)。

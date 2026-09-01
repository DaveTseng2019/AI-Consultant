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
建 release 版、可攜版、agent 腳本啟動法見 [`docs/RUN-AND-UPDATE.md`](../docs/RUN-AND-UPDATE.md)。

資料目錄在 `%APPDATA%\tw.micasa.aiconsultant`，四家各自獨立的登入 profile 都在裡面。

## 現況

repo 裡的版號永遠是 `0.0.0`，真正的版號由 CI 從 tag 注入。app 可以檢查有沒有新版。
安裝版只會把你帶到下載頁；可攜版可以就地更新自己——下載新版、蓋掉自己那個資料夾、重新開啟。

Windows x64 是實機驗證過的平台；macOS Apple Silicon 只有部分驗證（ad-hoc 簽章，Grok 曾卡在
Cloudflare 驗證）；Linux 目前只有 CI 建置，沒有實機回報。詳見
[`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md)。

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
完整說明在 [`docs/BASICS.md`](../docs/BASICS.md)。

## 版本異動

| 版本 | 日期 | 異動 |
|---|---|---|
| [v0.0.14](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.14) | 2026-09-01 | 視窗標題會說程式在做什麼：連線 AI 或跑工作流程的時候，標題的名稱暫時被目前那一步取代，縮到工作列也看得到，閒著才寫回 AI Consultant；設定裡多了「啟動時視窗最大化」，改了下次啟動生效；開發版的標題尾巴多一個 DEV，而且開發版與正式版現在可以同時開著（以前正式版開著時啟動開發版，會變成把正式版叫到前面然後自己結束） |
| [v0.0.13](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.13) | 2026-08-31 | 可攜版會自己更新自己：設定裡按「下載並自動更新」，程式關閉、下載新版、蓋掉自己這個資料夾再重新開啟，不必再開瀏覽器解壓縮手動覆蓋，失敗時會把舊版叫回來並打開 update-log.txt 說明卡在哪一步；zip 裡的資料夾也拿掉版號固定叫 ai-consultant-windows-portable，以免每更新一次就在旁邊多一份拷貝（已經在用 v0.0.12 可攜版的人這一次仍要手動更新一次，那支還沒有這顆按鈕）；按「新對話」不再把模式重設回自由模式，在哪個模式底下按，開出來的就是哪個模式 |
| [v0.0.12](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.12) | 2026-08-31 | 左邊的對話紀錄可以拖曳調整寬度；舞台的放大鈕現在任何狀態按一次就蓋掉模式列 |
| [v0.0.11](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.11) | 2026-08-31 | 按「新對話」不再把四家 provider 的頁面整個重新連線，改成按網站自己的「新對話」控制項換頁，登入狀態與已注入的橋接都留著，第二次送出可以直接開始；只有找不到那個控制項、或三秒內沒換到新對話網址時，才退回原本的重新載入 |
| [v0.0.10](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.10) | 2026-08-30 | 工具列上自己加的腳本按鈕自從指令改名之後每按必錯，兩支範例都走同一條路，所以一起壞掉，這一版修好；要「本次執行紀錄」的按鈕在沒有紀錄可傳時直接變灰，滑鼠滑過去說明原因——紀錄只留在記憶體裡，還原舊對話或重開 app 之後就沒有了；匯出不再散在兩個地方，檔名蓋的是對話開始的時間而不是按下按鈕的時間，同一則對話匯出兩次是覆寫同一個檔，存檔對話框開在上次匯出的資料夾，交給腳本的 .md 也放同一處，不再丟進會被清掉的暫存資料夾；每則回答的標題改用該家自己的標誌，圖檔內嵌在檔案裡所以離線讀也看得到，其他發言者則從機器人改成大腦 |
| [v0.0.9](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.9) | 2026-08-29 | provider 舞台的「放大」改成把上方模式選單那塊空間讓出來給舞台，而不是讓 provider 畫面蓋在它上面——只有使用者自己按的那次才讓，未登入時舞台自動放大仍保留模式選單；輸入框下方新增一行說明：插入檔案只收程式碼等文字檔，圖片請在輸入框按 Ctrl + V 或 Alt + V 貼上，這件事原本只有選錯檔案後的錯誤訊息會講 |
| [v0.0.8](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.8) | 2026-08-29 | 工具列的自訂腳本按鈕變成一張清單——名稱、腳本、註解、按下時傳什麼（不傳／本次執行紀錄／本次對話的 .md）與是否先確認，可排序、數量不限，舊設定會自動變成第一列；新增「只允許開一份」，重複啟動改為叫出現有視窗；設定按鈕移到啟動時不會隱藏的「AI 連線」那一列，設定頁的分區標題放大並提高亮度；模式選單只在處理問題時隱藏；examples/custom-actions/ 附上自訂按鈕的範例與說明 |
| [v0.0.7](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.7) | 2026-08-29 | 「執行腳本」按鈕在持久化 snapshots 關閉時也能用：以 full-local 臨時寫一份給腳本讀，跑完刪掉（已實測）；每個 provider 名稱旁都加上標誌，涵蓋對話、provider 視窗標題、診斷卡片與事件紀錄、存取範圍面板；模式選單只在處理中或視窗放大時隱藏；存取範圍從四份相同的說明改成一份共用 |
| [v0.0.6](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.6) | 2026-08-28 | 截圖可直接從剪貼簿貼進問題一起送出（Grok 已實測）；「傳送已選的 AI」在每個模式都看得到，角色決定參與者的模式以已勾選但不可更改的樣子顯示 |
| [v0.0.5](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.5) | 2026-08-28 | Grok 中途去搜尋時不再只收下開場白；程式碼方塊補回框線；閒置時點連線 chip 會放大該 provider 的視窗，回答進行中則不放大；設定裡直接看得到目前版本 |
| [v0.0.4](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.4) | 2026-08-27 | 啟動時看得見連線進度，送出對象與狀態訊息不再被收合藏住；按「新對話」不再堆出第二筆空白對話；收起對話紀錄改為選項；可攜版開放更新檢查，下載直指可攜版 zip |
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

MIT，與來源專案相同。

Copyright © 2026 Ted Huang (teddashh) — multi-ai-chat-desktop 的原始作者。
Copyright © 2026 Dave Tseng — 本分支的修改。

授權全文見 [`LICENSE`](../LICENSE)，歸屬說明見 [`NOTICE.md`](../NOTICE.md)。

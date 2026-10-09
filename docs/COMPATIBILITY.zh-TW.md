[English](./COMPATIBILITY.md) | **繁體中文**

# 相容性與人工測試矩陣

> 最後檢視：2026-10-09。最新的實機紀錄是 Windows 的 `v0.0.2`、Linux 的 `v0.0.17`、
> `v0.0.19` 的單項 provider 測試、`v0.0.23` 的 Meta AI 與啟動恢復測試，`v0.0.24` 的 Grok 登入／登出測試，以及 `v0.0.25` 的 Claude 辯證測試；
> 中間那些版本沒有逐項重跑。
>
> 這份文件記錄的是**實際觀察到的證據**，不是保證。provider 的 DOM 與登入流程隨時可能改變，
> 而且下面每一筆實機證據都只來自維護者這一台機器。

## 狀態說明

- **已驗證** — 在指名的平台上實際跑過，或有針對性的自動化測試覆蓋。
- **僅 CI** — GitHub Actions 建得出產物，但沒有任何實機啟動回報。
- **僅 WSLg 驗證** — 在真正的 Linux 桌面 session 裡跑過，但那個 session 是維護者 Windows 機器上的
  WSLg。實體機器仍然沒有任何回報。
- **待驗** — 要有可重複的人工檢查，才能宣稱支援。

## 桌面平台

| 平台 | 打包證據 | 實機啟動 | 狀態 |
|---|---|---|---|
| Windows x64 | NSIS 安裝檔與可攜版；本機開發版與打包版都建得出來 | 見下方 v0.0.2 紀錄 | **已驗證** |
| macOS Apple Silicon | CI 建得出 `.dmg`，並掛載驗證內嵌 `.app` 的 ad-hoc 簽章 | 無 | **僅 CI** |
| Linux x86_64 | CI 用 WebKitGTK 相依建得出 `.AppImage` | 見下方 v0.0.17 紀錄 | **僅 WSLg 驗證** |

macOS 只有 ad-hoc 簽章，不是 Developer ID 簽章、也沒有公證；Windows 產物完全沒有簽章。
兩者都是[凍結的發佈政策](./RELEASE.zh-TW.md)，不是待辦。

### v0.0.2 Windows 實測（2026-08-21）

環境：Windows 11 專業版 `10.0.26200`、WebView2 Runtime `151.0.4129.93`。測的是 CI 產出的
**可攜版**，不是本機建置，也不是 dev。

| 項目 | 結果 |
|---|---|
| 可攜版 zip 結構 | `ai-consultant.exe` ＋ `PORTABLE` 標記檔 ＋ `README-portable.txt` |
| 版號注入 | 兩支 exe 的 FileVersion／ProductVersion 都是 `0.0.2`（repo 釘 `0.0.0`，由 CI 從 tag 注入） |
| Authenticode 簽章 | `NotSigned`，與政策相符 |
| 啟動 | 成功，WebView2 正常載入 |
| 四家 provider 登入 | 全部就緒 |
| 等寬字型設定 | 正常 |
| 原生畫面問答擷取 | 正常 |

尚未驗：NSIS 安裝檔沒有實際安裝過；影像生成、匯出、更新檢查等下方清單的其他項目在這一版
沒有逐項重跑。

**可攜版不會隔離資料。** `PORTABLE` 標記（`src-tauri/src/settings.rs` 的 `portable_marker_exists`）
只用來認出這是可攜版：更新檢查會就地安裝（下載 release 的可攜版 zip、覆蓋這個資料夾、重開），
而不是把人送到安裝檔頁面；debug bundle 也會記下這一欄。設定與登入狀態仍走 `app_data_dir()`，跟安裝版共用同一份。
換一台電腦不會帶著登入狀態走，也會在原本那台留下痕跡。

### v0.0.17 Linux 實測：透過 WSLg（2026-09-06）

環境：WSL2 上的 Ubuntu 24.04.4 LTS（核心 `6.18.35.2-microsoft-standard-WSL2`），畫面透過 WSLg 顯示。
測的是**那個 checkout 裡建出來的 AppImage**（`AI Consultant_0.0.0_amd64.AppImage`——本機建置帶的是
repo 的 `0.0.0`），**不是 CI 掛在 release 上的那個 `.AppImage`**。

| 項目 | 結果 |
|---|---|
| 啟動 | 成功，WebKitGTK 正常載入 |
| 視窗版面 | 各家 AI 的畫面落在程式指定的位置；這一版之前它們會被切成橫帶，app 介面只剩 78 px |
| 在 AI 畫面裡輸入 | 打字與點擊都有作用 |
| 四家同時作答 | 一題四家同時回答，其中三家被收起來 |
| 縮放視窗 | 各家畫面跟著縮放移動 |

未驗證：CI 的 `.AppImage`、實體 Linux 機器、四家 provider 的登入，以及下面產品行為清單裡沒被點到的
每一項。這個修正只動 Linux，Windows 與 macOS 走的還是原本那條路。

### v0.0.19 provider 終止判定實測（2026-09-17）

這一版把交棒的完成判定改嚴：要同一個當前回合、回應全文不再變動、沒有強活動訊號，而且完成標記
連續穩定，才算這一輪結束。**只有 Grok 那一項用真帳號測過**，其餘沒測。

環境：Windows 11 Pro `10.0.26200`，**本機 `pnpm build:local` 建出來的執行檔**（stamp `v0.0.19`），
不是 CI 掛在 release 上的產物。

| 項目 | 結果 |
|---|---|
| Grok Heavy 不早退 | **通過**——開場白之後不會結束，等到完整答案才進逐字稿 |
| ChatGPT 生成中拒絕再送 | **未測** |
| ChatGPT 多階段輸出不早退 | **未測** |
| Grok 卡住時的 webview 重建復原 | **未測**（要真的卡住超過看門狗視窗才觸發得到） |

未驗證：上面標「未測」的三項、CI 產物本身（沒有下載 release 的檔案跑過）、macOS 與 Linux 上的
同一組行為，以及產品行為清單裡沒被點到的每一項。

> 這一版另外修掉一個只有本專案會踩到的問題：上游把完成判定改寫成 ChatGPT 專用，但入口仍依
> provider 查表，而本專案的表另有 Grok 一項。沒修的話 Grok 永遠不會完成。上面那一列就是修好
> 之後的實測結果。

### v0.0.25 Claude 回答與四方辯證（2026-10-09）

這一版改從 Claude 新的網頁結構讀取回答，並新增取回遲到回答的方法。由維護者手動檢查。

環境：Windows 11 Pro `10.0.26200`，**開發建置（`pnpm tauri dev`）**，不是掛在 release 上的 CI 產物。

| 項目 | 結果 |
|---|---|
| 四方辯證的 Claude 反方自動完成，裁判與總結接著執行 | **通過**（開發建置，2 輪）。修正前等 10 分鐘後失敗 |
| 抓到的 Claude 回答結束在它真正的最後一句 | **通過**（開發建置）。修正前結尾多了時間「現在」 |
| 步驟等待時，標題列的「已回應」 | **通過**（開發建置） |
| 文字出現前就按「已回應」：流程暫停，不會結束 | **通過**（開發建置） |
| 取回步驟失敗後才出現的回答 | **僅自動化測試**。真實頁面上只看到「沒有更新的回答」那一支 |
| 啟動時 Claude、Gemini 顯示「開啟中…」並保留辯證角色 | **僅自動化測試** |
| 視窗最大化與還原時維持左右欄比例 | **僅自動化測試** |
| 啟動時視窗置中並完整落在可用範圍內 | **通過**（開發建置，1920×1032 可用範圍：四邊留白 312／312／96／97）。比預設尺寸小的螢幕**僅自動化測試** |
| Ctrl+C 停止執行中的流程 | **僅自動化測試** |
| macOS 與 Linux | 這一版**未測試** |

頁面上看到的結構（2026-10-09，來自 engine 自己的探針）：沒有任何元素帶 `.font-claude-response`；
回答是 `[data-testid="assistant-message"]`，內文在其中的 `.standard-markdown`，旁邊是 `[data-testid="user-message"]`。

### v0.0.24 Grok 登入與登出（2026-10-01）

這一版讓 Grok 的登入與登出都在 app 裡完成，並移植上游針對 ChatGPT 新 Chat/Work 版面的修正。
由維護者手動檢查。

環境：Windows 11 Pro `10.0.26200`，**用 `pnpm build:local` 在本機建置的執行檔**，程式碼與發佈 commit 相同
（版本戳記 `v0.0.23-1-ga404bc8`，含未提交的修改），不是掛在 release 上的 CI 產物。

| 項目 | 結果 |
|---|---|
| 在 app 內用 Google 帳號登入 Grok | **通過**（本機 release 建置）。修正前會開外部瀏覽器、要重選一次帳號（2026-10-01 觀察，開發建置） |
| 在 app 內登出 Grok | **通過**（本機 release 建置）。修正前會開外部瀏覽器、把那個瀏覽器登出，並用新 token 無限重試（2026-10-01 觀察，開發建置） |
| ChatGPT 長回答在新 Chat/Work 版面下能完成 | **僅自動化測試** |
| 新版面下偵測到沒登入的 Grok | **僅自動化測試** |
| macOS 與 Linux | 這一版**未測試** |

修正放行的範圍：只有 `auth.x.ai` 與 `auth.cursor.com` 的「設定／清除 cookie」步驟
（`/set-cookie`、`/delete-cookie`）。`auth.x.ai/oauth/authorize` 仍刻意走系統瀏覽器。
Grok 的流程會經過 `auth.cursor.com` 是**推論**：來自一次網路搜尋（Grok Bot 使用 Cursor 帳號）與被擋網址的追蹤紀錄，
沒有任何官方頁面明說。

已知現象，未調查：開發建置（`pnpm tauri dev`）時，滑鼠游標在視窗上方會看不到；release 建置不受影響。

### v0.0.23 Meta AI 與啟動恢復實測（2026-09-29）

這一版加入第五家 Meta AI，新增替補 AI 接手沒就緒的角色，多方諮詢加入第三位回答者與匿名審查，並修掉三個啟動恢復的問題。由維護者實際操作。

環境：Windows 11 Pro `10.0.26200`，**準備發佈期間本機 `pnpm build:local` 建出來的執行檔**
（最後一支 stamp `v0.0.22-48-ge2bdecb`，建置時帶著尚未提交的改動，內容等同 `5f96368`），不是 CI 掛在 release 上的產物。

| 項目 | 結果 |
|---|---|
| 在 app 內登入 Meta AI | **通過** |
| 自由模式同時問 ChatGPT、Grok、Meta AI 一個長問題 | **通過**——三家都回答完整，流程自己結束 |
| Meta AI 放在中央，重開後自動開啟 | **通過**——修正前失敗，追蹤紀錄顯示恢復時被跳過 |
| 重開後「傳送給已選的 AI」裡 Meta AI 保持勾選 | **通過** |
| 重開多次後，原本開著的 AI 都還開著 | **通過**——修正前追蹤紀錄顯示啟動期間會寫入不完整的 `openProviders`，修正後沒有；另外正常關閉重開多次確認 |
| 「AI 連線」卡片排成一列 | **通過** |
| 協作角色的「預設值」按鈕 | **通過** |
| 選擇替補 AI 立即寫入 | **僅自動化測試** |
| 多方諮詢：ChatGPT、Grok、Meta AI 同時回答，Claude 審查，Gemini 總結 | **通過**（dev 版） |
| 多方諮詢：在「傳送給已選的 AI」取消與加回回答者、總結，以及「預設值」按鈕 | **通過**（dev 版） |
| 角色模式的按鈕只顯示 logo 與角色 | **通過**（dev 版） |
| ChatGPT 分數公式抓成「(分子) / 分母」 | **通過**（dev 版） |
| 審查者只以代號稱呼各份回答 | **僅自動化測試** |
| 替補 AI 接手沒登入的角色 | **僅自動化測試**——實測時五家都已登入，沒有觸發 |
| 第三位或總結的 AI 沒就緒時自動略過 | **僅自動化測試** |
| Claude、Gemini 在自由模式實際回答問題 | **未測**——兩家在多方諮詢裡有回答 |
| 把 Meta AI 或替補 AI 指派到多方諮詢以外的角色模式（四方辯證、Coding、道理辯證、腦力激盪）跑完一輪 | **未測** |

標示「dev 版」的項目是在 `pnpm agent:launch` 啟動的開發版上測的，程式碼等同發佈的 commit，
但不是打包後的執行檔。

未驗證：上表標示的項目、CI 產物本身，以及 macOS 與 Linux。

## Agent 原始碼啟動通道

| 證據 | Windows | macOS / Linux | 狀態 |
|---|---|---|---|
| manifest／schema 與 Skill 漂移測試 | `pnpm agent:verify` 21 項本機通過 | 同一組測試在三個 CI 作業系統上通過 | 原始碼契約**已驗證**；GUI 啟動另計 |
| doctor／audit／dry-run JSON | 本機跑過，dry-run 不寫入任何執行期狀態 | Node 契約路徑在三個 CI 作業系統上通過 | Windows **已驗證**；其餘**僅 CI** |
| app 層級的 READY 等待 | 本機多次 `agent:launch --wait` 取得同一次執行、身分已驗證的 READY 標記 | 無實機回報 | Windows **已驗證**；其餘**待驗** |
| 啟動／停止的競態安全 | 實測釋放了 fail-closed 的啟動 mutex；stop 在 kill 與刪除同執行狀態前重新驗證身分；foreign／EPERM 測試通過 | 同一段程式碼，未實際操作 | Windows **已驗證**；其餘**待驗** |
| 損毀狀態的復原 | 預設的 stop 拒絕格式錯誤的狀態檔並保留它；`--clear-invalid-state` 只刪狀態檔，之後正常啟停 | 未實際操作 | Windows **已驗證**；其餘**待驗** |

Agent 契約不宣稱 CI 顯示過視窗。它也不安裝宿主前置、不盤點作業系統、不沙箱化 checkout 的程式碼、
不上傳收據、不回滾宿主變更。見 [`AGENT-READY-SOURCE-RELEASE.zh-TW.md`](./AGENT-READY-SOURCE-RELEASE.zh-TW.md)。

v2.0.0 的原始碼契約支援 Node.js `^22.13.0 || >=24.0.0`，對應鎖定的 pnpm 與 lint 工具鏈。
`agent:doctor` 會擋掉不支援的 Node 版本並停下來，而不是把無效的啟動當成就緒。
這個需求只影響原始碼開發，打包版使用者不需要 Node.js。

## Provider adapter

| Provider | 內建 adapter | 自動化覆蓋 | 實機證據 |
|---|---:|---|---|
| ChatGPT | v9 | 結構、logged-out 優先序、完成標記、ProseMirror 輸入框 | v0.0.2 打包版登入就緒；v0.0.23 本機建置長問題回答完整 |
| Claude | v4 | 結構、登入頁偵測、明確的 Google SSO 範圍、engine 補上的新版回答標記 | v0.0.2 打包版登入就緒；v0.0.25 開發建置完成辯證步驟 |
| Gemini | v2 | 結構、Google `/sorry` 的有界導航與 blocked 狀態 | v0.0.2 打包版登入就緒，原生畫面問答擷取正常 |
| Grok | v9 | 結構、challenge 優先的延後接手、watchdog 復原、challenge 期間拒絕變更 DOM | v0.0.2 打包版登入就緒 |
| Meta AI | v3 | 結構、窄範圍 seed 合約、可用輸入框即視為登入、被鎖住的輸入框維持未登入 | v0.0.23 本機建置登入並回答 |

自動化測試驗證 adapter 結構、schema v1／v2 解析相容性、型別化 detector 的拒絕、logged-out 優先序、
許可的策略、HTTPS URL 解析與導航邊界。它們**不會**登入真實帳號。遠端 adapter 更新無法擴張
安裝版內建的 URL 範圍。

app 不繞過登入、年齡、訂閱、challenge 或任何 provider 端的要求；指派了某家席次的引導式流程，
會一直卡住直到那家回報輸入框就緒。

Gemini 可能把內嵌 session 導去 `https://www.google.com/sorry/index?...`。目前的程式只允許
Gemini 走 HTTPS 的 `www.google.com/sorry` 路徑族，把它回報為 blocked 而不是已登入，在那裡跳過
permission shim，並延後 bridge 啟動直到 Google 導回 Gemini。兄弟路徑、相似網域、非 HTTPS 的
URL 與跨 provider 使用一律拒絕。實際完成一次 challenge 仍待人工驗證。

Grok 的 Cloudflare challenge：單一原子化的 driver 會在改變 provider 狀態或建立 bridge 之前，
一次讀完共用的 Cloudflare／hCaptcha 標題、內文與標記訊號，再透過頁面載入事件與宿主 watchdog
重試未解決與被擋下的文件。已知的 challenge 標題含正體中文的「安全驗證」。已經在跑的 engine
會在 challenge 期間拒絕 fill、send 與 stop。關閉允許清單內的 Grok 登入彈窗可以保留一次同文件的
原生重載；owner／epoch 閘門、關閉時失效、回滾與有界的導航起始租約，防止重複或永久卡死的復原，
過程中不會對被擋下的文件求值。**app 不會自動化或繞過 challenge。**

## 產品行為

下表的「自動化證據」全部來自本 repo 的測試套件（`pnpm test` 534 項、`pnpm agent:verify` 21 項、
`cargo test` 91 項，2026-09-11 全綠）。「發佈前人工檢查」是清單，不是已完成的紀錄——
上面兩節實測才是紀錄，而且只涵蓋它們點名的項目。

| 範圍 | 自動化證據 | 發佈前人工檢查 |
|---|---|---|
| 自由模式 | 四家 fan-out 測試 | 送給所有選定的 provider，確認每一家的最終回應 |
| 辯證／諮詢／coding | 標準流程圖順序、提示串接、四家預設指派、provider 不可用的 preflight、可設定的角色、有界重試、終端錯誤 | 跑完一次預設流程，確認角色標籤與最終總結 |
| 道理辯證 | 五輪四席歷史、四家預設覆蓋、可設定指派、重複席次 preflight | 跑完一次，確認同一 session 稍早的發言仍可取用 |
| Brainstorm | 12 輪 × 4 席輪轉、四家預設、四種視角、48 步歷史串接、五段階段提示、preflight、在地化、快照 | 預留 45～90 分鐘，確認每輪四則貢獻與最後一位的整合成果 |
| 長時間作答 | thinking、pull 到的片段、bulk-ready、done-ready 都會刷新 10 分鐘無活動視窗；ChatGPT 完成標記測試涵蓋超過 10 分鐘的持續思考並在真正停止後 fail closed；另有 60 分鐘硬上限 | 跑一個超過 10 分鐘的任務，再確認真的卡住的任務仍會結束 |
| Session 隔離 | 對話持久化與最新快照比對 | 建兩個 session，確認訊息與匯出出處不互相污染 |
| 還原 session 的延續性 | 穩定的回應識別與有界的同 session 重播 | 重開一個 session 追問，確認舊脈絡可用且不跨 session 外洩 |
| 回應保真度 | DOM 轉 Markdown：段落、巢狀清單、連結、圍籬程式碼、直接與巢狀表格、純圖片 fallback、完成時的修訂與縮短、延遲的渲染批次、程式碼裡的字面取代樣式 | 比對一則含程式碼與表格、慢慢完成的回答，確認最終 DOM 與逐字稿一致 |
| 原生畫面問答擷取 | 輸入框清空視為送出、thinking 或新回答節點二擇一確認、手動清稿不採用 | 直接在 provider 自己的輸入框打字送出，確認問題與回答都進逐字稿 |
| 逐字稿捲動 | 接近底部與使用者捲動意圖；捲動連動的 provider 焦點、resize／回流重算、首則訊息前的邊界、二分查找、最大化工作區 | 串流一則長回答，往上捲、改變視窗大小、最大化再還原，確認 provider chip 與閱讀位置穩定 |
| Session 配額復原 | 只因配額驅逐、暫時性失敗保留、持久化狀態結果 | 把本機歷史填到接近配額，確認只有最舊的 session 被移除 |
| 快照／重播 | schema、遮蔽、版本不符、重播、app 版號 | 啟用本機快照持久化後存檔並重播一次 |
| Markdown 匯出 | 格式與出處 | 確認 UTC 時間、app 版號、最新的相符流程／快照與 adapter 版號 |
| HTML 匯出（v0.0.19） | 與 `.md` 同一份標題與出處；終端機框線表格、壓成一行的 markdown 表格、獨立成塊的「項目：值」都還原成 `<table>`；檔名為「日期 + 對話標題」 | 匯出一段含表格的對話，用瀏覽器開，確認畫出表格、標誌正確、檔名帶日期與標題 |
| 匯出裡的圖表（v0.0.16） | 各家分別取原始碼：ChatGPT 與 Grok 從 React props、Gemini 讀開頭關鍵字、Claude 從回答元素；讀不到原始碼時一律丟掉那個區塊，不匯出周邊的介面文字 | 請四家各畫一張 Mermaid 圖，確認匯出的 `.md` 裡是原始碼，不是 provider 自己的按鈕文字。實測一份跑過的紀錄：133 張圖有 121 張畫得出來，剩下 12 張是模型自己寫錯語法 |
| AI 交給你的檔案（v0.0.16） | provider webview 接受下載；下載完成後讀回檔案內容，上限 512 KB 且只收有效的 UTF-8 | 按 provider 自己的 Download，確認訊息有說存到哪裡；文字檔要確認以「AI 名稱 · 檔名」進到對話並出現在匯出的 `.md`。圖片或壓縮檔只報路徑 |
| Adapter 熱更新 | Rust 驗證、版本閘門、快取、URL 範圍 | 在允許的 host 範圍內用一份版號更高的測試 adapter |
| 控制台安全性 | capability 與 CSP 設定 | 確認打包版的「設定 → 檢查更新」與匯出仍能運作 |

## 發佈前的人工冒煙清單

1. 在乾淨的環境安裝或啟動該平台的產物。
2. 盡量用非敏感的測試帳號登入每一家。Claude 走它官方的 Google 或 email 流程；輸入框沒出現之前
   不要當它就緒。Windows 上完成 Grok 登入後關掉它的內嵌彈窗，確認被擋下的面板會自己重載一次
   並轉為就緒，不需要手動重載。macOS 上要明確確認 Grok 離開 Cloudflare 驗證頁，才能說這一版驗過。
3. 確認提示插入、自動送出、thinking 狀態、文字完成與新 session 重置。
4. 跑一次自由模式與一個串行模式，並取消一次進行中的執行。
5. 在支援的 provider 上生成一張圖，確認流程不靠純文字輸出也能走完。
6. 匯出 Markdown 檢查出處；開一個新的 app session，確認歷史彼此隔離。請 AI 畫一張 Mermaid 圖，
   確認原始碼進到匯出檔；按一次 provider 自己的 Download 按鈕，確認有報出存檔路徑，
   而且文字檔也進到對話裡。
7. 安裝版：開設定、檢查更新、切換主題與介面語言、看作者／贊助連結。可攜版：確認「下載並自動更新」
   會關掉 app、換掉資料夾並重新開啟；失敗時要看到舊版被叫回來並跳出 `update-log.txt`。
   `README-portable.txt` 也要連到最新的 GitHub Release。回應語言設為 Auto 時，確認英文問題得到
   英文、正體中文問題得到正體中文，與介面語言無關；再驗一次固定語言的選擇。特別確認 Grok 是
   回答問題，而不是把內部的 `<response-language-policy>` 區塊照抄出來。
8. 只有在失敗時才匯出經過清理的 debug bundle；絕不附上機密或原始的 provider 頁面內容。

## 回報方式

若你有 macOS 或 Linux 實機，最有價值的回報是：OS/CPU、app 版本、安裝方式、是否能第一次開啟、
四家 provider 的登入／自動送出／完成偵測，以及不含私人內容的 debug bundle。Adapter 問題請使用
GitHub 的 **Adapter broken** 表單；安全問題請依 [`SECURITY.md`](../SECURITY.md) 私下回報。

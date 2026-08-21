# 相容性與人工測試矩陣

> 最後檢視：2026-08-21，對應 `v0.0.2`。
>
> 這份文件記錄的是**實際觀察到的證據**，不是保證。provider 的 DOM 與登入流程隨時可能改變，
> 而且下面每一筆實機證據都只來自維護者這一台機器。

## 狀態說明

- **已驗證** — 在指名的平台上實際跑過，或有針對性的自動化測試覆蓋。
- **僅 CI** — GitHub Actions 建得出產物，但沒有任何實機啟動回報。
- **待驗** — 要有可重複的人工檢查，才能宣稱支援。

## 桌面平台

| 平台 | 打包證據 | 實機啟動 | 狀態 |
|---|---|---|---|
| Windows x64 | NSIS 安裝檔與可攜版；本機開發版與打包版都建得出來 | 見下方 v0.0.2 紀錄 | **已驗證** |
| macOS Apple Silicon | CI 建得出 `.dmg`，並掛載驗證內嵌 `.app` 的 ad-hoc 簽章 | 無 | **僅 CI** |
| Linux x86_64 | CI 用 WebKitGTK 相依建得出 `.AppImage` | 無 | **僅 CI** |

macOS 只有 ad-hoc 簽章，不是 Developer ID 簽章、也沒有公證；Windows 產物完全沒有簽章。
兩者都是[凍結的發佈政策](./RELEASE.md)，不是待辦。

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

**可攜版不會隔離資料。** `PORTABLE` 標記只讓 app 隱藏更新檢查介面（`src-tauri/src/settings.rs`
的 `portable_marker_exists`），設定與登入狀態仍走 `app_data_dir()`，跟安裝版共用同一份。
換一台電腦不會帶著登入狀態走，也會在原本那台留下痕跡。

## Agent 原始碼啟動通道

| 證據 | Windows | macOS / Linux | 狀態 |
|---|---|---|---|
| manifest／schema 與 Skill 漂移測試 | `pnpm agent:verify` 21 項本機通過 | 同一組測試在三個 CI 作業系統上通過 | 原始碼契約**已驗證**；GUI 啟動另計 |
| doctor／audit／dry-run JSON | 本機跑過，dry-run 不寫入任何執行期狀態 | Node 契約路徑在三個 CI 作業系統上通過 | Windows **已驗證**；其餘**僅 CI** |
| app 層級的 READY 等待 | 本機多次 `agent:launch --wait` 取得同一次執行、身分已驗證的 READY 標記 | 無實機回報 | Windows **已驗證**；其餘**待驗** |
| 啟動／停止的競態安全 | 實測釋放了 fail-closed 的啟動 mutex；stop 在 kill 與刪除同執行狀態前重新驗證身分；foreign／EPERM 測試通過 | 同一段程式碼，未實際操作 | Windows **已驗證**；其餘**待驗** |
| 損毀狀態的復原 | 預設的 stop 拒絕格式錯誤的狀態檔並保留它；`--clear-invalid-state` 只刪狀態檔，之後正常啟停 | 未實際操作 | Windows **已驗證**；其餘**待驗** |

Agent 契約不宣稱 CI 顯示過視窗。它也不安裝宿主前置、不盤點作業系統、不沙箱化 checkout 的程式碼、
不上傳收據、不回滾宿主變更。見 [`AGENT-READY-SOURCE-RELEASE.md`](./AGENT-READY-SOURCE-RELEASE.md)。

v2.0.0 的原始碼契約支援 Node.js `^22.13.0 || >=24.0.0`，對應鎖定的 pnpm 與 lint 工具鏈。
`agent:doctor` 會擋掉不支援的 Node 版本並停下來，而不是把無效的啟動當成就緒。
這個需求只影響原始碼開發，打包版使用者不需要 Node.js。

## Provider adapter

| Provider | 內建 adapter | 自動化覆蓋 | 實機證據 |
|---|---:|---|---|
| ChatGPT | v6 | 結構、logged-out 優先序、完成標記 | v0.0.2 打包版登入就緒 |
| Claude | v4 | 結構、登入頁偵測、明確的 Google SSO 範圍 | v0.0.2 打包版登入就緒 |
| Gemini | v2 | 結構、Google `/sorry` 的有界導航與 blocked 狀態 | v0.0.2 打包版登入就緒，原生畫面問答擷取正常 |
| Grok | v7 | 結構、challenge 優先的延後接手、watchdog 復原、challenge 期間拒絕變更 DOM | v0.0.2 打包版登入就緒 |

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

下表的「自動化證據」全部來自本 repo 的測試套件（`pnpm test` 493 項、`pnpm agent:verify` 21 項、
`cargo test` 87 項，2026-08-21 全綠）。「發佈前人工檢查」是清單，不是已完成的紀錄——
v0.0.2 只跑了上面 Windows 實測那一節列出的項目。

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
6. 匯出 Markdown 檢查出處；開一個新的 app session，確認歷史彼此隔離。
7. 安裝版：開設定、檢查更新、切換主題與介面語言、看作者／贊助連結。可攜版：確認更新介面隱藏，
   且 `README-portable.txt` 連到最新的 GitHub Release。回應語言設為 Auto 時，確認英文問題得到
   英文、正體中文問題得到正體中文，與介面語言無關；再驗一次固定語言的選擇。特別確認 Grok 是
   回答問題，而不是把內部的 `<response-language-policy>` 區塊照抄出來。
8. 只有在失敗時才匯出經過清理的 debug bundle；絕不附上機密或原始的 provider 頁面內容。

## 回報方式

若你有 macOS 或 Linux 實機，最有價值的回報是：OS/CPU、app 版本、安裝方式、是否能第一次開啟、
四家 provider 的登入／自動送出／完成偵測，以及不含私人內容的 debug bundle。Adapter 問題請使用
GitHub 的 **Adapter broken** 表單；安全問題請依 [`SECURITY.md`](../SECURITY.md) 私下回報。

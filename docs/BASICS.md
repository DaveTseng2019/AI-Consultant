# BASICS — 這個 app 怎麼運作

這個 app 怎麼運作。**不是操作手冊，是機制說明**——看完應該能回答「我按下送出之後，到底發生了什麼」。

> 2026-08-20 對照原始碼寫成，基準 commit `5d5fb29`。
> 引用到的檔案改動後本文可能失準；每一節都標了檔案位置，可以自己核對。
>
> `docs/` 其餘檔案是從來源專案帶過來的，描述的是**它**的產品，與本分支已經開始不同。

## 核心：沒有 API key

主視窗裡掛四個子 webview，載入你平常用的 ChatGPT／Claude／Gemini／Grok 網站。
送出時不呼叫任何 API，而是**用你已登入的網頁 session**，把字打進那個網站自己的輸入框、
按下它自己的送出鈕，再把回答抓回來。所以帳號、額度、模型版本全部是你自己的，
也沒有任何金鑰要保管。

代價是：**provider 改版就會壞**。壞的地方通常在 adapter（見下）。

## 三層構造

| 層 | 位置 | 負責 |
|---|---|---|
| 宿主 | `src-tauri/`（Rust） | 建立／擺放／隱藏 webview，管理各家的獨立登入 profile |
| 注入引擎 | `injected/engine.ts` | 在 provider 頁面內執行：找輸入框、打字、送出、判斷回答結束 |
| 控制台 | `src/`（React） | 介面、模式流程、對話與紀錄 |

控制台不能直接碰 provider 頁面，必須經過 bridge：Rust 用 `eval` 把指令送進頁面，
頁面把結果放進 outbox 等控制台來拉（`injected/bootstrap.ts` ＋ `src-tauri/src/bridge.rs`）。
契約以實作為準——為什麼非得用 `document.title` 當回傳通道，寫在 `injected/codec.ts` 的檔頭註解。

## adapter：每家網站的選擇器地圖

`adapters/*.json` 定義每個 provider 的：輸入框選擇器、送出鈕、回應區塊、
「正在生成」的判斷依據、以及登入／登出的偵測器。

> **這些檔案被政策凍結。** 種子表在 `scripts/check-adapters.mjs` 的 `expected` 物件，
> `pnpm check-adapters` 拿它跟 JSON 逐欄深度比對。要改 provider 的偵測行為，
> 改的是 `injected/engine.ts`，不是 JSON——直接改 JSON 會在驗證階段被擋下來。

## 連線狀態

`src/ui/providerChipState.ts` 依固定順序判定，先命中的先贏：

| 順序 | 狀態 | 意義 |
|---|---|---|
| 1 | 開啟中… | webview 正在建立 |
| 2 | 開啟 | 還沒有 webview（卡片上就是這個字） |
| 3 | 需要修復 | adapter 的選擇器對不上頁面 |
| 4 | 連線異常 | bridge degraded |
| 5 | 請登入 | 偵測到登出，或被挑戰頁擋住 |
| 6 | 思考中 | 正在生成回答 |
| 7 | 狀態過期 | 載入了，但還不滿足送出條件 |
| 8 | 就緒 | 可以送出 |

能不能送由 `src/workflow/sendability.ts` 一行決定：
`webview === 'loaded' && dom === 'ready' && login === 'logged_in'`。

> 那個檔案的 `notes:` 記著一個已知的不對稱：ChatGPT／Grok／Gemini 其實**未登入也答得出來**，
> 只有 Claude 真的必須登入。但「未登入」與「登入過期」在 DOM 上分不出來，
> 所以登入條件保留。目前只有 Gemini 未登入可送出，那是它沒寫登出偵測器的意外，不是設計。

### Grok 的四道關卡

四道都在 app 的視野之外，所以第一次用 Grok 的人自己不會知道。未登入的 Grok 置中時，
畫面上會有一條說明講第 1、3、4 點（`provider.grokSignInNotes`）——說明出現在登入**之前**，
是因為第 3、4 點都在登入之後才發作，那時已經沒有畫面可以講了。第 2 點只寫在這裡，
因為它是 X 自己的畫面，只有選 X 登入的人會遇到。

1. **能用哪一種登入方式，由 x.ai 帳號頁決定。** 登入頁（`accounts.x.ai/sign-in`，2026-08-31 實看）
   **一定會列出 Google／X／Apple／郵箱四顆按鈕**，按鈕在不代表走得通：只有在
   `accounts.x.ai/account`「登入方法」啟用（連接）過的那幾種，才進得了你原本的帳號。
   每個人啟用的不一樣，所以「我用 Google 登不進去」不是 app 的 bug。
2. **用 X 登入的話，中間多一道 X 的授權頁。** 2026-08-31 實看：畫面標題是
   `xAI Single Sign-On wants to access permissions on your account`，要按 `Authorize app`
   才會回到 Grok。那是 X 的 OAuth 畫面、不是 Grok 的，第一次用的人容易以為走錯地方。
   Google 那條則是跳出 Google 自己的登入視窗（`繼續使用「X」`）。
3. **註冊或登入後，Grok 會在對話裡問一次出生年份。** 不是彈窗也不是挑戰頁，就是一則訊息。
   app 分不出來——`chat-input` 與 `chat-submit` 都在，卡片照樣顯示「就緒」，
   但你送出的問題換回來的會是那句年齡詢問，而且串行模式會把它當材料往下傳。
   把 Grok 置中、切到**真實頁面**答完那一題就好；換新 profile 或重新登入要再答一次。
4. **第一次註冊完，卡片可能一直停在「開啟中…」。** 按上方的「前往登入」，或把 app 關掉重開，
   多半就會轉成就緒。
   **「開啟中…」的意思是「這一頁還沒有回報過任何人有沒有登入」，不是「還沒登入」**
   （`providerChipState.ts`：`login === 'unknown'` 就是這一格）。所以你從畫面上無法判斷
   Grok 到底登入了沒有——按下去之後可能直接變就緒（其實早就登入了，只是訊號沒送到），
   也可能發現真的還沒登入、要再走一次。這個「不知道」是使用者實際的感受，寫說明時不要
   講得像一定會好。
   真因是標題訊號競態（`webviews.rs` 的 `carry_grok_app_title_signal()`）：注入的 engine 拿
   `document.title` 當回報通道，導航時標題剛好停在 `Grok`，新文件的標題一樣，就不觸發
   `on_document_title_changed`，那個 epoch 拿不到授權。「前往登入」與 `provider_reload`
   這類**控制端**指令會把上一輪的訊號帶進新 epoch，自動路徑不帶。

## 擺法與舞台

每個 provider 有三種呈現（`src/ui/presentation.ts`）：

- `chip` — 收起來，webview 關閉，不佔資源
- `side` — 已載入但隱藏在畫面外
- `center` — 放上中央舞台

中央舞台有兩種內容：**真實網頁**（原生 webview）或**文字檢視**（只顯示抓回來的文字）。
置中一個**尚未登入**的 provider 時會自動切成真實網頁並放大——登入只能在真實頁面上做，
而登入表單需要空間。
已登入的 provider 則回到**上次自己選的那一面**（「真實頁面」／「文字」鈕寫進 `settings.json` 的 `centerSurface`），重開程式也還原。
舞台的「放大」是登入用的，不是偏好：**尺寸跟著登入狀態走**——未登入就放大，一報回已登入就還原，
不管那是啟動時的第一次回報，還是你在畫面上剛登入完。它**不寫進設定**，所以重啟後點一個已登入的
provider 不會是放大的。內容面則相反，一次置中只決定一次，免得剛登入完就被換成空的文字檢視。

> 判定在 `centerStageDecision()`（`src/ui/presentation.ts`）。login 還是 `unknown` 時回 `undefined`＝
> 先不要動——啟動當下每個 provider 都是 `unknown`，這時就判會把已登入的帳號當成未登入而放大。

## 六個模式

差別只在「誰講、講幾輪、什麼順序」（`shared/constants.ts` ＋ `src/workflow/graph/`）：

| 模式 | 形狀 | 執行 |
|---|---|---|
| 自由模式 | 同時發給四家，各自獨立回答 | 平行 |
| 多方諮詢 | 雙源先答 → 審查補充 → 總結研究 | 串行 |
| 四方辯證 | 正方 → 反方 → 判官 → 總結 | 串行 |
| Coding 模式 | 規劃 → 審查 → 實作 → 測試 → 驗收（8 步） | 串行 |
| 道理辯證 | 5 輪辯證螺旋 × 4 席 | 串行 |
| 腦力激盪 | 12 輪 · 48 次發言 · 5 階段 | 串行 |

串行模式的後續步驟**會拿到前面的回答當材料**，這是它和自由模式的根本差別。

## 送出走的那條路

```
preflight.ts      檢查誰能送，不能送的先擋下並說明原因
      ↓
graph/executor.ts 依模式的 graph 逐步推進
      ↓
stepRunner.ts     每一步：組 prompt → 指派給某個 provider
      ↓
sendAndWait.ts    透過 bridge 把字打進頁面、按送出
      ↓
waitForResponse.ts 等生成結束（靠 thinkingDetectors ＋ 逾時看門狗）
      ↓
providerResponse.ts 取回文字，交給下一步或收進 transcript
```

## 送出之後

- **transcript**：回答進右側對話區。
- **snapshot**：留下問題、角色對應、每步的輸入與輸出（`src/workflow/snapshot/`）。
- **重播**：**沿原路重跑一次**，AI 會重新回答，不是回放舊畫面。重跑前有五道把關：
  snapshot 不存在、graph 已刪除、graph 版本不同、原始問題未保留、preflight 失敗——
  擋下時會說明是哪一種。
- **匯出**：Markdown，或跑你在設定裡指定的自訂腳本。

## 幾個容易誤解的地方

- **「重播」不是回放。** 會真的再問一次，也會產生新的 snapshot。
- **「就緒」是在講能不能送，不是在講有沒有掛帳號。** 見上面的不對稱。
- **snapshot 預設不落地。** 要在設定裡開啟，而且只有 `full-local` 這一層會留原文。
- **對話欄會自己收起來。** 訊息為空且沒有任何 provider 可送出時，
  右欄讓出寬度給設定區；有訊息或有 AI 就緒就會回來。

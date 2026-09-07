[English](./AGENT-READY-SOURCE-RELEASE.md) | **繁體中文**

# Agent 可操作原始碼發行契約

> 契約版本：**2.0.0**<br>
> 機器可讀的唯一真相：[`agent-release.json`](../agent-release.json)<br>
> Schema：[`agent-release.schema.json`](../agent-release.schema.json)

本文件定義一套保守、可驗證的介面，讓本機 coding agent 能審計、啟動、確認、檢查與停止 AI Consultant 原始碼版。這是「原始碼開發通道」，不是一般安裝版本的替代品。

## 兩條發行通道

| 通道 | 適用對象 | 進入點 | 需要主機開發工具 | 產出 |
|---|---|---|---|---|
| 正式產物 | 大多數使用者 | GitHub Release 的安裝檔／可攜包／DMG／AppImage | 不需要 | 打包好的 app |
| Agent 可操作原始碼 | 開發者，以及刻意搭配本機 agent 工作的使用者 | 明確呼叫 Codex 或 Claude Code Skill | 需要，且要自己另外安裝 | 從這份 checkout 跑起來的 `tauri dev` process |

打開 repo 永遠不會啟動 app。原始碼 Skill 只能被明確呼叫。遠端 agent 可以修改或測試 repo，但只有跑在使用者本機圖形 session 裡的 agent shell，才能在那台機器上開出桌面視窗。

一般使用者應優先下載 Release。只有明確要求本機 agent 執行 Skill，才會進入原始碼通道。

## 契約涵蓋的檔案

| 檔案 | 用途 |
|---|---|
| `agent-release.json` | 帶版號的需求、權限、副作用、執行狀態、進入點與隱私承諾 |
| `agent-release.schema.json` | 這份 manifest 的嚴格 JSON Schema |
| `.agents/skills/launch-ai-consultant/` | 明確呼叫的 Codex Skill 與 UI metadata |
| `.claude/skills/launch-ai-consultant/` | 明確呼叫的 Claude Code Skill |
| `scripts/agent/*.mjs` | 決定性的生命週期指令 |
| `scripts/agent/tests/*.test.mjs` | 契約、漂移、dry-run、身分與執行狀態的測試 |
| `.agent-runtime/` | 被忽略的本機狀態、log、啟動收據與稽核收據 |

兩份 Skill 的指令本文刻意保持一致，並有測試防止漂移。只有各工具專屬的 frontmatter 允許不同。

## 信任與權限邊界

### 原始碼執行警告

從原始碼啟動會執行這份 checkout 與其鎖定相依套件裡的程式碼：

- `pnpm install --frozen-lockfile` 可能執行 JavaScript 相依套件的 lifecycle script。
- Cargo 編譯可能執行 Rust build script 與 procedural macro。
- `tauri dev` 會把這份 checkout 當成原生桌面程式跑起來。

呼叫 Skill 之前先審查並信任這份 checkout。生命週期是可稽核的，但它不是沙箱。

### 不需要另一次「變更主機」同意就能做的事

- 讀取 repo 檔案，執行版本與前置條件檢查。
- 在缺少時把鎖定的 JavaScript 相依套件裝進這個專案。
- 使用使用者既有的 pnpm 與 Cargo 快取。
- 寫入 manifest 宣告的 repo 內產生路徑。
- 只啟動、檢查與停止這份 checkout 中通過身分驗證的 launcher process tree。

### 必須另外取得明確同意的事

- 安裝或移除 Node.js、pnpm、Rust、Xcode tools、Visual Studio Build Tools、WebView2 或 Linux 套件。
- 執行 `winget`、`brew`、`apt`、`rustup`、全域套件安裝、`sudo` 或提權安裝程式。
- 變更 `PATH`、shell profile、OS 安全設定、Gatekeeper 政策或 execution policy。

缺少前置條件時，Skill 只會回報並停止。如果使用者另外要求 agent 修改主機，那是一件新的工作：要揭露確切的指令與副作用、取得明確同意，並在前後做稽核。Skill 永遠不會自動移除工具，也不會嘗試整機 rollback。

### 這條通道永遠禁止的事

- 只因為 repo 被打開就隱式執行。
- 產生安裝檔／release（`pnpm tauri build`）或下載 release 產物。
- 讀取、匯出、刪除或上傳 provider 的憑證、cookie、儲存內容或 profile。
- 停止一個未經驗證的 PID。
- 自動上傳 log 或稽核收據。
- 為了讓 app 啟動而降低 OS 安全性。

## 穩定的生命週期

所有指令都以 exit code `0` 表示成功、`1` 表示前置條件／執行期／操作失敗、`2` 表示用法或契約資料無效、`3` 表示等待就緒逾時。`--json` 會在 stdout 印出一個帶版號的 JSON 物件；指令與建置進度不會混進 JSON stdout。

```sh
node scripts/agent/audit.mjs --phase before --write --json
node scripts/agent/doctor.mjs --json
node scripts/agent/launch.mjs --dry-run --json
node scripts/agent/launch.mjs --wait --timeout-ms 600000 --json
node scripts/agent/status.mjs --json --lines 80
node scripts/agent/audit.mjs --phase after --write --json
node scripts/agent/stop.mjs --json
```

狀態損毀時，正常的 launch／stop 會直接失敗。使用者檢查過本機狀態與 log 之後，可以明確要求 `node scripts/agent/stop.mjs --clear-invalid-state --json`；它只會移除損毀的狀態檔，永遠不會終止不明的 process。

建議的 agent 執行順序：

1. 讀 `agent-release.json`，確認有本機圖形 session。
2. 寫 before audit 收據。
3. 跑 doctor。失敗就停下來，精確回報缺了哪些檢查。
4. 用 `--wait` 啟動；不要把「process 建立了」當成「已經就緒」。
5. 即使啟動失敗或逾時，也要寫 after audit 收據。
6. 只有這一次執行實際送出決定性的 control pane 標記，才回報 `ready`。
7. 只有被明確要求時才停止。

`launch --dry-run` 會做前置條件檢查並回報它的計畫，不會建立、刪除或改寫執行狀態。

## 執行狀態的真相

| 狀態 | 意義 |
|---|---|
| `not_started` | repo 沒有任何 launcher 狀態 |
| `building` | 通過身分驗證的 process 還活著，但 control pane 尚未證明就緒 |
| `ready` | 本次啟動區段含有 `[MAC_AGENT] READY control-pane`，且其驗證過的 process 還活著 |
| `failed` | launcher 在就緒前就結束，且目前 log 區段含有建置／執行期失敗 |
| `exited` | 記錄下來的 launcher 已經不在了 |
| `invalid_state` | 狀態 JSON、repo 身分、PID、時間戳或 log 路徑違反契約 |
| `foreign_process` | 記錄的 PID 還活著，但已經不符合這個 repo 的 runner 與 token |

READY 標記是由掛載完成的 React control pane 透過一個只在 debug 版存在的 Tauri command 送出。舊 log 區段裡的標記不能用來滿足新的一次執行。`accepted` 只代表 launcher PID 被記錄下來，絕不代表 UI 已就緒或已顯示在其他視窗之前。

runner token 是為了避免 PID 被回收後誤殺。它是 process 身分 metadata，不是密鑰、認證機制或沙箱邊界。

## 收據與副作用

| 路徑 | 意義 |
|---|---|
| `.agent-runtime/tauri-dev.json` | 目前 launcher 的身分與 checkout 路徑 |
| `.agent-runtime/launch.lock` | 短命的跨平台互斥鎖，避免並行啟動競態 |
| `.agent-runtime/tauri-dev.log` | 只附加的本機建置／執行輸出 |
| `.agent-runtime/last-launch.json` | 上一次被接受的啟動步驟與宣告的影響 |
| `.agent-runtime/audit-before.json` | 明確的啟動前環境／產物收據 |
| `.agent-runtime/audit-after.json` | 明確的啟動後收據與比較結果 |

宣告的 repo 內影響是 `node_modules/`、`src-tauri/gen/injected/`、`src-tauri/target/` 與 `.agent-runtime/`。pnpm 與 Cargo 也可能寫進使用者既有的快取。Tauri app 一旦跑起來，就可能建立一般的本機設定與 provider WebView profile。

稽核記錄的是宣告過的檢查、repo 產物的 metadata，以及契約宣告的證據檔 metadata（相依標記、產生的 bundle、開發版執行檔與執行期收據）。它不是遞迴的檔案雜湊、不是完整的作業系統清點，也不能證明無關的主機狀態從未改變。log 與收據都留在本機，可能含有使用者名稱、本機路徑或編譯器診斷訊息；分享前先自己看過。

## 跨平台證據

`pnpm agent:verify` 會檢查 manifest／schema、進入點、package script 對齊、Skill 本文一致性、明確呼叫政策、原始碼變更邊界、JSON 指令格式、dry-run 不變更狀態、本次執行的 READY 區段切分，以及 PID 身分比對。

CI 會在 Windows、macOS 與 Linux 上跑這些測試，並實際編譯 Tauri／Rust。這證明的是契約可攜與編譯得過，不是每個 OS 上都有人親眼看過 GUI。實機啟動證據放在 [`docs/COMPATIBILITY.zh-TW.md`](./COMPATIBILITY.zh-TW.md)。

## 為什麼沒有 Docker 通道

這個產品刻意內嵌原生 WebView、在主機上開桌面視窗，並使用本機的 provider profile。容器仍然需要主機顯示轉發、原生 WebView 整合與 profile 橋接，還多出一個會誤導人的第二環境。所以 Docker 是這條原始碼發行通道的 non-goal；它不會讓預期中的本機 GUI 路徑更簡單或更安全。

## 可重用的發行檢查清單

想採用「agent 可操作原始碼發行」這個模式的專案，下面每一項都要有：

1. 一份帶版號、機器可讀的 manifest，以及一份嚴格的 schema。
2. Skill 只能被明確呼叫；打開 repo 不做任何事。
3. 誠實揭露 checkout 程式碼、lifecycle script、build script、快取與 app 資料的影響。
4. 一張把「專案內動作」與「主機變更」分開的權限矩陣。
5. 穩定的指令、JSON 輸出與有文件的 exit code。
6. 一個有測試保證不會變更生命週期狀態的 dry-run。
7. 把「process 已接受」「建置中」與應用層「就緒」三種證據分開，並綁定同一個啟動身分。
8. 一個啟動互斥鎖，加上會重新驗證身分、拒絕過期或外來 PID 的停止行為。
9. 本機的前後收據，不自動上傳，也不做主機 rollback。
10. 跨平台測試，防止 manifest、script、package 與 Skill 漂移。
11. 清楚區分 CI 自動化證據與實機 GUI 證據。
12. 明確的 non-goal，避免原始碼通道長成套件管理器、常駐服務或隱形控制面。

## 操作摘要

1. 一般使用者請下載正式 Release；Agent Skill 是需要本機開發環境的原始碼通道。
2. 打開 repo 不會自動執行。只有使用者明確呼叫 `$launch-ai-consultant` 或 `/launch-ai-consultant` 才能開始。
3. Skill 會先寫入 before audit、執行 doctor、啟動並等待 React control pane 的 READY 訊號，再寫 after audit。
4. `accepted`／`building` 不等於 ready；舊 log 的 READY 也不能算新一次啟動成功。
5. Skill 可以安裝此 repo 的 locked JavaScript dependencies，但不會安裝／移除系統工具、全域套件、PATH 或安全設定。
6. 若缺少 Node、Rust、MSVC、Xcode tools 或 Linux 套件，Skill 只會精確報告並停止；任何 host 安裝都必須是另一個獨立、明確同意的工作。
7. Lifecycle script 永遠不讀 provider credential/profile、不自動上傳 log、不自動 rollback host，也不會停止無法驗證身分的 process。
8. `pnpm agent:verify` 會在三個 OS 的 CI 防止 manifest、script 與兩套 Skill 漂移。
9. Audit 是可檢查的 repo-level receipt，不是 sandbox 或完整作業系統鑑識。
10. 不提供 Docker，因為這是需要本機圖形 session、native WebView 與 local provider profile 的桌面程式。

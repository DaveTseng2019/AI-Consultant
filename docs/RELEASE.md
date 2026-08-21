# 發佈流程

> **已發佈的版本從 `v0.0.1`（2026-08-21）開始。** 打新 tag 之前先跑 `git tag -l` 看目前最新是哪一個，
> 這份文件不逐版更新。

發佈是 **tag 驅動**的：你推一個 `v*` tag，CI 建三個平台，開一個 **draft** release 把產物掛上去。
你檢查完自己按 Publish。**CI 不會建 tag，也不會自己發佈**——tag 推上去之前什麼都不會發生，
draft 發佈之前什麼都不會公開。

## 發佈一次

### 1. 停掉正在跑的 app

```sh
node scripts/agent/stop.mjs --json
```

> app 開著的話 `pnpm verify` 會失敗。`scripts/agent/tests/commands.test.mjs` 裡的
> `launch dry-run` 期望拿到 `would_start`，但 app 在跑時它拿到的是 `already_running`。
> 那不是程式壞了，是環境沒清乾淨——但它會讓 `pnpm verify` 以非零結束，看起來像真的失敗。

### 2. 本機驗證

```sh
pnpm verify                                  # build:injected + typecheck + lint + vitest + agent:verify + adapter 檢查
cd src-tauri
cargo test
cargo fmt -- --check
cargo clippy --all-targets -- -D warnings
```

四項都要過。詳細的發佈前檢查見下面的清單。

### 3. 確認 main 已經推上去

```sh
git push origin main
```

tag 必須指在 `origin` 已經有的 commit 上，否則 CI checkout 不到。

### 4. 打 tag 並推上去

```sh
git tag -a v0.1.0 -m "v0.1.0: 說明這一版做了什麼"
git push origin v0.1.0
```

### 5. 等 CI、審 draft、發佈

推上去之後等 **10～20 分鐘**（三個平台各自建置）。到
<https://github.com/DaveTseng2019/AI-Consultant/releases> 開那個 draft：

- 確認 Windows `.exe`／`.zip`、macOS `.dmg`、Linux `.AppImage` 都掛上去了
- 至少下載 Windows 的產物實際跑一次
- 檢查自動產生的 release notes

沒問題就按 **Publish release**。

### 作廢一次建置

刪掉 draft release，再刪掉 tag：

```sh
git push origin :refs/tags/v0.1.0
git tag -d v0.1.0
```

發佈之前什麼都不是公開的。

## 版號來自 tag

Release workflow 只對 `v*` tag 觸發。它把開頭的 `v` 去掉，在 CI 的 checkout 裡把版號注入
`package.json` 與 `src-tauri/tauri.conf.json`，然後才跑 `pnpm tauri build`。

**repo 裡的版號永遠是 `0.0.0`**，發佈時不需要改任何檔案。

tag 名稱含 `-pre` 會被標成 prerelease（例如 `v0.2.0-pre.1`）。

## CI 產出什麼

| 平台 | 產物 |
|---|---|
| Windows | NSIS 安裝檔 `.exe` ＋ 可攜版 `AI-Consultant-<版號>-windows-portable.zip` |
| macOS | ad-hoc 簽章的 `.dmg`；CI 會掛載它並嚴格驗證內嵌 `.app` 的簽章 |
| Linux | `.AppImage` |

可攜版的 `.exe` 旁邊會放一個 `PORTABLE` 標記檔。可攜模式**隱藏 app 內的更新檢查介面**，
可攜版使用者靠自己到 GitHub Releases 下載新版。安裝版使用者可以用「設定 → 檢查更新」
偵測新版並開啟下載頁——app 不會自己下載或安裝。

## 發佈前的檢查清單

- `pnpm verify`（含 `pnpm agent:verify`）、Rust 測試、`cargo fmt -- --check`、
  `cargo clippy --all-targets -- -D warnings` 全數通過。
- `agent-release.json` 通過 schema 驗證；兩份 Skill 內容同步且維持「只能明確呼叫」；
  `node scripts/agent/launch.mjs --dry-run --json` 沒有任何寫入。source lane 不安裝任何宿主前置，
  也不建置 release 產物。
- 預設 capability 只指向 `webviews:["main"]`，沒有 `windows` 或 `remote` 條目；
  打包後的控制台在正式 CSP 下仍能檢查更新與匯出。
- 遠端 adapter 測試允許在已內建的 URL 範圍內改選擇器與時序，並拒絕擴張 provider／登入／match／SSO。
- 用**實際觀察到的證據**更新 [`COMPATIBILITY.md`](./COMPATIBILITY.md)。CI 打包成功不等於使用者啟動成功。
- 發佈前實測 Windows 產物。Apple Silicon 上要確認首次啟動與四家 provider 登入，
  特別要求 Grok 能通過 Cloudflare 驗證。Linux 在拿到實機回報之前維持 CI-only。

## 凍結的發佈政策

- 最終 identifier 是 `tw.micasa.aiconsultant`。
- GitHub Releases 是唯一的更新管道。app 可以檢查有沒有新版並開啟它的頁面，
  但**不會自己下載或安裝更新**。
- release tag 同時帶著 Agent-Ready Source Release 的 manifest 與 Skills，但它們只會從可信的
  checkout 啟動 `tauri dev`。那不是打包產物、容器、更新器或宿主工具安裝程式。
  見 [`AGENT-READY-SOURCE-RELEASE.md`](./AGENT-READY-SOURCE-RELEASE.md)。
- Windows Authenticode 簽章、macOS Developer ID／公證、更新器 manifest、獨立的套件管理器發佈，
  全部是**關閉的範圍**，不是待辦。macOS 的 ad-hoc 簽章是打包完整性的底線，不是身分認證方案。
- 每一個 release tag 在 draft 發佈之前，都必須通過 `pnpm verify`、跨平台的
  `cargo clippy -- -D warnings`，以及三平台的建置 workflow。

## 使用者會遇到的事

- **Windows 產物沒有簽章。** SmartScreen 會跳警告，使用者要按「其他資訊 → 仍要執行」。
- **可攜版需要 Microsoft Edge WebView2 Evergreen Runtime。** Windows 10/11 通常已內建。
- **macOS 產物只有 ad-hoc 簽章，沒有公證。** 第一次啟動被擋之後，使用者要到
  「系統設定 → 隱私權與安全性 → 安全性」按「強制開啟」。那個選項通常只出現約一小時。

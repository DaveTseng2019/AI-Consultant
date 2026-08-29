# 自訂功能按鈕範例

對話工具列上的按鈕可以自己加。每一顆按鈕就是「一支 PowerShell 腳本」加上「按下時要傳什麼給它」，
app 只負責把東西交出去、把結果顯示回來——腳本拿它做什麼由你決定。

這個資料夾裡有兩支可以直接用的範例：

| 檔案 | 傳什麼 | 做什麼 |
| --- | --- | --- |
| [`export-and-open.ps1`](./export-and-open.ps1) | 本次對話的 `.md` | 用 VS Code 打開這次的問答 |
| [`save-run-as-note.ps1`](./save-run-as-note.ps1) | 本次執行紀錄 | 把問題與各家回答寫成一則 Markdown 筆記 |

## 怎麼加一顆按鈕

1. 把要用的 `.ps1` 複製到一個固定位置（例如 `C:\Users\<你>\Documents\ai-consultant-scripts\`）。
   **不要**留在這個 repo 裡跑——重新 clone 或切分支時路徑會不見。
2. 開 **設定 → 進階與診斷 → 自訂功能按鈕 → 新增一顆按鈕**，填四個欄位：

   - **名稱**：按鈕上的字。工具列不寬，短一點。
   - **PowerShell 腳本**：`.ps1` 的**完整路徑**。相對路徑會被拒絕——它會相對於 app 的工作目錄解析，
     那不是你選的地方。可以按「瀏覽…」選。
   - **註解**：滑鼠滑過按鈕時顯示。給半年後的自己看。
   - **按下時傳給腳本的內容**：見下一節。

3. 按 **Save**。跑腳本的欄位不會即時儲存，一定要按。
4. 按鈕的左右順序就是清單順序，用每一列的 **↑ ↓** 調整。

## 按下時傳給腳本的內容

| 選項 | app 怎麼呼叫 | 什麼時候用 |
| --- | --- | --- |
| 不傳 | `script.ps1` | 跟這次對話無關的工具 |
| 本次執行紀錄 | `script.ps1 -SnapshotId snapshot-<uuid>` | 腳本要讀問題與各家回答 |
| 本次對話的 `.md` | `script.ps1 -MarkdownPath <檔案>` | 腳本只要一份可讀的檔案 |

後兩者要**先問完一題**，按鈕才按得下去（沒有執行紀錄可傳）。

**`-SnapshotId`**：對應到 `%APPDATA%\tw.micasa.aiconsultant\snapshots\<id>.json`。
即使設定裡的「持久化 snapshots」是關的也讀得到——app 會為這一次臨時寫一份，腳本跑完再刪掉。
檔案裡留下多少原文由遮蔽等級決定，**只有 `full-local` 會保留原文**。

**`-MarkdownPath`**：跟「匯出 .md」同一份內容，寫在系統暫存資料夾。要長期保存的話，
自己在腳本裡 `Copy-Item` 一份到別的地方——暫存檔 Windows 之後會清掉。

## `.md` 用 VS Code 開啟

Windows 對 `.md` **沒有**預設程式，所以「匯出後自動打開」這件事一定要有人指定用什麼開。兩種做法：

**做法一：腳本直接叫 VS Code（範例用的就是這個）**

```powershell
Start-Process -FilePath 'code.cmd' -ArgumentList @('-r', "`"$MarkdownPath`"")
```

`code.cmd` 而不是 `code`：後者是 shim，`Start-Process` 不會自己解析。VS Code 安裝時的
「加入 PATH」預設是勾的，所以直接用名字就找得到；沒有的話改成 `Code.exe` 的完整路徑。
`-r` 是重複使用已開的視窗，不加的話每匯出一次就多一個視窗。

**這個做法不需要動任何檔案關聯**，也不影響你在檔案總管雙擊 `.md` 時的行為。

**做法二：把 `.md` 關聯到 VS Code**

在檔案總管對任一個 `.md` 按右鍵 →「開啟檔案」→「選擇其他應用程式」→ Visual Studio Code →
勾「一律使用此應用程式」。之後腳本可以簡化成 `Start-Process $MarkdownPath`，由系統決定用什麼開。

代價是**雙擊 `.md` 會進 VS Code 的編輯畫面**，不是渲染後的預覽。匯出的對話通常是拿來讀的，
所以做法一比較不會互相干擾：日常雙擊維持你原本的習慣，按鈕走按鈕的。

## 腳本要注意的事

- **app 怎麼呼叫**：先找 `pwsh.exe`（PowerShell 7），沒有才用 `powershell.exe`，一律帶
  `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File <你的腳本>`。
  `-NonInteractive` 表示 **不能** 用 `Read-Host`、`Get-Credential` 這類會等輸入的東西，會直接卡住。
- **成功與失敗**：離開碼 `0` 算成功，app 顯示你 **stdout 最後一行非空白的輸出**；
  非 0 會顯示失敗，並附上離開碼與 stderr。所以最後一行印個檔案路徑很有用。
- **沒有主控台**：視窗是隱藏的，`Write-Host` 你看不到。要留紀錄就自己寫檔。
  非 ASCII 的輸出記得先設 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`，
  否則會以系統 ANSI 編碼送出，app 收到的是亂碼。
- **檔案編碼**：腳本裡有中文（或任何非 ASCII）時，**存成 UTF-8 with BOM**。
  Windows PowerShell 5.1 讀沒有 BOM 的 `.ps1` 會用系統 ANSI 編碼，中文會變成亂碼並通常直接是語法錯誤。
  這兩支範例刻意維持純 ASCII，所以沒有這個問題。
- **「執行前確認」**：預設是開的。腳本會開一個子行程，第一次按下去就直接跑不是好事。
  自己天天在用、確定安全的按鈕再關掉它。

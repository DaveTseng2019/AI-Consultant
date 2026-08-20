# AI Consultant

由 [teddashh/multi-ai-chat-desktop](https://github.com/teddashh/multi-ai-chat-desktop) 衍生的獨立專案，
不是它的 fork，也不再對它送 PR。程式碼從 Dave 的 fork 在 2026-08-20 的狀態分出來，之後各走各的。

分出來有兩個理由：

1. **避免混淆。** 送 PR 的 fork 與自用的產品線混在同一個 checkout 裡，
   分支、版號、資料目錄都會互相干擾。
2. **驗證概念。** 這裡是拿來試想法的地方。改動不必先想「上游會不會收」，
   也不必遷就上游的檔案結構與命名慣例——那正是留在 fork 裡做不到的事。

送 PR 給上游的那份仍在
[DaveTseng2019/multi-ai-chat-desktop](https://github.com/DaveTseng2019/multi-ai-chat-desktop)，
**兩個專案不要混用**：那邊是上游的貢獻管道，這邊是可以隨便試的產品線。

## 與來源專案的差別

| | 來源（fork） | AI Consultant |
|---|---|---|
| 目的 | 對上游送 PR ＋ 自用整合版 | 自己的產品線 |
| app 名稱 | Multi-AI Chat Desktop | AI Consultant |
| 資料目錄 | `%APPDATA%\com.tedh.multiaichat` | `%APPDATA%	w.micasa.aiconsultant` |
| release | `v1.9.0` 起自成一線 | 尚未建立 |

資料目錄刻意分開，所以兩支可以並存，但**登入狀態不共用**——這邊要重新登入各家 provider。

## 上游的修正還要不要拿

`upstream` remote 仍指向 teddashh 的 repo。要撿上游的修正就正常 fetch、cherry-pick 或 merge；
但這個專案不再回送 PR，所以不必再遷就上游的檔案結構與命名慣例。

## 授權

MIT，與來源專案相同。原始著作權屬 teddashh，`NOTICE.md` 與各 `README.*.md` 保留原樣。

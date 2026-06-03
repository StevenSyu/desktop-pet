# CI Release Pipeline 設計

日期：2026-06-03
狀態：已與使用者確認
關聯：issue #8（跨平台支援未竟事項）——本 spec 解掉「Linux build 要在 Linux 跑」與 release 自動化；實機驗證另波處理。

## 目標

1. **Release pipeline**：push `v*` tag → GitHub Actions 三平台自動 build（dmg／nsis exe／AppImage+deb）→ artifacts 上傳到同一個 **draft** GitHub Release → 使用者驗過手動 publish。
2. **Push CI**：push main 與 PR → ubuntu 跑 typecheck + 全部單元測試（~2 分），壞 code 即時暴露。

## 決策（已確認）

| 決策點 | 選擇 | 理由 |
|---|---|---|
| 實作方式 | electron-builder 原生 GitHub publish | 最少 glue code；builder 自動建/找同 tag draft、上傳 artifacts+blockmap |
| 發佈流 | draft Release，人工驗過再 publish | 未簽章個人專案，壞 build 不直接曝露給下載者 |
| 測試 gate | 各平台 build 前跑 typecheck + 單測 | 純函式、快、跨平台穩；e2e 留本機（CI 跑 Electron 視窗環境性失敗風險高） |
| push CI | 加（ubuntu 單 runner） | 成本低、回饋快 |
| 簽章 | 全 unsigned | mac 維持 `identity: null`（ad-hoc）；win 出 SmartScreen 警告，文件註明 |
| Release notes | builder 產生陽春版，publish 前手動貼 CHANGELOG 段 | draft 階段本來就有人工步驟 |

## 變更檔案

### 1. `.github/workflows/ci.yml`（新增）

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

### 2. `.github/workflows/release.yml`（新增）

```yaml
name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:   # 驗證 pipeline 用，不必污染 tag
permissions:
  contents: write      # 建 draft release + 上傳 artifacts
jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

註：
- `electron-builder` 不帶 `--mac/--win/--linux` 時依當前平台選 target（與本機 `npm run dist` 同行為）。
- `workflow_dispatch` 觸發時無 tag，electron-builder 以 `package.json` version 命名 draft——驗證輪可接受；正式 release 一律走 tag。
- 三個 job 對同一 version/tag 各自上傳，builder 會 reuse 同一個 draft（GitHub provider 標準行為）。

### 3. `electron-builder.yml`（修改）

加 publish 區塊：

```yaml
publish:
  provider: github
  releaseType: draft
```

本機 `npm run dist`／`dist:mac`／`dist:win`／`dist:linux` 不帶 `--publish`，electron-builder CLI 預設 `never`——本機行為不變、不會誤上傳。

### 4. `docs/CROSS_PLATFORM.md`（修改）

補「Release pipeline」一節：tag 流程、draft 驗證步驟、unsigned 注意事項（win SmartScreen／mac Gatekeeper 右鍵開啟）。

### 5. issue #8（修改）

勾掉「Windows 打包」「Linux 打包」兩項（targets 已配置 + CI 產出），補 comment 連到本 spec。

## 產物

| 平台 | Runner | 產物 |
|---|---|---|
| macOS | macos-latest | `desktop-notify-<ver>-arm64.dmg` |
| Windows | windows-latest | `desktop-notify Setup <ver>.exe`（nsis x64） |
| Linux | ubuntu-latest | `desktop-notify-<ver>.AppImage` + `.deb`（x64） |

## 風險與緩解

- **290 單測首次在 win/linux 跑**：路徑類測試（prefs／window-state 用 tmp dir）可能踩分隔符差異。CI 第一輪即暴露；視為要修的真 bug，修到綠為止。
- **ubuntu runner 出 AppImage**：build 不需 fuse（只有執行需要），標準 runner 可產出。
- **macos-latest = arm64 runner**：與現行 dmg target（arm64）一致；x64 mac 不在範圍。

## 驗證計畫

1. merge workflow 檔後，先 `workflow_dispatch` 手動跑一輪 → Actions 全綠、draft Release 出現三平台 artifacts。
2. 驗證輪的 draft 直接刪除（不 publish）。
3. 下次真版本（如 v1.0.1）：bump version + CHANGELOG → tag push → draft 出現 → 手動貼 CHANGELOG 段做 release notes → publish。

## 不在範圍

- Windows／Linux 實機行為驗證（#8 另波）
- 自動更新（electron-updater）——unsigned 限制多，獨立 spec
- 簽章／公證
- e2e 進 CI

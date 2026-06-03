# CI Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** push `v*` tag → GitHub Actions 三平台 build（dmg／nsis／AppImage+deb）→ draft GitHub Release；另加 push main/PR 的 typecheck+單測 CI。

**Architecture:** 兩個 workflow 檔（`ci.yml` 平日 gate、`release.yml` tag 觸發三平台 matrix），electron-builder 原生 GitHub publish（draft）負責建 Release 與上傳 artifacts——零自寫 glue。本機 `npm run dist` 不帶 `--publish`、CLI 在非 CI 環境預設 never，行為不變。

**Tech Stack:** GitHub Actions（actions/checkout@v4、actions/setup-node@v4）、electron-builder 的 GitHub publish provider、gh CLI（驗證與 issue 操作）。

**Spec:** `docs/superpowers/specs/2026-06-03-ci-release-pipeline-design.md`

---

## 檔案地圖

| 檔案 | 動作 | 職責 |
|---|---|---|
| `.github/workflows/ci.yml` | Create | push main / PR → ubuntu → typecheck + 單測 |
| `.github/workflows/release.yml` | Create | v* tag / workflow_dispatch → 三平台 matrix → gate → build+publish draft |
| `electron-builder.yml` | Modify | 加 `publish:` 區塊（github / draft） |
| `docs/CROSS_PLATFORM.md` | Modify | 補「Release pipeline」一節 |
| GitHub issue #8 | Update | 勾「Windows 打包」「Linux 打包」、comment 連 spec |

注意：workflow 檔無法單測——驗證手段是 push 後的實際 run（Task 4、5）。Task 1-3 的「verify」是 YAML 可解析 + 內容比對。

---

### Task 1: push CI workflow（ci.yml）

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 建立 workflow 檔**

寫入 `.github/workflows/ci.yml`（完整內容）：

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
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 2: 驗證 YAML 可解析**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml"); puts "yaml OK"'`
Expected: `yaml OK`（macOS 內建 ruby；若無 ruby 改用 `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml OK')"`，PyYAML 缺就跳過此步——Task 4 的實際 run 是最終驗證）

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: push main/PR 跑 typecheck+單測（ubuntu）"
```

### Task 2: release workflow（release.yml）

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: 建立 workflow 檔**

寫入 `.github/workflows/release.yml`（完整內容）：

```yaml
name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch: # 驗證 pipeline 用：無 tag 時 electron-builder 以 package.json version 命名 draft
permissions:
  contents: write # 建 draft release + 上傳 artifacts
jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

要點（實作者須知）：
- `electron-builder` 不帶平台 flag → 依 runner 平台選 `electron-builder.yml` 的對應 target（mac dmg／win nsis／linux AppImage+deb），與本機 `npm run dist` 同行為。
- `npx electron-builder` 內部會先跑 `npm run build`？**不會**——electron-builder 只打包 `out/`。但本專案 `package.json` 的 `dist` script 是 `npm run build && electron-builder`。所以 workflow 的 build step 必須改用 **`npm run dist -- --publish always`** 而非裸 `npx electron-builder`，否則 `out/` 不存在打包到空殼。上面 YAML 的最後一個 run step 改為：

```yaml
      - run: npm run dist -- --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

（最終檔案以這版為準；`--` 把 flag 傳給 script 尾端的 electron-builder。）

- [ ] **Step 2: 驗證 YAML 可解析**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/release.yml"); puts "yaml OK"'`
Expected: `yaml OK`

- [ ] **Step 3: 比對 package.json 的 dist script 確認 `--` 傳遞成立**

Run: `jq -r '.scripts.dist' package.json`
Expected: 形如 `npm run build && electron-builder`（electron-builder 在尾端 → `npm run dist -- --publish always` 的 flag 會接到 electron-builder）。
若實際是其他形狀（例如 flag 接不到尾端指令），改 release.yml 為兩步：`- run: npm run build` ＋ `- run: npx electron-builder --publish always`。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: v* tag → 三平台 build → draft Release（workflow_dispatch 可手動驗證）"
```

### Task 3: electron-builder publish 設定

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: 加 publish 區塊**

在 `electron-builder.yml` 頂層（appId/productName 同層）加：

```yaml
publish:
  provider: github
  releaseType: draft
```

- [ ] **Step 2: 驗證本機行為不變（不上傳）**

Run: `npx electron-builder --help 2>&1 | head -3 && ruby -ryaml -e 'cfg=YAML.load_file("electron-builder.yml"); puts cfg["publish"].inspect'`
Expected: help 正常輸出 + `{"provider"=>"github", "releaseType"=>"draft"}`。
本機不帶 `--publish` 時 CLI 預設 `never`（非 CI 環境），故 `npm run dist` 仍只出本機檔案——不需實跑整個 dist 驗證。

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "build: electron-builder 加 GitHub publish（draft）供 CI 用"
```

### Task 4: push 與 push CI 首輪驗證

**Files:**（無——遠端操作）

- [ ] **Step 1: push main**

```bash
git push origin main
```

- [ ] **Step 2: 等 push CI 完成**

Run: `gh run watch $(gh run list --workflow=ci.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`
Expected: exit 0、job `test` 綠（typecheck + 290 單測過）。
若紅：讀 log（`gh run view --log-failed`），常見因＝lockfile 與 node 版本不符（確認 setup-node 20 與本機一致）→ 修正、commit、push、重看。

### Task 5: release pipeline 驗證輪（workflow_dispatch）

**Files:**（無——遠端操作）

- [ ] **Step 1: 手動觸發 release workflow**

```bash
gh workflow run release.yml
sleep 10
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: 三平台 job 全綠（各 ~5-10 分鐘；windows 最慢）。
已知風險：**290 單測首次在 windows/ubuntu 跑**，路徑類測試（prefs／window-state 的 tmp dir、path join）可能踩分隔符差異——紅了視為真 bug：`gh run view --log-failed` 找失敗測試，修 source（不是改測試遷就），本機 `npm test` 綠後 push 重跑。

- [ ] **Step 2: 確認 draft Release 與三平台 artifacts**

```bash
gh release list --limit 3
gh release view --json assets -q '.assets[].name' "$(gh release list --limit 1 --json tagName,isDraft -q '.[0].tagName')"
```

Expected: 一個 draft（workflow_dispatch 輪以 package.json version 命名，如 `v1.0.0` 既存則 builder 沿用該 tag 的 draft 或建新 draft），assets 含：`*-arm64.dmg`、`*Setup*.exe`、`*.AppImage`、`*.deb`（外加 blockmap／yml 中繼檔屬正常）。
注意：v1.0.0 已是 published release——builder 對同 version 會另建 draft 而非碰已發佈者；若 assets 衝突報錯，把 `package.json` version 臨時視角無關（不改），直接看 draft 內容即可。

- [ ] **Step 3: 刪除驗證 draft**

```bash
gh release list --limit 5   # 找出 isDraft=true 那筆的 tag
gh release delete <draft-tag> --yes
```

Expected: 驗證 draft 消失；published 的 v1.0.0 不動。

### Task 6: 文件與 issue 收尾

**Files:**
- Modify: `docs/CROSS_PLATFORM.md`
- Update: GitHub issue #8

- [ ] **Step 1: CROSS_PLATFORM.md 補 Release pipeline 一節**

在 `## Font Notes` 之前插入：

```markdown
## Release Pipeline

Push a `v*` tag and GitHub Actions builds all three platforms and uploads to a **draft** GitHub Release:

1. Bump `version` in `package.json`, update `CHANGELOG.md`, commit.
2. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`
3. Wait for the Release workflow (macos / windows / ubuntu matrix; each runs typecheck + unit tests before packaging).
4. Open the draft Release, paste the CHANGELOG section as release notes, verify artifacts (dmg / nsis exe / AppImage / deb), then publish.

`workflow_dispatch` on the Release workflow runs the same pipeline without a tag (draft named from `package.json` version) — use it to validate pipeline changes, then delete the draft.

All artifacts are **unsigned**: macOS users may need right-click → Open on first launch (Gatekeeper); Windows SmartScreen will warn on the nsis installer.
```

- [ ] **Step 2: Commit + push**

```bash
git add docs/CROSS_PLATFORM.md
git commit -m "docs: CROSS_PLATFORM 補 release pipeline 流程"
git push origin main
```

- [ ] **Step 3: 更新 issue #8**

```bash
gh issue comment 8 --body "CI release pipeline 已落地（spec: docs/superpowers/specs/2026-06-03-ci-release-pipeline-design.md）：
- v* tag → Actions 三平台 build（dmg / nsis / AppImage+deb）→ draft Release
- workflow_dispatch 驗證輪三平台 artifacts 已確認
- 「Windows 打包」「Linux 打包」兩項由 CI 產出 cover；實機行為驗證仍 open"
```

然後用 `gh issue view 8` 取 body、把「- [ ] **Windows 打包**」「- [ ] **Linux 打包**」改 `[x]` 後 `gh issue edit 8 --body-file -` 寫回。

Expected: issue #8 兩項勾掉、comment 出現。

---

## Self-Review（已跑）

- **Spec coverage**：ci.yml（Task 1）、release.yml（Task 2）、publish 區塊（Task 3）、CROSS_PLATFORM 節（Task 6）、issue #8（Task 6）、驗證計畫（Task 4-5）——spec 全項有任務。
- **Placeholder scan**：無 TBD；Task 2 內嵌「dist script 形狀」檢查步驟取代盲信。
- **一致性**：release.yml 最終版用 `npm run dist -- --publish always`（Task 2 Step 1 要點段為準）；Task 5 的驗證指令與其產物命名一致。

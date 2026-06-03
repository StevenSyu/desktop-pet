# Cross-Platform Packaging and Validation

This project is macOS-first, with Windows and Linux support enabled for local testing and packaging.

## Build Targets

The Electron Builder config supports:

- macOS: `dmg`
- Windows: `nsis`
- Linux: `AppImage`, `deb`

Commands:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

`npm run dist` builds the app and lets `electron-builder` choose the current platform target.

## Windows Notes

Windows transparent windows do not behave like macOS `setIgnoreMouseEvents(..., { forward: true })`.
For pet windows, Windows keeps mouse events enabled and limits the input region with `BrowserWindow.setShape()`.
This prevents transparent pet-window padding from blocking hover, click, drag, or context menu events on another pet.

Verified on Windows during issue #8 work:

- App starts with multiple pet windows.
- Local `/notify` endpoint receives test events.
- Pet renderers keep CSS animation running with `backgroundThrottling: false`.
- Multi-pet transparent hit regions are constrained with `setShape()`.
- Pet drag keeps notification cards aligned using the same drag-frame bounds sent from main.

## Linux Notes

Linux packaging targets are configured, but Linux behavior still needs a real desktop-environment pass.
Transparent windows and always-on-top behavior can vary between X11, Wayland, and compositors.

On Windows, `npx electron-builder --linux --dir` can produce `release/linux-unpacked`.
Building AppImage/deb from Windows may fail when `app-builder` needs to create symlinks and the current user does not have that privilege.
Run the full Linux packaging command on Linux/CI, or enable Windows Developer Mode / run from an elevated environment before cross-building Linux installers.

Recommended Linux validation matrix:

- AppImage launches.
- deb installs and launches.
- Pet windows render with transparent background.
- Pet windows stay above ordinary app windows.
- Hook script reads `$XDG_CONFIG_HOME/desktop-notify/endpoint.json` or `~/.config/desktop-notify/endpoint.json`.
- `/notify` events trigger pet animation and cards.
- Notification center, settings, channel manager, and skin picker open without native toolbar regressions.
- Drag, resize, hover, right-click menu, and multi-pet hit testing work under the target desktop session.
- `pet://` loads bundled and user-installed skins.

## Release Pipeline

Push a `v*` tag and GitHub Actions builds all three platforms and uploads to a **draft** GitHub Release:

1. Bump `version` in `package.json`, update `CHANGELOG.md`, commit.
2. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`
3. Wait for the Release workflow (macos / windows / ubuntu matrix; each runner gates on typecheck + unit tests before packaging).
4. Open the draft Release, paste the CHANGELOG section as release notes, verify artifacts (dmg / nsis exe / AppImage / deb), then publish.

To validate pipeline changes without a tag, trigger the Release workflow via `workflow_dispatch` with the optional `test_version` input (e.g. `0.0.0-ci-test`) so the draft does not collide with a real version — then delete the draft afterwards.

All artifacts are **unsigned**: macOS users may need right-click → Open on first launch (Gatekeeper); Windows SmartScreen will warn on the nsis installer.

## Font Notes

The app currently falls back to `"Segoe UI"` on Windows and system sans-serif fonts on Linux.
If a rounder visual match is required across platforms, package a dedicated font and reference it from renderer CSS.

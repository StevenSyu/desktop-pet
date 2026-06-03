# Codex Hooks

Desktop Pet can receive lifecycle notifications from Codex through Codex hooks.

## What is configured

The recommended user-level config is written to:

```text
~/.codex/hooks.json
```

This keeps the hook available across Codex projects. Codex loads this file independently of project trust.

The hook events are mapped like this:

| Codex event | Pet notification type | Meaning |
| --- | --- | --- |
| `PermissionRequest` | `attention` | Codex needs approval or attention |
| `Stop` | `done` | The Codex turn finished |

The hook command runs:

```text
node hooks/codex-notify.mjs <type>
```

`codex-notify.mjs` reads Codex hook JSON from stdin when available, then posts to the running app through the local `endpoint.json` file.

## Generate the config

From the project root:

```bash
npm run hooks:codex-config
```

This prints a `hooks.json` payload with absolute paths for the current machine.

On Windows, the generated hook includes both `command` and `commandWindows` so Codex can run the same command through the Windows hook override.

## Install

Write the generated JSON to:

```text
C:\Users\<you>\.codex\hooks.json
```

Example:

```powershell
npm run --silent hooks:codex-config | Set-Content -LiteralPath "$HOME\.codex\hooks.json" -Encoding UTF8
```

If `hooks.json` already exists, merge the `hooks` object instead of replacing it.

## Trust the hooks

Codex requires non-managed command hooks to be reviewed and trusted before they run.

Open Codex and run:

```text
/hooks
```

Review the new `desktop-pet/hooks/codex-notify.mjs` commands, then trust them. If you change the hook file or command later, Codex may ask you to review the updated hook again.

## Test

Start Desktop Pet first:

```bash
npm run dev
```

Then run a direct hook test:

```powershell
'{"session_id":"codex-test","cwd":"C:\\Users\\f7721\\Downloads\\新增資料夾\\desktop-pet","event":"manual-test"}' | node hooks\codex-notify.mjs done
```

Optional debug log:

```powershell
$env:DESKPET_HOOK_LOG = "$env:TEMP\deskpet-codex-hook.log"
'{"session_id":"codex-test","cwd":"C:\\Users\\f7721\\Downloads\\新增資料夾\\desktop-pet","event":"manual-test"}' | node hooks\codex-notify.mjs done
Get-Content $env:DESKPET_HOOK_LOG
```

You should see `posted 127.0.0.1:<port>` when the app is running.

## Disable

Remove `~/.codex/hooks.json`, remove the Desktop Pet entries from it, or disable hooks globally in `~/.codex/config.toml`:

```toml
[features]
hooks = false
```

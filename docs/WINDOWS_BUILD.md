# Сборка под Windows (временная схема)

Пока нет локального GitLab с CI/CD, Windows-сборка FocusGlass делается на тестовой виртуалке с Windows 11.

## Виртуалка

- Адрес: `51.250.70.150`, доступ по RDP (`3389`) и SSH (`22`, OpenSSH for Windows, оболочка по умолчанию — PowerShell).
- Логин и пароль **в репозиторий не кладём** — спросить у владельца проекта.
- Блокировка учёток после неверных паролей отключена (`net accounts /lockoutthreshold:0`): RDP открыт в интернет, и боты постоянно блокировали `Administrator`. Вернуть, когда закроем порты группой безопасности.
- Политика выполнения скриптов PowerShell закрыта: запускать с `-ExecutionPolicy Bypass`, `npm` и `npx` вызывать как `npm.cmd` / `npx.cmd`.

## Что установлено

| Что | Где |
|---|---|
| Git (MinGit 2.47) | `C:\git\cmd` |
| Node.js 26 / npm 11 | `C:\node` |
| Rust 1.99 (MSVC) | `C:\rust` (`RUSTUP_HOME=C:\rust\rustup`, `CARGO_HOME=C:\rust\cargo`) |
| Visual Studio Build Tools 2022 | стандартный путь |
| WebView2 Runtime | системный |

Всё прописано в системный `PATH`.

## Где что лежит

- `C:\src\FocusGlass` — клон этого репозитория (`https://github.com/Da4n1k/FocusGlass.git`).
- `C:\FocusGlassApp` — результат сборки: `FocusGlass.exe` и установщик `FocusGlass_<версия>_x64-setup.exe`.
- `C:\build\build-git.log` — лог последней сборки.
- `C:\build`, `C:\FocusGlass` — старая ручная сборка из zip-архива (29.10), можно не трогать.

## Как собрать

С Linux/macOS по SSH:

```bash
ssh Administrator@51.250.70.150 "powershell -ExecutionPolicy Bypass -File C:\src\FocusGlass\scripts\windows\build.ps1"
```

Или в RDP, в PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File C:\src\FocusGlass\scripts\windows\build.ps1
```

Скрипт [`scripts/windows/build.ps1`](../scripts/windows/build.ps1) делает `git pull --ff-only`, `npm ci`, `npx tauri build` и копирует `.exe` и установщик в `C:\FocusGlassApp`. На любой ошибке падает с ненулевым кодом, в конце успешной сборки печатает `BUILD_OK`. Флаг `-NoPull` — собрать без обновления репы.

Tauri автоматически подхватывает `src-tauri/tauri.windows.conf.json`: цель NSIS
и режим установки `perMachine` сохранены. Скрипт менять не нужно. Linux-сборка
использует отдельный платформенный конфиг, см. [LINUX_BUILD.md](LINUX_BUILD.md).

Первая сборка Rust идёт около 5 минут (проверено 30.10: 4 мин на компиляцию + установщик NSIS 2,7 МБ), повторные — быстрее (кеш в `src-tauri\target`).

Требуется Rust не ниже 1.85 (`edition = "2024"`).

На машине без Visual Studio Build Tools можно собирать GNU-тулчейном: `rustup toolchain install stable-x86_64-pc-windows-gnu`, затем перед сборкой `$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"`. Перед первым запуском `npm.cmd run desktop:build` вручную на чистом клоне выполните `powershell -ExecutionPolicy Bypass -File scripts\fetch-neurosdk2.ps1`, чтобы в `src-tauri\vendor\neurosdk2-x64.dll` скачалась библиотека NeuroSDK2 для бандлинга. Собирать именно через `npm.cmd run desktop:build` (`npx.cmd tauri build`): обычный `cargo build --release` даёт dev-бинарник, который ищет `localhost:5173`.

На Windows после `npm.cmd run desktop:build` и `npm.cmd run desktop:build:binary` автоматически срабатывает [`scripts/sync-build-artifacts.mjs`](../scripts/sync-build-artifacts.mjs) (`postdesktop:build` / `postdesktop:build:binary`), копирующий `FocusGlass.exe`, `neurosdk2-x64.dll`, `WebView2Loader.dll` и `FocusGlass_<версия>_x64-setup.exe` в `..\FocusGlass-build` (путь можно переопределить через `FOCUSGLASS_BUILD_OUT_DIR`, а автосинхронизацию отключить флагом `FOCUSGLASS_SKIP_ARTIFACT_SYNC=1`; при `CI=true` без `FOCUSGLASS_BUILD_OUT_DIR` скрипт не выполняется). Ручная синхронизация уже собранных артефактов — `npm.cmd run desktop:sync-artifacts`.

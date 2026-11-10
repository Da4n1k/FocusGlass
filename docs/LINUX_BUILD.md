# Запуск и сборка под Linux

Windows и Linux используют одну кодовую базу. Cargo-профили `dev` / `release`
определяют оптимизацию, а не ОС. Tauri автоматически объединяет
`src-tauri/tauri.conf.json` с конфигом целевой платформы:

- `tauri.linux.conf.json` — пакеты DEB и AppImage;
- `tauri.windows.conf.json` — установщик NSIS, сборка на Windows.

Передавать `--config` вручную не нужно. Linux-конфиг не превращает Linux-сборку
в Windows-сборку и наоборот. Windows собираем на Windows-виртуалке по
[существующей инструкции](WINDOWS_BUILD.md).

## Зависимости

Нужны Rust (через rustup), Node.js с npm, C/C++ toolchain и системные библиотеки
Tauri. GTK/WebKitGTK нужны самой оболочке, интерфейс остаётся на React.

Arch Linux:

```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf
```

Ubuntu 22.04 / 24.04:

```bash
sudo apt update
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev
```

## Запуск

Из корня репозитория, не из `src-tauri`:

```bash
npm ci
npm run desktop:dev
```

Ошибка `tauri: command not found` при `npm run tauri dev` означает, что локальный
CLI не установлен: сначала выполните `npm ci` с dev-зависимостями. Глобальная
установка Tauri CLI не требуется. `npm run dev` запускает только веб-интерфейс,
без нативного окна.

## Сборка

```bash
# Release-бинарник без установочных пакетов
npm run desktop:build:binary

# Release-бинарник и пакеты DEB / AppImage
npm run desktop:build
```

Бинарник: `src-tauri/target/release/focusglass`.
Пакеты: `src-tauri/target/release/bundle/`.
Обычный бинарник требует установленных runtime-библиотек Tauri на целевой машине.
Упаковка AppImage может потребовать дополнительных системных инструментов;
успешная сборка бинарника не подтверждает успешную упаковку.

## Wayland и X11

Запуск окна проверен в Arch Linux с niri / Wayland. Это не означает, что
проверены все функции оверлея: always-on-top, глобальный `Ctrl+Shift+G`,
максимизация и сквозные клики зависят от композитора и backend GTK.
В частности, X11-хоткей через XWayland не гарантирует работу поверх нативных
Wayland-приложений. Не включайте click-through, пока не проверите возврат
управления горячей клавишей в своём окружении.

Нативное размытие рабочего стола эта конфигурация не добавляет.
Не устанавливайте глобально `GDK_BACKEND` или переменные отключения ускорения
WebKit без конкретной воспроизводимой проблемы.

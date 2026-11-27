# FocusGlass native Linux effects

Shared C++20 / Qt / OpenGL renderer, with two adapters:

* **KDE / Wayland:** version-matched KWin 6 effect. Copies the actual compositor
  render target into a GPU texture before applying a separable blur. No portal,
  screenshot round trip or overlay feedback loop.
* **X11:** `focusglass-x11` reads redirected window pixmaps through XComposite,
  reconstructs stacking order using XRender, downsamples on the X server, then
  uploads the reduced image to the same GPU renderer. Requires an existing
  compositing manager; never replaces the window manager.

The OS-authenticated controlling PID identifies FocusGlass windows, including its
HUD; dock windows are also excluded. Docks use their input region (Wayland
surface input / X11 ShapeInput), without the transparent buffer margins,
work-area reservation or extra padding that can leave a sharp bottom strip.
Protected rectangles discard both blur and
particles. The X11 window has an empty input shape, does not accept focus, and
uses premultiplied alpha; the KWin effect has no input window at all.

The standalone compact HUD has no transparent outer gutter: its window fits the
card itself at every DPI. Control protection stops at the window edge without
extra padding; surrounding shadows/glow remain blurred.

## Build

Dependencies: C++20 compiler, CMake >= 3.22, Ninja, pkg-config, libepoxy, Qt
Core/Gui/Network/OpenGL, X11/XComposite/XRender/XFixes/Xext development files.
For KDE also install the **exact running KWin version's** development package,
Qt 6 Widgets/DBus and KDE Extra CMake Modules.

Example Arch packages (installation requires administrator approval):

```sh
sudo pacman -S --needed base-devel cmake ninja extra-cmake-modules qt6-base kwin libepoxy libxcomposite libxrender libxfixes libxext
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX=/usr -DKDE_INSTALL_USE_QT_SYS_PATHS=ON
cmake --build native/build
```

X11-only build, including on distributions with Qt 5:

```sh
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DFOCUSGLASS_BUILD_KWIN=OFF
cmake --build native/build
```

Build on the target distribution. A binary linked to a newer host's Qt/glibc is
not a portable Astra binary. Qt 5 build compatibility is not a substitute for a
test on the required Astra release.

## Install and run

Run the application normally. **No separate terminal installation is required.**

* **KDE Wayland:** startup checks the exact running KWin ABI and compares the
  bundled plugin with the installed file. An update/first installation opens
  the normal **Polkit graphical authorization dialog**. After approval, the
  plugin is replaced atomically and enabled through KWin's DBus API. A matching
  installation is reused without prompting. Declining authorization keeps blur
  disabled; settings show the setup error. The desktop session is never restarted.
* **X11:** the Rust worker starts/stops the bundled `focusglass-x11` helper.
* **Development:** `npm run desktop:dev` builds/stages native effects before Vite
  starts, then the same runtime setup installs/enables the KDE plugin as needed.
  Development still requires the compiler/CMake/Qt/KWin development dependencies
  listed above. `FOCUSGLASS_BUILD_KWIN=1` enables KDE builds on a headless builder;
  `0` selects X11-only builds. KDE is selected automatically in a KDE session.
* **Packages:** the Linux Tauri bundle includes the plugin, setup helper and X11
  helper under `native/`. Build for the exact target KWin version. Incompatible
  packages are rejected before privilege escalation, not loaded into the compositor.

To disable immediately (optional troubleshooting):

```sh
qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect focusglass
```

No host compositor is restarted by the build/tests.

The worker also rejects old plugin protocol versions rather than silently using
an outdated renderer. Set `FOCUSGLASS_AUTO_INSTALL_KWIN=0` only for isolated tests
or an externally managed installation.

Without a loaded native effect, Wayland blur stays disabled and the settings
show an actionable error. The old layer-shell fallback blurs **the dashboard
and HUD too**, cannot render the particle wave, and is not a compatible backend.
It is now experimental opt-in only:
`FOCUSGLASS_UNSAFE_WAYLAND_BLUR_FALLBACK=1` (not recommended).

Select **Блюр по порогу**, then use the settings' three-second preview. Normal
feedback follows the engine's threshold, contact, pause and stream state.
The native radius is `settings.blurRadius / 2`: UI range **0–16 logical px**,
default **8 px**. Zero disables normal blur and is explicitly marked in settings.
On threshold crossing, a soft diagonal wave starts at the top-left. Dots appear
first; blur follows each part of the wave 450 ms later. The complete screen
reaches full blur after **2.7 seconds**. Preview uses the same introduction.
At rest
the sharp scene is fully replaced, not permanently blended with the blurred one.
Windows retains its existing scale.

## Control and safety

Unix socket: `$XDG_RUNTIME_DIR/focusglass-effects-<display>.sock`, overridable
with `FOCUSGLASS_EFFECT_SOCKET`. Both processes must use the same path/display.
The server restricts the socket to the current user and checks `SO_PEERCRED`.
Newline-delimited JSON has bounded buffers:

* `{"op":"update","amount":0.4,"radius":4,"frozen":false}`
* `{"op":"preview","radius":8}` — three seconds at the selected radius
  (default 8); zero-value updates do not cancel it.
* `{"op":"stop"}`, `{"op":"status"}`

Normal updates need a heartbeat. Abandoned effects fade out; stale EEG clears
the Rust target after two seconds. Artifact freezing suspends animation but
does not prevent watchdog clearing. Render/capture errors disable the effect.
KWin does not render the effect while the screen is locked.

Particles use a deterministic jittered grid, smooth diagonal reveal, damped
spring return and cursor repulsion within **180 logical px**. Physics is active
during the introduction too; a pointer exactly on a dot also pushes it away.
Both adapters use the same logical-coordinate timeline, shader and physics.
Only the explicit `diagnose` operation skips the introduction for a settled GPU
probe. This is an adaptation of the visual reference, not a pixel-identical port.

## Reproducible isolated tests

On an Arch development host, `fetch-test-tools.py` downloads tools into
`/tmp/opencode/focusglass-native-tools`; it does not install system packages.
`fetch-fly-test.py` extracts SHA256-checked official Astra Common packages.
The latter is **not** an Astra SE environment.

```sh
python3 scripts/linux/fetch-test-tools.py
python3 scripts/linux/test-native.py
FOCUSGLASS_TEST_RUST=1 python3 scripts/linux/test-native.py
python3 scripts/linux/test-kwin.py
python3 scripts/linux/test-kwin-setup.py
python3 scripts/linux/test-kwin-desktop.py
FOCUSGLASS_TEST_NO_PLUGIN=1 python3 scripts/linux/test-kwin-desktop.py
FOCUSGLASS_TEST_RUST=1 python3 scripts/linux/test-kwin.py
python3 scripts/linux/fetch-fly-test.py
FOCUSGLASS_TEST_FLY=1 python3 scripts/linux/test-native.py
```

KWin test requires a running parent Wayland compositor and matching KWin
development/runtime files. X11 tests use private Xvfb + picom. Fly tests add the
real official Fly WM in a bubblewrap sandbox with a private HOME and shared-memory
directory, and require the fixtures to be managed before testing blur.
Assertions are not skipped when Fly fails to initialize.

Results/logs are written under `/tmp/opencode/focusglass-{native,kwin,fly}-test`.
Readbacks and diagnostic PNGs in the KWin plugin are enabled **only** by
`FOCUSGLASS_EFFECT_TEST_PROBE` in the isolated test; production does no readback.

## Remaining acceptance checks

Nested-compositor and software-rendering tests do not establish behavior on every
GPU, Astra SE security policy, or multi-monitor layout. Check moving/resizing
windows, mixed DPI/rotation, screen lock, notifications, autohide panels,
protected video and the actual production Astra/Fly installation.
Control exclusions preserve visible window frames; dock exclusions follow input
regions. Both are occlusion-aware. X11 reconstructs window pixmaps, not compositor-specific
shadows/color-management or every wallpaper implementation.

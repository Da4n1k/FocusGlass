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
HUD; dock windows are also excluded. Protected rectangles discard both blur and
particles. The X11 window has an empty input shape, does not accept focus, and
uses premultiplied alpha; the KWin effect has no input window at all.

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

X11: place `focusglass-x11` beside the application, in `/usr/local/bin`, or set
`FOCUSGLASS_X11_HELPER=/absolute/path/focusglass-x11`. The Rust worker starts and
stops its own helper. A development checkout also searches `native/build`.

KDE: inspect the actual install destinations before installing:

```sh
DESTDIR="$PWD/native/stage" cmake --install native/build
find native/stage -name focusglass.so
```

Install the effect into the matching Qt/KWin plugin prefix using the packaging
conventions of the target distribution (`cmake --install` may require sudo).
Do not copy a KWin 6 plugin into KWin 5 or a different KWin ABI. Enable FocusGlass
in Desktop Effects, or load it in the current session:

```sh
qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect focusglass
```

Restart FocusGlass after loading the plugin. To disable immediately:

```sh
qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect focusglass
```

No host compositor is restarted by the build/tests.

Select **Блюр по порогу**, then use the settings' three-second preview. Normal
feedback follows the engine's threshold, contact, pause and stream state.
The native radius is `settings.blurRadius / 2`: UI range **0–16 logical px**,
default **8 px**. Zero disables normal blur and is explicitly marked in settings.
The threshold reaction starts immediately (with a short fade), without waiting
for particles or passing the proportional dimmer's opacity dead zone. At rest
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

Particles use a deterministic jittered grid, diagonal reveal, damped spring
return and cursor repulsion. Ambient physics starts at 4.16 s, as in the demo.
Blur no longer waits for the 3.08 s introduction:
immediate, visible feedback takes priority. Preview skips the introduction.
This is an adaptation of the visual reference, not a pixel-identical port.

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
Rectangular exclusions preserve entire window frames, not arbitrary shapes or
occlusion-aware masks. X11 reconstructs window pixmaps, not compositor-specific
shadows/color-management or every wallpaper implementation.

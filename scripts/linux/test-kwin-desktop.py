#!/usr/bin/env python3
"""Real desktop:dev + GTK/WebKit inside a private nested KWin, not a Qt fixture."""
import http.server
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import dbus

if "--inner" not in sys.argv:
    raise SystemExit(subprocess.call(["dbus-run-session", "--", sys.executable, __file__, "--inner"]))

repo = pathlib.Path(__file__).resolve().parents[2]
no_plugin = os.environ.get("FOCUSGLASS_TEST_NO_PLUGIN") == "1"
artifacts = pathlib.Path("/tmp/opencode/focusglass-kwin-desktop-no-plugin-test" if no_plugin
                         else "/tmp/opencode/focusglass-kwin-desktop-test")
artifacts.mkdir(exist_ok=True)
env = dict(os.environ, QT_PLUGIN_PATH=str(repo/"native/build/plugins")+":/usr/lib/qt6/plugins",
           XDG_CONFIG_HOME=str(artifacts/"config"), XDG_DATA_HOME=str(artifacts/"data"),
           XDG_CACHE_HOME=str(artifacts/"cache"),
           FOCUSGLASS_EFFECT_SOCKET=str(artifacts/"effect.sock"),
           FOCUSGLASS_AUTO_INSTALL_KWIN="0",
           FOCUSGLASS_EFFECT_TEST_PROBE=str(artifacts), QT_QPA_PLATFORMTHEME="", NO_AT_BRIDGE="1")
pathlib.Path(env["XDG_CONFIG_HOME"]).mkdir(exist_ok=True)
(pathlib.Path(env["XDG_CONFIG_HOME"])/"kwinrc").write_text(
    "[Plugins]\nfocusglassEnabled="+("false" if no_plugin else "true")+"\n")
children, logs = [], []
phase = "dashboard"
application_status = None

def launch(args, environment):
    log = open(artifacts/(pathlib.Path(args[0]).name+f"-{len(children)}.log"), "w")
    logs.append(log)
    child = subprocess.Popen(args, cwd=repo, env=environment, stdout=log,
                             stderr=subprocess.STDOUT, start_new_session=True)
    children.append(child)
    return child

def eventually(check, seconds=15):
    deadline = time.monotonic()+seconds
    while time.monotonic()<deadline:
        value = check()
        if value:
            return value
        time.sleep(.1)
    raise AssertionError("Timed out waiting for real desktop:dev; inspect "+str(artifacts))

def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]

vite_port = free_port()

class Proxy(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        global application_status
        if self.path != "/__fg_test_status":
            self.send_error(404)
            return
        application_status = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/__fg_test_phase":
            data = json.dumps({"phase": phase}).encode()
            content_type = "application/json"
        else:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{vite_port}"+self.path) as response:
                    data = response.read()
                    content_type = response.headers.get("Content-Type", "application/octet-stream")
            except Exception as error:
                self.send_error(502, str(error))
                return
            if self.path == "/":
                # Test-only injection, served by this private proxy. No test
                # commands or arbitrary eval hooks are added to the application.
                data += b"""<script type="module">
                import { useFocusStore as store } from '/src/stores/useFocusStore.ts';
                import { tauriBridge as bridge } from '/src/services/tauriBridge.ts';
                let previous = '';
                setInterval(async () => {
                    const status = await bridge.getLinuxBlurStatus();
                    await fetch('/__fg_test_status',{method:'POST',body:JSON.stringify(status)});
                    const {phase} = await (await fetch('/__fg_test_phase')).json();
                    const state = store.getState();
                    if (!state.isTauri || phase === previous) return;
                    previous = phase;
                    state.updateSettings({deviceSource:'simulator',overlayMode:'threshold_blur',threshold:95});
                    state.setPreset('attention_drift');
                    state.setViewMode(phase);
                }, 200);
                </script>"""
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *_):
        pass

proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
threading.Thread(target=proxy.serve_forever, daemon=True).start()
try:
    try:
        os.unlink(env["FOCUSGLASS_EFFECT_SOCKET"])
    except FileNotFoundError:
        pass
    launch(["kwin_wayland", "--wayland-display", os.environ.get("WAYLAND_DISPLAY", "wayland-1"),
            "--socket", "focusglass-desktop-test", "--width", "1400", "--height", "1000",
            "--no-lockscreen", "--no-global-shortcuts", "--no-kactivities"], env)
    def loaded():
        return subprocess.run(["qdbus6", "org.kde.KWin", "/Effects",
            "org.kde.kwin.Effects.isEffectLoaded", "focusglass"],
            env=env, capture_output=True, text=True).stdout.strip() == ("false" if no_plugin else "true")
    eventually(loaded)
    launch(["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(vite_port), "--strictPort"], env)
    def vite_ready():
        try:
            return urllib.request.urlopen(f"http://127.0.0.1:{vite_port}").status == 200
        except OSError:
            return False
    eventually(vite_ready)
    clients = dict(env, WAYLAND_DISPLAY="focusglass-desktop-test", GDK_BACKEND="wayland",
                   QT_QPA_PLATFORM="wayland", XDG_SESSION_TYPE="wayland")
    launch([str(repo/"native/build/focusglass-native-scene")], clients)
    config = json.dumps({"build":{"devUrl":f"http://127.0.0.1:{proxy.server_port}", "beforeDevCommand":""}})
    launch(["npm", "run", "desktop:dev", "--", "--no-watch", "--config", config], clients)
    if no_plugin:
        eventually(lambda: application_status and application_status.get("backend") == "native-effect-required",
                   seconds=180)
        # The frontend really requests threshold blur; the worker must still
        # keep layer-shell surfaces unmapped, rather than blurring its controls.
        time.sleep(3)
        assert application_status["available"] is False, application_status
        assert application_status["active"] is False, application_status
        assert application_status["mappedOutputs"] == 0, application_status
        (artifacts/"results.json").write_text(json.dumps(application_status,indent=2))
        print(json.dumps(application_status,indent=2),flush=True)
        raise SystemExit(0)
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(5)
    connection.connect(env["FOCUSGLASS_EFFECT_SOCKET"])
    stream = connection.makefile("rwb", buffering=0)
    def status():
        stream.write(b'{"op":"status"}\n')
        value = json.loads(stream.readline())
        assert value["ok"], value
        return value
    def measured():
        value = status()
        return value if value.get("elapsed",0)>2.8 and value.get("frames",0)>40 else None
    dashboard = eventually(measured, seconds=180)
    (artifacts/"dashboard.json").write_text(json.dumps(dashboard,indent=2))
    assert dashboard["protectedControls"] >= 1, ("real main window not recognized", dashboard)
    assert dashboard["diagnostics"]["protectedSamples"] > 100, dashboard
    assert dashboard["diagnostics"]["protectedChanged"] == 0, dashboard
    assert dashboard["diagnostics"]["glError"] == 0, dashboard
    phase = "hud"
    # Wait for native geometry and a fresh frame at the new size.
    start_frames = dashboard["frames"]
    def hud_measured():
        value = status()
        return value if value["frames"] > start_frames+90 else None
    hud = eventually(hud_measured)
    (artifacts/"hud.json").write_text(json.dumps(hud,indent=2))
    assert hud["protectedControls"] >= 1, ("real HUD not recognized", hud)
    assert hud["diagnostics"]["protectedSamples"] > 100, hud
    assert hud["diagnostics"]["protectedChanged"] == 0, hud
    assert hud["diagnostics"]["protectedSamples"] < dashboard["diagnostics"]["protectedSamples"]*.5, \
        ("dashboard-sized sharp hole remained around HUD", dashboard, hud)
    print(json.dumps({"dashboard":dashboard,"hud":hud},indent=2), flush=True)
finally:
    proxy.shutdown()
    proxy.server_close()
    for child in reversed(children):
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    for log in logs:
        log.close()

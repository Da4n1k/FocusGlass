#!/usr/bin/env python3
"""Real KWin plugin in a disposable, private-DBus nested Wayland session."""
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import dbus

repo = pathlib.Path(__file__).resolve().parents[2]
artifacts = pathlib.Path("/tmp/opencode/focusglass-kwin-test")
artifacts.mkdir(exist_ok=True)
if "--inner" not in sys.argv:
    raise SystemExit(subprocess.call(["dbus-run-session","--",sys.executable,__file__,"--inner"]))

env = dict(os.environ,
    QT_PLUGIN_PATH=str(repo/"native/build/plugins")+":/usr/lib/qt6/plugins",
    XDG_CONFIG_HOME=str(artifacts/"config"), XDG_DATA_HOME=str(artifacts/"data"),
    FOCUSGLASS_EFFECT_SOCKET=str(artifacts/"effect.sock"), FOCUSGLASS_EFFECT_TEST_PROBE=str(artifacts),
    QT_FORCE_STDERR_LOGGING="1")
env["QT_QPA_PLATFORMTHEME"] = ""
env["NO_AT_BRIDGE"] = "1"
one_shot = os.environ.get("FOCUSGLASS_TEST_ONESHOT") == "1"
if one_shot:
    env.pop("FOCUSGLASS_EFFECT_TEST_PROBE",None)
pathlib.Path(env["XDG_CONFIG_HOME"]).mkdir(exist_ok=True)
(pathlib.Path(env["XDG_CONFIG_HOME"])/"kwinrc").write_text("[Plugins]\nfocusglassEnabled=true\nblurEnabled=true\n")
children = []
logs = []
def launch(args,environment):
    log = open(artifacts/(pathlib.Path(args[0]).name+f"-{len(children)}.log"),"w")
    logs.append(log)
    process = subprocess.Popen(args,env=environment,stdout=log,stderr=subprocess.STDOUT)
    children.append(process)
    return process
def eventually(check,seconds=10):
    deadline = time.monotonic()+seconds
    while time.monotonic()<deadline:
        result = check()
        if result: return result
        time.sleep(.05)
    raise AssertionError("Timed out waiting for nested KWin test condition")

try:
    try: os.unlink(env["FOCUSGLASS_EFFECT_SOCKET"])
    except FileNotFoundError: pass
    parent_display = os.environ.get("WAYLAND_DISPLAY","wayland-1")
    backend = ["--virtual"] if os.environ.get("FOCUSGLASS_TEST_VIRTUAL") == "1" else ["--wayland-display",parent_display]
    launch(["kwin_wayland",*backend,"--socket","focusglass-test",
        "--width","800","--height","600","--no-lockscreen","--no-global-shortcuts","--no-kactivities"],env)
    def loaded():
        result = subprocess.run(["qdbus6","org.kde.KWin","/Effects",
            "org.kde.kwin.Effects.isEffectLoaded","focusglass"],env=env,capture_output=True,text=True)
        return result.stdout.strip()=="true"
    eventually(loaded)
    info = subprocess.run(["qdbus6","org.kde.KWin","/KWin","org.kde.KWin.supportInformation"],
        env=env,capture_output=True,text=True,check=True).stdout
    (artifacts/"support-information.txt").write_text(info)
    clients = dict(env, WAYLAND_DISPLAY="focusglass-test", QT_QPA_PLATFORM="wayland")
    launch([str(repo/"native/build/focusglass-native-scene"),"--glass"],clients)
    controls = launch([str(repo/"native/build/focusglass-native-scene"),"--controls",
        *(["--diagnose"] if one_shot else [])],clients)
    # Deterministic protection fixture. Otherwise the foreign window can map
    # later and completely cover the controls, legitimately leaving no protected
    # pixels to sample in an occlusion-aware renderer.
    arrange = artifacts/"arrange-controls.js"
    arrange.write_text("""function arrange(w) { if (w.pid === %d) w.keepAbove = true; }
        workspace.windowAdded.connect(arrange); workspace.windowList().forEach(arrange);""" % controls.pid)
    bus = dbus.SessionBus()
    script_id = bus.call_blocking("org.kde.KWin","/Scripting","org.kde.kwin.Scripting",
        "loadScript","ss",(str(arrange),"focusglass-test-arrange"))
    dbus.Interface(bus.get_object("org.kde.KWin","/Scripting/Script"+str(script_id)),
        "org.kde.kwin.Script").run()
    connection = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    connection.settimeout(3)
    connection.connect(env["FOCUSGLASS_EFFECT_SOCKET"])
    stream = connection.makefile("rwb",buffering=0)
    def status():
        stream.write(b'{"op":"status"}\n')
        value=json.loads(stream.readline())
        assert value["ok"],value
        return value
    def measured():
        value=status()
        return value if value.get("elapsed",0)>3.8 and value.get("amount",0)>.4 and value.get("frames",0)>40 and value.get("diagnostics",{}).get("unprotectedChanged",0)>100 else None
    result=eventually(measured,seconds=6)
    assert result["backend"]=="kwin-gpu",result
    assert result["protectedWindows"]>=1,result
    probe=result["diagnostics"]
    assert probe["protectedSamples"]>100,probe
    assert probe["protectedChanged"]==0,probe
    assert probe["glError"]==0,probe
    assert probe["copiedEdgeEnergy"]>probe["originalEdgeEnergy"]*.5,probe
    assert probe["resultEdgeEnergy"]<probe["originalEdgeEnergy"],probe
    # A missing/incomplete texture also removes edges, but is NOT blur.
    assert .7 < probe["resultLight"]/probe["originalLight"] < 1.3,probe
    screenshot = dbus.Interface(dbus.SessionBus().get_object("org.kde.KWin.ScreenShot2",
        "/org/kde/KWin/ScreenShot2"),"org.kde.KWin.ScreenShot2")
    with open(artifacts/"presented.raw","w+b") as raw:
        metadata = screenshot.CaptureArea(dbus.Int32(0),dbus.Int32(0),dbus.Int32(800),dbus.Int32(600),
            dbus.Dictionary({"hide-caller-windows":dbus.Boolean(False)},signature="sv"),dbus.types.UnixFd(raw.fileno()))
        print("Final scene screenshot metadata:",dict(metadata),flush=True)
        eventually(lambda:os.fstat(raw.fileno()).st_size>=int(metadata["stride"])*int(metadata["height"]))
    (artifacts/"presented-metadata.json").write_text(json.dumps(dict(metadata),default=int,indent=2))
    eventually(lambda:not status()["active"],seconds=5)
    result["previewCleared"]=True
    (artifacts/"results.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2),flush=True)
    if os.environ.get("FOCUSGLASS_TEST_RUST") == "1":
        connection.close()
        subprocess.run(["cargo","test","native_worker_preview_and_watchdog","--","--ignored","--nocapture"],
            cwd=repo/"src-tauri",env=dict(clients,XDG_SESSION_TYPE="wayland"),check=True)
    if os.environ.get("FOCUSGLASS_TEST_WEBKIT") == "1":
        subprocess.run(["cargo","test","timers_and_blur_survive_minimize_and_hide","--","--ignored","--nocapture"],
            cwd=repo/"src-tauri",env=dict(clients,XDG_SESSION_TYPE="wayland",
                FOCUSGLASS_WEBKIT_EVIDENCE=str(artifacts/"background-processing.json")),check=True)
finally:
    for process in reversed(children):
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill();process.wait()
    for log in logs: log.close()

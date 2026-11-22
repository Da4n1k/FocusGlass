#!/usr/bin/env python3
"""Opt-in hardware-session probe. Captures ONLY the interior of our synthetic fixture."""
import json
import os
import pathlib
import socket
import struct
import subprocess
import time
import zlib

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
repo = pathlib.Path(__file__).resolve().parents[2]
artifacts = pathlib.Path("/tmp/opencode/focusglass-host-probe")
artifacts.mkdir(exist_ok=True)
bus = dbus.SessionBus()
name = dbus.service.BusName("org.focusglass.NativeProbe",bus)
geometry = None

class Probe(dbus.service.Object):
    @dbus.service.method("org.focusglass.NativeProbe",in_signature="s",out_signature="")
    def Report(self,value):
        global geometry
        geometry = json.loads(value)
probe = Probe(bus,"/Probe")
scripting = dbus.Interface(bus.get_object("org.kde.KWin","/Scripting"),"org.kde.kwin.Scripting")
screenshot = dbus.Interface(bus.get_object("org.kde.KWin.ScreenShot2","/org/kde/KWin/ScreenShot2"),
    "org.kde.KWin.ScreenShot2")
fixture = subprocess.Popen([str(repo/"native/build/focusglass-native-scene")],
    env=dict(os.environ,QT_QPA_PLATFORM="wayland"))
script_name = "focusglass-native-probe-"+str(os.getpid())
script = artifacts/"probe.js"
script.write_text("""
function report(w) {
    if (w.pid !== %d) return;
    w.keepAbove = true;
    workspace.activeWindow = w;
    var r = w.frameGeometry;
    callDBus("org.focusglass.NativeProbe","/Probe","org.focusglass.NativeProbe","Report",
        JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height,id:String(w.internalId)}));
}
workspace.windowAdded.connect(report);
workspace.windowList().forEach(report);
""" % fixture.pid)
connection = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
connection.settimeout(3)
connection.connect(os.path.join(os.environ["XDG_RUNTIME_DIR"],
    "focusglass-effects-"+os.environ["WAYLAND_DISPLAY"]+".sock"))
stream = connection.makefile("rwb",buffering=0)
def request(op):
    stream.write(json.dumps({"op":op}).encode()+b"\n")
    value=json.loads(stream.readline())
    assert value["ok"],value
    return value
def capture(filename):
    # Stay well inside the known foreground synthetic window; no desktop capture.
    x,y=int(geometry["x"])+30,int(geometry["y"])+60
    width,height=300,160
    assert geometry["width"]>=360 and geometry["height"]>=250,geometry
    with open(artifacts/(filename+".raw"),"w+b") as raw:
        metadata=screenshot.CaptureArea(dbus.Int32(x),dbus.Int32(y),dbus.Int32(width),dbus.Int32(height),
            dbus.Dictionary({"hide-caller-windows":dbus.Boolean(False)},signature="sv"),
            dbus.types.UnixFd(raw.fileno()))
        size=int(metadata["stride"])*int(metadata["height"])
        deadline=time.monotonic()+3
        while os.fstat(raw.fileno()).st_size<size:
            assert time.monotonic()<deadline,"Screenshot writer timed out"
            time.sleep(.01)
        raw.seek(0)
        pixels=raw.read()
    # QImage::Format_RGBX8888 / RGBA8888, as reported by current KWin.
    assert int(metadata["format"]) in (16,17,18),dict(metadata)
    stride=int(metadata["stride"])
    packed=b"".join(b"\0"+pixels[y*stride:y*stride+width*4] for y in range(height))
    def chunk(kind,data):
        return struct.pack("!I",len(data))+kind+data+struct.pack("!I",zlib.crc32(kind+data)&0xffffffff)
    (artifacts/(filename+".png")).write_bytes(b"\x89PNG\r\n\x1a\n"+
        chunk(b"IHDR",struct.pack("!IIBBBBB",width,height,8,6,0,0,0))+
        chunk(b"IDAT",zlib.compress(packed))+chunk(b"IEND",b""))
    return pixels

try:
    assert not request("status")["active"],"Do not run while an EEG session controls the effect"
    script_id=bus.call_blocking("org.kde.KWin","/Scripting","org.kde.kwin.Scripting",
        "loadScript","ss",(str(script),script_name))
    dbus.Interface(bus.get_object("org.kde.KWin","/Scripting/Script"+str(script_id)),
        "org.kde.kwin.Script").run()
    deadline=time.monotonic()+5
    while geometry is None:
        while GLib.MainContext.default().pending():
            GLib.MainContext.default().iteration(False)
        assert time.monotonic()<deadline,"Fixture geometry unavailable"
        time.sleep(.02)
    time.sleep(.5)
    before=capture("before")
    request("preview")
    time.sleep(1)
    active=request("status")
    after=capture("during")
    changed=sum(a!=b for a,b in zip(before,after))
    result={"status":active,"changedBytes":changed,"capturedFixturePid":fixture.pid}
    (artifacts/"results.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2),flush=True)
    assert changed>1000,"No visible effect on the synthetic window in the hardware session"
finally:
    request("stop")
    scripting.unloadScript(script_name)
    fixture.terminate()
    fixture.wait(timeout=5)

#!/usr/bin/env python3
"""Isolated X11 integration test. Never replaces or screenshots the user's desktop."""
import ctypes as C
import json
import os
import pathlib
import select
import signal
import socket
import subprocess
import sys
import time
import struct
import zlib

fly = os.environ.get("FOCUSGLASS_TEST_FLY") == "1"
if fly and "--private-bus" not in sys.argv:
    raise SystemExit(subprocess.call(["dbus-run-session","--",sys.executable,__file__,"--private-bus"]))
repo = pathlib.Path(__file__).resolve().parents[2]
prefix = pathlib.Path("/tmp/opencode/focusglass-native-tools/usr")
artifacts = pathlib.Path("/tmp/opencode/focusglass-fly-test" if fly else "/tmp/opencode/focusglass-native-test")
artifacts.mkdir(exist_ok=True)
processes = []
logs = []

def launch(arguments, env):
    log = open(artifacts / (pathlib.Path(arguments[0]).name + ".log"), "w")
    logs.append(log)
    child = subprocess.Popen(arguments, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    processes.append(child)
    return child

def eventually(check, seconds=5):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.03)
    raise AssertionError("Timed out waiting for test condition")

try:
    read_fd, write_fd = os.pipe()
    env = dict(os.environ, LD_LIBRARY_PATH=str(prefix / "lib"),
               QT_QPA_PLATFORM="xcb", QT_SCALE_FACTOR="1", LIBGL_ALWAYS_SOFTWARE="1",
               QT_FORCE_STDERR_LOGGING="1")
    env["QT_QPA_PLATFORMTHEME"] = ""
    env["NO_AT_BRIDGE"] = "1"
    for key in ("WAYLAND_DISPLAY", "QT_SCREEN_SCALE_FACTORS", "QT_AUTO_SCREEN_SCALE_FACTOR"):
        env.pop(key, None)
    xvfb_log = open(artifacts / "Xvfb.log", "w")
    logs.append(xvfb_log)
    xvfb = subprocess.Popen([str(prefix/"bin/Xvfb"), "-displayfd", str(write_fd),
        "-screen", "0", "800x600x24", "-nolisten", "tcp"],
        pass_fds=[write_fd], stdout=xvfb_log, stderr=subprocess.STDOUT, env=env)
    processes.append(xvfb)
    os.close(write_fd)
    assert select.select([read_fd], [], [], 10)[0], "Xvfb did not initialize"
    display_number = os.read(read_fd, 64).strip().decode()
    os.close(read_fd)
    assert display_number, "Xvfb exited before announcing display"
    env["DISPLAY"] = ":" + display_number
    env["XDG_SESSION_TYPE"] = "x11"
    env["FOCUSGLASS_EFFECT_SOCKET"] = str(artifacts/"effect.sock")
    # Only remove this isolated test's stale socket, never a live session's socket.
    try:
        os.unlink(env["FOCUSGLASS_EFFECT_SOCKET"])
    except FileNotFoundError:
        pass
    subprocess.run([str(repo/"native/build/focusglass-native-test")], env=env, check=True)
    x = C.CDLL("libX11.so.6")
    x.XOpenDisplay.restype = C.c_void_p
    x.XOpenDisplay.argtypes = [C.c_char_p]
    display = x.XOpenDisplay(env["DISPLAY"].encode())
    assert display
    W = C.c_ulong
    D = C.c_void_p
    def configure(name, arguments, result=C.c_int):
        function = getattr(x, name)
        function.argtypes = arguments
        function.restype = result
        return function
    root = configure("XDefaultRootWindow", [D], W)(display)
    def save_scene(name):
        image = configure("XGetImage",[D,W,C.c_int,C.c_int,C.c_uint,C.c_uint,W,C.c_int],D)(
            display,root,0,0,800,600,0xffffffff,2)
        if not image: return
        pixel = configure("XGetPixel",[D,C.c_int,C.c_int],W)
        raw = bytearray()
        for y in range(600):
            raw.append(0)
            for xx in range(800):
                value = pixel(image,xx,y)
                raw.extend(((value>>16)&255,(value>>8)&255,value&255))
        configure("XDestroyImage",[D])(image)
        def chunk(kind,data):
            return struct.pack("!I",len(data))+kind+data+struct.pack("!I",zlib.crc32(kind+data)&0xffffffff)
        (artifacts/name).write_bytes(b"\x89PNG\r\n\x1a\n"+
            chunk(b"IHDR",struct.pack("!IIBBBBB",800,600,8,2,0,0,0))+
            chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b""))
    atom = configure("XInternAtom", [D, C.c_char_p, C.c_int], W)
    selection = configure("XGetSelectionOwner", [D, W], W)
    sync = configure("XSync", [D, C.c_int])
    launch([str(prefix/"bin/picom"), "--config", "/dev/null", "--backend", "xrender"], env)
    cm = atom(display, b"_NET_WM_CM_S0", 0)
    eventually(lambda: selection(display, cm) != 0)
    if fly:
        fly_root = pathlib.Path("/tmp/opencode/focusglass-fly")
        home = artifacts/"home"
        home.mkdir(exist_ok=True)
        (home/".fly").mkdir(exist_ok=True)
        (home/"Desktop").mkdir(exist_ok=True)
        runtime = artifacts/"runtime"
        runtime.mkdir(exist_ok=True,mode=0o700)
        rc = home/".fly/en.fly-wmrc"
        rc.write_text(f"[Variables]\nUseSM=false\nUseComposite=false\nImagePath={fly_root}/usr/share/fly-wm/images\n")
        fly_env = dict(env, HOME=str(home), DESKTOP_SESSION="fly", XDG_SESSION_DESKTOP="fly",
            XDG_CURRENT_DESKTOP="FLY", XDG_CONFIG_HOME=str(home/".config"),
            XDG_RUNTIME_DIR=str(runtime),
            XDG_CONFIG_DIRS=str(home/".config"), XDG_DATA_DIRS=str(fly_root/"usr/share"),
            LD_LIBRARY_PATH=":".join(str(p) for p in [
                fly_root/"lib/x86_64-linux-gnu",fly_root/"usr/lib/x86_64-linux-gnu",
                fly_root/"usr/lib",prefix/"lib"]))
        fly_command = ["bwrap", "--ro-bind", "/", "/", "--dev-bind", "/dev", "/dev",
            "--tmpfs", "/dev/shm", "--proc", "/proc", "--overlay-src", "/usr", "--overlay-src", str(fly_root/"usr"),
            "--tmp-overlay", "/usr", "--bind", str(home), str(home),
            "--bind", str(runtime), str(runtime), "--die-with-parent"]
        # Fly intentionally sanitizes LD_LIBRARY_PATH for its image service.
        # Expose its official libraries in this sandbox's default loader path.
        for library in (fly_root/"usr/lib/x86_64-linux-gnu").glob("*.so*"):
            fly_command += ["--ro-bind",str(library.resolve()),"/usr/lib/"+library.name]
        for library in (prefix/"lib").glob("libev.so*"):
            fly_command += ["--ro-bind",str(library.resolve()),"/usr/lib/"+library.name]
        fly_command += ["/usr/bin/fly-wm","--rcfile",str(rc),"--restart"]
        if os.environ.get("FOCUSGLASS_TRACE_FLY") == "1":
            fly_command = [str(prefix/"bin/strace"), "-f", "-tt", "-s", "1024", "-o", str(artifacts/"fly.strace")] + fly_command
        launch(fly_command,fly_env)
        getprop = configure("XGetWindowProperty",[D,W,W,C.c_long,C.c_long,C.c_int,W,
            C.POINTER(W),C.POINTER(C.c_int),C.POINTER(W),C.POINTER(W),C.POINTER(C.c_void_p)])
        free = configure("XFree",[C.c_void_p])
        def wm_ready():
            actual=W();fmt=C.c_int();count=W();remaining=W();data=C.c_void_p()
            getprop(display,root,atom(display,b"_NET_SUPPORTING_WM_CHECK",0),0,1,0,0,
                C.byref(actual),C.byref(fmt),C.byref(count),C.byref(remaining),C.byref(data))
            ready=count.value>0
            if data: free(data)
            return ready
        eventually(wm_ready)
    create = configure("XCreateSimpleWindow", [D,W,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_uint,W,W], W)
    prop = configure("XChangeProperty", [D,W,W,W,C.c_int,C.c_int,C.c_void_p,C.c_int])
    map_window = configure("XMapWindow", [D,W])
    gc_create = configure("XCreateGC", [D,W,W,C.c_void_p], D)
    foreground = configure("XSetForeground", [D,D,W])
    fill = configure("XFillRectangle", [D,W,D,C.c_int,C.c_int,C.c_uint,C.c_uint])
    def paint_pattern(window,width,height):
        gc = gc_create(display,window,0,None)
        for py in range(0,height,4):
            for px in range(0,width,4):
                foreground(display,gc,0xeeeeee if (px//4+py//4)%2 else 0x111111)
                fill(display,window,gc,px,py,4,4)
        configure("XFreeGC",[D,D])(display,gc)
    def pattern(left, top, width, height, pid, dock=False):
        window = create(display, root, left, top, width, height, 0, 0, 0)
        configure("XStoreName",[D,W,C.c_char_p])(display,window,
            b"FocusGlass controls fixture" if pid==os.getpid() else b"Foreign fixture")
        wm_class = b"fg-fixture\0FocusGlassFixture\0"
        prop(display,window,atom(display,b"WM_CLASS",0),31,8,0,C.cast(C.c_char_p(wm_class),C.c_void_p),len(wm_class))
        hints = (W*9)(3,1,1,0,0,0,0,0,0)
        prop(display,window,atom(display,b"WM_HINTS",0),atom(display,b"WM_HINTS",0),32,0,hints,9)
        value = W(pid)
        prop(display, window, atom(display,b"_NET_WM_PID",0), 6, 32, 0, C.byref(value), 1)
        value = W(atom(display,b"_NET_WM_WINDOW_TYPE_DOCK" if dock else b"_NET_WM_WINDOW_TYPE_NORMAL",0))
        prop(display,window,atom(display,b"_NET_WM_WINDOW_TYPE",0),4,32,0,C.byref(value),1)
        map_window(display,window)
        paint_pattern(window,width,height)
        return window
    foreign = pattern(40,40,360,300,424242)
    protected = pattern(480,60,260,240,os.getpid())
    panel = pattern(0,550,800,50,424242,True)
    configure("XSelectInput",[D,W,C.c_long])(display,protected,4) # ButtonPressMask
    sync(display,0)
    if fly:
        # Let the real WM reparent the clients, then request their test positions.
        move = configure("XMoveResizeWindow",[D,W,C.c_int,C.c_int,C.c_uint,C.c_uint])
        translate = configure("XTranslateCoordinates",[D,W,W,C.c_int,C.c_int,
            C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(W)])
        def managed():
            actual=W();fmt=C.c_int();count=W();remaining=W();data=C.c_void_p()
            getprop(display,root,atom(display,b"_NET_CLIENT_LIST",0),0,4096,0,0,
                C.byref(actual),C.byref(fmt),C.byref(count),C.byref(remaining),C.byref(data))
            windows=list(C.cast(data,C.POINTER(W))[:count.value]) if data else []
            if data: free(data)
            managed.last_windows=windows
            def normal(window):
                aa=W();ff=C.c_int();cc=W();rr=W();dd=C.c_void_p()
                getprop(display,window,atom(display,b"WM_STATE",0),0,2,0,0,
                    C.byref(aa),C.byref(ff),C.byref(cc),C.byref(rr),C.byref(dd))
                states=list(C.cast(dd,C.POINTER(W))[:cc.value]) if dd else []
                if dd: free(dd)
                return states
            managed.states=(normal(foreign),normal(protected))
            # Fly's first-login dialogs run a modal event loop before the normal
            # WM loop, and can consume initial MapRequests. Retry only clients
            # that still have no WM_STATE; never bypass the management assertion.
            if time.monotonic()-managed.last_retry>3:
                for window,state in zip((foreign,protected),managed.states):
                    if not state:
                        configure("XUnmapWindow",[D,W])(display,window)
                        map_window(display,window)
                sync(display,0)
                managed.last_retry=time.monotonic()
            return (protected in windows and foreign in windows) or (
                managed.states[0] and managed.states[1] and managed.states[0][0]==1 and managed.states[1][0]==1)
        managed.last_retry=time.monotonic()
        try:
            eventually(managed,seconds=90)
        except AssertionError:
            save_scene("fly-startup-failure.png")
            rr=W();parent=W();data=C.c_void_p();count=C.c_uint()
            configure("XQueryTree",[D,W,C.POINTER(W),C.POINTER(W),C.POINTER(C.c_void_p),C.POINTER(C.c_uint)])(
                display,root,C.byref(rr),C.byref(parent),C.byref(data),C.byref(count))
            print("Fly root children:",list(C.cast(data,C.POINTER(W))[:count.value]),"fixtures:",foreign,protected,panel,
                "client list:",managed.last_windows,"WM_STATE:",managed.states,flush=True)
            if data: free(data)
            raise
        move(display,foreign,40,40,360,300);move(display,protected,480,60,260,240)
        sync(display,0)
        def location(window):
            xx=C.c_int();yy=C.c_int();child=W()
            translate(display,window,root,0,0,C.byref(xx),C.byref(yy),C.byref(child))
            return xx.value,yy.value
        eventually(lambda:location(protected)[0]>400)
        paint_pattern(foreign,360,300);paint_pattern(protected,260,240);paint_pattern(panel,800,50)
        sync(display,0)
    else:
        def location(window):
            return (40,40) if window==foreign else (480,60) if window==protected else (0,550)
    # XGetImage/XGetPixel operate on this disposable Xvfb display only.
    get_image = configure("XGetImage",[D,W,C.c_int,C.c_int,C.c_uint,C.c_uint,W,C.c_int],D)
    get_pixel = configure("XGetPixel",[D,C.c_int,C.c_int],W)
    destroy_image = configure("XDestroyImage",[D])
    def samples():
        image = get_image(display,root,0,0,800,600,0xffffffff,2)
        assert image, "No screenshot of isolated test scene"
        result = {}
        fx,fy=location(foreign);px,py=location(protected);dx,dy=location(panel)
        for name,(left,top,width,height) in {
            "foreign":(fx+40,fy+40,240,160),"protected":(px+30,py+30,180,140),"panel":(dx+80,dy+10,240,20)
        }.items():
            result[name] = [get_pixel(image,px,py)&0xffffff
                for py in range(top,top+height,5) for px in range(left,left+width,5)]
        destroy_image(image)
        return result
    # Wait for the compositor to paint actual checkerboard pixels.
    def baseline_ready():
        values = samples()
        return values if len(set(values["foreign"])) > 1 else None
    baseline = eventually(baseline_ready)
    save_scene("original.png")
    helper = launch([str(repo/"native/build/focusglass-x11")],env)
    def connect_control():
        try:
            connection = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            connection.connect(env["FOCUSGLASS_EFFECT_SOCKET"])
            connection.settimeout(3)
            return connection
        except (FileNotFoundError, ConnectionRefusedError):
            return None
    connection = eventually(connect_control)
    stream = connection.makefile("rwb",buffering=0)
    def request(value):
        stream.write(json.dumps(value).encode()+b"\n")
        reply = json.loads(stream.readline())
        assert reply.get("ok"), reply
        return reply
    request({"op":"preview"})
    started = time.monotonic()
    def frames_ready():
        value = request({"op":"status"})
        return value if value.get("frames",0) > 40 else None
    status = eventually(frames_ready)
    assert status["protectedWindows"] >= 2, status
    # Ensure the diagonal front has crossed the sampled foreign window.
    while time.monotonic()-started < 2.0:
        request({"op":"status"})
        time.sleep(0.03)
    blurred = samples()
    changed = sum(a!=b for a,b in zip(baseline["foreign"],blurred["foreign"]))
    own_changed = sum(a!=b for a,b in zip(baseline["protected"],blurred["protected"]))
    panel_changed = sum(a!=b for a,b in zip(baseline["panel"],blurred["panel"]))
    assert changed > len(baseline["foreign"])*0.5, ("no actual screen blur",changed,status)
    assert own_changed == 0, ("own window blurred",own_changed)
    assert panel_changed == 0, ("panel blurred",panel_changed)
    # A real injected click must reach the window below the noninteractive overlay.
    assert request({"op":"status"})["active"], "Preview ended before input tests"
    xt = C.CDLL("libXtst.so.6")
    xt.XTestFakeMotionEvent.argtypes = [D,C.c_int,C.c_int,C.c_int,W]
    xt.XTestFakeButtonEvent.argtypes = [D,C.c_uint,C.c_int,W]
    px,py=location(protected)
    configure("XSetInputFocus",[D,W,C.c_int,W])(display,protected,2,0)
    xt.XTestFakeMotionEvent(display,0,px+40,py+40,0)
    xt.XTestFakeButtonEvent(display,1,1,0); xt.XTestFakeButtonEvent(display,1,0,0)
    sync(display,0)
    event = C.create_string_buffer(192)
    delivered = configure("XCheckTypedWindowEvent",[D,W,C.c_int,C.c_void_p])(display,protected,4,event)
    assert delivered, "Overlay intercepted the injected click"
    # Keyboard input is not forwarded artificially: X must deliver it underneath.
    configure("XSelectInput",[D,W,C.c_long])(display,protected,4 | 1)
    xt.XTestFakeKeyEvent.argtypes = [D,C.c_uint,C.c_int,W]
    keycode = configure("XKeysymToKeycode",[D,W],C.c_ubyte)(display,ord("a"))
    xt.XTestFakeKeyEvent(display,keycode,1,0);xt.XTestFakeKeyEvent(display,keycode,0,0)
    sync(display,0)
    key_delivered = configure("XCheckTypedWindowEvent",[D,W,C.c_int,C.c_void_p])(display,protected,2,event)
    assert key_delivered, "Overlay intercepted keyboard input"
    save_scene("result.png")
    stopped = eventually(lambda: not request({"op":"status"})["active"],seconds=4)
    def restored():
        values = samples()
        return values if values["foreign"] == baseline["foreign"] else None
    final = eventually(restored)
    save_scene("restored.png")
    activated_at=time.monotonic()
    request({"op":"update","amount":1,"radius":8,"frozen":False})
    eventually(lambda:request({"op":"status"})["amount"]>.9,seconds=1)
    immediate=samples()
    activation_latency=time.monotonic()-activated_at
    immediate_changed=sum(a!=b for a,b in zip(baseline["foreign"],immediate["foreign"]))
    assert activation_latency<1.5,("threshold feedback delayed",activation_latency)
    assert immediate_changed>len(baseline["foreign"])*.5, "normal feedback waited for the particle introduction"
    request({"op":"stop"})
    eventually(lambda:not request({"op":"status"})["active"],seconds=3)
    eventually(restored)
    report = {"backend":status["backend"],"frames":status["frames"],
        "window_manager":"fly-wm 2.43.9+ci12 / Astra Common packages" if fly else "none (Xvfb + picom)",
        "managed_fixtures":bool(managed()) if fly else None,
        "protected_windows":status["protectedWindows"],"blurred_samples_changed":changed,
        "own_window_changed":own_changed,"panel_changed":panel_changed,
        "click_through":bool(delivered),"keyboard_through":bool(key_delivered),"preview_cleared":bool(stopped),
        "threshold_visible_within_seconds":round(activation_latency,3),
        "scene_restored":final["foreign"]==baseline["foreign"]}
    (artifacts/"results.json").write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2),flush=True)
    if os.environ.get("FOCUSGLASS_TEST_RUST") == "1":
        helper.terminate()
        helper.wait(timeout=5)
        subprocess.run(["cargo","test","native_worker_preview_and_watchdog","--","--ignored","--nocapture"],
            cwd=repo/"src-tauri",env=env,check=True)
        def helper_gone():
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as probe:
                try:
                    probe.connect(env["FOCUSGLASS_EFFECT_SOCKET"])
                    return False
                except (FileNotFoundError,ConnectionRefusedError):
                    return True
        eventually(helper_gone)
        print("PASS: Rust worker preview, stale telemetry clearing, child exit cleanup",flush=True)
finally:
    for process in reversed(processes):
        # Includes Fly image services / optional strace descendants, not just
        # the wrapper. Every launch above owns a separate process group.
        if process is not xvfb:
            try: os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError: pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if process is not xvfb:
                    try: os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError: pass
                process.kill()
                process.wait()
    for log in logs:
        log.close()

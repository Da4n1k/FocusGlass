#!/usr/bin/env python3
"""Three-second preview with scalar GPU diagnostics; does not save desktop pixels."""
import json
import os
import pathlib
import socket
import time

path=os.environ.get("FOCUSGLASS_EFFECT_SOCKET",os.path.join(os.environ["XDG_RUNTIME_DIR"],
    "focusglass-effects-"+os.environ["WAYLAND_DISPLAY"].replace("/","_")+".sock"))
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
    connection.settimeout(5)
    connection.connect(path)
    stream=connection.makefile("rwb",buffering=0)
    def request(operation):
        stream.write(json.dumps({"op":operation}).encode()+b"\n")
        result=json.loads(stream.readline())
        if not result.get("ok"):
            raise RuntimeError(result.get("error","Native effect failed"))
        return result
    before=request("status")
    if before["active"]:
        raise SystemExit("Close FocusGlass before the standalone diagnostic preview.")
    try:
        request("diagnose")
        time.sleep(1)
        result=json.dumps(request("status"),indent=2)
        path=pathlib.Path("/tmp/opencode/focusglass-host-probe")
        path.mkdir(parents=True,exist_ok=True)
        (path/"diagnostics.json").write_text(result)
        print(result,flush=True)
        time.sleep(2.5)
    finally:
        request("stop")

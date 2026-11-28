#!/usr/bin/env python3
"""Exercise automatic setup/cancellation/ABI checks without root or real DBus changes."""
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile

repo = pathlib.Path(__file__).resolve().parents[2]
helper = repo/"native/build/focusglass-native-setup"
info = json.loads(subprocess.check_output([helper,"--build-info"]))
target = pathlib.Path(info["destination"])
before = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
with tempfile.TemporaryDirectory(prefix="focusglass-setup-test-",dir="/tmp/opencode") as temporary:
    root = pathlib.Path(temporary)
    source = root/"focusglass.so"
    source.write_bytes((repo/"native/build/plugins/kwin/effects/plugins/focusglass.so").read_bytes()+b"\0test")
    commands = root/"commands.log"
    dbus = root/"qdbus6"
    dbus.write_text("""#!/usr/bin/python3
import os,sys
with open(os.environ['TEST_COMMANDS'],'a') as f: f.write(' '.join(sys.argv[1:])+'\\n')
if sys.argv[-1].endswith('supportInformation'):
    print('KWin version: '+os.environ['TEST_KWIN_VERSION'])
else: print('true')
""")
    polkit = root/"pkexec"
    polkit.write_text("""#!/usr/bin/python3
import os,sys
assert len(sys.argv)==4 and sys.argv[2]=='--install-plugin'
assert open(sys.argv[3],'rb').read(4)==b'\\x7fELF'
assert os.access(sys.argv[1],os.X_OK)
with open(os.environ['TEST_COMMANDS'],'a') as f: f.write('authorization requested\\n')
sys.exit(126) # User dismissed the graphical authorization dialog.
""")
    dbus.chmod(0o755)
    polkit.chmod(0o755)
    env = dict(os.environ,PATH=str(root)+":"+os.environ["PATH"],QT_FORCE_STDERR_LOGGING="1",
               TEST_COMMANDS=str(commands),TEST_KWIN_VERSION=info["kwinVersion"])
    denied = subprocess.run([helper,"--ensure-kwin",source],env=env,capture_output=True,text=True)
    assert denied.returncode == 1, denied
    history = commands.read_text()
    assert "unloadEffect" in history and "authorization requested" in history, history
    assert "org.kde.kwin.Effects.loadEffect" not in history, history
    assert "cancelled or failed" in denied.stderr, denied.stderr
    assert (hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None) == before
    commands.write_text("")
    incompatible = subprocess.run([helper,"--ensure-kwin",source],
        env=dict(env,TEST_KWIN_VERSION="0.0.0"),capture_output=True,text=True)
    assert incompatible.returncode == 1 and "ABI mismatch" in incompatible.stderr, incompatible
    assert "authorization requested" not in commands.read_text()
    if target.exists():
        # A matching installed plugin is recognized without an auth prompt.
        commands.write_text("")
        current = subprocess.run([helper,"--ensure-kwin",target],env=env,capture_output=True,text=True)
        assert current.returncode == 0, current.stderr
        assert "authorization requested" not in commands.read_text()
print("PASS: automatic setup, graphical authorization handoff, cancellation stays clear, "
      "ABI rejection before installation, matching-plugin reuse; no privileged writes")

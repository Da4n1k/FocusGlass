#!/usr/bin/env python3
"""Download Arch test/build tools into an isolated prefix; never change the host session."""
import json
import pathlib
import subprocess
import urllib.request

root = pathlib.Path("/tmp/opencode/focusglass-native-tools")
root.mkdir(parents=True, exist_ok=True)
for package in ("cmake", "extra-cmake-modules", "xorg-server-xvfb", "picom", "libev", "libconfig", "rhash", "cppdap", "vulkan-headers", "strace"):
    architecture = "any" if package in ("extra-cmake-modules", "vulkan-headers") else "x86_64"
    with urllib.request.urlopen(f"https://archlinux.org/packages/extra/{architecture}/{package}/json/") as response:
        info = json.load(response)
    archive = root / info["filename"]
    if not archive.exists():
        urllib.request.urlretrieve(
            f"https://geo.mirror.pkgbuild.com/extra/os/x86_64/{info['filename']}", archive
        )
    subprocess.run(["bsdtar", "-xf", str(archive), "-C", str(root)], check=True)
    print(f"{package}: {info['pkgver']}-{info['pkgrel']}", flush=True)
print(f"Prefix: {root}", flush=True)

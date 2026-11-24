#!/usr/bin/env python3
"""Extract official Astra Common Edition Fly packages for an isolated compatibility test.
No packages are installed into the host; this is NOT a certified Astra SE environment.
"""
import gzip
import hashlib
import pathlib
import subprocess
import urllib.request

base = "https://dl.astralinux.ru/astra/stable/2.12_x86-64/repository/"
root = pathlib.Path("/tmp/opencode/focusglass-fly")
root.mkdir(exist_ok=True)
packages = {}
for component in ("main", "non-free"):
    url = base + f"dists/orel/{component}/binary-amd64/Packages.gz"
    with urllib.request.urlopen(url) as response:
        text = gzip.decompress(response.read()).decode()
    for paragraph in text.split("\n\n"):
        record = {}
        for line in paragraph.splitlines():
            if line and not line.startswith(" ") and ": " in line:
                key,value = line.split(": ",1)
                record[key] = value
        if "Package" in record:
            packages[record["Package"]] = record
for name in ("fly-wm", "libflycore", "libflydbus", "libnanosvg", "libprocps6", "libxres1", "fly-data", "fly-wm-decor"):
    record = packages[name]
    filename = record["Filename"]
    directory = root/"archives"/name
    directory.mkdir(parents=True,exist_ok=True)
    archive = directory/pathlib.Path(filename).name
    if not archive.exists():
        urllib.request.urlretrieve(base+filename,archive)
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==record["SHA256"], name
    subprocess.run(["bsdtar","-xf",str(archive),"-C",str(directory)],check=True)
    data = next(directory.glob("data.tar.*"))
    subprocess.run(["bsdtar","-xf",str(data),"-C",str(root)],check=True)
    print(name,record["Version"],flush=True)
print(root,flush=True)

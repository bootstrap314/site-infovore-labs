"""Deterministic newc initramfs; creates device nodes without host root access."""
import gzip
import io
import stat
import sys
from pathlib import Path

root, output = map(Path, sys.argv[1:])
archive = io.BytesIO()
inode = 0

def entry(name, mode, data=b"", major=0, minor=0):
    global inode
    inode += 1
    path = name.encode() + b"\0"
    fields = [inode, mode, 0, 0, 1, 0, len(data), 0, 0, major, minor, len(path), 0]
    archive.write(b"070701" + b"".join(f"{n:08x}".encode() for n in fields))
    archive.write(path)
    archive.write(b"\0" * (-archive.tell() % 4))
    archive.write(data)
    archive.write(b"\0" * (-archive.tell() % 4))

for file in sorted(root.rglob("*")):
    name = str(file.relative_to(root))
    if file.is_dir():
        entry(name, stat.S_IFDIR | 0o755)
    else:
        entry(name, stat.S_IFREG | (0o755 if name == "init" else 0o644), file.read_bytes())
entry("dev/console", stat.S_IFCHR | 0o600, major=5, minor=1)
entry("dev/ttyS0", stat.S_IFCHR | 0o600, major=4, minor=64)
entry("dev/ttyS1", stat.S_IFCHR | 0o600, major=4, minor=65)
entry("dev/null", stat.S_IFCHR | 0o666, major=1, minor=3)
entry("TRAILER!!!", 0)
output.write_bytes(gzip.compress(archive.getvalue(), compresslevel=9, mtime=0))

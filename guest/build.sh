#!/bin/sh
set -eu
. /project/guest/archive.sh
export LC_ALL=C SOURCE_DATE_EPOCH=1746057600
BUILD=/build
JOBS=${JOBS:-8}
LINUX=6.6.90
NCURSES=6.5
MUSL=1.2.5
BUSYBOX=1.38.0
mkdir -p "$BUILD" /project/public/vm
cd "$BUILD"
if [ ! -f "linux-$LINUX.tar.xz" ]; then
  curl -fL --retry 3 "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-$LINUX.tar.xz" -o "linux-$LINUX.tar.xz"
fi
prepare_source "linux-$LINUX.tar.xz" "linux-$LINUX" ff856748671629c1fefef219099e0b4b81131c2d325e768cb0806e204157014e
if [ ! -f "ncurses-$NCURSES.tar.gz" ]; then
  curl -fL --retry 3 "https://invisible-mirror.net/archives/ncurses/ncurses-$NCURSES.tar.gz" -o "ncurses-$NCURSES.tar.gz"
fi
prepare_source "ncurses-$NCURSES.tar.gz" "ncurses-$NCURSES" 136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6
if [ ! -f "$BUILD/musl/bin/musl-gcc" ]; then
  curl -fL --retry 3 "https://musl.libc.org/releases/musl-$MUSL.tar.gz" -o "musl-$MUSL.tar.gz"
  prepare_source "musl-$MUSL.tar.gz" "musl-$MUSL" a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4
  cd "$BUILD/musl-$MUSL"
  CC=i686-linux-gnu-gcc ./configure --target=i686-linux-gnu --prefix="$BUILD/musl" --disable-shared
  make -j"$JOBS"
  make install
fi
if [ ! -f "$BUILD/ncurses-musl-wide/lib/libncursesw.a" ]; then
  cd "$BUILD/ncurses-$NCURSES"
  if [ -f Makefile ]; then make distclean; fi
  mkdir -p "$BUILD/ncurses-musl-wide"
  cd "$BUILD/ncurses-musl-wide"
  CC="$BUILD/musl/bin/musl-gcc" "$BUILD/ncurses-$NCURSES/configure" --host=i686-linux-gnu --build="$(gcc -dumpmachine)" \
    --without-shared --without-debug --without-ada --without-cxx --without-cxx-binding \
    --without-progs --without-tests --enable-widec --with-normal --with-termlib=no
  make -j"$JOBS" libs
fi
# BusyBox ip uses Linux netlink UAPI headers alongside musl's libc headers.
if [ ! -f "$BUILD/musl/include/linux/netlink.h" ]; then
  make -C "$BUILD/linux-$LINUX" ARCH=x86 headers
  cp -R "$BUILD/linux-$LINUX/usr/include/." "$BUILD/musl/include/"
fi
cd "$BUILD"
if [ ! -f "busybox-$BUSYBOX.tar.bz2" ]; then
  if [ -f "/project/.build/busybox-$BUSYBOX.tar.bz2" ]; then
    cp "/project/.build/busybox-$BUSYBOX.tar.bz2" .
  else
    curl -fL --retry 3 "https://busybox.net/downloads/busybox-$BUSYBOX.tar.bz2" -o "busybox-$BUSYBOX.tar.bz2"
  fi
fi
prepare_source "busybox-$BUSYBOX.tar.bz2" "busybox-$BUSYBOX" 34f9ea6ff8636f2c9241153b9114eefa9e65674a45318ae1ef95bb5f31c53bb2
cd "$BUILD/busybox-$BUSYBOX"
if [ ! -f busybox ] || ! cmp -s /project/guest/busybox.config "$BUILD/busybox.config.input"; then
  make CROSS_COMPILE=i686-linux-gnu- CC="$BUILD/musl/bin/musl-gcc" allnoconfig >/dev/null
  python3 - /project/guest/busybox.config <<'PY'
from pathlib import Path
import sys
overrides = dict(line.split('=', 1) for line in Path(sys.argv[1]).read_text().splitlines() if line.startswith('CONFIG_'))
lines = []
for line in Path('.config').read_text().splitlines():
    name = line.split()[1] if line.startswith('# CONFIG_') else line.split('=', 1)[0]
    lines.append(f'{name}={overrides.pop(name)}' if name in overrides else line)
lines.extend(f'{name}={value}' for name, value in overrides.items())
Path('.config').write_text('\n'.join(lines) + '\n')
PY
  make CROSS_COMPILE=i686-linux-gnu- CC="$BUILD/musl/bin/musl-gcc" oldconfig </dev/null >/dev/null
  make -j"$JOBS" CROSS_COMPILE=i686-linux-gnu- CC="$BUILD/musl/bin/musl-gcc"
  cp /project/guest/busybox.config "$BUILD/busybox.config.input"
fi
mkdir -p "$BUILD/root/bin"
make CROSS_COMPILE=i686-linux-gnu- CC="$BUILD/musl/bin/musl-gcc" busybox.links >/dev/null
# Recreate applet links when the enabled BusyBox command set changes.
find "$BUILD/root/bin" -type l -delete
cp busybox "$BUILD/root/bin/busybox"
i686-linux-gnu-strip "$BUILD/root/bin/busybox"
while IFS= read -r applet; do
  [ "${applet##*/}" = busybox ] || ln -sf busybox "$BUILD/root/bin/${applet##*/}"
done < busybox.links
ln -sf /init "$BUILD/root/bin/view"
ln -sf /init "$BUILD/root/bin/ip"
cp /project/guest/shell-help "$BUILD/root/bin/?"
chmod 755 "$BUILD/root/bin/?"
mkdir -p "$BUILD/root/etc" "$BUILD/root/root" "$BUILD/root/dev/pts" "$BUILD/root/run"
cp /project/guest/profile "$BUILD/root/etc/profile"
printf 'root:x:0:0:root:/root:/bin/ash\n' > "$BUILD/root/etc/passwd"
cp .config /project/guest/busybox.resolved.config
cd "$BUILD/linux-$LINUX"
if [ ! -f .config ] || ! cmp -s /project/guest/kernel.config "$BUILD/kernel.config.input"; then
  make ARCH=x86 CROSS_COMPILE=i686-linux-gnu- tinyconfig
  cat /project/guest/kernel.config >> .config
  make ARCH=x86 CROSS_COMPILE=i686-linux-gnu- olddefconfig
  cp /project/guest/kernel.config "$BUILD/kernel.config.input"
fi
make -j"$JOBS" ARCH=x86 CROSS_COMPILE=i686-linux-gnu- KBUILD_BUILD_TIMESTAMP='Thu May 1 00:00:00 UTC 2025' KBUILD_BUILD_USER=site KBUILD_BUILD_HOST=wasm bzImage
mkdir -p "$BUILD/root/dev" "$BUILD/root/proc" "$BUILD/root/sys" "$BUILD/root/usr/share/terminfo/x"
"$BUILD/musl/bin/musl-gcc" -static -Os -flto -Wall -Wextra -Werror \
  -I"$BUILD/ncurses-musl-wide/include" /project/guest/site.c \
  -L"$BUILD/ncurses-musl-wide/lib" -lncursesw -lm -o "$BUILD/root/init"
rm -rf "$BUILD/root/notes" "$BUILD/root/usr/share/notes"
mkdir -p "$BUILD/root/notes" "$BUILD/root/usr/share/notes"
cp /project/.build/notes-raw/. "$BUILD/root/notes/" -r
cp /project/.build/notes-images/. "$BUILD/root/usr/share/notes/" -r
rm -rf "$BUILD/root/projects" "$BUILD/root/usr/share/projects"
mkdir -p "$BUILD/root/projects" "$BUILD/root/usr/share/projects"
cp /project/.build/projects-raw/. "$BUILD/root/projects/" -r
cp /project/.build/projects-images/. "$BUILD/root/usr/share/projects/" -r
i686-linux-gnu-strip "$BUILD/root/init"
cp /lib/terminfo/x/xterm-256color "$BUILD/root/usr/share/terminfo/x/"
python3 /project/scripts/initramfs.py "$BUILD/root" /project/public/vm/initramfs.cpio.gz
cp arch/x86/boot/bzImage /project/public/vm/bzImage
cp .config /project/guest/kernel.resolved.config
mkdir -p /project/public/licenses
cp "$BUILD/musl-$MUSL/COPYRIGHT" /project/public/licenses/musl.txt
cp "$BUILD/ncurses-$NCURSES/COPYING" /project/public/licenses/ncurses.txt
cp "$BUILD/busybox-$BUSYBOX/LICENSE" /project/public/licenses/busybox.txt
cp LICENSES/preferred/GPL-2.0 /project/public/licenses/linux-GPL-2.0.txt
cp LICENSES/exceptions/Linux-syscall-note /project/public/licenses/linux-syscall-note.txt
for bios in seabios vgabios; do
  if [ ! -f "/project/public/vm/$bios.bin" ]; then
    curl -fsSL "https://raw.githubusercontent.com/copy/v86/b28e415/bios/$bios.bin" -o "/project/public/vm/$bios.bin"
  fi
done
echo '73e3f359102e3a9982c35fce98eb7cd08f18303ac7f1ba6ebfbe6cdc1c244d98  /project/public/vm/seabios.bin' | sha256sum -c -
echo 'a4bc0d80cc3ca028c73dafa8fee396b8d054ce87ebd8abfbd31b06b437607880  /project/public/vm/vgabios.bin' | sha256sum -c -
sha256sum "$BUILD/linux-$LINUX.tar.xz" "$BUILD/ncurses-$NCURSES.tar.gz" /project/public/vm/bzImage /project/public/vm/initramfs.cpio.gz
ls -lh /project/public/vm/bzImage /project/public/vm/initramfs.cpio.gz "$BUILD/root/init"

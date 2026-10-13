#!/bin/sh
set -eu
export LC_ALL=C SOURCE_DATE_EPOCH=1746057600
BUILD=/build
JOBS=${JOBS:-8}
LINUX=6.6.90
NCURSES=6.5
MUSL=1.2.5
mkdir -p "$BUILD" /project/public/vm
cd "$BUILD"
if [ ! -f "linux-$LINUX.tar.xz" ]; then
  curl -fL --retry 3 "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-$LINUX.tar.xz" -o "linux-$LINUX.tar.xz"
  curl -fsSL https://cdn.kernel.org/pub/linux/kernel/v6.x/sha256sums.asc -o kernel-sha256sums.asc
  grep " linux-$LINUX.tar.xz$" kernel-sha256sums.asc | sha256sum -c -
fi
if [ ! -d "linux-$LINUX" ]; then tar xf "linux-$LINUX.tar.xz"; fi
echo 'ff856748671629c1fefef219099e0b4b81131c2d325e768cb0806e204157014e  linux-6.6.90.tar.xz' | sha256sum -c -
if [ ! -f "ncurses-$NCURSES.tar.gz" ]; then
  curl -fL --retry 3 "https://invisible-mirror.net/archives/ncurses/ncurses-$NCURSES.tar.gz" -o "ncurses-$NCURSES.tar.gz"
fi
if [ ! -d "ncurses-$NCURSES" ]; then tar xf "ncurses-$NCURSES.tar.gz"; fi
echo '136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6  ncurses-6.5.tar.gz' | sha256sum -c -
if [ ! -f "$BUILD/musl/bin/musl-gcc" ]; then
  curl -fL --retry 3 "https://musl.libc.org/releases/musl-$MUSL.tar.gz" -o "musl-$MUSL.tar.gz"
  echo 'a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4  musl-1.2.5.tar.gz' | sha256sum -c -
  tar xf "musl-$MUSL.tar.gz"
  cd "$BUILD/musl-$MUSL"
  CC=i686-linux-gnu-gcc ./configure --target=i686-linux-gnu --prefix="$BUILD/musl" --disable-shared
  make -j"$JOBS"
  make install
fi
if [ ! -f "$BUILD/ncurses-musl/lib/libncurses.a" ]; then
  cd "$BUILD/ncurses-$NCURSES"
  if [ -f Makefile ]; then make distclean; fi
  mkdir -p "$BUILD/ncurses-musl"
  cd "$BUILD/ncurses-musl"
  CC="$BUILD/musl/bin/musl-gcc" "$BUILD/ncurses-$NCURSES/configure" --host=i686-linux-gnu --build="$(gcc -dumpmachine)" \
    --without-shared --without-debug --without-ada --without-cxx --without-cxx-binding \
    --without-progs --without-tests --disable-widec --with-normal --with-termlib=no
  make -j"$JOBS" libs
fi
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
  -I"$BUILD/ncurses-musl/include" /project/guest/site.c \
  -L"$BUILD/ncurses-musl/lib" -lncurses -o "$BUILD/root/init"
i686-linux-gnu-strip "$BUILD/root/init"
cp /lib/terminfo/x/xterm-256color "$BUILD/root/usr/share/terminfo/x/"
python3 /project/scripts/initramfs.py "$BUILD/root" /project/public/vm/initramfs.cpio.gz
cp arch/x86/boot/bzImage /project/public/vm/bzImage
cp .config /project/guest/kernel.resolved.config
mkdir -p /project/public/licenses
cp "$BUILD/musl-$MUSL/COPYRIGHT" /project/public/licenses/musl.txt
cp "$BUILD/ncurses-$NCURSES/COPYING" /project/public/licenses/ncurses.txt
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

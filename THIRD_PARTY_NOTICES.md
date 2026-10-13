# Open-source credits

This site runs a real Linux kernel and a native ncurses application in a v86 WebAssembly virtual machine. The terminal display uses xterm.js.

- v86 0.5.358, BSD-2-Clause: https://github.com/copy/v86/tree/b28e415
- xterm.js 6.0.0 and FitAddon 0.11.0, MIT: https://github.com/xtermjs/xterm.js
- Linux 6.6.90, GPL-2.0-only with Linux syscall exception: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.90.tar.xz
- ncurses 6.5, MIT-style license: https://invisible-mirror.net/archives/ncurses/ncurses-6.5.tar.gz
- musl 1.2.5, MIT: https://musl.libc.org/releases/musl-1.2.5.tar.gz
- SeaBIOS and VGA BIOS distributed with v86: https://github.com/copy/v86/tree/b28e415/bios

The repository includes the application source and image build scripts. The kernel is unmodified and built using guest/kernel.config; guest/kernel.resolved.config records the complete effective configuration. See README.md for the rebuild commands.

Full license notices are served in /licenses/. The source URLs above identify the exact unmodified upstream releases used by the build.

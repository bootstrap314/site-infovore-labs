# Open-source credits

This site runs a real Linux kernel and a native ncurses application in a v86 WebAssembly virtual machine. The terminal display uses xterm.js.

- v86 0.5.358, BSD-2-Clause: https://github.com/copy/v86/tree/b28e415
- xterm.js 6.0.0 and FitAddon 0.11.0, MIT: https://github.com/xtermjs/xterm.js
- xterm ImageAddon 0.9.0, MIT: https://github.com/xtermjs/xterm.js/tree/master/addons/addon-image
- Linux 6.6.90, GPL-2.0-only with Linux syscall exception: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.90.tar.xz
- ncurses 6.5, MIT-style license: https://invisible-mirror.net/archives/ncurses/ncurses-6.5.tar.gz
- musl 1.2.5, MIT: https://musl.libc.org/releases/musl-1.2.5.tar.gz
- BusyBox 1.38.0, GPL-2.0-only, including ash and its enabled utilities: https://busybox.net/downloads/busybox-1.38.0.tar.bz2
- SeaBIOS and VGA BIOS distributed with v86: https://github.com/copy/v86/tree/b28e415/bios

The repository includes the application source and image build scripts. The kernel is unmodified and built using guest/kernel.config; guest/kernel.resolved.config records the complete effective configuration. See README.md for the rebuild commands.

Full license notices are served in /licenses/. The source URLs above identify the exact unmodified upstream releases used by the build.

Build-only content tools: unified/remark (MIT), YAML (ISC), Mermaid (MIT), Playwright (Apache-2.0), and termtex (Apache-2.0, pinned commit c407d5cf5251). Their exact Node versions are locked in package-lock.json; the Go version and checksums are in tools/termtex/go.mod and go.sum. These tools do not run in the website or guest. termtex source: https://github.com/doug/termtex/tree/c407d5cf5251

The résumé's LaTeX source retains the template attribution to Matthew Boedicker (2002), David J. Grant (2003–2007), and Todd C. Miller (2007–2010), under Creative Commons Attribution-ShareAlike 3.0: https://creativecommons.org/licenses/by-sa/3.0/. The website adapts its content into a responsive reading layout and matching PDF.

Build-time ASCII diagram rendering uses beautiful-mermaid 1.1.3 (MIT), whose text layout derives from mermaid-ascii: https://github.com/lukilabs/beautiful-mermaid

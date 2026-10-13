# Personal / Space

A personal website whose interface is an actual **ncurses 6.5 C application**, running as PID 1 in **Linux 6.6.90**, inside the **v86 WebAssembly virtual machine**. xterm.js renders the guest's serial terminal. Page navigation and all terminal content are implemented in the Linux program, not emulated in HTML.

The current pages are deliberate placeholders awaiting personal content.

## Run

Requires Node.js 24+ (with zstd support). Prebuilt guest artifacts are included.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4173. Add `?cold` to boot the kernel from scratch instead of restoring the snapshot. The normal page automatically falls back to a cold boot if the snapshot cannot load. A failed cold boot offers a retry and the text view remains available.

## Navigation

- **Keyboard:** arrows, Tab / Shift+Tab, `h/j/k/l`, or `1`–`5`. `?` opens help; `r` redraws.
- **Mouse:** click the ncurses menu labels inside the terminal, or the page buttons below it.
- **Touch:** tap the page buttons. Resizing the browser updates the Linux tty size and ncurses layout.
- **Accessibility:** keyboard-operable HTML controls, xterm's screen-reader mode, and a readable text alternative.

The terminal captures Tab for page navigation. Focus the outer page controls to use regular browser tab navigation.

## Build the Linux guest

Requires Docker with Compose. The builder runs on ARM64 or x86-64 hosts and cross-compiles to i686. Its source/build cache lives in the project-specific Docker volume `terminal-site_guest-cache`.

```sh
npm run vm:build
npm run vm:snapshot
npm run build
```

`guest/site.c` contains the placeholder pages, navigation, responsive layout, and runtime System page. Edit it to add content; then run the three commands above. `guest/kernel.config` defines the tiny kernel. `guest/kernel.resolved.config` records its complete configuration. `src/` contains the browser frame, worker, terminal connection, and text fallback.

The build downloads pinned Linux, ncurses, musl, and BIOS sources/assets and verifies SHA-256 hashes. The native app links statically against musl and ncurses. The guest has no network stack, disk, desktop, shell, or services. Its initramfs contains the app, one terminfo entry, and the required device nodes. The Docker builder is only a development tool; visitors download static files and run the guest locally.

## Loading strategy

1. The small HTML frame appears immediately using system fonts.
2. A Web Worker fetches the compressed guest state and compiles the emulator's WASM in parallel.
3. v86 restores the running kernel and ncurses process from a zstd snapshot.
4. The guest reinitializes the new terminal's keyboard/mouse modes and redraws for the current viewport.
5. The loading screen disappears only after the guest responds and xterm has consumed its output.

Snapshot preparation clears free guest pages containing discarded boot data. Normal page loads do not perform this work. The emulator pauses when the tab is hidden. Refreshing/restarting makes a fresh disposable session; there is no backend service or persistent guest state.

The guest has 128 MiB of emulated RAM because v86's direct Linux boot loader places an external initrd at 64 MiB. Its saved state excludes unused zero pages. The Linux kernel is approximately 737 KiB and the initramfs approximately 145 KiB; cold boot remains a lightweight fallback. A manifest pins the matching WASM, snapshot and machine settings; builds fail if the guest inputs have changed since snapshot generation.

Static assets have content hashes and immutable cache headers. The local server negotiates precompressed Brotli/gzip files; `dist/_headers` supplies the static hosting cache policy. Hosts must serve `.wasm` as `application/wasm` and ideally compress JS/CSS/WASM. The `.zst` snapshot is already compressed and is decoded by v86, so it must be served as ordinary binary data without a `Content-Encoding: zstd` header. No cross-origin isolation or third-party CDNs are needed.

## Verification

With `npm start` running and Google Chrome installed:

```sh
npm test
npm run bench
```

The smoke test verifies a real Linux/ncurses identity, arrow/Tab/number navigation, native ncurses mouse events, HTML page buttons, help, restart, text view, cold boot, touch input, 320/390px layouts, live resize and automatic cold-boot recovery. Screenshots and results go in `.test-results/`.

The benchmark measures three runs each for a fresh snapshot load, cached load, cold boot, and a simulated 10 Mbit/s / 40 ms connection. `readyMs` measures navigation to rendered guest output; `sessionMs` measures VM startup after the terminal dependencies are ready. Local numbers depend on browser/hardware and are not a universal internet loading guarantee.

Measured on the development Mac in Chrome, October 13, 2026 (three-run medians):

| Load | Navigation to interactive |
| --- | ---: |
| Fresh local snapshot | 228 ms |
| Cached local snapshot | 197 ms |
| Full local Linux cold boot | 981 ms |
| Snapshot, simulated 10 Mbit/s and 40 ms latency | 1,814 ms |

The normal fresh load transferred approximately **1.72 MB**, including a **1.25 MB** zstd machine snapshot. The original snapshot was 2.60 MB before switching to musl, clearing discarded boot pages, and using zstd. Cached loads revalidate the small manifest and reuse immutable assets.

## Hosting

`dist/` is a portable static site. The `.openai/hosting.json` file binds this checkout to its private Sites project. Do not create another Sites project when updating this one. Keep the existing site identity and sharing settings.

Third-party versions, source locations, and licenses are listed in `THIRD_PARTY_NOTICES.md` and `public/licenses/`.

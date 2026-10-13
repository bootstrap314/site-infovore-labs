import { V86 } from 'v86';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { zstdCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { machine, cmdline } from './vm-options.mjs';

const binary = async path => ({buffer: new Uint8Array(await readFile(path)).buffer});
await mkdir('.build', {recursive:true});
const start = performance.now();
const vm = new V86({
  ...machine,
  wasm_path: 'node_modules/v86/build/v86.wasm',
  bios: await binary('public/vm/seabios.bin'),
  vga_bios: await binary('public/vm/vgabios.bin'),
  bzimage: await binary('public/vm/bzImage'),
  initrd: await binary('public/vm/initramfs.cpio.gz'),
  cmdline,
});
let output = '', control = '';
vm.add_listener('serial0-output-byte', byte => { output += String.fromCharCode(byte); });
try {
  const identity = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Linux did not reach ncurses in 45 seconds.\n' + output.slice(-6000))), 45_000);
    vm.add_listener('serial1-output-byte', byte => {
      control += String.fromCharCode(byte);
      if (byte !== 10) return;
      try {
        const event = JSON.parse(control.trim());
        if (event.event === 'ready') { clearTimeout(timer); resolve(event); }
      } catch { /* Partial serial message. */ }
      control = '';
    });
  });
  const bootMs = performance.now() - start;
  if (!identity.kernel.startsWith('6.6.90') || !identity.ncurses.startsWith('ncurses 6.5') || identity.pid !== 1)
    throw new Error('Unexpected guest identity: ' + JSON.stringify(identity));
  await new Promise((resolve,reject) => {
    let reply = '';
    const timer = setTimeout(() => reject(new Error('Snapshot preparation timed out')),30_000);
    const listener = byte => {
      reply += String.fromCharCode(byte);
      if (byte === 10 && reply.includes('"event":"ready"')) {
        clearTimeout(timer); vm.remove_listener('serial1-output-byte',listener); resolve();
      }
    };
    vm.add_listener('serial1-output-byte',listener);
    vm.serial_send_bytes(1,new TextEncoder().encode('S\n'));
  });
  await new Promise(resolve => setTimeout(resolve, 150));
  await vm.stop();
  const state = Buffer.from(await vm.save_state());
  const compressed = zstdCompressSync(state, {params:{[constants.ZSTD_c_compressionLevel]:19}});
  await writeFile('public/vm/state.bin.zst', compressed);
  await rm('public/vm/state.bin.gz',{force:true});
  const inputs = ['guest/site.c','guest/kernel.config','guest/build.sh','scripts/initramfs.py','scripts/vm-options.mjs','public/vm/bzImage','public/vm/initramfs.cpio.gz','public/vm/seabios.bin','public/vm/vgabios.bin','node_modules/v86/build/v86.wasm','node_modules/v86/build/libv86.js'];
  const hashes = {};
  for (const path of inputs) hashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  const metadata = {identity, coldBootMs:Math.round(bootMs), stateBytes:state.length, compressedBytes:compressed.length, hashes};
  await writeFile('public/vm/metadata.json', JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify(metadata, null, 2));
} finally {
  await writeFile('.build/boot.log', output);
  await vm.destroy();
}

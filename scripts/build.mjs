import { readFile, writeFile, mkdir, copyFile, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { machine, cmdline } from './vm-options.mjs';

const metadata = JSON.parse(await readFile('public/vm/metadata.json', 'utf8'));
for (const [path, hash] of Object.entries(metadata.hashes)) {
  if (createHash('sha256').update(await readFile(path)).digest('hex') !== hash)
    throw new Error(`Stale VM: ${path} changed. Rebuild the guest and snapshot first.`);
}
await rm('dist', {recursive:true, force:true});
await mkdir('dist/assets', {recursive:true});
const manifest = {machine, cmdline, identity:metadata.identity};
const assets = {
  libv86:'node_modules/v86/build/libv86.js', wasm:'node_modules/v86/build/v86.wasm',
  xterm:'node_modules/@xterm/xterm/lib/xterm.mjs', fit:'node_modules/@xterm/addon-fit/lib/addon-fit.mjs',
  xtermCss:'node_modules/@xterm/xterm/css/xterm.css',
  snapshot:'public/vm/state.bin.zst', kernel:'public/vm/bzImage', initrd:'public/vm/initramfs.cpio.gz',
  bios:'public/vm/seabios.bin', vgaBios:'public/vm/vgabios.bin',
  worker:'src/vm-worker.js', app:'src/app.js', style:'src/style.css',
};
let totalRaw = 0, totalBrotli = 0;
for (const [key, path] of Object.entries(assets)) {
  const data = await readFile(path);
  const hash = createHash('sha256').update(data).digest('hex').slice(0,12);
  const basename = path.split('/').pop();
  const url = `assets/${hash}-${basename}`;
  await writeFile(`dist/${url}`, data);
  if (!/\.(gz|zst)$/.test(path)) {
    await writeFile(`dist/${url}.gz`, gzipSync(data, {level:9}));
    const brotli = brotliCompressSync(data, {params:{[constants.BROTLI_PARAM_QUALITY]:11}});
    await writeFile(`dist/${url}.br`, brotli);
    if (!['kernel','bios','vgaBios'].includes(key)) totalBrotli += brotli.length;
  } else if (key === 'snapshot') totalBrotli += data.length;
  if (!['kernel','initrd','bios','vgaBios'].includes(key)) totalRaw += data.length;
  manifest[key] = url;
}
await writeFile('dist/manifest.json', JSON.stringify(manifest));
let html = await readFile('src/index.html','utf8');
html = html.replaceAll('{{style}}',manifest.style).replaceAll('{{app}}',manifest.app).replaceAll('{{xtermCss}}',manifest.xtermCss);
await writeFile('dist/index.html',html);
await copyFile('public/favicon.svg','dist/favicon.svg');
await copyFile('THIRD_PARTY_NOTICES.md','dist/THIRD_PARTY_NOTICES.txt');
await cp('public/licenses','dist/licenses',{recursive:true});
await copyFile('node_modules/v86/LICENSE','dist/licenses/v86.txt');
await copyFile('node_modules/@xterm/xterm/LICENSE','dist/licenses/xterm.txt');
await copyFile('node_modules/@xterm/addon-fit/LICENSE','dist/licenses/xterm-addon-fit.txt');
await writeFile('dist/_headers', '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/manifest.json\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n');
console.log(JSON.stringify({dist:'dist',snapshotBytes:metadata.compressedBytes,normalLoadRawBytes:totalRaw,normalLoadBrotliBytes:totalBrotli,identity:metadata.identity},null,2));

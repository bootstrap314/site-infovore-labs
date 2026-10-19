import { readFile, writeFile, mkdir, copyFile, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { machine, cmdline } from './vm-options.mjs';
import { noteSources } from './notes.mjs';
import { themeCss } from '../src/themes.js';
import { buildResumePdf } from './resume-pdf.mjs';
import { buildOffline } from './offline.mjs';
import { patchImageAddon } from './image-addon.mjs';

const metadata = JSON.parse(await readFile('public/vm/metadata.json', 'utf8'));
if (JSON.stringify(await noteSources()) !== JSON.stringify(metadata.noteSources)) throw new Error('Notes changed. Run make build to rebuild the guest and snapshot.');
if (JSON.stringify(await noteSources('projects')) !== JSON.stringify(metadata.projectSources)) throw new Error('Projects changed. Run make build to rebuild the guest and snapshot.');
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
  imageAddon:'node_modules/@xterm/addon-image/lib/addon-image.mjs',themes:'src/themes.js',
  resumeStyle:'src/resume.css',
  offline:'src/offline.js',
};
let totalRaw = 0, totalBrotli = 0;
for (const [key, path] of Object.entries(assets)) {
  let data = await readFile(path);
  if (key === 'imageAddon') data = Buffer.from(patchImageAddon(data.toString()));
  if (key === 'style') data = Buffer.concat([data,Buffer.from(themeCss())]);
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
const manifestData=JSON.stringify(manifest);
const manifestUrl=`assets/${createHash('sha256').update(manifestData).digest('hex').slice(0,12)}-manifest.json`;
await writeFile(`dist/${manifestUrl}`,manifestData);
await writeFile('dist/manifest.json',manifestData);
let html = await readFile('src/index.html','utf8');
const resumeTemplate=await readFile('src/resume.html','utf8');
const resumeHtml=resumeTemplate.replaceAll('{{style}}',manifest.style).replaceAll('{{resumeStyle}}',manifest.resumeStyle).replaceAll('{{offline}}',manifest.offline).replace('{{resume}}',await readFile('.build/resume.html','utf8'));
const resumeView=resumeHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
html = html.replaceAll('{{style}}',manifest.style).replaceAll('{{app}}',manifest.app).replaceAll('{{xtermCss}}',manifest.xtermCss).replaceAll('{{resumeStyle}}',manifest.resumeStyle).replace('{{resumeView}}',resumeView);
html=html.replaceAll('{{manifest}}',manifestUrl).replaceAll('{{offline}}',manifest.offline);
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const resume=JSON.parse(await readFile('.build/resume.json','utf8'));
const workText=`<h1>${escapeHtml(resume.name)}</h1><p>${escapeHtml(resume.title)}</p>${resume.experience.slice(0,3).map(job=>`<h2>${escapeHtml(job.organization)}</h2><p>${escapeHtml(job.dates)}</p>`).join('')}<p><a href="mailto:${escapeHtml(resume.email)}">${escapeHtml(resume.email)}</a></p><p><a href="resume.html">Read full résumé →</a></p>`;
html=html.replace('{{workText}}',workText);
for(const [collection,singular] of [['notes','note'],['projects','project']]) {
  const posts=JSON.parse(await readFile(`.build/${collection}.json`,'utf8'));
  const indexHtml=posts.length ? `<ul class="text-notes-list">${posts.map((post,index)=>`<li><a href="#text-${singular}-${index}" data-text-${singular}-open="${index}">${escapeHtml(post.title)}</a>${post.date ? ` <span class="note-date">${escapeHtml(post.date)}</span>` : ''}</li>`).join('')}</ul>` : `<p>No ${collection} published yet.</p>`;
  let postIndex=0;
  const articles=(await readFile(`.build/${collection}.html`,'utf8')).replaceAll('<article>',()=>`<article data-text-${singular}="${postIndex}" id="text-${singular}-${postIndex++}">`);
  html=html.replace(`{{${collection}Index}}`,indexHtml).replace(`{{${collection}}}`,posts.length ? articles : '');
}
await writeFile('dist/index.html',html);
await writeFile('dist/resume.html',resumeHtml);
await buildResumePdf();
await copyFile('public/favicon.svg','dist/favicon.svg');
await copyFile('THIRD_PARTY_NOTICES.md','dist/THIRD_PARTY_NOTICES.txt');
await cp('public/licenses','dist/licenses',{recursive:true});
for(const collection of ['notes','projects']) {
  await cp(`.build/${collection}-images`,`dist/${collection}-assets`,{recursive:true});
  await cp(`.build/${collection}-vectors`,`dist/${collection}-assets`,{recursive:true});
}
await copyFile('node_modules/v86/LICENSE','dist/licenses/v86.txt');
await copyFile('node_modules/@xterm/xterm/LICENSE','dist/licenses/xterm.txt');
await copyFile('node_modules/@xterm/addon-fit/LICENSE','dist/licenses/xterm-addon-fit.txt');
await copyFile('node_modules/@xterm/addon-image/LICENSE','dist/licenses/xterm-addon-image.txt');
await writeFile('dist/_headers', '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/sw.js\n  Cache-Control: no-cache\n/manifest.json\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/resume.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n');
const offline=await buildOffline();
console.log(JSON.stringify({dist:'dist',snapshotBytes:metadata.compressedBytes,normalLoadRawBytes:totalRaw,normalLoadBrotliBytes:totalBrotli,offline,identity:metadata.identity},null,2));

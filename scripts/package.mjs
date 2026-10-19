import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

await mkdir('release',{recursive:true});
const archive = resolve('release/site-static.tar.gz');
execFileSync('tar',['-czf',archive,'-C','dist','.'],{stdio:'inherit'});
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(archive+'.sha256',`${digest}  site-static.tar.gz\n`);
console.log(`Static site: ${archive}\nExtract into your web server or CDN document root. No server-side application is required.`);

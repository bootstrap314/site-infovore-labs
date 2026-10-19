import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
try {
  const archive='release/site-static.tar.gz';
  const checksum=(await readFile(archive+'.sha256','utf8')).trim();
  const match=checksum.match(/^([a-f0-9]{64})\s+site-static\.tar\.gz$/);
  const actual=createHash('sha256').update(await readFile(archive)).digest('hex');
  if(!match || match[1]!==actual)throw new Error('Archive checksum does not match. Run make archive to recreate it.');
  console.log(`${archive}: checksum OK`);
} catch(error) {
  console.error(error.code==='ENOENT' ? 'No complete release archive found. Run make package (full build) or make archive (existing dist/).' : error.message);
  process.exitCode=1;
}

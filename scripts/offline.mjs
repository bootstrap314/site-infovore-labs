import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function buildOffline(root='dist') {
  async function filesIn(directory='') {
    const entries=await readdir(`${root}/${directory}`,{withFileTypes:true});
    const groups=await Promise.all(entries.map(entry=>{
      const path=directory+entry.name;
      return entry.isDirectory() ? filesIn(path+'/') : [path];
    }));
    return groups.flat();
  }
  const paths=new Set(await filesIn());
  const files=[];
  let compressedBytes=0;
  for(const path of [...paths].sort()) {
    if(path==='_headers' || path==='sw.js')continue;
    // Compression sidecars aren't separate resources. The initramfs .gz is.
    if(/\.(br|gz)$/.test(path) && paths.has(path.replace(/\.(br|gz)$/,'')))continue;
    const bytes=await readFile(`${root}/${path}`);
    files.push({path,integrity:'sha256-'+createHash('sha256').update(bytes).digest('base64'),bytes:bytes.length});
    compressedBytes+=(paths.has(path+'.br') ? await readFile(`${root}/${path}.br`) : bytes).length;
  }
  const template=await readFile('src/sw.js','utf8');
  const version=createHash('sha256').update(JSON.stringify(files)).update(template).digest('hex').slice(0,20);
  await writeFile(`${root}/sw.js`,template.replace('__OFFLINE_BUILD__',JSON.stringify({version,files})));
  return {version,files:files.length,compressedBytes,storedBytes:files.reduce((total,file)=>total+file.bytes,0)};
}

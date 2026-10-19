import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import { parse as parseYaml } from 'yaml';
import stringWidth from 'string-width';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir, rm, copyFile, realpath } from 'node:fs/promises';
import { resolve, relative, basename, dirname, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { diagramRenderer, diagramAscii } from './diagram.mjs';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkFrontmatter,['yaml']);
const clean = value => String(value).normalize('NFC').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');
const escape = value => String(value).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digest = value => createHash('sha256').update(value).digest('hex');
const cString = value => JSON.stringify(value).replace(/\\u([0-9a-fA-F]{4})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));

export function mathText(source, inline = false) {
  try {
    return clean(execFileSync(resolve('.build/termtex'),['-color=false',...(inline ? ['-inline'] : []),'--',source],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']})).trimEnd();
  } catch (error) { throw new Error(`LaTeX: ${String(error.stderr || error.message).trim()}`); }
}

const safeLink = value => {
  try {const url=new URL(value);return ['http:','https:','mailto:'].includes(url.protocol) ? url.href : null;}
  catch {return null;}
};
const imageReference = (node,references) => node.url || references.get(node.identifier) || '';
const localPng = url => !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(url) && /\.png$/i.test(url);
async function imagePath(directory,filename,url) {
  const root=await realpath(directory);
  const path=resolve(directory,dirname(filename),decodeURIComponent(url));
  const inside=target=>{const rel=relative(root,target);return rel && rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel);};
  if(!inside(path) || !inside(await realpath(path)))throw new Error('Image must stay inside its content directory');
  return path;
}

export async function compilePost(source, filename, renderDiagram, loadImage) {
  const tree = parser.parse(source);
  const yaml = tree.children.find(node=>node.type==='yaml');
  const meta = yaml ? parseYaml(yaml.value) : {};
  if (meta != null && (typeof meta !== 'object' || Array.isArray(meta))) throw new Error('Front matter must be a mapping');
  if (meta?.draft === true) return null;
  if (meta?.draft != null && typeof meta.draft !== 'boolean') throw new Error('draft must be true or false');
  const repository=meta?.repository == null ? '' : safeLink(meta.repository);
  if(meta?.repository != null && (!repository || !repository.startsWith('https://')))throw new Error('repository must be an HTTPS URL');
  const references = new Map(tree.children.filter(n=>n.type==='definition').map(n=>[n.identifier,n.url]));
  const inline = node => {
    if (node.type === 'inlineMath') return mathText(node.value,true).replace(/\n/g,' ');
    if (node.type === 'break') return '\n';
    if (node.type === 'link' || node.type === 'linkReference') {
      const label = node.children.map(inline).join('');
      const url = node.url || references.get(node.identifier) || '';
      return label === url ? label : `${label} (${url})`;
    }
    if (node.type === 'image' || node.type === 'imageReference') return `[Image: ${node.alt || 'illustration'}] (${node.url || references.get(node.identifier) || ''})`;
    if (node.children) return node.children.map(inline).join('');
    return clean(node.value || '').replace(/\n/g,' ');
  };
  const inlineHtml = node => {
    if(node.type==='inlineMath')return escape(mathText(node.value,true).replace(/\n/g,' '));
    if(node.type==='break')return '<br>';
    if(node.type==='link' || node.type==='linkReference') {
      const label=node.children.map(inlineHtml).join('');
      const url=safeLink(node.url || references.get(node.identifier) || '');
      return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    }
    if(node.type==='image' || node.type==='imageReference')return escape(inline(node));
    if(node.children)return node.children.map(inlineHtml).join('');
    return escape(clean(node.value || '').replace(/\n/g,' '));
  };
  const heading = tree.children.find(n=>n.type==='heading' && n.depth===1);
  const title = clean(meta?.title || (heading && inline(heading)) || basename(filename,'.md').replace(/[-_]/g,' ')).trim();
  if (!title || typeof meta?.title === 'object') throw new Error('title must be nonempty text');
  let date = meta?.date == null ? '' : String(meta.date);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) throw new Error('date must be a valid YYYY-MM-DD date');
  const blocks = [];
  const append = (kind,text,extra={}) => blocks.push({kind,text:clean(text),...extra});
  async function walk(nodes, prefix='') {
    for (const node of nodes) {
      try {
        if (['yaml','definition'].includes(node.type)) continue;
        if (node === heading && inline(node) === title) continue;
        if (node.type === 'heading') append('heading',prefix+inline(node));
        else if (node.type === 'paragraph') {
          // A standalone local PNG becomes an embedded image in both readers.
          // Other inline/remote images retain their text alternative.
          const image=node.children.length===1 && ['image','imageReference'].includes(node.children[0].type) ? node.children[0] : null;
          const url=image && imageReference(image,references);
          if(image && localPng(url) && loadImage) {
            const asset=await loadImage(url);
            const backdrop=image.title==='light' ? 1 : image.title==='dark' ? 2 : 0;
            append('image',image.alt || 'Screenshot',{image:asset.name,lightImage:asset.name,width:asset.width,height:asset.height,screenshot:true,backdrop});
          } else append('text',prefix+inline(node),{html:escape(prefix)+inlineHtml(node)});
        }
        else if (node.type === 'math' || (node.type === 'code' && ['math','latex','tex'].includes(node.lang))) append('math',mathText(node.value));
        else if (node.type === 'code' && node.lang === 'mermaid') {
          const alt = node.value.match(/accDescr:\s*(.*)/)?.[1] || node.value.match(/accTitle:\s*(.*)/)?.[1] || 'Mermaid diagram';
          const dark = await renderDiagram(node.value,'dark');
          const light = await renderDiagram(node.value,'light');
          append('image',alt,{image:dark.name,lightImage:light.name,svg:dark.svgName,lightSvg:light.svgName,width:dark.width,height:dark.height,source:node.value,ascii:diagramAscii(node.value)});
        } else if (node.type === 'code') append('pre',node.value.replace(/\t/g,'    '));
        else if (node.type === 'blockquote') await walk(node.children,prefix+'│ ');
        else if (node.type === 'list') {
          let index = node.start || 1;
          for (const item of node.children) {
            const marker = item.checked != null ? (item.checked ? '[x] ' : '[ ] ') : node.ordered ? `${index++}. ` : '• ';
            const start = blocks.length;
            await walk(item.children,prefix+'  ');
            if (blocks[start]) blocks[start].text = prefix+marker+blocks[start].text.slice(prefix.length+2);
            if (blocks[start]?.html) blocks[start].html = escape(prefix+marker)+blocks[start].html.slice(escape(prefix+'  ').length);
          }
        } else if (node.type === 'table') {
          const rows = node.children.map(row=>row.children.map(inline));
          const widths = rows[0].map((_,i)=>Math.max(...rows.map(row=>stringWidth(row[i] || ''))));
          const format = row=>row.map((s,i)=>s+' '.repeat(widths[i]-stringWidth(s))).join(' │ ');
          append('pre',[format(rows[0]),widths.map(w=>'─'.repeat(w)).join('─┼─'),...rows.slice(1).map(format)].join('\n'));
        } else if (node.type === 'thematicBreak') append('rule','');
        else if (node.type === 'html') append('pre',node.value);
        else if (node.children) await walk(node.children,prefix);
        else if (node.value) append('text',node.value);
      } catch (error) { throw new Error(`${filename}:${node.position?.start.line || 1}: ${error.message}`); }
    }
  }
  await walk(tree.children);
  return {slug:filename.replace(/\.md$/i,''),title,date,repository,blocks};
}

async function markdownFiles(directory) {
  let entries;
  try { entries = await readdir(directory,{withFileTypes:true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(path);
  }
  return result;
}

export async function noteSources(directory='notes') {
  const sources = {};
  for (const file of await markdownFiles(directory)) {
    const source=await readFile(file,'utf8');sources[file]=digest(source);
    const tree=parser.parse(source),yaml=tree.children.find(node=>node.type==='yaml');
    if(yaml && parseYaml(yaml.value)?.draft===true)continue;
    const references=new Map(tree.children.filter(n=>n.type==='definition').map(n=>[n.identifier,n.url]));
    async function visit(node) {
      if(['image','imageReference'].includes(node.type)) {
        const url=imageReference(node,references);
        if(localPng(url)) {
          try {
            const path=await imagePath(directory,relative(directory,file),url);
            sources[relative(process.cwd(),path)]=digest(await readFile(path));
          } catch(error) {throw new Error(`${file}:${node.position?.start.line || 1}: ${error.message}`);}
        }
      }
      for(const child of node.children || [])await visit(child);
    }
    await visit(tree);
  }
  return sources;
}

export async function compileNotes(directory='notes', output='.build', collection='notes') {
  if(!['notes','projects'].includes(collection))throw new Error('Unknown content collection');
  const singular=collection==='notes' ? 'note' : 'project';
  const renderer = await diagramRenderer();
  const assets = new Map(), vectors = new Map(), posts = [], sources = await noteSources(directory);
  try {
    for (const file of await markdownFiles(directory)) {
      const post = await compilePost(await readFile(file,'utf8'),relative(directory,file),async (source,scheme)=>{
        const image = await renderer.render(source,scheme); assets.set(image.name,image); vectors.set(image.svgName,image.svgData); return image;
      },async url=>{
        const data=await readFile(await imagePath(directory,relative(directory,file),url));
        if(data.length<33 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data.toString('ascii',12,16)!=='IHDR')throw new Error('Invalid PNG image');
        const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
        if(!width || !height || width*height>9000000 || data.length>8000000)throw new Error('PNG must be at most 9 megapixels and 8 MB');
        const image={name:`${digest(data).slice(0,24)}.png`,width,height,data};
        assets.set(image.name,image);return image;
      });
      if (post) posts.push({...post,filename:relative(directory,file)});
    }
  } finally { await renderer.close(); }
  posts.sort((a,b)=>b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  await mkdir(output,{recursive:true});
  const kind = {text:0,heading:1,pre:2,math:3,image:4,rule:5};
  let header = `/* Generated by scripts/notes.mjs. Edit ${collection}/ instead. */\n`;
  header += '#ifndef SITE_CONTENT_TYPES\n#define SITE_CONTENT_TYPES\n';
  header += 'typedef struct { int kind; const char *text, *image, *light_image; int width, height, backdrop; const char *ascii; int diagram; } NoteBlock;\n';
  header += 'typedef struct { const char *title, *date, *filename; const NoteBlock *blocks; int count; } Note;\n';
  header += '#endif\n';
  posts.forEach((post,index)=>{
    header += `static const NoteBlock ${singular}_blocks_${index}[] = {\n`;
    for (const block of post.blocks) header += `{${kind[block.kind]},${cString(block.text)},${cString(block.image ? '/usr/share/'+collection+'/'+block.image : '')},${cString(block.lightImage ? '/usr/share/'+collection+'/'+block.lightImage : '')},${block.width || 0},${block.height || 0},${block.backdrop || 0},${cString(block.ascii || '')},${block.source ? 1 : 0}},\n`;
    if (!post.blocks.length) header += '{0,"","","",0,0,0,"",0},\n';
    header += '};\n';
  });
  header += `static const Note ${collection}[] = {\n`;
  posts.forEach((post,index)=>{header += `{${cString(post.title)},${cString(post.date)},${cString(post.filename)},${singular}_blocks_${index},${post.blocks.length}},\n`;});
  if (!posts.length) header += '{"","","",NULL,0},\n';
  header += `};\nstatic const int ${singular}_count = ${posts.length};\n`;
  await writeFile(`${output}/${collection}.h`,header);
  await writeFile(`${output}/${collection}.json`,JSON.stringify(posts,null,2)+'\n');
  await writeFile(`${output}/${collection}-sources.json`,JSON.stringify(sources,null,2)+'\n');
  await rm(`${output}/${collection}-raw`,{recursive:true,force:true});
  await mkdir(`${output}/${collection}-raw`,{recursive:true});
  for (const post of posts) {
    const target=`${output}/${collection}-raw/${post.filename}`;
    await mkdir(dirname(target),{recursive:true});
    await copyFile(`${directory}/${post.filename}`,target);
  }
  await rm(`${output}/${collection}-images`,{recursive:true,force:true});
  await mkdir(`${output}/${collection}-images`,{recursive:true});
  for (const [name,image] of assets) await writeFile(`${output}/${collection}-images/${name}`,image.data);
  // SVGs are for the HTML reader; only PNG fallbacks enter the Linux guest.
  await rm(`${output}/${collection}-vectors`,{recursive:true,force:true});
  await mkdir(`${output}/${collection}-vectors`,{recursive:true});
  for (const [name,data] of vectors) await writeFile(`${output}/${collection}-vectors/${name}`,data);
  const imageHtml=block=>{
    const image=`<img loading="lazy" src="${collection}-assets/${block.svg || block.image}" alt="${escape(block.text)}" width="${block.width}" height="${block.height}"${block.backdrop ? ` style="background:${block.backdrop===1 ? '#ffffff' : '#202020'}"` : ''}>`;
    return block.screenshot ? `<figure class="post-screenshot"><a href="${collection}-assets/${block.image}" target="_blank" rel="noopener noreferrer" aria-label="Open screenshot at full size: ${escape(block.text)}">${image}</a><figcaption>${escape(block.text)} · Open image for full size</figcaption></figure>` : `<figure class="mermaid-diagram${block.ascii ? ' has-ascii' : ''}"><picture><source media="(prefers-color-scheme: light)" type="image/svg+xml" srcset="${collection}-assets/${block.lightSvg}">${image}</picture>${block.ascii ? `<pre class="diagram-ascii" aria-label="${escape(block.text)}">${escape(block.ascii)}</pre>` : ''}<figcaption>${escape(block.text)}</figcaption></figure>`;
  };
  const articles = posts.map(post=>`<article><h2>${escape(post.title)}</h2>${post.date ? `<p class="note-date">${escape(post.date)}</p>` : ''}${post.repository ? `<p><a data-repository href="${escape(post.repository)}" target="_blank" rel="noopener noreferrer">View on GitHub ↗</a></p>` : ''}${post.blocks.map(block=>block.kind==='image' ? imageHtml(block) : block.kind==='heading' ? `<h3>${escape(block.text)}</h3>` : block.kind==='rule' ? '<hr>' : ['math','pre'].includes(block.kind) ? `<pre>${escape(block.text)}</pre>` : `<p>${block.html || escape(block.text).replace(/\n/g,'<br>')}</p>`).join('')}</article>`).join('\n');
  await writeFile(`${output}/${collection}.html`,articles || `<p>No ${collection} published yet.</p>`);
  console.log(`Compiled ${posts.length} ${collection} and ${assets.size} PNG / ${vectors.size} SVG assets.`);
  return posts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const collection=process.argv[2] || 'notes';
  compileNotes(collection,'.build',collection).catch(error=>{console.error(error.message);process.exitCode=1;});
}

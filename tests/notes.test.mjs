import { diagramAscii } from '../scripts/diagram.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { compilePost, compileNotes, noteSources } from '../scripts/notes.mjs';

test('Markdown becomes structured prose, lists, code, tables, references, and typeset math',async()=>{
  const post=await compilePost('# A note\n\nHello **reader**, $x^2$.\n\n- One\n- Two\n\n```js\nlet x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[Link][ref]\n\n[ref]: https://example.com\n\n$$\n\\frac{1}{2}\n$$\n','a-note.md');
  assert.equal(post.title,'A note');
  assert.ok(post.blocks.some(b=>b.text.includes('Hello reader, x².')));
  assert.ok(post.blocks.some(b=>b.text==='• One'));
  assert.ok(post.blocks.some(b=>b.kind==='pre'&&b.text==='let x = 1;'));
  assert.ok(post.blocks.some(b=>b.text.includes('Link (https://example.com)')));
  assert.ok(post.blocks.some(b=>b.kind==='math'&&/1\n.*─.*\n.*2/.test(b.text)));
});

test('metadata defaults, drafts, and invalid dates are explicit',async()=>{
  assert.equal((await compilePost('Just text','my-first-note.md')).title,'my first note');
  assert.equal(await compilePost('---\ndraft: true\n---\n# Not published','draft.md'),null);
  await assert.rejects(()=>compilePost('---\ndate: 2026-02-30\n---\nText','bad.md'),/valid YYYY-MM-DD/);
  await assert.rejects(()=>compilePost('---\ndraft: "false"\n---\nText','bad.md'),/true or false/);
  await assert.rejects(()=>compilePost('---\nrepository: javascript:alert(1)\n---\nText','bad.md'),/HTTPS URL/);
});

test('local screenshots are embedded, hashed as dependencies, and confined to the collection',async()=>{
  const root=await mkdtemp('.build/screenshots-test-');
  const directory=`${root}/projects`,output=`${root}/output`;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aocsAAAAASUVORK5CYII=','base64');
  await mkdir(`${directory}/images`,{recursive:true});
  try {
    await writeFile(`${directory}/images/app.png`,png);
    await writeFile(`${directory}/app.md`,'---\nrepository: https://github.com/bootstrap314/ac-man\n---\n# App\n\n[Source](https://github.com/bootstrap314/ac-man)\n\n![Native controls](images/app.png "light")\n');
    const before=await noteSources(directory);
    const [post]=await compileNotes(directory,output,'projects');
    assert.equal(post.repository,'https://github.com/bootstrap314/ac-man');
    const image=post.blocks.find(block=>block.kind==='image');
    assert.equal(image.screenshot,true);assert.equal(image.backdrop,1);assert.equal(image.width,1);assert.equal(image.height,1);
    assert.deepEqual(await readFile(`${output}/projects-images/${image.image}`),png);
    const html=await readFile(`${output}/projects.html`,'utf8');
    assert.match(html,/data-repository href="https:\/\/github.com\/bootstrap314\/ac-man"/);
    assert.match(html,/>Source<\/a>/);
    assert.match(html,/class="post-screenshot"/);
    assert.match(html,/Open screenshot at full size: Native controls/);
    await writeFile(`${directory}/images/app.png`,Buffer.concat([png,Buffer.from('changed')]));
    assert.notDeepEqual(await noteSources(directory),before,'Image-only edits invalidate the guest');
    await rm(`${directory}/images/app.png`);
    await assert.rejects(()=>compileNotes(directory,output,'projects'),/app.md:8:.*ENOENT/);
    await writeFile(`${root}/outside.png`,png);
    await symlink('../../outside.png',`${directory}/images/app.png`);
    await assert.rejects(()=>compileNotes(directory,output,'projects'),/inside its content directory/);
    await writeFile(`${directory}/app.md`,'# App\n\n![Outside](../outside.png)');
    await assert.rejects(()=>compileNotes(directory,output,'projects'),/inside its content directory/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('HTML links escape labels and reject executable schemes; remote images stay text',async()=>{
  const post=await compilePost('# Links\n\n[<script>](https://example.com/?a=1&b=2) [bad](javascript:alert%281%29)\n\n![Remote](https://example.com/image.png)','links.md');
  assert.match(post.blocks[0].html,/href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(post.blocks[0].html,/&lt;script&gt;/);
  assert.doesNotMatch(post.blocks[0].html,/href="javascript:/);
  assert.equal(post.blocks[1].kind,'text');
});

test('Mermaid compiles to dark and light images, while invalid LaTeX reports its source',async()=>{
  const schemes=[];
  const post=await compilePost('```mermaid\ngraph LR\n A --> B\n```','graph.md',async(source,scheme)=>{
    schemes.push(scheme);assert.match(source,/A --> B/);return {name:`${scheme}.png`,svgName:`${scheme}.svg`,width:400,height:150};
  });
  assert.deepEqual(schemes,['dark','light']);
  assert.equal(post.blocks[0].kind,'image');
  assert.equal(post.blocks[0].image,'dark.png');
  assert.equal(post.blocks[0].lightImage,'light.png');
  assert.equal(post.blocks[0].svg,'dark.svg');
  assert.equal(post.blocks[0].lightSvg,'light.svg');
  assert.match(post.blocks[0].ascii,/\|A\|.*>\|B\|/);
  assert.doesNotMatch(post.blocks[0].ascii,/[\x1b\u2500-\u257f]/);
  await assert.rejects(()=>compilePost('Before\n\n$$\n\\frac{1}{\n$$','broken.md'),/broken.md:3: LaTeX/);
});

test('discovery notices additions, edits, deletions; publication is date-sorted and escaped',async()=>{
  await mkdir('.build',{recursive:true});
  const root=await mkdtemp('.build/notes-test-');
  const notes=`${root}/notes`, output=`${root}/output`;
  await mkdir(notes);
  try {
    await writeFile(`${notes}/older.md`,'---\ndate: 2025-01-01\n---\n# Older\n');
    const before=await noteSources(notes);
    await writeFile(`${notes}/newer.md`,'---\ndate: 2026-10-13\ntitle: "<script>"\n---\nText');
    await writeFile(`${notes}/draft.md`,'---\ndraft: true\n---\n# Secret');
    const posts=await compileNotes(notes,output);
    assert.deepEqual(posts.map(p=>p.title),['<script>','Older']);
    assert.match(await readFile(`${output}/notes.html`,'utf8'),/&lt;script&gt;/);
    assert.doesNotMatch(await readFile(`${output}/notes.html`,'utf8'),/Secret/);
    assert.deepEqual((await readdir(`${output}/notes-raw`)).sort(),['newer.md','older.md']);
    assert.match(await readFile(`${output}/notes-raw/older.md`,'utf8'),/# Older/);
    assert.notDeepEqual(await noteSources(notes),before);
    await writeFile(`${notes}/older.md`,'# Edited');
    assert.notEqual((await noteSources(notes))[`${notes}/older.md`],before[`${notes}/older.md`]);
    await rm(`${notes}/older.md`);await rm(`${notes}/newer.md`);
    assert.deepEqual(await compileNotes(notes,output),[]);
    assert.match(await readFile(`${output}/notes.h`,'utf8'),/note_count = 0/);
    assert.deepEqual(await readdir(`${output}/notes-raw`),[]);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('Projects shares the compiler while keeping content and generated symbols separate from Notes',async()=>{
  const root=await mkdtemp('.build/collections-test-');
  try {
    await mkdir(`${root}/notes`);await mkdir(`${root}/projects`);
    await writeFile(`${root}/notes/shared.md`,'# A note\n\nNote content.');
    await writeFile(`${root}/projects/shared.md`,'# A project\n\nProject $x^2$.');
    await writeFile(`${root}/projects/draft.md`,'---\ndraft: true\n---\n# Private draft');
    const output=`${root}/output`;
    await compileNotes(`${root}/notes`,output);
    const noteHeader=await readFile(`${output}/notes.h`,'utf8');
    await compileNotes(`${root}/projects`,output,'projects');
    assert.equal(await readFile(`${output}/notes.h`,'utf8'),noteHeader);
    const projectHeader=await readFile(`${output}/projects.h`,'utf8');
    assert.match(projectHeader,/#ifndef SITE_CONTENT_TYPES/);
    assert.match(projectHeader,/project_blocks_0/);
    assert.match(projectHeader,/project_count = 1/);
    assert.match(await readFile(`${output}/projects.html`,'utf8'),/Project x²/);
    assert.deepEqual(await readdir(`${output}/projects-raw`),['shared.md']);
    assert.match(await readFile(`${output}/notes-raw/shared.md`,'utf8'),/Note content/);
    await rm(`${root}/projects/shared.md`);
    assert.deepEqual(await compileNotes(`${root}/projects`,output,'projects'),[]);
    assert.deepEqual(await readdir(`${output}/projects-raw`),[]);
    assert.equal(await readFile(`${output}/notes.h`,'utf8'),noteHeader);
  } finally {await rm(root,{recursive:true,force:true});}
});


test('ASCII keeps semantic labels and edges, omits accessibility metadata, and leaves unsupported families as images',()=>{
  const text=diagramAscii('flowchart TB\naccTitle: Hidden title\naccDescr {\nHidden description\n}\nA[Validate] --> B[Send once]\nB --> C[Read back]');
  for(const label of ['Validate','Send once','Read back'])assert.ok(text.includes(label));
  assert.equal((text.match(/v/g) || []).length,2);
  assert.doesNotMatch(text,/Hidden|accDescr/);
  assert.equal(diagramAscii('pie\n"One" : 1'), '');
});

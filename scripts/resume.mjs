import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// A small, deliberately constrained adapter for misc/resume.tex's macros.
// No TeX execution or raw source is needed in the browser.
const escapeHtml=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=message=>{throw new Error(`misc/resume.tex: ${message}`);};
function uncomment(source) {
  return source.split('\n').map(line=>{
    for(let i=0;i<line.length;i++) {
      if(line[i]==='\\') {i++;continue;}
      if(line[i]==='%') return line.slice(0,i);
    }
    return line;
  }).join('\n');
}
function group(source,start,open='{',close='}') {
  let i=start;
  while(/\s/.test(source[i]||'') && i<source.length)i++;
  if(source[i]!==open)fail(`Expected ${open} near ${source.slice(start,start+50)}`);
  const begin=++i;
  let depth=1;
  for(;i<source.length;i++) {
    if(source[i]==='\\') {i++;continue;}
    if(source[i]===open)depth++;
    if(source[i]===close && --depth===0)return {value:source.slice(begin,i),end:i+1};
    if(source[i]!==close)continue;
  }
  fail('Unclosed argument');
}
function commands(source,name,count) {
  const pattern=new RegExp(`\\\\${name}(?![A-Za-z])`,'g'),found=[];
  let match;
  while((match=pattern.exec(source))) {
    let end=pattern.lastIndex;
    const args=[];
    for(let i=0;i<count;i++) {const next=group(source,end);args.push(next.value);end=next.end;}
    found.push({start:match.index,end,args});
    pattern.lastIndex=end;
  }
  return found;
}
export function latexText(source) {
  let out='';
  const formatting=new Set(['textbf','textit','emph','textrm','textsf','texttt','mbox','underline']);
  const declarations=new Set(['large','Large','small','normalsize','bfseries','itshape']);
  for(let i=0;i<source.length;) {
    const c=source[i++];
    if(c==='{' || c==='}')continue;
    if(c==='~') {out+=' ';continue;}
    if(c!=='\\') {out+=c;continue;}
    const next=source[i++];
    if('%&#_${}'.includes(next)) {out+=next;continue;}
    if(next==='\\' || next===' ') {out+=' ';continue;}
    const match=source.slice(i-1).match(/^[A-Za-z]+/);
    if(!match)fail(`Unsupported text escape \\${next}`);
    const name=match[0];i+=name.length-1;
    if(declarations.has(name))continue;
    if(formatting.has(name)) {const arg=group(source,i);out+=latexText(arg.value);i=arg.end;continue;}
    if(name==='href') {
      const url=group(source,i),label=group(source,url.end);
      out+=`${latexText(label.value)} (${latexText(url.value)})`;i=label.end;continue;
    }
    if(name==='url') {const arg=group(source,i);out+=latexText(arg.value);i=arg.end;continue;}
    if(name==='LaTeX') {out+='LaTeX';continue;}
    fail(`Unsupported text command \\${name}; add it to the résumé adapter before building`);
  }
  return out.replace(/\s+/g,' ').trim();
}
export function parseResume(source) {
  const document=uncomment(source).match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/)?.[1];
  if(!document)fail('Expected a document environment');
  const headings=commands(document,'resheading',1);
  const expected=['Skills','Work Experience','Education'];
  if(JSON.stringify(headings.map(h=>latexText(h.args[0])))!==JSON.stringify(expected))fail('Expected Skills, Work Experience, and Education sections');
  const intro=document.slice(0,headings[0].start);
  const tableEnd=intro.indexOf('\\end{tabular*}');
  if(tableEnd<0)fail('Expected the contact table');
  const contact=intro.slice(0,tableEnd);
  const name=latexText(commands(contact,'textbf',1)[0]?.args[0]||'');
  const email=contact.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  const summary=latexText(commands(intro.slice(tableEnd),'textbf',1)[0]?.args[0]||'');
  if(!name || !email || !summary)fail('Name, email, and summary are required');
  const title=summary.split(/\s+with\s+/i)[0];
  const skillSource=document.slice(headings[0].end,headings[1].start);
  const skills=[...skillSource.matchAll(/\\item\s*\[([^\]]+)\]([\s\S]*?)(?=\\item|\\end\{description\})/g)]
    .map(([,label,items])=>({label:latexText(label).replace(/:$/,''),items:latexText(items)}));
  if(!skills.length)fail('No skills found in the description list');
  const entries=(start,end)=>{
    const section=document.slice(start,end),heads=commands(section,'ressubheading',4);
    return heads.map((head,index)=>{
      const [organization,location,role,dates]=head.args.map(latexText);
      const items=commands(section.slice(head.end,heads[index+1]?.start),'resitem',1).map(item=>latexText(item.args[0]));
      if(!organization || !role || !dates || !items.length)fail('Each role needs an organization, title, dates, and at least one resitem');
      return {organization,location,role,dates,items};
    });
  };
  const experience=entries(headings[1].end,headings[2].start);
  const education=entries(headings[2].end,document.length);
  if(!experience.length || !education.length)fail('Work experience and education must not be empty');
  if([...experience,...education].reduce((n,entry)=>n+entry.items.length,0)!==commands(document,'resitem',1).length)fail('A resitem is outside a supported section');
  // Only these explicitly selected fields leave the private source. In particular,
  // the contact table's phone number and postal address never enter any output.
  return {name,email,title,summary,skills,experience,education};
}
export function resumeHtml(resume) {
  const h=escapeHtml;
  const entries=(items,kind)=>items.map((entry,index)=>`<article class="career-entry" id="${kind}-${index}">
    <header class="career-heading"><p class="career-dates">${h(entry.dates)}</p><h3>${h(entry.organization)}</h3><p class="career-role">${h(entry.role)}</p><p class="career-location">${h(entry.location)}</p></header>
    <ul>${entry.items.map(item=>`<li>${h(item)}</li>`).join('')}</ul>
  </article>`).join('\n');
  return `<header class="resume-intro" id="overview">
    <p class="resume-kicker">CURRICULUM VITAE <span aria-hidden="true">/</span> ${h(resume.experience.at(-1).dates.match(/\d{4}/)?.[0]||'')} ONWARD</p>
    <h1>${h(resume.name)}</h1>
    <p class="resume-title">${h(resume.title)}</p>
    <a class="resume-email" href="mailto:${h(resume.email)}">${h(resume.email)} <span aria-hidden="true">↗</span></a>
    <p class="resume-summary">${h(resume.summary)}</p>
  </header>
  <div class="resume-layout">
    <nav class="resume-contents" aria-label="Résumé sections"><span>ON THIS PAGE</span><a href="#experience">01 <span>Experience</span></a><a href="#skills">02 <span>Skills</span></a><a href="#education">03 <span>Education</span></a></nav>
    <div class="resume-sections">
      <section id="experience" aria-labelledby="experience-title"><h2 id="experience-title"><span>01</span> Experience</h2>${entries(resume.experience,'role')}</section>
      <section id="skills" aria-labelledby="skills-title"><h2 id="skills-title"><span>02</span> Tools &amp; technologies</h2><dl class="resume-skills">${resume.skills.map(skill=>`<div><dt>${h(skill.label)}</dt><dd>${h(skill.items)}</dd></div>`).join('')}</dl></section>
      <section id="education" aria-labelledby="education-title"><h2 id="education-title"><span>03</span> Education</h2>${entries(resume.education,'education')}</section>
    </div>
  </div>`;
}
export async function compileResume(sourcePath='misc/resume.tex',output='.build') {
  const resume=parseResume(await readFile(sourcePath,'utf8'));
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/resume.json`,JSON.stringify(resume,null,2)+'\n');
  await writeFile(`${output}/resume.html`,resumeHtml(resume));
  const c=JSON.stringify;
  await writeFile(`${output}/resume.h`,`/* Generated from misc/resume.tex. Do not edit. */\nstatic const char *resume_name=${c(resume.name)};\nstatic const char *resume_title=${c(resume.title)};\nstatic const char *resume_email=${c(resume.email)};\nstatic const char *resume_companies[]={${resume.experience.map(e=>c(e.organization)).join(',')}};\nstatic const char *resume_dates[]={${resume.experience.map(e=>c(e.dates)).join(',')}};\nstatic const int resume_jobs=${resume.experience.length};\n`);
  console.log(`Compiled résumé: ${resume.experience.length} roles, ${resume.skills.length} skill groups (email-only contact).`);
  return resume;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await compileResume();

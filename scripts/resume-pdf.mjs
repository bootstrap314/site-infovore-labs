import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function buildResumePdf() {
  const [html,style,resumeStyle]=await Promise.all(['dist/resume.html','src/style.css','src/resume.css'].map(p=>readFile(p,'utf8')));
  const printable=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]+>/g,'').replace('</head>',`<style>${style}\n${resumeStyle}</style></head>`);
  const version=JSON.parse(await readFile('node_modules/playwright/package.json')).version;
  const key=createHash('sha256').update(`${version}:${printable}:${await readFile('scripts/resume-pdf.mjs','utf8')}`).digest('hex');
  await mkdir('.build/resume-pdf',{recursive:true});
  const cached=`.build/resume-pdf/${key}.pdf`;
  try {await copyFile(cached,'dist/resume.pdf');return;} catch {}
  const browser=await chromium.launch({headless:true,channel:process.env.CHROME_CHANNEL||'chrome'});
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent(printable,{waitUntil:'load'});
    const bytes=await page.pdf({format:'Letter',preferCSSPageSize:true,printBackground:true,tagged:true,outline:true,displayHeaderFooter:true,
      headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;margin:0 17mm;color:#657b83;font:8px Arial;display:flex;justify-content:space-between"><span>WILLIAM MICHAEL TURNER / RÉSUMÉ</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
    await writeFile(cached,bytes);await writeFile('dist/resume.pdf',bytes);
  } finally {await browser.close();}
}

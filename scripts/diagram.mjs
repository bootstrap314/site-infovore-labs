import { chromium } from 'playwright';
import { renderMermaidASCII } from 'beautiful-mermaid';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// The terminal text version is also compiled once, never in the visitor's
// browser. Unsupported diagram families keep their regular image fallback.
export function diagramAscii(source) {
  const diagram = source.replace(/^\s*acc(?:Title|Descr):[^\n]*$/gm,'')
    .replace(/^\s*accDescr\s*\{[\s\S]*?^\s*\}/gm,'').trim();
  if (!/^(?:graph|flowchart|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|xychart-beta)\b/.test(diagram)) return '';
  try {
    return renderMermaidASCII(diagram,{useAscii:true,colorMode:'none',paddingX:3,paddingY:2,boxBorderPadding:0})
      .split('\n').map(line=>line.trimEnd()).join('\n').trimEnd();
  } catch (error) {
    console.warn(`ASCII diagram unavailable; keeping its image: ${error.message}`);
    return '';
  }
}

// A build-time browser produces SVGs for HTML and PNG fallbacks for xterm.
// No Mermaid code ships to visitors.
export async function diagramRenderer() {
  let browser, page;
  const version = JSON.parse(await readFile('node_modules/mermaid/package.json')).version;
  await mkdir('.build/diagram-cache', {recursive:true});
  return {
    async render(source, scheme='dark') {
      const key = createHash('sha256').update(`png-svg-v3:${version}:${scheme}:${source}`).digest('hex').slice(0,24);
      const path = `.build/diagram-cache/${key}.png`;
      const svgPath = `.build/diagram-cache/${key}.svg`;
      try {
        const info = JSON.parse(await readFile(path + '.json','utf8'));
        return {...info, data:await readFile(path), name:`${key}.png`,svgData:await readFile(svgPath),svgName:`${key}.svg`};
      } catch { /* New or changed diagram. */ }
      if (!browser) {
        browser = await chromium.launch({headless:true, channel:process.env.CHROME_CHANNEL || 'chrome'});
        page = await browser.newPage({viewport:{width:1600,height:1200},deviceScaleFactor:2});
        // Rendering is self-contained; author content cannot fetch remote assets.
        await page.route('**/*', route => route.abort());
        await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#20231e;color:#d6dad1"><div id="diagram" style="display:inline-block;padding:16px"></div></body></html>');
        await page.addScriptTag({path:'node_modules/mermaid/dist/mermaid.min.js'});
      }
      const {svg:vector,...info} = await page.evaluate(async ({source,scheme}) => {
        const light = scheme === 'light';
        const bg = light ? '#fdf6e3' : '#002b36', fg = light ? '#586e75' : '#93a1a1';
        document.body.style.background = bg;
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,theme:'base',fontFamily:'monospace',themeVariables:{background:bg,primaryColor:light ? '#eee8d5' : '#073642',primaryTextColor:fg,primaryBorderColor:'#2aa198',lineColor:fg,secondaryColor:light ? '#eee8d5' : '#073642',tertiaryColor:bg,textColor:fg,fontSize:'18px'}});
        const {svg} = await mermaid.render('note-diagram',source);
        const box = document.getElementById('diagram');
        box.innerHTML = svg;
        const image = box.querySelector('svg');
        const vb = image.viewBox.baseVal;
        if (!(vb.width > 0 && vb.height > 0)) throw new Error('Mermaid produced an empty diagram');
        const scale = Math.min(1,1400/vb.width,1400/vb.height);
        image.style.maxWidth = 'none';
        image.setAttribute('width',String(Math.ceil(vb.width*scale)));
        image.setAttribute('height',String(Math.ceil(vb.height*scale)));
        const width=Math.ceil(vb.width*scale)+32,height=Math.ceil(vb.height*scale)+32;
        // Keep the PNG's padding and background in the standalone vector too.
        const inner=image.cloneNode(true);inner.setAttribute('x','16');inner.setAttribute('y','16');
        const standalone=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${bg}"/>${new XMLSerializer().serializeToString(inner)}</svg>`;
        return {width,height,svg:standalone};
      },{source,scheme});
      const data = await page.locator('#diagram').screenshot();
      await writeFile(path,data);
      await writeFile(svgPath,vector);
      await writeFile(path+'.json',JSON.stringify(info));
      return {...info,data,name:`${key}.png`,svgName:`${key}.svg`,svgData:Buffer.from(vector)};
    },
    async close() { await browser?.close(); },
  };
}

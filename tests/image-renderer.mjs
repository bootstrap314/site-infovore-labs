import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {drawImageTiles,clearImageLines,patchImageAddon} from '../scripts/image-addon.mjs';

const original=await readFile('node_modules/@xterm/addon-image/lib/addon-image.mjs','utf8');
const oldDraw=original.match(/draw\(t,i,s,n,A=1\)\{.*?(?=extractTile\(t,i\))/s)[0];
assert.ok(patchImageAddon(original).includes('originX'));
assert.throws(()=>patchImageAddon('unexpected dependency'),/Image addon changed/);
const engine=process.argv.includes('--webkit')?'webkit':'chromium';
const browser=engine==='webkit'?await webkit.launch():await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const results=[];
try {
  for(const dpr of [1,1.5,2]) {
    const page=await browser.newPage({deviceScaleFactor:dpr});
    const result=await page.evaluate(({draw,clear,oldDraw})=>{
      const fixed=Function(`return (${draw})`)(),clearLines=Function(`return (${clear})`)();
      const old=Function(`return ({${oldDraw}}).draw`)();
      const make=()=>{const canvas=document.createElement('canvas');canvas.width=300;canvas.height=350;return canvas;};
      const source=make();source.width=137;source.height=209;
      const ctx=source.getContext('2d');
      ctx.fillStyle='rgba(50,80,120,.25)';ctx.fillRect(0,0,137,209);
      ctx.fillStyle='rgba(220,30,80,.6)';ctx.fillRect(11,33,103,49);
      ctx.fillStyle='black';ctx.font='16px monospace';ctx.fillText('Temperature',8,118);
      const differences=(a,b)=>{
        const left=a.getContext('2d').getImageData(0,0,a.width,a.height).data;
        const right=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
        return left.reduce((total,value,index)=>total+(value!==right[index]),0);
      };
      const cases=[];
      for(const [width,height] of [[8.421875,17.08],[8.5,17.5],[9,20]]) {
        for(const [col,row] of [[3,2],[1,-2],[-2,-2]]) {
          const cols=Math.ceil(source.width/width),rows=Math.ceil(source.height/height);
          const expected=make(),actual=make(),before=make();
          expected.getContext('2d').drawImage(source,Math.floor(col*width),Math.floor(row*height));
          const renderer=canvas=>({_ctx:canvas.getContext('2d'),cellSize:{width,height},_rescaleImage(){},dimensions:{css:{cell:{height},canvas:{width:canvas.width}}}});
          const fixedRenderer=renderer(actual),oldRenderer=renderer(before),spec={actual:source};
          for(let y=0;y<rows;y++) {
            // Split a row into runs too, as terminal overwrites can do.
            for(const [x,count] of [[0,3],[3,cols-3]]) {
              fixed.call(fixedRenderer,spec,y*cols+x,col+x,row+y,count);
              old.call(oldRenderer,spec,y*cols+x,col+x,row+y,count);
            }
          }
          const initial=differences(actual,expected),oldPixels=differences(before,expected);
          clearLines.call(fixedRenderer,row+3,row+5);
          for(let y=3;y<=5;y++)fixed.call(fixedRenderer,spec,y*cols,col,row+y,cols);
          cases.push({width,height,col,row,initial,redraw:differences(actual,expected),oldPixels});
        }
      }
      return cases;
    },{draw:drawImageTiles.toString(),clear:clearImageLines.toString(),oldDraw});
    for(const item of result) {
      assert.equal(item.initial,0,`Continuous image pixels at DPR ${dpr}: ${JSON.stringify(item)}`);
      assert.equal(item.redraw,0,`Partial repaint preserves adjacent pixels at DPR ${dpr}: ${JSON.stringify(item)}`);
    }
    assert.ok(result.some(item=>item.oldPixels>0),'The original tiled renderer reproduces the artifact');
    results.push({dpr,cases:result.length,passed:true,originalMismatch:Math.max(...result.map(item=>item.oldPixels))});
    await page.close();
  }
  await mkdir('.test-results',{recursive:true});
  await writeFile(`.test-results/image-renderer-${engine}.json`,JSON.stringify(results,null,2)+'\n');
  console.log(engine,JSON.stringify(results,null,2));
} finally {await browser.close();}

// @xterm/addon-image 0.9.0 rounds each tile's size up independently. At
// fractional cell sizes adjacent rows overlap, blending translucent PNGs twice
// and duplicating source pixels. Clip on shared pixel boundaries and draw the
// image at one continuous origin instead of resampling individual strips.
export function drawImageTiles(spec,tileId,col,row,count=1) {
  const ctx=this._ctx;
  if(!ctx)return;
  const {width,height}=this.cellSize;
  if(width<=0 || height<=0)return;
  this._rescaleImage(spec,width,height);
  const image=spec.actual;
  const columns=Math.ceil(image.width/width);
  const tileCol=tileId%columns,tileRow=Math.floor(tileId/columns);
  const originX=Math.floor((col-tileCol)*width),originY=Math.floor((row-tileRow)*height);
  const left=Math.floor(col*width),top=Math.floor(row*height);
  const right=Math.floor((col+count)*width),bottom=Math.floor((row+1)*height);
  ctx.save();
  ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  ctx.clearRect(left,top,right-left,bottom-top);
  ctx.drawImage(image,originX,originY);
  ctx.restore();
}

export function clearImageLines(start,end) {
  const height=this.dimensions?.css.cell.height || 0;
  const top=Math.floor(start*height),bottom=Math.floor((end+1)*height);
  this._ctx?.clearRect(0,top,this.dimensions?.css.canvas.width || 0,bottom-top);
}

// Fail visibly on a dependency update instead of silently losing the fix or
// changing unrelated code. The installed dependency itself stays untouched.
export function patchImageAddon(source) {
  for(const [name,next,re] of [
    ['draw',drawImageTiles,/draw\(t,i,s,n,A=1\)\{.*?(?=extractTile\(t,i\))/gs],
    ['clearLines',clearImageLines,/clearLines\([^)]*\)\{.*?(?=clearAll\(\))/gs],
  ]) {
    if([...source.matchAll(re)].length!==1)throw new Error(`Image addon changed: review the ${name} tile-rendering fix.`);
    source=source.replace(re,()=>next.toString().replace(/^function \w+/,name));
  }
  return source;
}

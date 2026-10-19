import {V86} from 'v86';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {zstdDecompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {machine,cmdline} from '../scripts/vm-options.mjs';

const binary=async path=>({buffer:new Uint8Array(await readFile(path)).buffer});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const prompt='personal:/notes# ';
const results=[];
await mkdir('.test-results',{recursive:true});
for(const cold of [false,true]) {
  const options=cold ? {
    bios:await binary('public/vm/seabios.bin'),vga_bios:await binary('public/vm/vgabios.bin'),
    bzimage:await binary('public/vm/bzImage'),initrd:await binary('public/vm/initramfs.cpio.gz'),cmdline,
  } : {initial_state:{buffer:new Uint8Array(zstdDecompressSync(await readFile('public/vm/state.bin.zst'))).buffer}};
  const vm=new V86({...machine,...options,wasm_path:'node_modules/v86/build/v86.wasm'});
  let output='',control='',identity,started=false;
  const send=(port,text)=>vm.serial_send_bytes(port,new TextEncoder().encode(text));
  vm.add_listener('emulator-started',()=>{started=true;});
  vm.add_listener('serial0-output-byte',byte=>{output+=String.fromCharCode(byte);});
  vm.add_listener('serial1-output-byte',byte=>{
    control+=String.fromCharCode(byte);
    if(byte!==10)return;
    try {const event=JSON.parse(control.trim());if(event.event==='ready')identity=event;}catch{}
    control='';
  });
  const until=async predicate=>{
    const deadline=Date.now()+15000;
    while(!predicate()) {
      assert.ok(Date.now()<deadline,`Guest timed out: ${JSON.stringify(output.slice(-2000))}`);
      await pause(10);
    }
  };
  const command=async(input,result)=>{
    output='';send(0,input+'\r');
    await until(()=>output.endsWith(prompt));
    assert.equal(output,input+'\r\n'+result+prompt,`Serial output must be ordered for: ${input}`);
  };
  try {
    await until(()=>started);
    if(cold)await until(()=>identity?.event==='ready');
    send(1,'R 40 160\nP 6\nI\n');
    await until(()=>identity?.page===6 && identity.shellPid>1 && output.endsWith(prompt));
    for(let n=0;n<30;n++)await command('echo "hi?\\n" > /dev/console','hi?\\n\r\n');
    await command('echo "hi?\\n"','hi?\\n\r\n');
    await command("printf 'one\\ntwo\\n' > /dev/console",'one\r\ntwo\r\n');
    await command("printf 'BEFORE\\n'; printf 'CONSOLE\\n' > /dev/console; printf 'AFTER\\n'",'BEFORE\r\nCONSOLE\r\nAFTER\r\n');
    await command("printf 'no newline' > /dev/console",'no newline');
    await command("printf 'TTY\\n' > /dev/tty",'TTY\r\n');
    await command("printf 'PIPE\\n' | cat",'PIPE\r\n');
    // Ash stopping/resuming and line editing must not detach console output.
    send(1,'P 2\n');await until(()=>identity?.page===2);
    send(1,'P 6\n');await until(()=>identity?.page===6 && /personal:\/notes# (?:\x1b\[J)?$/.test(output));
    await command("printf 'RETURN\\n' > /dev/console",'RETURN\r\n');
    // Closing a shell must release the redirect so a new PTY can claim it.
    for(let n=0;n<3;n++) {
      send(0,'exit\r');await until(()=>identity?.page===0 && identity.shellPid===0);
      output='';send(1,'P 6\n');
      await until(()=>identity?.page===6 && identity.shellPid>1 && output.endsWith(prompt));
      await command("printf 'NEW SHELL\\n' > /dev/console",'NEW SHELL\r\n');
    }
    results.push({boot:cold?'cold':'snapshot',test:'30 repeated console writes, stdout/console ordering, CRLF, literal echo escapes, printf, /dev/tty, pipes, page switching, shell exit/recreation',passed:true});
  } finally {await vm.destroy();}
}
await writeFile('.test-results/console.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));

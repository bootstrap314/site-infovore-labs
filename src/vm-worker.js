let vm, timer, output = '', control = '';
const send = (type, data) => postMessage({type, ...data});
const flush = () => { if (output) { send('output',{text:output}); output = ''; } timer = undefined; };
const buffer = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
};
onmessage = async ({data}) => {
  try {
    if (data.type === 'input') { vm?.serial0_send(data.text); return; }
    if (data.type === 'control') { vm?.serial_send_bytes(1, new TextEncoder().encode(data.text)); return; }
    if (data.type === 'pause') { await vm?.stop(); return; }
    if (data.type === 'resume') { await vm?.run(); return; }
    if (data.type !== 'start') return;
    const {manifest: m, cold} = data;
    const started = performance.now();
    const wasm = WebAssembly.compileStreaming(fetch(m.wasm));
    const images = cold
      ? Promise.all([buffer(m.bios),buffer(m.vgaBios),buffer(m.kernel),buffer(m.initrd)])
      : Promise.all([buffer(m.snapshot)]);
    importScripts(m.libv86);
    const loaded = await images;
    send('phase',{phase:cold ? 'Booting Linux' : 'Restoring Linux'});
    const options = {...m.machine, wasm_fn:async imports => (await WebAssembly.instantiate(await wasm, imports)).exports};
    if (cold) {
      Object.assign(options,{bios:{buffer:loaded[0]},vga_bios:{buffer:loaded[1]},bzimage:{buffer:loaded[2]},initrd:{buffer:loaded[3]},cmdline:m.cmdline});
    } else options.initial_state = {buffer:loaded[0]};
    vm = new V86(options);
    vm.add_listener('serial0-output-byte', byte => {
      output += String.fromCharCode(byte);
      if (!timer) timer = setTimeout(flush, 8);
    });
    vm.add_listener('serial1-output-byte', byte => {
      control += String.fromCharCode(byte);
      if (byte !== 10) return;
      try {
        const identity = JSON.parse(control.trim());
        flush();
        const resources = performance.getEntriesByType('resource');
        send('guest',{identity,workerMs:performance.now()-started,transferBytes:resources.reduce((n,r)=>n+r.transferSize,0)});
      } catch {}
      control = '';
    });
    vm.add_listener('emulator-started',() => send('started',{}));
  } catch (error) { send('error',{message:error.message}); }
};

const $ = selector => document.querySelector(selector);
const status = $('#status'), boot = $('#boot'), retry = $('#retry');
const metrics = window.siteMetrics = {ready:false,mode:'snapshot'};
let worker, terminal, fit, manifest, timeout, session = 0, firstFrame = false;
let desiredPage = 0;
const control = text => worker?.postMessage({type:'control',text});
function size() {
  if (!fit || !terminal) return;
  fit.fit();
  control(`R ${Math.max(22,terminal.rows)} ${Math.max(38,terminal.cols)}\n`);
}
function showError(message) {
  clearTimeout(timeout);
  metrics.ready = false;
  status.textContent = 'Session unavailable';
  $('#status-dot').classList.remove('ready');
  $('#boot-title').textContent = 'The machine could not start.';
  $('#boot-detail').textContent = message;
  boot.hidden = false; retry.hidden = false;
}
function start(cold = false) {
  const id = ++session;
  worker?.terminate();
  clearTimeout(timeout);
  terminal.reset();
  firstFrame = false;
  metrics.ready = false;
  metrics.mode = cold ? 'cold' : 'snapshot';
  metrics.sessionStarted = performance.now();
  status.textContent = cold ? 'Booting Linux' : 'Starting Linux';
  $('#status-dot').classList.remove('ready');
  $('#boot-title').textContent = 'A small machine is waking up.';
  $('#boot-detail').textContent = cold ? 'Booting the kernel from scratch' : 'Loading Linux into this browser tab';
  boot.hidden = false; retry.hidden = true;
  worker = new Worker(manifest.worker);
  worker.onerror = event => fail(event.message);
  const fail = message => {
    if (id !== session) return;
    if (!cold) { console.warn('Snapshot failed; booting Linux from scratch.',message); start(true); }
    else { worker.terminate(); showError(message || 'Please reload to try again.'); }
  };
  timeout = setTimeout(() => fail('Startup timed out. Try a fresh boot.'), 30_000);
  worker.onmessage = ({data}) => {
    if (id !== session) return;
    if (data.type === 'output') terminal.write(data.text);
    if (data.type === 'phase') status.textContent = data.phase;
    if (data.type === 'error') fail(data.message);
    if (data.type === 'started') { size(); control(`P ${desiredPage}\nI\n`); }
    if (data.type === 'guest') {
      metrics.identity = data.identity;
      metrics.workerTransferBytes = data.transferBytes;
      for (const button of document.querySelectorAll('[data-page]')) {
        if (Number(button.dataset.page) === data.identity.page) button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      }
      if (firstFrame) return;
      firstFrame = true;
      terminal.write('',() => {
        requestAnimationFrame(() => {
          clearTimeout(timeout);
          metrics.ready = true;
          metrics.readyMs = performance.now();
          metrics.sessionMs = metrics.readyMs - metrics.sessionStarted;
          performance.mark('linux-interactive');
          boot.hidden = true;
          $('#status-dot').classList.add('ready');
          status.textContent = `Linux · ${(metrics.sessionMs/1000).toFixed(2)}s`;
          size();
          if (matchMedia('(pointer:fine)').matches) terminal.focus();
          document.dispatchEvent(new CustomEvent('linux-ready',{detail:metrics}));
        });
      });
    }
  };
  worker.postMessage({type:'start',manifest,cold});
}
try {
  if (!window.Worker || !window.WebAssembly) throw new Error('Please use a current browser with WebAssembly support, or choose Read as text.');
  const response = await fetch('manifest.json');
  if (!response.ok) throw new Error('The site files could not be loaded. Please reload.');
  manifest = await response.json();
  for (const key of ['worker','libv86','wasm','snapshot','kernel','initrd','bios','vgaBios','xterm','fit']) manifest[key] = new URL(manifest[key],document.baseURI).href;
  const [{Terminal},{FitAddon}] = await Promise.all([import(manifest.xterm),import(manifest.fit)]);
  terminal = new Terminal({
    fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize:matchMedia('(max-width:700px)').matches ? 11 : 14,
    lineHeight:1.22,scrollback:0,convertEol:false,cursorBlink:false,screenReaderMode:true,
    theme:{background:'#20231e',foreground:'#d6dad1',cursor:'#d7e6a2',selectionBackground:'#4d5b3b'},
    allowProposedApi:false,
  });
  fit = new FitAddon();terminal.loadAddon(fit);terminal.open($('#terminal'));fit.fit();
  terminal.onData(text => worker?.postMessage({type:'input',text}));
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(size,100); }).observe($('#terminal'));
  start(new URLSearchParams(location.search).has('cold'));
} catch (error) { showError(error.message); }
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click',() => {
  desiredPage = Number(button.dataset.page);control(`P ${desiredPage}\n`);
  if (matchMedia('(pointer:fine)').matches) terminal?.focus();
}));
$('#restart').addEventListener('click',() => { if (terminal) { desiredPage = 0; start(); } });
retry.addEventListener('click',() => terminal ? start(true) : location.reload());
$('#text-toggle').addEventListener('click',() => {
  const text = $('#text-view');text.hidden = !text.hidden;
  $('#text-toggle').setAttribute('aria-expanded',String(!text.hidden));
  if (!text.hidden) text.focus();
});
document.addEventListener('visibilitychange',() => worker?.postMessage({type:document.hidden ? 'pause' : 'resume'}));
window.addEventListener('pagehide',() => worker?.terminate());
window.addEventListener('pageshow',event => { if (event.persisted && terminal) start(); });

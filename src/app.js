const $ = selector => document.querySelector(selector);
const status = $('#status'), boot = $('#boot'), retry = $('#retry');
const metrics = window.siteMetrics = {ready:false,mode:'snapshot'};
let worker, terminal, fit, manifest, timeout, session = 0, firstFrame = false;
const pageNames=['Home','About','Work','Notes','Projects','System','Shell'];
let desiredPage=Math.max(0,pageNames.findIndex(name=>location.hash===`#${name.toLowerCase()}`));
let themes, terminalTheme, themeChoice=0, themeResolved=1, imageAddon;
const terminalView=$('#terminal-view'),resumeView=$('#resume-view');
const textView=$('#text-view'),textToggle=$('#text-toggle');
let textDiagramAscii=false;
const resumeUrl=new URL('resume.html',location.href),terminalTitle=document.title;
let resumeOpen=false,terminalScroll=0;
function syncActivity() {
  worker?.postMessage({type:document.hidden || resumeOpen ? 'pause' : 'resume'});
}
function renderRoute() {
  const reading=location.pathname===resumeUrl.pathname;
  if(reading===resumeOpen)return;
  if(reading)terminalScroll=window.scrollY;
  resumeOpen=reading;
  terminalView.hidden=reading;resumeView.hidden=!reading;
  document.title=reading ? 'William Michael Turner / Résumé' : terminalTitle;
  syncActivity();
  if(reading) {
    const target=location.hash && /^#[\w-]+$/.test(location.hash) ? resumeView.querySelector(location.hash) : null;
    if(target)target.scrollIntoView();else window.scrollTo(0,0);
    const heading=resumeView.querySelector('h1');heading.tabIndex=-1;heading.focus({preventScroll:true});
  } else {
    size();
    terminal?.focus();
    window.scrollTo(0,terminalScroll);
  }
}
function openResume() {
  if(resumeOpen)return;
  history.pushState(null,'',resumeUrl);
  renderRoute();
}
const textPages=[...textView.querySelectorAll('[data-text-page]')];
const collections=[{page:3,name:'notes',singular:'note'},{page:4,name:'projects',singular:'project'}].map(collection=>({...collection,articles:[...textView.querySelectorAll(`[data-text-${collection.singular}]`)]}));
// Let keyboard readers pan wide character diagrams in the text alternative.
textView.querySelectorAll('.diagram-ascii').forEach(diagram=>{diagram.tabIndex=0;});
function syncTextView() {
  const identity=metrics.renderedIdentity || metrics.identity || {page:desiredPage,note:-1};
  const page=identity.page;
  const diagrams=(page===3 || page===4) && identity.note>=0 && identity.hasDiagrams;
  textView.dataset.diagrams=textDiagramAscii ? 'ascii' : 'svg';
  const textDiagramToggle=$('[data-text-diagrams]');
  textDiagramToggle.hidden=!diagrams;
  textDiagramToggle.textContent=textDiagramAscii ? 'Diagrams: ASCII' : 'Diagrams: SVG';
  textDiagramToggle.setAttribute('aria-pressed',String(textDiagramAscii));
  for(const button of document.querySelectorAll('[data-note="diagrams"]')) {
    button.hidden=!diagrams;
    button.textContent=identity.diagramAscii ? 'Diagrams: ASCII' : 'Diagrams: Images';
    button.setAttribute('aria-pressed',String(Boolean(identity.diagramAscii)));
  }
  for(const panel of textPages)panel.hidden=Number(panel.dataset.textPage)!==page;
  for(const {page:collectionPage,name,singular,articles} of collections) {
    const reading=page===collectionPage && identity.note>=0;
    $(`#text-${name}-index`).hidden=reading;
    $(`#text-${singular}-back`).hidden=!reading;
    for(const article of articles)article.hidden=!reading || Number(article.getAttribute(`data-text-${singular}`))!==identity.note;
  }
  textView.setAttribute('aria-label',`${pageNames[page]} as text`);
  if(!textView.hidden && terminal && (page===5 || page===6)) {
    const buffer=terminal.buffer.active;
    // System's body excludes the ncurses frame; Shell includes the current
    // viewport, including a pager or history the visitor has scrolled to.
    const first=page===5 ? 4 : 0,last=page===5 ? terminal.rows-4 : terminal.rows;
    const lines=[];
    for(let row=first;row<last;row++)lines.push(buffer.getLine(buffer.viewportY+row)?.translateToString(true) || '');
    const content=lines.join('\n').trim();
    const target=textPages[page].querySelector('[data-terminal-text]');
    if(target.textContent!==content)target.textContent=content;
  }
}
let textFrame;
function scheduleTextView() {
  if(textView.hidden || textFrame)return;
  textFrame=requestAnimationFrame(()=>{textFrame=undefined;syncTextView();});
}
syncTextView();
const osTheme=matchMedia('(prefers-color-scheme: dark)');
const control = text => worker?.postMessage({type:'control',text});
function applyTheme(choice, save=false) {
  themeChoice=choice;
  themeResolved=choice || (osTheme.matches ? 1 : 2);
  const theme=themes[themeResolved];
  document.documentElement.dataset.theme=theme.id;
  if (terminal) terminal.options.theme=terminalTheme(theme);
  metrics.theme=theme.id;
  if(save) {try {localStorage.setItem('personal-space-theme',themes[choice].id);} catch {}}
  control(`T ${themeChoice} ${themeResolved}\n`);
}
osTheme.addEventListener('change',()=>{if(themes && themeChoice===0) applyTheme(0);});
function size() {
  if (!fit || !terminal || resumeOpen) return;
  fit.fit();
  const rect=$('.xterm-screen').getBoundingClientRect();
  control(`R ${Math.max(22,terminal.rows)} ${Math.max(38,terminal.cols)} ${Math.round(rect.width/terminal.cols*1000)} ${Math.round(rect.height/terminal.rows*1000)}\n`);
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
    if (data.type === 'output') terminal.write(data.bytes);
    if (data.type === 'phase') status.textContent = data.phase;
    if (data.type === 'error') fail(data.message);
    if (data.type === 'started') { size(); control(`T ${themeChoice} ${themeResolved}\nP ${desiredPage}\nI\n`); }
    if (data.type === 'guest') {
      if(data.identity.resumeRequest) {openResume();return;}
      metrics.identity = data.identity;
      metrics.workerTransferBytes = data.transferBytes;
      if(data.identity.themeRequest>=0) applyTheme(data.identity.themeRequest,true);
      const collection=collections.find(item=>item.page===data.identity.page), reading=data.identity.note>=0;
      $('#notes-controls').hidden=!collection;
      $('#notes-controls').setAttribute('aria-label',collection?.singular==='project' ? 'Project reader' : 'Note reader');
      $('#note-open').textContent=`Read ${collection?.singular || 'note'} ↵`;
      $('#note-back').textContent=collection?.singular==='project' ? '← Projects' : '← Notes';
      const repository=reading && collection?.articles[data.identity.note]?.querySelector('[data-repository]');
      $('#post-repository').hidden=!repository;
      if(repository)$('#post-repository').href=repository.href;
      else $('#post-repository').removeAttribute('href');
      $('#shell-controls').hidden=data.identity.page!==6;
      $('#note-open').hidden=reading;
      $('#note-open').disabled=data.identity.noteCount===0;
      $('#note-back').hidden=!reading;
      $('#note-prev').disabled=reading ? data.identity.readerPage===0 : data.identity.selectedNote===0;
      $('#note-next').disabled=reading ? data.identity.readerPage+1>=data.identity.readerPages : data.identity.selectedNote+1>=data.identity.noteCount;
      $('#note-position').textContent=reading ? `Page ${data.identity.readerPage+1} of ${data.identity.readerPages}` : `${data.identity.noteCount} ${collection?.name || 'notes'}`;
      terminal.write('',()=>requestAnimationFrame(()=>{
        if(id!==session)return;
        metrics.imageStorage=imageAddon.storageUsage;
        metrics.renderedIdentity=data.identity;
        syncTextView();
      }));
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
          if (resumeOpen) syncActivity();
          else if (matchMedia('(pointer:fine)').matches) terminal.focus();
          document.dispatchEvent(new CustomEvent('linux-ready',{detail:metrics}));
        });
      });
    }
  };
  worker.postMessage({type:'start',manifest,cold});
}
try {
  if (!window.Worker || !window.WebAssembly) throw new Error('Please use a current browser with WebAssembly support, or choose Read as text.');
  const response = await fetch(document.querySelector('link[rel="site-manifest"]').href);
  if (!response.ok) throw new Error('The site files could not be loaded. Please reload.');
  manifest = await response.json();
  for (const key of ['worker','libv86','wasm','snapshot','kernel','initrd','bios','vgaBios','xterm','fit','imageAddon','themes']) manifest[key] = new URL(manifest[key],document.baseURI).href;
  const [{Terminal},{FitAddon},{ImageAddon},themeModule] = await Promise.all([import(manifest.xterm),import(manifest.fit),import(manifest.imageAddon),import(manifest.themes)]);
  ({themes,terminalTheme}=themeModule);
  let saved;try {saved=localStorage.getItem('personal-space-theme');}catch{}
  themeChoice=Math.max(0,themes.findIndex(t=>t.id===saved));
  applyTheme(themeChoice);
  terminal = new Terminal({
    fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize:matchMedia('(max-width:700px)').matches ? 11 : 14,
    lineHeight:1.22,scrollback:1000,convertEol:false,cursorBlink:false,screenReaderMode:true,
    theme:terminalTheme(themes[themeResolved]),
    allowProposedApi:false,
  });
  fit = new FitAddon();terminal.loadAddon(fit);terminal.open($('#terminal'));fit.fit();
  imageAddon = new ImageAddon({sixelSupport:false,iipSupport:true,enableSizeReports:false,storageLimit:32,pixelLimit:9000000});terminal.loadAddon(imageAddon);
  terminal.onData(text => worker?.postMessage({type:'input',text}));
  terminal.onWriteParsed(scheduleTextView);
  terminal.onScroll(scheduleTextView);
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(size,100); }).observe($('#terminal'));
  start(new URLSearchParams(location.search).has('cold'));
} catch (error) { showError(error.message); }
// Keep the worker and terminal mounted during résumé navigation. Direct links
// and modified clicks still serve the standalone, JavaScript-free résumé.
document.addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(!link || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.download || link.target)return;
  const url=new URL(link.href);
  if(resumeOpen && link.hasAttribute('data-return-terminal')) {
    event.preventDefault();history.back();
  } else if(resumeOpen && resumeView.contains(link) && link.getAttribute('href')?.startsWith('#')) {
    event.preventDefault();history.replaceState(null,'',url);
    resumeView.querySelector(url.hash)?.scrollIntoView();
  } else if(!resumeOpen && url.origin===resumeUrl.origin && url.pathname===resumeUrl.pathname) {
    event.preventDefault();openResume();
  }
});
window.addEventListener('popstate',renderRoute);
const pageButtons=[...document.querySelectorAll('[data-page]')];
function selectPage(index) {
  desiredPage=Number(pageButtons[index].dataset.page);
  control(`P ${desiredPage}\n`);
}
pageButtons.forEach((button,index)=>{
  button.addEventListener('click',()=>{selectPage(index);terminal?.focus();});
  button.addEventListener('keydown',event=>{
    if(event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();
    const next=(index+(event.key==='ArrowRight' ? 1 : -1)+pageButtons.length)%pageButtons.length;
    selectPage(next);
    pageButtons[next].focus();
  });
});
// A rebuild changes the manifest and asset URLs. Reload the document as well
// as Linux so Restart cannot keep booting an image from an earlier build.
$('#restart').addEventListener('click',async() => {await window.refreshSiteCache?.();location.reload();});
$('[data-text-diagrams]').addEventListener('click',()=>{textDiagramAscii=!textDiagramAscii;syncTextView();});
document.querySelectorAll('[data-note]').forEach(button=>button.addEventListener('click',()=>{
  control(`N ${button.dataset.note}\n`);
  if(!textView.contains(button))terminal?.focus();
}));
document.querySelectorAll('[data-shell]').forEach(button=>button.addEventListener('click',()=>{
  let input=JSON.parse(`"${button.dataset.shell}"`);
  if(terminal?.modes.applicationCursorKeysMode && /^\u001b\[[AB]$/.test(input)) input=input.replace('[','O');
  worker?.postMessage({type:'input',text:input==='?\n' ? '\u0015?\n' : input});
  terminal?.focus();
}));
retry.addEventListener('click',() => terminal ? start(true) : location.reload());
function setTextView(open) {
  textView.hidden=!open;
  if(open)syncTextView();
  textToggle.setAttribute('aria-expanded',String(open));
  $('[data-text-label]').textContent=open ? 'Hide text' : 'Read as text';
  $('[data-text-icon]').textContent=open ? '×' : '↗';
  (open ? textView : textToggle).focus();
}
textView.addEventListener('click',event=>{
  const link=event.target.closest('[data-text-note-open],[data-text-project-open]');
  if(!link || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
  const collection=collections.find(item=>link.hasAttribute(`data-text-${item.singular}-open`));
  const target=Number(link.getAttribute(`data-text-${collection.singular}-open`));
  if(!metrics.ready || metrics.identity.page!==collection.page || !Number.isInteger(target) || target<0 || target>=collection.articles.length)return;
  event.preventDefault();
  // Use the same guest reader as keyboard/mouse navigation. Selecting a text
  // index entry must not create a second, independent current-note state.
  const difference=target-metrics.identity.selectedNote;
  control('N back\n'+`N ${difference<0 ? 'prev' : 'next'}\n`.repeat(Math.abs(difference))+'N open\n');
  textView.focus({preventScroll:true});
});
for(const {singular} of collections)$(`#text-${singular}-back`).addEventListener('click',()=>{control('N back\n');textView.focus({preventScroll:true});});
textToggle.addEventListener('click',()=>setTextView(textView.hidden));
$('#text-close').addEventListener('click',()=>setTextView(false));
textView.addEventListener('keydown',event=>{
  if(event.key==='Escape') {event.preventDefault();setTextView(false);}
});
document.addEventListener('visibilitychange',syncActivity);
window.addEventListener('pagehide',() => worker?.terminate());
window.addEventListener('pageshow',event => { if (event.persisted && terminal) start(); });

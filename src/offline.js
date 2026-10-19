// Loaded by both entry pages. Caching is optional and never gates the UI.
let registered;
async function register() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // Staging uses private HTTP caching for hashed assets, but every entry-page
  // navigation must still reach Access. A cache-first service worker would
  // bypass that login check. Production/localhost retain full offline support.
  if(location.hostname==='staging.infovore-labs.com') {
    const scope=new URL('../',import.meta.url).href;
    const registration=await navigator.serviceWorker.getRegistration(scope);
    if(registration?.scope===scope)await registration.unregister();
    if('caches' in window) {
      const names=await caches.keys();
      await Promise.all(names.filter(name=>name.startsWith(`personal-space:${scope}:`)).map(name=>caches.delete(name)));
    }
    return;
  }
  return navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{updateViaCache:'none'});
}
function start() {
  registered=register().catch(()=>undefined);
}
if(document.readyState==='complete')start();
else window.addEventListener('load',start,{once:true});

// Restart is an explicit request for a fresh session; give a pending deployment
// time to finish caching before reloading. Offline/blocked storage still works.
window.refreshSiteCache=async()=>{
  let timer;
  try {
    await Promise.race([
      (async()=>{
        const registration=await registered;
        if(!registration)return;
        await registration.update();
        const worker=registration.installing || registration.waiting;
        if(worker && !['activated','redundant'].includes(worker.state)) {
          await new Promise(resolve=>worker.addEventListener('statechange',()=>{
            if(['activated','redundant'].includes(worker.state))resolve();
          }));
        }
      })(),
      new Promise(resolve=>{timer=setTimeout(resolve,5000);}),
    ]);
  } catch {} finally {clearTimeout(timer);}
};

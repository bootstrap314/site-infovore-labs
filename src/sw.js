// The build inserts a complete, integrity-checked list of deployable files.
const BUILD=__OFFLINE_BUILD__;
const PREFIX=`personal-space:${self.registration.scope}:`;
const CACHE=PREFIX+BUILD.version;
const absolute=path=>new URL(path,self.registration.scope).href;
const FILES=new Map(BUILD.files.map(file=>[absolute(file.path),file]));
const immutable=url=>/\/(?:assets|notes-assets|projects-assets)\/[^/]+$/.test(new URL(url).pathname);

async function previousAsset(url) {
  for(const name of (await caches.keys()).reverse()) {
    if(name.startsWith(PREFIX) && name!==CACHE) {
      const response=await (await caches.open(name)).match(url);
      if(response)return response;
    }
  }
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // A failed/partial deployment must leave the previous complete cache active.
  const results=await Promise.allSettled(BUILD.files.map(async file=>{
    const url=absolute(file.path);
    const reused=immutable(url) && await previousAsset(url);
    const response=reused || await fetch(new Request(url,{
      integrity:file.integrity,cache:immutable(url) ? 'default' : 'reload',credentials:'same-origin',
    }));
    if(!response.ok || response.redirected)throw new Error(`Cannot cache ${file.path}`);
    await cache.put(url,response);
  }));
  if(results.some(result=>result.status==='rejected')) {
    await caches.delete(CACHE);
    throw new Error('The complete site could not be cached. Keeping the previous build.');
  }
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Retain the preceding build for documents already open during an update.
  const old=(await caches.keys()).filter(name=>name.startsWith(PREFIX) && name!==CACHE);
  await Promise.all(old.slice(0,-1).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin)return;
  // Only the two actual entry pages have query-insensitive document aliases.
  // This preserves ?cold and hash routes without turning unknown paths into HTML.
  let key=request.url;
  if(request.mode==='navigate') {
    if(url.pathname===new URL(self.registration.scope).pathname)key=absolute('index.html');
    else if(['index.html','resume.html'].some(path=>url.pathname===new URL(absolute(path)).pathname)) {
      url.search='';key=url.href;
    }
  }
  if(!FILES.has(key) && !immutable(key))return;
  event.respondWith((async()=>{
    const cached=await (await caches.open(CACHE)).match(key);
    if(cached)return cached;
    if(immutable(key)) {
      const old=await previousAsset(key);
      if(old)return old;
    }
    // Storage eviction or an older open document can still use the network.
    // Unknown responses and external services are never added to this cache.
    return fetch(request);
  })());
});

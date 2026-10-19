const base=process.env.TEST_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
try {
  const url=new URL(base.endsWith('/') ? base : base+'/');
  if(!['http:','https:'].includes(url.protocol))throw new Error('TEST_URL must use http or https');
  const response=await fetch(new URL('manifest.json',url),{signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const manifest=await response.json();
  if(!manifest.worker || !manifest.snapshot || !manifest.wasm)throw new Error('the server did not return a site manifest');
  console.log(`Preview ready: ${base}`);
} catch(error) {
  console.error(`Preview unavailable at ${base}: ${error.message}\nStart make serve PORT=${process.env.PORT || 4173} in another terminal, or set TEST_URL to a running build.`);
  process.exitCode=1;
}

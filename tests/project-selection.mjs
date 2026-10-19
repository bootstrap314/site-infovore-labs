import assert from 'node:assert/strict';

export async function projectIndex(page,title) {
  const value=await page.locator('[data-text-project-open]').filter({hasText:title}).getAttribute('data-text-project-open');
  assert.match(value,/^\d+$/,'Project has an index');
  return Number(value);
}

export async function selectProject(page,title) {
  const index=await projectIndex(page,title);
  let selected=await page.evaluate(()=>window.siteMetrics.identity.selectedNote);
  while(selected!==index) {
    const step=selected<index ? 1 : -1;
    await page.locator(step===1 ? '#note-next' : '#note-prev').click();
    selected+=step;
    await page.waitForFunction(n=>window.siteMetrics.identity.selectedNote===n,selected);
  }
  return index;
}

export async function openProject(page,title) {
  const index=await selectProject(page,title);
  await page.locator('#note-open').click();
  await page.waitForFunction(n=>window.siteMetrics.renderedIdentity?.note===n,index);
  return index;
}

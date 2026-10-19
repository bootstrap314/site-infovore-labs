import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function verifyPromotion(run,jobs,repository) {
  if(run.repository?.full_name!==repository || run.head_repository?.full_name!==repository ||
     run.path!=='.github/workflows/site.yml' || run.event!=='push' || run.head_branch!=='main' ||
     run.status!=='completed' || run.conclusion!=='success' || !/^[a-f0-9]{40}$/.test(run.head_sha)) {
    throw new Error('Choose a successful Site workflow run from a push to main in this repository.');
  }
  if(!jobs.some(job=>job.name==='Publish staging' && job.conclusion==='success')) {
    throw new Error('The selected run did not successfully publish staging.');
  }
  return run.head_sha;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const {RUN_ID,GITHUB_REPOSITORY,GITHUB_TOKEN,GITHUB_OUTPUT}=process.env;
    if(!/^\d+$/.test(RUN_ID || ''))throw new Error('Run ID must be a numeric GitHub Actions run ID.');
    if(!GITHUB_REPOSITORY || !GITHUB_TOKEN || !GITHUB_OUTPUT)throw new Error('Missing GitHub workflow environment.');
    const api=async path=>{
      const response=await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`,{
        headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
        signal:AbortSignal.timeout(30000),redirect:'error',
      });
      if(!response.ok)throw new Error(`Could not verify the staging run (GitHub HTTP ${response.status}).`);
      return response.json();
    };
    const run=await api(`actions/runs/${RUN_ID}`);
    const jobs=await api(`actions/runs/${RUN_ID}/jobs?filter=latest&per_page=100`);
    const sha=verifyPromotion(run,jobs.jobs,GITHUB_REPOSITORY);
    await appendFile(GITHUB_OUTPUT,`sha=${sha}\nrun_id=${RUN_ID}\n`);
    console.log(`Verified staging run ${RUN_ID}, commit ${sha}.`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}

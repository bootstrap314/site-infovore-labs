import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseResume, resumeHtml, latexText } from '../scripts/resume.mjs';

const fixture=String.raw`\begin{document}
\begin{tabular*}{7in}{lr}
\textbf{\large Example Engineer} & 555.123.4567 \\
99 Hidden Street & person@example.test \\
Private City, ST 12345 & \\
\end{tabular*}
\textbf{Infrastructure Engineer with 10+ years building systems.}
\resheading{Skills}
\begin{description}\item[Programming:] Go, C\end{description}
\resheading{Work Experience}
\ressubheading{Example \& Co.}{Remote}{Engineer}{2020 - 2024}
\resitem{Improved performance by 40\% with \textbf{nested {formatting}}.}
\resitem{Kept <script> as text.} % Comment not published.
\resheading{Education}
\ressubheading{Example College}{Town}{Mathematics}{2010 - 2014}
\resitem{Geometry}
\end{document}`;

test('LaTeX adapter preserves content, nesting, escaped characters, and section structure',()=>{
  const resume=parseResume(fixture);
  assert.equal(resume.name,'Example Engineer');
  assert.equal(resume.title,'Infrastructure Engineer');
  assert.equal(resume.experience[0].organization,'Example & Co.');
  assert.equal(resume.experience[0].items[0],'Improved performance by 40% with nested formatting.');
  assert.equal(resume.skills[0].items,'Go, C');
  assert.equal(resume.education[0].role,'Mathematics');
  assert.doesNotMatch(resumeHtml(resume),/<script>|Comment not published/);
  assert.match(resumeHtml(resume),/&lt;script&gt;/);
});
test('public résumé outputs expose email only from the contact table',()=>{
  const resume=parseResume(fixture);
  for(const output of [JSON.stringify(resume),resumeHtml(resume)]) {
    assert.match(output,/person@example.test/);
    assert.doesNotMatch(output,/555\.123|Hidden Street|Private City|12345/);
  }
});
test('unsupported commands and malformed structural changes fail visibly',()=>{
  assert.throws(()=>latexText(String.raw`\unknown{content}`),/Unsupported text command/);
  assert.throws(()=>latexText(String.raw`\textbf{missing`),/Unclosed argument/);
  assert.throws(()=>parseResume(fixture.replace('Work Experience','Career')),/Expected Skills/);
  assert.throws(()=>parseResume(fixture.replace('person@example.test','')),/email/);
});
test('the actual résumé contains all six roles and their accomplishments',async()=>{
  const source=await readFile('misc/resume.tex','utf8'),resume=parseResume(source);
  assert.equal(resume.experience.length,6);
  assert.equal(resume.experience[0].organization,'Vercel');
  assert.equal(resume.experience.at(-1).organization,'Avum Inc.');
  assert.equal(resume.experience.reduce((n,job)=>n+job.items.length,0),44);
  assert.equal(resume.education.length,1);
  assert.equal(resume.skills.length,5);
  assert.match(resumeHtml(resume),/16PB/);
});

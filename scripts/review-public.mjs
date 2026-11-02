import {readdirSync, readFileSync} from 'node:fs';
import {join, resolve, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Explicit source allowlist: never walk runtime data, attachments or artifacts.
const directories=['src','ui','skills','assets','.codex-plugin','LICENSES','scripts','test','docs','examples'];
const roots=['plugin.json','mcp.json','.mcp.json','.gitignore','package.json','LICENSE',
  'THIRD_PARTY_NOTICES.md','README.md','CHANGELOG.md','.agents/plugins/marketplace.json'];
export function reviewPublicFiles(root) {
  root=resolve(root);const files=[],findings=[];
  const add=path=>{
    const name=relative(root,path).replaceAll('\\','/'),bytes=readFileSync(path),body=bytes.toString('utf8');
    if (/\.(sqlite(?:-wal|-shm)?|db|log|zip)$/i.test(name) || name.split('/').some(p=>['artifacts','.team-workbench','.git','node_modules'].includes(p))) findings.push({path:name,reason:'runtime/private file'});
    if (body.includes('\uFFFD')) findings.push({path:name,reason:'invalid UTF-8 or replacement character'});
    if (/[A-Z]:(?:\\+|\/)Users(?:\\+|\/)[^\\\/\s<>"']+/i.test(body)) findings.push({path:name,reason:'personal absolute path'});
    if (/\b(?:Plugin_|pluginrel_|libfile_)[0-9a-f]{16,}\b/.test(body)) findings.push({path:name,reason:'private account/artifact identifier'});
    if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/.test(body)) findings.push({path:name,reason:'possible credential'});
    for(const id of body.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)??[]) {
      if(!id.startsWith('00000000-0000-'))findings.push({path:name,reason:'non-synthetic UUID'});
    }
    files.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex')});
  };
  const walk=dir=>{for(const item of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,item.name);
    if(item.isSymbolicLink())findings.push({path:relative(root,path),reason:'symlink'});
    else if(item.isDirectory())walk(path);else if(item.isFile())add(path);
  }};
  for(const dir of directories)walk(join(root,dir));for(const file of roots)add(join(root,file));
  return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),findings};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const review=reviewPublicFiles(resolve(import.meta.dirname,'..'));
  console.log(JSON.stringify({publicFileCount:review.files.length,privacyFindings:review.findings},null,2));
  if(review.findings.length)process.exitCode=1;
}

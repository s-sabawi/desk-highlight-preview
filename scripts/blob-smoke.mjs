import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as blob from '@vercel/blob';

const allowed = env => Date.now() < Date.parse('2026-11-25T05:13:52.321Z') && env.VERCEL_ENV === 'preview'
  && env.VERCEL_GIT_REPO_OWNER === 's-sabawi'
  && env.VERCEL_GIT_REPO_SLUG === 'desk-highlight-preview'
  && env.VERCEL_GIT_COMMIT_REF === 'pilot/ipad-blob-smoke'
  && typeof env.VERCEL_OIDC_TOKEN === 'string' && env.VERCEL_OIDC_TOKEN.length > 0
  && /^store_[a-zA-Z0-9]+$/.test(env.BLOB_STORE_ID ?? '');

export async function smoke(env, sdk=blob, anonymous=fetch) {
  if (!allowed(env)) throw Error('preview_or_oidc_gate');
  const key='desk-preview-diagnostic/'+randomBytes(16).toString('hex')+'.txt';
  const bytes=Buffer.from('desk-preview-storage-check-v1\n','ascii');
  const auth={storeId:env.BLOB_STORE_ID,oidcToken:env.VERCEL_OIDC_TOKEN};
  const opts=()=>({...auth,abortSignal:AbortSignal.timeout(12000)});
  const privateOpts=()=>({...opts(),access:'private',useCache:false});
  let stage='put', failed=null;
  try {
    const result=await sdk.put(key,bytes,{...opts(),access:'private',addRandomSuffix:false,allowOverwrite:false,
      contentType:'text/plain',cacheControlMaxAge:60,ttlDays:1});
    stage='private_target';
    const u=new URL(result.url);
    if(result.pathname!==key||u.protocol!=='https:'||u.host!==env.BLOB_STORE_ID.slice('store_'.length).toLowerCase()+'.private.blob.vercel-storage.com'
      ||u.pathname!=='/'+key||u.username||u.password||u.search||u.hash) throw Error(stage);
    stage='authenticated_read';
    const found=await sdk.get(key,privateOpts());
    if(!found||found.statusCode!==200||found.blob.pathname!==key||found.blob.size!==bytes.length)throw Error(stage);
    const sr=found.stream.getReader(); let got=Buffer.alloc(0);
    while(true){const chunk=await sr.read();if(chunk.done)break;if(got.length+chunk.value.length>bytes.length){void sr.cancel();throw Error(stage);}got=Buffer.concat([got,chunk.value]);}
    if(!got.equals(bytes))throw Error(stage);
    stage='anonymous_read';
    const guess=await anonymous(u.href,{method:'GET',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(guess.body)void guess.body.cancel().catch(()=>{});
    if(![401,403,404].includes(guess.status))throw Error(stage);
  } catch { failed=stage; }
  // Only this invocation's random synthetic key. TTL is fallback if cleanup fails.
  try {
    await sdk.del(key,opts());
    if(await sdk.get(key,privateOpts())!==null)throw Error('still_exists');
  } catch { throw Error('cleanup_unconfirmed'); }
  if(failed)throw Error(failed);
}
if(import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { await smoke(process.env); console.log('DESK_BLOB_SMOKE_PASS private_write authenticated_read anonymous_denied deleted absent'); }
  catch(e) { console.error('DESK_BLOB_SMOKE_FAIL '+e.message); process.exitCode=1; }
}

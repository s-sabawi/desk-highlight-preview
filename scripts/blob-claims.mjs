import { randomBytes } from 'node:crypto';
import * as blob from '@vercel/blob';
const env=process.env;
const base=env.BLOB_STORE_ID?.slice('store_'.length).toLowerCase();
const host=base+'.private.blob.vercel-storage.com';
const auth={storeId:env.BLOB_STORE_ID,oidcToken:env.VERCEL_OIDC_TOKEN};
const opts=()=>({...auth,abortSignal:AbortSignal.timeout(12000)});
const stem='desk-preview-diagnostic/'+randomBytes(16).toString('hex');
const claim=stem+'/claim.txt', artifact=stem+'/output.txt';
const put=()=>({...opts(),access:'private',allowOverwrite:false,addRandomSuffix:false,contentType:'text/plain',ttlDays:1,cacheControlMaxAge:60});
const get=key=>blob.get(key,{...opts(),access:'private',useCache:false});
const signedFetch=(url,opt)=>fetch(url,{...opt,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(12000)});
const ok=v=>{if(!v)throw Error('check');};
let stage='scope', passed=false;
try{
  ok(Date.now() < Date.parse('2026-11-25T05:17:58.660Z') && env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_REPO_OWNER==='s-sabawi'&&env.VERCEL_GIT_REPO_SLUG==='desk-highlight-preview'
     &&env.VERCEL_GIT_COMMIT_REF==='pilot/ipad-blob-primitives'&&!!auth.oidcToken&&/^store_[a-zA-Z0-9]+$/.test(auth.storeId??''));
  stage='claim_race';
  const payload=['candidate-one','candidate-two','candidate-three'];
  const results=await Promise.allSettled(payload.map(value=>blob.put(claim,value,put())));
  const wins=results.flatMap((r,i)=>r.status==='fulfilled'?[i]:[]);
  ok(wins.length===1&&results[wins[0]].value.pathname===claim);
  const stored=await get(claim);
  ok(stored?.statusCode===200&&await new Response(stored.stream).text()===payload[wins[0]]);
  stage='server_private_put';
  const validUntil=Date.now()+90000;
  const bytes='desk signed-output fixture';
  const checked=await blob.put(artifact,bytes,put());
  ok(checked.pathname===artifact);
  stage='signed_get_range';
  const gt=await blob.issueSignedToken({...opts(),pathname:artifact,operations:['get'],validUntil});
  const {presignedUrl:g}=await blob.presignUrl(gt,{access:'private',pathname:artifact,operation:'get',validUntil,useCache:false});
  const gu=new URL(g);ok(gu.protocol==='https:'&&gu.host===host&&gu.pathname==='/'+artifact);
  const complete=await signedFetch(g,{method:'GET'});ok(complete.status===200&&await complete.text()===bytes);
  const range=await signedFetch(g,{method:'GET',headers:{Range:'bytes=0-3'}});
  ok(range.status===206&&await range.text()===bytes.slice(0,4));
  const unsigned=await signedFetch(gu.origin+gu.pathname,{method:'GET'});ok([401,403,404].includes(unsigned.status));
  passed=true;
}catch{ console.error('DESK_BLOB_PRIMITIVES_FAIL '+stage); }
if(stage!=='scope'){
  try{for(const key of [claim,artifact]){await blob.del(key,opts());ok(await get(key)===null);}}
  catch{passed=false;console.error('DESK_BLOB_PRIMITIVES_FAIL cleanup_unconfirmed');}
}
if(passed)console.log('DESK_BLOB_PRIMITIVES_PASS one_claim server_private_put signed_get range unsigned_denied deleted');
else process.exitCode=1;

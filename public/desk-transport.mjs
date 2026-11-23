const ID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const RECORD=/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/
const SECRET=/^[a-zA-Z0-9_-]{32,96}$/
const HEX=/^[0-9a-f]{64}$/
const TERMINAL = new Set(['failed','expired','outcome_unknown'])
const STAGES=['queued','building','rendering','verifying','complete']
export const SHOT='reading-push'
export const PHRASE='The meeting starts at 7:00 p.m.'
export const UPLOAD_CAP=4*1024*1024
export const DOC_MIMES=['image/png','image/jpeg','application/pdf']
export const HEAD={width:480,height:270,fps:24,frames:600,duration:25}

function exactOrigin(input,loopback) {
 try {
  const url=new URL(input)
  return url.origin===input&&(url.protocol==='https:'||(loopback&&url.protocol==='http:'&&url.hostname==='127.0.0.1')) ? input : null
 }catch{return null}
}
export const validInvite=value=>typeof value==='string'&&SECRET.test(value)
export function readInvite(url,replace) {
 const hash=new URL(url).hash
 if(!hash)return null
 const link=new URL(url);link.hash=''
 try{replace(link.pathname+link.search)}catch{return null}
 const m=/^#invite=([a-zA-Z0-9_-]{32,96})$/.exec(hash)
 return m?.[1]??null
}

const message=(reason)=>Object.assign(new Error(reason),{name:'DeskTransportError'})
export function createDeskTransport({apiOrigin,storageOrigin,request=fetch,localTest=false}) {
 const api=exactOrigin(apiOrigin,localTest),store=exactOrigin(storageOrigin,localTest)
 if(!api||!store)return null
 async function raw(path,token,{body,signal,contentType,idempotency,accept='application/json'}={}){
  if(!SECRET.test(token??''))throw message('Open an authorized preview invite first.')
  const headers={Authorization:`Bearer ${token}`,Accept:accept}
  if(contentType)headers['Content-Type']=contentType
  if(idempotency){
   if(!ID.test(idempotency))throw message('Invalid submission reference.')
   headers['Idempotency-Key']=idempotency
  }
  return request(api+path,{method:body===undefined?'GET':'POST',headers,cache:'no-store',
    credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',body,signal})
 }
 async function getJson(path,token,{body,signal,contentType='application/json',idempotency}={}){
  const r=await raw(path,token,{body,signal,contentType:body===undefined?undefined:contentType,idempotency})
  if(!r.ok)throw message(r.status===409?'This render invite is already used. No second job was started.':
    r.status===401||r.status===403?'This preview invite is invalid or expired.':'The preview service could not verify this request.')
  const responseType=r.headers.get('content-type')??''
  if(!/^application\/json(?:;|$)/i.test(responseType)||!r.body)throw message('Unexpected preview service response.')
  // The control plane never carries video.
  const reader=r.body.getReader();let size=0;const chunks=[]
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length
      if(size>4096){await reader.cancel();throw message('Unexpected preview service response.')}chunks.push(value)}
  }finally{reader.releaseLock()}
  const joined=new Uint8Array(size);let pos=0
  for(const c of chunks){joined.set(c,pos);pos+=c.length}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined))}
  catch{throw message('Unexpected preview service response.')}
 }
 function ready(d,expectedId){
  if(!d||!RECORD.test(d.documentId??'')||(expectedId&&d.documentId!==expectedId))throw message('Document receipt missing.')
  if(d.state==='preparing'||d.state==='failed')return {documentId:d.documentId,state:d.state}
  const path='/v1/documents/'+d.documentId+'/preview'
  if(d.state!=='ready'||!Number.isInteger(d.width)||!Number.isInteger(d.height)||Math.min(d.width,d.height)<1||
     Math.max(d.width,d.height)>2000||!HEX.test(d.pageSha256??'')||![path,api+path].includes(d.previewUrl))
   throw message('The normalized page could not be verified.')
  return {documentId:d.documentId,state:d.state,width:d.width,height:d.height,pageSha256:d.pageSha256,previewPath:path}
 }
 function checkedBox(box,doc){
  const b=Object.fromEntries(['x','y','w','h'].map(k=>[k,Math.round(box?.[k])]))
  if(!Object.values(b).every(Number.isFinite)||b.x<0||b.y<0||b.w<2||b.h<2||b.x+b.w>doc.width||b.y+b.h>doc.height)
    throw message('Confirm one rectangle within the page.')
  return b
 }
 function checkedPassage(passage){
  if(typeof passage!=='string'||!passage.trim()||passage.length>300)throw message('Paste one short phrase.')
  return passage.trim()
 }
 return {
  async upload(invite,file,idempotency,signal){
   if(!file||!DOC_MIMES.includes(file.type)||file.size<16||file.size>UPLOAD_CAP)
     throw message('Choose one PNG, JPG, or single-page PDF under 4 MiB.')
   return ready(await getJson('/v1/documents',invite,{body:file,contentType:file.type,idempotency,signal}))
  },
  async document(invite,id,signal){
   if(!RECORD.test(id??''))throw message('Document receipt missing.')
   return ready(await getJson('/v1/documents/'+id,invite,{signal}),id)
  },
  async preview(invite,doc,signal){
   const path='/v1/documents/'+doc.documentId+'/preview'
   if(!RECORD.test(doc.documentId??'')||doc.previewPath!==path)throw message('Document receipt missing.')
   const r=await raw(path,invite,{signal,accept:'image/png'})
   if(!r.ok||r.headers.get('content-type')!=='image/png'||!r.body)throw message('The private page could not be opened.')
   const reader=r.body.getReader(),chunks=[];let size=0
   try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length
     if(size>UPLOAD_CAP){await reader.cancel();throw message('The private page exceeded limits.')}chunks.push(value)}
   }finally{reader.releaseLock()}
   const result=new Blob(chunks,{type:'image/png'})
   const head=new Uint8Array(await result.slice(0,24).arrayBuffer())
   if(head.length!==24||![137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((n,k)=>head[k]===n))
     throw message('The private page was not a PNG.')
   const read32=n=>new DataView(head.buffer).getUint32(n)
   if(read32(16)!==doc.width||read32(20)!==doc.height)throw message('The private page dimensions changed.')
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await result.arrayBuffer()))
   const sha=Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('')
   if(sha!==doc.pageSha256)throw message('The private page failed integrity verification.')
   return result
  },
  async match(invite,doc,passage,signal){
   if(!RECORD.test(doc.documentId??''))throw message('Document receipt missing.')
   const data=await getJson('/v1/documents/'+doc.documentId+'/match',invite,{body:JSON.stringify({passage:checkedPassage(passage)}),signal})
   if(data?.mode==='manual-required')return {mode:data.mode}
   if(data?.mode!=='exact')throw message('The OCR proposal could not be verified.')
   return {mode:data.mode,box:checkedBox(data.box,doc)}
  },
  async confirm(invite,doc,passage,box,signal){
   if(!RECORD.test(doc.documentId??'')||!HEX.test(doc.pageSha256??''))throw message('Document receipt missing.')
   const data=await getJson('/v1/documents/'+doc.documentId+'/confirm',invite,{body:JSON.stringify({
    pageSha256:doc.pageSha256,passage:checkedPassage(passage),box:checkedBox(box,doc)
   }),signal})
   if(!RECORD.test(data?.selectionId??''))throw message('No confirmed selection receipt.')
   return data.selectionId
  },
  async submit(invite,doc,selectionId,idempotency,signal){
   if(!RECORD.test(doc.documentId??'')||!RECORD.test(selectionId??'')||!HEX.test(doc.pageSha256??''))throw message('Confirmed document required.')
   const job=await getJson('/v1/submit',invite,{body:JSON.stringify({
    documentId:doc.documentId,selectionId,pageSha256:doc.pageSha256,shot:SHOT,duration:25
   }),idempotency,signal})
   if(!job||!RECORD.test(job.jobId??'')||!validInvite(job.statusToken)||job.statusToken===invite||job.status!=='queued')
      throw message('No valid render receipt came back. Do not submit the invite again.')
   return {id:job.jobId,readToken:job.statusToken,state:'queued'}
  },
  async status(job,previous,signal){
   if(!RECORD.test(job?.id??'')||!SECRET.test(job?.readToken??''))throw message('Render receipt missing.')
   const data=await getJson('/v1/jobs/'+job.id,job.readToken,{signal})
   if(!data||data.jobId!==job.id)throw message('Render receipt does not match.')
   if(TERMINAL.has(data.status))return {state:data.status}
   const status=data.status==='ready'?'complete':data.status
   const current=STAGES.indexOf(status)
   if(current<0||current<STAGES.indexOf(previous))throw message('Unverified render status.')
   if(status!=='complete')return {state:status}
   const result=data.result
   if(!result||result.type!=='video/mp4'||!Object.keys(HEAD).every(k=>result[k]===HEAD[k])||
      !HEX.test(result.sha256??'')||!Number.isInteger(result.bytes)||result.bytes<=0||result.bytes>32*1024*1024)
      throw message('The render failed video verification.')
   let u
   try{u=new URL(result.downloadUrl)}catch{throw message('Verified download link missing.')}
   if(u.origin!==store||u.username||u.password||u.hash||u.pathname!=='/v1/download/'+job.id)
      throw message('Verified download link missing.')
   return {state:'complete',result:{...HEAD,bytes:result.bytes,sha256:result.sha256,url:u.toString()}}
  }
 }
}

// Only this same-origin app may advertise readiness. No client input can select a broker.
export async function connectSameOriginPilot(origin,request=fetch) {
 const api=exactOrigin(origin,false)
 if(!api)return null
 try{
  const response=await request(api+'/v1/editor-config',{method:'GET',cache:'no-store',
   credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
   signal:AbortSignal.timeout(4000),headers:{Accept:'application/json'}})
  if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)return null
  const stream=response.body.getReader()
  let payload='',length=0
  const decoder=new TextDecoder('utf-8',{fatal:true})
  try {
   while(true){
    const {done,value}=await stream.read()
    if(done)break
    length+=value.byteLength
    if(length>96){await stream.cancel();return null}
    payload+=decoder.decode(value,{stream:true})
   }
   payload+=decoder.decode()
  }finally{stream.releaseLock()}
  const ready=JSON.parse(payload)
  if(!ready||ready.ready!==true||Object.keys(ready).length!==1)return null
  return createDeskTransport({apiOrigin:api,storageOrigin:api,request})
 }catch{return null}
}

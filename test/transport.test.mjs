import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createDeskTransport,readInvite,HEAD,PHRASE,UPLOAD_CAP} from '../public/desk-transport.mjs'
const FIXTURE_SHA='0c0ba8c2de9b29eecf082f0b1a31ff28aad72648583e0e7855d91c1c9b728546'
const api='https://broker.invalid', invite='A'.repeat(40), statusToken='B'.repeat(40)
const documentId='00000000-0000-4000-8000-000000001234', selectionId='00000000-0000-4000-8000-000000001235'
const jobId='00000000-0000-4000-8000-000000001236', key='00000000-0000-4000-8000-000000001237'
const box={x:110,y:480,w:470,h:45}
const docPath='/v1/documents/'+documentId
const ready={documentId,state:'ready',width:1275,height:1650,pageSha256:FIXTURE_SHA,previewUrl:docPath+'/preview'}
const job={jobId,statusToken,status:'queued'}
const complete={jobId,status:'complete',result:{...HEAD,type:'video/mp4',bytes:19820000,sha256:'c'.repeat(64),
  downloadUrl:api+'/v1/download/'+jobId+'?exp=2000000000&sig=example'}}
const png=await readFile(new URL('../public/samples/01-Hearing-Notice.png',import.meta.url))
function transport(...sequence){
 const calls=[]
 const t=createDeskTransport({apiOrigin:api,storageOrigin:api,request:async(url,init)=>{
  calls.push({url,init})
  const next=sequence.shift()
  return next instanceof Response?next:Response.json(next)
 }})
 return [t,calls]
}
const imageResponse=(bytes=png)=>new Response(bytes,{headers:{'content-type':'image/png'}})
test('staging-only; removes fragment credential',()=>{
 assert.equal(createDeskTransport({apiOrigin:'',storageOrigin:''}),null)
 assert.equal(createDeskTransport({apiOrigin:'http://broker.invalid',storageOrigin:api}),null)
 const paths=[]
 assert.equal(readInvite('https://page.invalid/demo/#invite='+invite,p=>paths.push(p)),invite)
 assert.deepEqual(paths,['/demo/'])
 assert.equal(readInvite('https://page.invalid/demo/?invite='+invite,()=>assert.fail('query is not accepted')),null)
 assert.equal(readInvite('https://page.invalid/demo/#invite=broken',p=>paths.push(p)),null)
 assert.equal(readInvite('https://page.invalid/demo/#invite='+invite,()=>{throw new Error('history blocked')}),null)
 assert.deepEqual(paths,['/demo/','/demo/'])
})
test('PNG upload, private PNG hash, OCR, manual confirmation, one sealed job and download result',async()=>{
 const [t,calls]=transport(ready,imageResponse(),{mode:'exact',box},{selectionId},job,
   {jobId,status:'building'},{jobId,status:'rendering'},{jobId,status:'verifying'},complete)
 const file=new Blob([png],{type:'image/png'})
 const doc=await t.upload(invite,file,key)
 assert.equal((await t.preview(invite,doc)).size,png.length)
 assert.deepEqual(await t.match(invite,doc,PHRASE),{mode:'exact',box})
 assert.equal(await t.confirm(invite,doc,PHRASE,{...box,x:120}),selectionId)
 const receipt=await t.submit(invite,doc,selectionId,key)
 let previous='queued',state
 for(let i=0;i<4;i++){state=await t.status(receipt,previous);previous=state.state}
 assert.equal(state.result.url,complete.result.downloadUrl)
 assert.equal(calls[0].url,api+'/v1/documents')
 assert.equal(calls[0].init.body,file)
 assert.equal(calls[0].init.headers['Content-Type'],'image/png')
 assert.equal(calls[1].url,api+docPath+'/preview')
 assert.deepEqual(JSON.parse(calls[3].init.body),{pageSha256:FIXTURE_SHA,passage:PHRASE,box:{...box,x:120}})
 assert.deepEqual(JSON.parse(calls[4].init.body),{documentId,selectionId,pageSha256:FIXTURE_SHA,shot:'reading-push',duration:25})
 assert.equal(calls[4].init.headers['Idempotency-Key'],key)
 assert.ok(calls.slice(5).every(c=>c.init.method==='GET'&&c.init.headers.Authorization==='Bearer '+statusToken))
 assert.ok(calls.every(c=>!c.url.includes(invite)&&!c.url.includes(statusToken)&&
   (typeof c.init.body!=='string'||(!c.init.body.includes(invite)&&!c.init.body.includes(statusToken)))))
 assert.ok(calls.every(c=>c.init.redirect==='error'&&c.init.credentials==='omit'&&c.init.referrerPolicy==='no-referrer'))
})
test('block oversized/disallowed uploads and mismatched private preview',async()=>{
 const [t,calls]=transport({...ready,previewUrl:'https://unexpected.invalid/page.png'})
 await assert.rejects(t.upload(invite,new Blob([Buffer.alloc(UPLOAD_CAP+1)],{type:'application/pdf'}),key))
 await assert.rejects(t.upload(invite,new Blob([png],{type:'image/gif'}),key))
 assert.equal(calls.length,0)
 await assert.rejects(t.upload(invite,new Blob([png],{type:'image/png'}),key))
 const [h]=transport(ready,imageResponse(Buffer.concat([png,Buffer.from('bad')])))
 const doc=await h.upload(invite,new Blob([png],{type:'image/png'}),key)
 await assert.rejects(h.preview(invite,doc),/integrity/)
})
test('reject nonverified status, mismatched job, or arbitrary download',async()=>{
 const doc={...ready,previewPath:docPath+'/preview'}
 for(const [response,prev] of [
  [{...complete,result:{...complete.result,width:1920}},'rendering'],
  [{...complete,jobId:jobId.slice(0,-1)+'0'},'rendering'],
  [{...complete,result:{...complete.result,downloadUrl:'https://public.invalid/payload.mp4'}},'rendering'],
  [{jobId,status:'queued'},'verifying'],
 ]) {
  const [t]=transport(response)
  await assert.rejects(t.status({id:jobId,readToken:statusToken},prev))
 }
 const [t,calls]=transport({})
 await assert.rejects(t.confirm(invite,doc,PHRASE,{...box,x:1270}))
 assert.equal(calls.length,0)
})
test('shipped disconnected page makes no fake result and permits original formats only',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8')
 const source=await readFile(new URL('../public/editor.js',import.meta.url),'utf8')
 assert.doesNotMatch(html,/name="desk-api-origin"/)
 assert.match(html,/connect-src 'self'/)
 assert.match(html,/accept="image\/png,image\/jpeg,application\/pdf"/)
 assert.doesNotMatch(source,/toDataURL|drawImage\(/)
 assert.equal(source.split('transport.submit').length,2)
 assert.ok(source.indexOf('attempted=true')<source.indexOf('transport.submit'))
})

test('reject replay-capable invite as status credential',async()=>{
 const [t]=transport({...job,statusToken:invite})
 await assert.rejects(t.submit(invite,ready,selectionId,key),/No valid render receipt/)
})
test('static page applies no-referrer and allows only same-origin connections',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8')
 const policy=html.indexOf('<meta name="referrer" content="no-referrer">')
 assert.ok(policy>=0&&policy<html.indexOf('<link '))
 assert.match(html,/connect-src 'self'/)
 assert.match(html,/id="invite-code" autocomplete="off"/)
 assert.doesNotMatch(html,/<form\b/)
})

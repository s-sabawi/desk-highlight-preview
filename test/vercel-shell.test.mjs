import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import api from '../api/desk.mjs'
import {connectSameOriginPilot} from '../public/desk-transport.mjs'
const origin='https://editor.invalid'
test('unbound shell cannot claim ready or accept document/render requests',async()=>{
 for(const [path,method] of [['/api/desk','GET'],['/v1/editor-config','GET'],['/v1/documents','POST'],['/v1/submit','POST']]){
  const reply=await api.fetch(new Request(origin+path,{method}))
  assert.equal(reply.status,404)
  assert.equal(reply.headers.get('cache-control'),'private, no-store')
  assert.equal(reply.headers.get('referrer-policy'),'no-referrer')
  assert.deepEqual(await reply.json(),{code:'unavailable'})
 }
 assert.equal(await connectSameOriginPilot(origin,()=>api.fetch()),null)
})
test('exact ready shape makes one credential-free no-redirect same-origin GET',async()=>{
 let checks=0
 assert.ok(await connectSameOriginPilot(origin,(url,init)=>{
  checks++
  assert.equal(url,origin+'/v1/editor-config')
  assert.equal(init.method,'GET')
  assert.equal(init.body,undefined)
  assert.ok(!('Authorization' in init.headers))
  assert.equal(init.credentials,'omit')
  assert.equal(init.redirect,'error')
  assert.equal(init.referrerPolicy,'no-referrer')
  assert.equal(init.cache,'no-store')
  return Response.json({ready:true})
 }))
 assert.equal(checks,1)
 for(const bad of [{ready:false},{ready:'true'},{ready:true,origin:'https://outside.invalid'},{ready:true,oversize:'x'.repeat(100)}])
  assert.equal(await connectSameOriginPilot(origin,()=>Response.json(bad)),null)
 assert.equal(await connectSameOriginPilot(origin,()=>Response.redirect('https://outside.invalid')),null)
 assert.equal(await connectSameOriginPilot('http://localhost:3000',()=>assert.fail()),null)
})
test('allowlisted Vercel public files, no secret and API source separated',async()=>{
 const cfg=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'))
 assert.equal(cfg.outputDirectory,'public')
 assert.equal(Object.hasOwn(cfg,'public'),false)
 assert.ok(cfg.buildCommand.includes("process.env.VERCEL_ENV !== 'preview'"))
 assert.equal(cfg.git.deploymentEnabled['review/desk-vercel-editor-shell'],false)
 assert.deepEqual(cfg.rewrites,[{source:'/v1/:path*',destination:'/api/desk'}])
 assert.ok(cfg.headers[0].headers.some(h=>h.key==='Referrer-Policy'&&h.value==='no-referrer'))
 assert.deepEqual((await readdir(new URL('../public/',import.meta.url),{recursive:true})).sort(),
  ['.nojekyll','desk-transport.mjs','editor.css','editor.js','fonts','fonts/OFL-sans.txt',
   'fonts/OFL-serif.txt','fonts/sans.woff2','fonts/serif.woff2','index.html','samples','samples/01-Hearing-Notice.pdf','samples/01-Hearing-Notice.png'])
 const editor=await readFile(new URL('../public/editor.js',import.meta.url),'utf8')
 assert.ok(editor.indexOf('let invite=readInvite(')<editor.indexOf('await connectSameOriginPilot('))
})

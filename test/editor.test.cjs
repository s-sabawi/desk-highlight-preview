const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict')
const src=fs.readFileSync(__dirname+'/../public/editor.js','utf8').replace(/^import[^\n]*\n/,'')
const PHRASE='The meeting starts at 7:00 p.m.'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(enabled,{holdMatch=false,manualInvite=false}={}){
 const nodes={},events=[]
 let report
 const el=id=>nodes[id]??={
  id,value:'',attrs:{},hidden:id==='video',disabled:['render','review'].includes(id),style:{},dataset:{},files:[],
  setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this[k]},replaceChildren(...v){this.children=v},append(x){this.children.push(x)}
 }
 const ctx={
  document:{getElementById:el,querySelector:()=>({content:''}),createElementNS:(_ns,id)=>el(id),createElement:el},
  history:{replaceState(){}},location:{href:'https://preview.invalid/'},
  Image:class{naturalWidth=1275;naturalHeight=1650;async decode(){}},
  URL:{createObjectURL(){return 'blob:synthetic'},revokeObjectURL(){}},
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000002222'},
  connectSameOriginPilot:async()=>enabled?{
   async upload(code,file,key){events.push(['upload',file.type,key]);return {documentId:'doc',state:'ready',width:1275,height:1650}},
   async preview(code,doc){events.push(['preview',doc.documentId]);return new Blob(['fake'])},
   async match(code,doc,p){events.push(['match',p]);const data={mode:'exact',box:{x:115,y:487,w:473,h:42}}
      return holdMatch?await new Promise(resolve=>{report=()=>resolve(data)}):data},
   async confirm(code,doc,text,box){events.push(['confirm',text,box.x]);return 'test-selection'},
   async submit(code,doc,selection){events.push(['submit',selection,doc.documentId]);await Promise.resolve();return {id:'fake',readToken:'fake',state:'queued'}},
   async status(job,state){events.push(['status',job.id,state]);
    return state==='queued'?{state:'rendering'}:{state:'complete',result:{url:'https://fixture.invalid/NOT-REAL.mp4',fps:24,frames:600,width:480,height:270}}}
  }:null,
  DOC_MIMES:['image/png','image/jpeg','application/pdf'],UPLOAD_CAP:4*1024*1024,
  PHRASE,readInvite:()=>enabled&&!manualInvite?'A'.repeat(40):null,validInvite:c=>/^[A-Za-z0-9_-]{32,96}$/.test(c),
  AbortController,setTimeout:(fn,ms)=>{if(ms===5000)Promise.resolve().then(fn);return 1},clearTimeout:()=>{},
 }
 const ready=vm.runInNewContext('(async()=>{'+src+'})()',ctx)
  return {ready,el,events,finishMatch:()=>report()}
}
async function upload(f){
 f.el('upload').files=[{type:'application/pdf',size:2000}];f.el('upload').onchange();await tick()
}
async function enter(f){
 f.el('passage').value=PHRASE;f.el('passage').oninput();await f.el('review').onclick()
}
;(async()=>{
 const disabled=fixture(false);await disabled.ready
 await upload(disabled);assert.equal(disabled.el('render').disabled,true);assert.deepEqual(disabled.events,[])
 assert.match(disabled.el('status').textContent,/not connected/)
 const stale=fixture(true,{holdMatch:true});await stale.ready;await upload(stale)
 stale.el('passage').value=PHRASE;stale.el('passage').oninput()
 const p=stale.el('review').onclick()
 stale.el('passage').value='Changed while OCR runs';stale.el('passage').oninput()
 stale.finishMatch();await p
 assert.equal(stale.el('reviewPanel').hidden,true)
 assert.equal(stale.el('render').disabled,true)
 const fallback=fixture(true,{manualInvite:true});await fallback.ready
 assert.equal(fallback.el('invite-entry').hidden,false)
 assert.deepEqual(fallback.events,[])
 fallback.el('invite-code').value='invalid';fallback.el('apply-invite').onclick()
 assert.equal(fallback.el('invite-code').value,'')
 assert.equal(fallback.el('invite-entry').hidden,false)
 fallback.el('invite-code').value='A'.repeat(40);fallback.el('apply-invite').onclick()
 assert.equal(fallback.el('invite-code').value,'')
 assert.equal(fallback.el('invite-entry').hidden,true)
 assert.deepEqual(fallback.events,[])
 await upload(fallback)
 assert.equal(fallback.events[0][0],'upload')
 const f=fixture(true);await f.ready
 await upload(f);await enter(f)
 assert.equal(f.el('render').disabled,true)
 f.el('line_x').valueAsNumber=120;f.el('line_x').oninput()
 await f.el('confirm').onclick();assert.equal(f.el('render').disabled,false)
 await Promise.all([f.el('render').onclick(),f.el('render').onclick()])
 assert.equal(f.events.filter(([op])=>op==='submit').length,1)
 assert.ok(f.events.some(e=>e[0]==='confirm'&&e[2]===120))
 assert.equal(f.el('video').hidden,false)
 assert.equal(f.el('download').children[0].textContent,'Download verified MP4 ↓')
 console.log('Original editor mock: private PDF intake, stale OCR invalidation, adjusted OCR rectangle confirmation, one submit despite double click, only verified video.')
})().catch(e=>{console.error(e);process.exit(1)})

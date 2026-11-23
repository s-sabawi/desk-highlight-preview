import {DOC_MIMES, UPLOAD_CAP, PHRASE, readInvite, validInvite, connectSameOriginPilot} from './desk-transport.mjs'
'use strict';
const $=id=>document.getElementById(id),editorStatus=$('status'),canvas=$('pageCanvas'),ns='http://www.w3.org/2000/svg'
const fixture={uri:'./samples/01-Hearing-Notice.png',name:'Sample A: Hearing notice',phrase:PHRASE}
// Strip the invite before the first request. The readiness request never carries it.
let invite=readInvite(location.href,path=>history.replaceState(null,'',path))
const transport=await connectSameOriginPilot(location.origin)
if(!transport)invite=null
let attempted=false
const labels={queued:'Queued',building:'Preparing the original desk scene…',rendering:'Rendering in Blender…',verifying:'Verifying the video…'}
const unavailable=()=>!transport?'3D rendering is not connected on this preview.':!invite?'Open an authorized 3D preview invite to render.':'Ready to render one 25-second Blender video.'
$('invite-entry').hidden=!transport||Boolean(invite)
if(transport) $('privacy-note').textContent='Your document is sent to the private rendering service only when you choose it.'
editorStatus.textContent=unavailable()
function applyInvite(){
 if(!transport||invite||attempted)return
 const input=$('invite-code'), code=input.value.trim()
 input.value=''
 if(!validInvite(code)){editorStatus.textContent='Enter a valid editor invite code.';return}
 invite=code
 $('invite-entry').hidden=true
 editorStatus.textContent=unavailable()
}
$('apply-invite').onclick=applyInvite
$('invite-code').onkeydown=event=>{
 if(event.key==='Enter'){event.preventDefault();applyInvite()}
}
let page=null, pageURL=null, doc=null, W=0,H=0, rect=null, drag=null, armed=false, confirmed=false, selection=null, currentLoad=0, revision=0, intake=null
const norm=s=>s.trim().replace(/\s+/g,' ').toLowerCase()
function clearOutput(){
 $('video').hidden=true;$('caption').textContent='';$('download').replaceChildren();$('video').removeAttribute('src')
}
function invalidate(){revision++;selection=null;confirmed=false;$('render').disabled=true;clearOutput()}
function valid(){
 return Boolean(rect&&[rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)&&
  rect.x>=0&&rect.y>=0&&rect.w>=2&&rect.h>=2&&rect.x+rect.w<=W&&rect.y+rect.h<=H)
}
function paint(){
 for(const k of ['x','y','w','h'])$('line_'+k).value=rect?Math.round(rect[k]*100)/100:'';
 const group=$('boxes');group.replaceChildren()
 if(rect){
  const box=document.createElementNS(ns,'rect')
  for(const [k,v] of Object.entries(rect))box.setAttribute(({w:'width',h:'height'})[k]||k,v)
  box.setAttribute('fill','#56a9ff55');box.setAttribute('stroke','#087fff');box.setAttribute('stroke-width',Math.max(1,W/500));box.dataset.index='0'
  group.append(box)
 }
 $('remove').disabled=!rect
 $('confirm').disabled=!valid()||!norm($('passage').value)
}
function inviteReady(){
 if(transport&&invite&&!attempted)return true
 editorStatus.textContent=unavailable()
 return false
}
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))
const errorText=(err,fallback)=>err?.name==='DeskTransportError'?err.message:fallback
async function load(file,label){
 if(!inviteReady())return
 if(!DOC_MIMES.includes(file.type)||file.size>UPLOAD_CAP){editorStatus.textContent='Choose one PNG, JPG, or single-page PDF under 4 MiB.';return}
 const generation=++currentLoad
 intake?.abort();const controller=new AbortController();intake=controller
 const deadline=setTimeout(()=>controller.abort(),90_000)
 invalidate();doc=null;page=null;rect=null;drag=null;armed=false
 $('review').disabled=true;$('reviewPanel').hidden=true;$('empty').hidden=false
 editorStatus.textContent='Preparing a private copy and reading its text…'
 $('source').textContent='Preparing document';$('passage').value=''
 try {
  let d=await transport.upload(invite,file,crypto.randomUUID(),controller.signal)
  for(let i=0;d.state==='preparing'&&i<30;i++){
   await delay(2500)
   d=await transport.document(invite,d.documentId,controller.signal)
  }
  if(d.state!=='ready')throw Error('Document not ready.')
  const blob=await transport.preview(invite,d,controller.signal)
  if(generation!==currentLoad)return
  const src=URL.createObjectURL(blob)
  let img
  try {
   img=new Image();img.src=src;await img.decode()
   if(img.naturalWidth!==d.width||img.naturalHeight!==d.height)throw Error('Document dimensions changed.')
  }catch(err){URL.revokeObjectURL(src);throw err}
  if(generation!==currentLoad){URL.revokeObjectURL(src);return}
  if(pageURL)URL.revokeObjectURL(pageURL)
  pageURL=src;page=img;doc=d;W=d.width;H=d.height
  $('source').textContent=label;$('review').disabled=false
  editorStatus.textContent='Paste the exact passage, then select Review highlight.'
 }catch(error){
  if(generation===currentLoad)editorStatus.textContent=errorText(error,'The document could not be prepared. No render was started.')
 }finally{clearTimeout(deadline)}
}
$('sample-a').onclick=async()=>{
 if(!inviteReady())return
 const before=currentLoad
 try {
  const r=await fetch(fixture.uri,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'})
  if(!r.ok)throw Error('Sample unavailable')
  const blob=await r.blob()
  if(before!==currentLoad)return
  await load(blob,fixture.name)
 }catch{if(before===currentLoad)editorStatus.textContent='The sample could not be opened.'}
}
$('upload').onchange=()=>{
 const file=$('upload').files[0];$('upload').value=''
 if(file)void load(file,'Uploaded document')
}
$('passage').oninput=()=>{invalidate();$('reviewPanel').hidden=true;$('empty').hidden=false;rect=null;armed=false;drag=null}
$('review').onclick=async()=>{
 if(!page||!doc||!norm($('passage').value)){editorStatus.textContent='Paste the exact passage first.';return}
 if($('passage').value.length>300){editorStatus.textContent='Paste one short phrase.';return}
 invalidate()
 const at=revision, source=doc, text=$('passage').value
 $('review').disabled=true;editorStatus.textContent='Checking the proposed OCR placement…'
 const ctl=new AbortController();const stop=setTimeout(()=>ctl.abort(),15_000)
 try{
  const result=await transport.match(invite,source,text,ctl.signal)
  if(at!==revision||doc!==source)return
  rect=result.mode==='exact'?result.box:null
  canvas.setAttribute('viewBox',`0 0 ${W} ${H}`)
  $('pageImage').setAttribute('href',page.src);$('pageImage').setAttribute('width',W);$('pageImage').setAttribute('height',H)
  $('empty').hidden=true;$('reviewPanel').hidden=false
  $('mode').textContent=rect?'Check the proposed line, then confirm.':'No reliable single-line match. Draw one box around the phrase.'
  editorStatus.textContent='Review the line before rendering.'
  paint()
 }catch(error){if(at===revision)editorStatus.textContent=errorText(error,'The OCR review could not be verified.')}
 finally{clearTimeout(stop);if(doc===source&&!attempted)$('review').disabled=false}
}
const positive=(n,max)=>Math.max(0,Math.min(n,max))
function point(e){
 const p=canvas.createSVGPoint();p.x=e.clientX;p.y=e.clientY
 const matrix=canvas.getScreenCTM();if(!matrix)return null
 const q=p.matrixTransform(matrix.inverse());return {x:positive(q.x,W),y:positive(q.y,H)}
}
canvas.onpointerdown=e=>{
 if(!page||e.button!==0||drag||(!armed&&e.target.dataset.index!=='0'))return
 const start=point(e);if(!start)return
 drag={id:e.pointerId,start,old:armed?null:rect};armed=false;invalidate();canvas.setPointerCapture(e.pointerId)
}
canvas.onpointermove=e=>{
 if(!drag||drag.id!==e.pointerId)return
 const q=point(e);if(!q)return
 const {start,old}=drag
 rect=old?{...old,x:positive(old.x+q.x-start.x,W-old.w),y:positive(old.y+q.y-start.y,H-old.h)}:
  {x:Math.min(start.x,q.x),y:Math.min(start.y,q.y),w:Math.abs(q.x-start.x),h:Math.abs(q.y-start.y)}
 paint()
}
canvas.onpointerup=e=>{if(drag?.id===e.pointerId){canvas.onpointermove(e);drag=null;paint()}}
canvas.onpointercancel=()=>{if(drag){rect=drag.old;drag=null;paint()}}
$('draw').onclick=()=>{armed=true;invalidate();$('mode').textContent='Draw one line on the page.'}
$('remove').onclick=()=>{rect=null;invalidate();paint();$('mode').textContent='Line removed. Draw a new one.'}
for(const k of ['x','y','w','h'])$('line_'+k).oninput=()=>{if(rect){rect[k]=$('line_'+k).valueAsNumber;invalidate();paint()}}
$('confirm').onclick=async()=>{
 if(!doc||!valid()||!norm($('passage').value)||drag||!inviteReady())return
 invalidate()
 const at=revision,source=doc,text=$('passage').value,box={...rect}
 $('confirm').disabled=true;editorStatus.textContent='Saving the confirmed selection privately…'
 const ctl=new AbortController();const stop=setTimeout(()=>ctl.abort(),15_000)
 try{
  const ref=await transport.confirm(invite,source,text,box,ctl.signal)
  if(at!==revision||doc!==source)return
  selection=ref;confirmed=true;$('render').disabled=false
  $('mode').textContent='One highlight confirmed.';editorStatus.textContent=unavailable()
 }catch(error){if(at===revision)editorStatus.textContent=errorText(error,'The selection could not be confirmed.')}
 finally{clearTimeout(stop);if(at===revision&&!attempted)paint()}
}
$('render').onclick=async()=>{
 if(!confirmed||!selection||!doc||!valid()||!page||drag||attempted||!transport||!invite)return
 attempted=true;confirmed=false;$('render').disabled=true
 const code=invite,source=doc,selectionId=selection;invite=null
 for(const id of ['sample-a','upload','passage','review','confirm','draw','remove','line_x','line_y','line_w','line_h'])$(id).disabled=true
 canvas.style.pointerEvents='none'
 const controller=new AbortController();const stop=setTimeout(()=>controller.abort(),25*60*1000)
 try {
  editorStatus.textContent='Submitting one authorized Blender render…'
  const job=await transport.submit(code,source,selectionId,crypto.randomUUID(),controller.signal)
  let previous='queued'
  for(let i=0;i<300;i++){
   editorStatus.textContent=labels[previous]||'Checking verified render…'
   await new Promise(resolve=>setTimeout(resolve,5000))
   const state=await transport.status(job,previous,controller.signal)
   if(['failed','expired','outcome_unknown'].includes(state.state)){
    editorStatus.textContent='No verified video. The invite was consumed; no render retry was made.'
    return
   }
   if(state.state==='complete'){
    const {url,fps,frames,width,height}=state.result
    $('video').src=url;$('video').hidden=false
    $('caption').textContent=`${frames/fps}s · ${fps} fps · ${width} × ${height} · verified Blender preview`
    const a=document.createElement('a');a.href=url;a.setAttribute('rel','noreferrer');a.textContent='Download verified MP4 ↓'
    $('download').replaceChildren(a);editorStatus.textContent='Verified Blender video ready.'
    return
   }
   previous=state.state
  }
  editorStatus.textContent='No verified result in the preview window. Do not resubmit this invite.'
 }catch(error){
  editorStatus.textContent=error.name==='DeskTransportError'?error.message:'Render outcome unverified. No automatic retry was made.'
 }finally{clearTimeout(stop)}
}

// Replace this closed placeholder only with the reviewed same-origin broker.
export default {
 async fetch(){
  return Response.json({code:'unavailable'},{status:404,headers:{
   'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer',
   'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
   'X-Content-Type-Options':'nosniff'
  }})
 }
}

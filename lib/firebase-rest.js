const base = 'https://scoreboard-6d34c-default-rtdb.europe-west1.firebasedatabase.app';
let cached, pending;
async function token() {
  if (cached?.until > Date.now()) return cached.value;
  if (!pending) pending = (async () => {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAFb-yJaI7WJFcTx_wAFmSngupHqUNai1I', {
      method: 'POST', headers: {'Content-Type':'application/json'}, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({email:process.env.FIREBASE_ADMIN_EMAIL,password:process.env.FIREBASE_ADMIN_PASSWORD,returnSecureToken:true})
    });
    if (!r.ok) throw new Error('SERVER_AUTH');
    const data = await r.json(); cached = {value:data.idToken,until:Date.now()+3000000}; return cached.value;
  })().finally(() => pending = null);
  return pending;
}
export async function database(path, method='GET', value, etag) {
  const auth = await token();
  const headers = {'Content-Type':'application/json'};
  if(method==='GET') headers['X-Firebase-ETag']='true';
  if(etag) headers['if-match']=etag;
  const r=await fetch(`${base}/${path}.json?auth=${encodeURIComponent(auth)}`,{method,headers,body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(12000)});
  if(r.status===412) return {conflict:true};
  if(!r.ok) throw new Error(r.status===401||r.status===403?'DATABASE_PERMISSION':'DATABASE_UNAVAILABLE');
  return {value:await r.json(),etag:r.headers.get('etag')};
}
export function hasSession(req) {
  const secret=process.env.ADMIN_SESSION_TOKEN;
  return Boolean(secret) && (req.headers.cookie||'').split(';').some(p=>p.trim()===`legion_admin=${secret}`);
}

const listeners=new Map(); let polling=false, latest={}, pendingWrites=0, revision=0;
function status(text) { window.dispatchEvent(new CustomEvent('match-connection',{detail:text})); }
async function request(options) {
  const r=await fetch('/api/match',{cache:'no-store',signal:AbortSignal.timeout(25000),...options});
  if(!r.ok) { const data=await r.json().catch(()=>({})); throw new Error(data.error||`HTTP_${r.status}`); }
  return r.json();
}
function deliver(data) {
  for(const [path,items] of listeners) {
    const value=data[path]??null; const key=JSON.stringify(value);
    for(const item of items) if(item.key!==key) {item.key=key;item.fn({val:()=>value,exists:()=>value!==null});}
  }
  latest=data;
}
async function poll() {
  const before=revision;
  try { const data=await request(); if(!pendingWrites && before===revision) {deliver(data); status('На связи');} }
  catch { status('Нет связи · повторяем подключение'); }
  setTimeout(poll,2000);
}
export const db={};
export function ref(_,path) {return path;}
export function onValue(path,fn) {
  const item={fn,key:undefined}; if(!listeners.has(path)) listeners.set(path,new Set());listeners.get(path).add(item);
  if(!polling) {polling=true;setTimeout(poll,0);}
  return ()=>listeners.get(path).delete(item);
}
async function write(path,value,method) {
  pendingWrites++;revision++;status('Сохраняем…');
  try {
    await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,value,method})});
    deliver({...latest,[path]:method==='PATCH'?{...latest[path],...value}:value});status('Сохранено');
  } catch(error) {status(error.message==='SESSION_EXPIRED'?'Откройте ссылку входа в админку':'Не удалось сохранить');throw error;}
  finally {pendingWrites--;revision++;}
}
export const update=(path,value)=>write(path,value,'PATCH');
export const set=(path,value)=>write(path,value,'PUT');

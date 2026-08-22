import { getVapidPublicKey, sendWebPush } from './webPush.js';
const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'}});
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
const auth=(r,e)=>{const h=r.headers.get('authorization')||'';return !!e.RELAY_SECRET&&h===`Bearer ${e.RELAY_SECRET}`};
const key=(inbox,charId)=>`proactive:${inbox}:${charId}`;
const outKey=inbox=>`outbox:${inbox}`;
const subKey=inbox=>`pushsubs:${inbox}`;
const rand=(a,b)=>a+Math.random()*(b-a);
async function readJson(kv,k,d){try{const v=await kv.get(k);return v?JSON.parse(v):d}catch{return d}}
async function writeJson(kv,k,v){await kv.put(k,JSON.stringify(v))}
async function addIndex(kv,k){const a=await readJson(kv,'proactive:index',[]);if(!a.includes(k)){a.push(k);await writeJson(kv,'proactive:index',a)}}
async function delIndex(kv,k){const a=(await readJson(kv,'proactive:index',[])).filter(x=>x!==k);await writeJson(kv,'proactive:index',a)}
async function addOutbox(kv,inbox,item){let a=await readJson(kv,outKey(inbox),[]);a.push(item);a=a.slice(-80);await writeJson(kv,outKey(inbox),a)}
async function pushAll(env,inbox,payload){const subs=await readJson(env.OUTBOX,subKey(inbox),[]),keep=[];for(const s of subs){const r=await sendWebPush(env,s,payload);if(!r.gone)keep.push(s)}if(keep.length!==subs.length)await writeJson(env.OUTBOX,subKey(inbox),keep)}
async function recordsForInbox(kv,inbox,idx){const rows=[];for(const k of idx){const c=await readJson(kv,k,null);if(c&&c.inboxId===inbox)rows.push([k,c])}return rows}
async function alignInboxDue(kv,inbox,nextDueAt,idx){for(const [k,c] of await recordsForInbox(kv,inbox,idx)){if(!c.enabled)continue;c.nextDueAt=nextDueAt;await writeJson(kv,k,c)}}
async function tick(env){
  const kv=env.OUTBOX,idx=await readJson(kv,'proactive:index',[]),now=Date.now(),byInbox=new Map();
  for(const k of idx){const c=await readJson(kv,k,null);if(!c||!c.enabled||!Array.isArray(c.cardPool)||!c.cardPool.length)continue;const a=byInbox.get(c.inboxId)||[];a.push([k,c]);byInbox.set(c.inboxId,a)}
  for(const [inbox,rows] of byInbox){
    const dueRows=rows.filter(([,c])=>c.nextDueAt&&now>=c.nextDueAt);if(!dueRows.length)continue;
    // One global proactive event per inbox, matching the foreground behaviour: pick one private contact each interval.
    const [chosenKey,c]=dueRows[Math.floor(Math.random()*dueRows.length)];
    const choices=c.cardPool.filter(x=>x&&x!==c.lastText),pool=choices.length?choices:c.cardPool,text=pool[Math.floor(Math.random()*pool.length)];
    if(!text)continue;
    const id=`relay_proactive_${c.charId}_${now}_${Math.random().toString(36).slice(2,7)}`;
    await addOutbox(kv,inbox,{id,charId:c.charId,text,createdAt:now,proactive:true});
    c.lastText=text;c.lastFiredAt=now;
    const mn=Math.max(1,Number(c.intervalMin)||5),mx=Math.max(mn,Number(c.intervalMax)||mn),nextDueAt=now+rand(mn,mx)*60000;
    // All contacts share the same next due time, preventing a burst of one message per contact.
    for(const [k,row] of rows){row.nextDueAt=nextDueAt;if(k===chosenKey){row.lastText=text;row.lastFiredAt=now}await writeJson(kv,k,row)}
    await pushAll(env,inbox,{title:c.charName||'苜蓿',body:text,tag:`muxu-msg-${id}`,data:{messageId:id,charId:c.charId,conversationId:c.charId},kind:'relay-proactive'}).catch(()=>{});
  }
}
export default {async fetch(request,env){const u=new URL(request.url),p=u.pathname;if(request.method==='OPTIONS')return new Response(null,{headers:cors});if(p==='/health')return J({ok:true,mode:'nuojiji-style-proactive-relay'});if(p==='/api/push/vapid-key'){return J({publicKey:await getVapidPublicKey(env)})}if(!auth(request,env))return J({error:'unauthorized'},401);if(p==='/api/push/subscribe'&&request.method==='POST'){const b=await request.json(),i=b.inboxId,s=b.subscription;if(!i||!s?.endpoint)return J({error:'inboxId / subscription required'},400);let a=await readJson(env.OUTBOX,subKey(i),[]);a=a.filter(x=>x.endpoint!==s.endpoint);a.push(s);await writeJson(env.OUTBOX,subKey(i),a.slice(-8));return J({ok:true})}if(p==='/proactive/register'&&request.method==='POST'){const b=await request.json(),{inboxId,userId,charId}=b;if(!inboxId||charId==null)return J({error:'inboxId / charId required'},400);const mn=Math.max(1,Math.min(1440,Number(b.intervalMin)||5)),mx=Math.max(mn,Math.min(1440,Number(b.intervalMax)||mn)),k=key(inboxId,String(charId)),old=await readJson(env.OUTBOX,k,null),changed=!old||old.intervalMin!==mn||old.intervalMax!==mx,idx=await readJson(env.OUTBOX,'proactive:index',[]);let sharedDue=0;for(const [,row] of await recordsForInbox(env.OUTBOX,inboxId,idx)){if(row.nextDueAt){sharedDue=row.nextDueAt;break}}const rec={...(old||{}),inboxId,userId:String(userId??'me'),charId:String(charId),charName:String(b.charName||'对方'),enabled:b.enabled!==false,intervalMin:mn,intervalMax:mx,cardPool:Array.isArray(b.cardPool)?[...new Set(b.cardPool.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))].slice(0,300):[],updatedAt:Date.now()};if(!rec.nextDueAt)rec.nextDueAt=sharedDue||Date.now()+rand(mn,mx)*60000;await writeJson(env.OUTBOX,k,rec);await addIndex(env.OUTBOX,k);if(changed){const nextDueAt=Date.now()+rand(mn,mx)*60000;const latestIdx=await readJson(env.OUTBOX,'proactive:index',[]);await alignInboxDue(env.OUTBOX,inboxId,nextDueAt,latestIdx);rec.nextDueAt=nextDueAt}return J({ok:true,nextDueAt:rec.nextDueAt})}if(p==='/proactive/unregister'&&request.method==='POST'){const b=await request.json(),k=key(b.inboxId,String(b.charId));await env.OUTBOX.delete(k);await delIndex(env.OUTBOX,k);return J({ok:true})}if(p==='/proactive/status'&&request.method==='GET'){const inbox=u.searchParams.get('inboxId'),idx=await readJson(env.OUTBOX,'proactive:index',[]),rows=[];for(const k of idx){const c=await readJson(env.OUTBOX,k,null);if(c&&c.inboxId===inbox)rows.push({charId:c.charId,enabled:c.enabled,nextDueAt:c.nextDueAt,lastFiredAt:c.lastFiredAt||0,intervalMin:c.intervalMin,intervalMax:c.intervalMax})}return J({pairs:rows})}if(p==='/outbox'&&request.method==='GET'){const i=u.searchParams.get('inboxId');if(!i)return J({error:'inboxId required'},400);return J({items:await readJson(env.OUTBOX,outKey(i),[]),now:Date.now()})}if(p==='/ack'&&request.method==='POST'){const b=await request.json(),ids=new Set(b.ids||[]),a=(await readJson(env.OUTBOX,outKey(b.inboxId),[])).filter(x=>!ids.has(x.id));await writeJson(env.OUTBOX,outKey(b.inboxId),a);return J({acked:ids.size})}return J({error:'not found'},404)},async scheduled(event,env,ctx){ctx.waitUntil(tick(env))}};

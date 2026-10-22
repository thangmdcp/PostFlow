import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readDownloadSnapshot,reusableDownload} from '../lib/fetchDownloadSnapshot.ts';

function load(file,mocks,globals={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,require:id=>{if(!(id in mocks))throw Error(id);return mocks[id];},Date,URL,console,...globals});
  return module.exports;
}
function fixture() {
  const posts=[],configs=new Map();let chain=Promise.resolve(),counter=0,capacity={max:2,available:2,reason:null};
  const appConfig={findUnique:async({where})=>configs.has(where.key)?{key:where.key,value:configs.get(where.key)}:null,
    findMany:async({where})=>[...configs].filter(([key])=>where.key.in.includes(key)).map(([key,value])=>({key,value})),
    upsert:async({where,create,update})=>configs.set(where.key,configs.has(where.key)?update.value:create.value),
    updateMany:async({where,data})=>{if(configs.get(where.key)!==where.value)return {count:0};configs.set(where.key,data.value);return {count:1};}};
  const post={findMany:async()=>posts.filter(p=>p.status==='queued'&&(!p.fetchLeaseUntil||p.fetchLeaseUntil<=new Date())&&(!p.fetchNextAttemptAt||p.fetchNextAttemptAt<=new Date())),
    updateMany:async({where,data})=>{const p=posts.find(p=>p.id===where.id&&p.status===where.status&&p.updatedAt===where.updatedAt);if(!p)return {count:0};Object.assign(p,data);return {count:1};},
    findFirst:async()=>posts.find(p=>p.status==='queued')};
  const tx={appConfig,post,fetchProviderState:{findUnique:async()=>null},$queryRawUnsafe:async()=>[]};
  const prisma={...tx,$transaction:fn=>{const next=chain.then(()=>fn(tx));chain=next.catch(()=>{});return next;}};
  const api=load('lib/downloadPool.ts',{'@prisma/client':{},'node:crypto':{randomUUID:()=>`owner-${++counter}`},'@/lib/prisma':{prisma},
    '@/lib/fetchDownloadSnapshot':{readDownloadSnapshot,reusableDownload},'@/lib/renderDownload':{renderConfig:async()=>({platforms:['facebook']})},
    '@/lib/renderCapacity':{renderCapacity:async()=>capacity,RENDER_CAPACITY_KEY:'capacity'},
    '@/lib/fetchPostJob':{processFetchPost:async(id,_stage,claim)=>{const p=posts.find(p=>p.id===id);assert.equal(p.fetchDownloadSnapshot.pool.owner,JSON.parse(claim.reservation.value).owner);p.status='ready';return {status:'done'};}}});
  const add=(id,fields={})=>{const p={id,sourceKind:'source_link',sourceUrl:`https://www.facebook.com/reel/${id}`,status:'queued',finalCaption:null,cloudinaryId:null,stableMediaUrl:null,fetchDownloadSnapshot:null,fetchAttempt:0,updatedAt:new Date(),...fields};posts.push(p);return p;};
  return {api,add,posts,configs,setCapacity:value=>{capacity=value;}};
}
test('atomic claims admit one Flully and two independent Render slots; fourth waits',async()=>{
  const f=fixture();for(let i=0;i<4;i++)f.add(`post${i}`);
  const claims=await Promise.all([f.api.claimPoolPost('flully'),f.api.claimPoolPost('render'),f.api.claimPoolPost('render'),f.api.claimPoolPost('render'),f.api.claimPoolPost('flully')]);
  assert.equal(claims.filter(Boolean).length,3);assert.equal(new Set(claims.filter(Boolean).map(c=>c.postId)).size,3);
  assert.deepEqual(claims.filter(c=>c?.provider==='render').map(c=>c.slot),[0,1]);
  assert.equal(f.posts.filter(p=>p.status==='queued').length,1);
});
test('free source takes oldest eligible work; stale preassignment may rebalance, started retries cannot',async()=>{
  const f=fixture();f.add('old',{fetchDownloadSnapshot:{version:1,purpose:'fetch',sourceUrl:'https://www.facebook.com/reel/old',downloadProvider:'flully'}});
  f.add('started',{fetchAttempt:1,fetchDownloadSnapshot:{version:1,purpose:'fetch',sourceUrl:'https://www.facebook.com/reel/started',downloadProvider:'flully',started:true}});
  f.add('next');assert.equal((await f.api.claimPoolPost('render')).postId,'old');assert.equal((await f.api.claimPoolPost('render')).postId,'next');
  assert.equal((await f.api.claimPoolPost('flully')).postId,'started');
});
test('active legacy lease fences new slots; no download during resource pause',async()=>{
  const f=fixture();f.add('a');f.configs.set('_internal_render_download_lease',JSON.stringify({until:Date.now()+60000}));
  assert.equal(await f.api.claimPoolPost('render'),null);f.configs.clear();
  f.setCapacity({max:2,reason:'RAM thấp'});assert.equal(await f.api.claimPoolPost('render'),null);
  f.setCapacity({max:2,reason:null});assert.ok(await f.api.claimPoolPost('render'));
});
test('expired slot can be reclaimed but old owner cannot unlock its successor',async()=>{
  const f=fixture();f.add('a');f.add('b');const first=await f.api.claimPoolPost('render');
  f.configs.set(first.reservation.key,JSON.stringify({owner:'old',until:0}));
  const next=await f.api.claimPoolPost('render');assert.equal(first.slot,next.slot);assert.notEqual(first.reservation.value,next.reservation.value);
  // Same conditional release used by the pump's finally block.
  const current=f.configs.get(first.reservation.key);
  if(current===first.reservation.value)f.configs.set(first.reservation.key,'');
  assert.equal(f.configs.get(next.reservation.key),next.reservation.value);
});
test('upload checkpoint and scheduled content never enter source pool; expired checkpoint stays pinned',async()=>{
  const f=fixture();f.add('ready',{stableMediaUrl:'stable'});f.add('scheduled',{finalCaption:'saved'});
  f.add('checkpoint',{fetchDownloadSnapshot:{version:1,purpose:'fetch',sourceUrl:'https://www.facebook.com/reel/checkpoint',downloadProvider:'render',expiresAt:new Date(Date.now()+3600000).toISOString(),data:{media:[{type:'video',url:'temporary'}]}}});
  assert.equal(await f.api.claimPoolPost('render'),null);assert.equal(await f.api.claimPoolPost('flully'),null);
  const old=f.add('expired',{fetchDownloadSnapshot:{version:1,purpose:'fetch',sourceUrl:'https://www.facebook.com/reel/expired',downloadProvider:'render',expiresAt:new Date(0).toISOString(),data:{media:[{type:'video',url:'expired'}]}}});
  assert.equal(await f.api.claimPoolPost('flully'),null);assert.equal((await f.api.claimPoolPost('render')).postId,old.id);
});
test('pump releases its owned slot after work and exposes safe aggregate status only',async()=>{
  const f=fixture();f.add('a');await f.api.processFetchPump('render');
  assert.equal(f.configs.get('_internal_render_download_slot_0'),'');
  f.configs.set('renderDownloadEnabled','true');f.configs.set('capacity',JSON.stringify({max:2}));
  f.configs.set('_internal_render_download_slot_1',JSON.stringify({owner:'private-token',postId:'private-post',until:Date.now()+60000}));
  const result=await f.api.poolStatus();assert.equal(result.render.active,1);assert.equal(result.render.max,2);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('public state strips checkpoint URLs and owner but keeps phase and slot',()=>{
  const {publicFetchState}=load('lib/publicFetchState.ts',{'@/lib/fetchDownloadSnapshot':{readDownloadSnapshot,reusableDownload}});
  const result=publicFetchState({status:'fetching',sourceUrl:'u',fetchDownloadSnapshot:{version:1,purpose:'fetch',sourceUrl:'u',downloadProvider:'render',pool:{slot:1,owner:'private'}}});
  assert.equal(result.fetchPhase,'download');assert.equal(result.fetchSlot,2);assert.equal(result.fetchDownloadSnapshot,null);assert.ok(!JSON.stringify(result).includes('private'));
});

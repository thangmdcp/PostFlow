import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {SourceFetchError} from '../lib/sourceFetchError.ts';
import {fetchStageFor} from '../lib/fetchDownloadSnapshot.ts';

function load(file,mocks,globals={}) {
 const module={exports:{}};
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(!(id in mocks))throw Error(id);return mocks[id];},Date,URL,AbortSignal,process:{env:{CLOUDINARY_CLOUD_NAME:'demo'}},...globals});return module.exports;
}
function fixture({enabled='true',origin='https://safe.onrender.com',status=200,code,network=false}={}) {
 const calls=[], failures=[];
 const api=load('lib/renderDownload.ts',{
  '@/lib/prisma':{prisma:{appConfig:{findMany:async()=>[{key:'renderDownloadEnabled',value:enabled},{key:'renderDownloadUrl',value:origin},{key:'renderDownloadApiKey',value:'private-key'}]}}},
  '@/lib/sourceFetchError':{SourceFetchError},
  '@/lib/flullyDownloadLease':{withDownloadLease:async(provider,run)=>{assert.equal(provider,'render');return run();}},
  '@/lib/fetchProviderCircuit':{assertFetchProviderAvailable:async()=>{},recordFetchProviderSuccess:async()=>{},recordFetchProviderFailure:async e=>failures.push(e)},
 },{fetch:async(url,options)=>{calls.push({url,options});if(network)throw Error('secret response');return new Response(JSON.stringify(code?{success:false,code}:{success:true,type:'video',caption:'full caption',media:[{type:'video',url:'https://res.cloudinary.com/demo/video/upload/v1/postflow-fetch/video-post12345678.mp4',public_id:'postflow-fetch/video-post12345678'}]}),{status});}});
 return {api,calls,failures};
}
test('Render uses isolated server key, deterministic request ID, bounded timeout and trusted origin',async()=>{
 const f=fixture();const result=await f.api.renderDownload('https://www.facebook.com/reel/1','post12345678');
 assert.equal(result.provider,'render');assert.equal(result.media[0].publicId,'postflow-fetch/video-post12345678');
 assert.equal(f.calls[0].url,'https://safe.onrender.com/api/download');
 assert.equal(f.calls[0].options.headers['X-API-Key'],'private-key');
 assert.deepEqual(JSON.parse(f.calls[0].options.body),{url:'https://www.facebook.com/reel/1',requestId:'post12345678'});
 for(const origin of ['http://safe.onrender.com','https://127.0.0.1','https://onrender.com.evil.test','https://user@safe.onrender.com'])assert.equal(await fixture({origin}).api.renderConfig(),null);
 assert.equal(await fixture({enabled:'false'}).api.renderConfig(),null);
});
test('Render busy waits; auth/size are permanent; storage errors stay storage; lost response is fenced',async()=>{
 for(const [code,status,retry,provider] of [['MEDIA_BUSY',503,true,'render'],['UNAUTHORIZED',401,false,'render'],['MEDIA_TOO_LARGE',413,false,'render'],['CLOUDINARY_FAILED',502,true,'cloudinary']]){
  await assert.rejects(fixture({code,status}).api.renderDownload('url','post12345678'),e=>e.code===code&&e.retryable===retry&&e.provider===provider);
 }
 await assert.rejects(fixture({network:true}).api.renderDownload('url','post12345678'),e=>e.code==='RENDER_UNCERTAIN'&&e.retryAfterSeconds===420&&!e.message.includes('secret'));
});
test('Render checkpoint routes only to Render until upload checkpoint exists',()=>{
 const snapshot={version:1,purpose:'fetch',sourceUrl:'source',downloadProvider:'render'};
 assert.equal(fetchStageFor('source',snapshot),'render');
 assert.equal(fetchStageFor('different',snapshot),'download');
 assert.equal(fetchStageFor('source',{...snapshot,data:{media:[{type:'video',url:'https://res.cloudinary.com/demo/video/upload/x.mp4'}]},expiresAt:new Date(Date.now()+3600000).toISOString()}),'upload');
});
test('Worker binds Render with concurrency one and keeps authoritative stage on delayed busy replacement',async()=>{
 const source=readFileSync(new URL('../cloudflare/postflow-queue/wrangler.jsonc',import.meta.url),'utf8');const config=JSON.parse(source);
 assert.equal(config.queues.consumers.find(c=>c.queue==='postflow-render').max_concurrency,1);
 const calls=[];const queue={send:async(...args)=>calls.push(args)};
 const worker=load('cloudflare/postflow-queue/src/index.ts',{}, {fetch:async(_url,options)=>{assert.equal(JSON.parse(options.body).stage,'render');return new Response(JSON.stringify({fetchStatus:'waiting',retryAfterSeconds:10}));}}).default;
 let ack=0; await worker.queue({queue:'postflow-render',messages:[{body:{type:'fetch',postId:'p',stage:'upload'},ack:()=>ack++,retry:()=>assert.fail('must not consume retry')}]},{POSTFLOW_API_URL:'https://test.example',POSTFLOW_RENDER_QUEUE:queue});
 assert.equal(ack,1);assert.equal(calls[0][0].stage,'render');assert.equal(calls[0][1].delaySeconds,10);
});

test('Dispatcher alternates eligible new jobs, pins assignment and excludes blocked Render / photos',async()=>{
 const records=new Map();let counter='0',blocked=false;
 const appConfig={findUnique:async({where})=>where.key==='_internal_download_dispatch'?{value:counter}:null,upsert:async({update})=>{counter=update.value;}};
 const tx={appConfig,$queryRawUnsafe:async()=>{},fetchProviderState:{findUnique:async()=>blocked?{blockedUntil:new Date(Date.now()+60000)}:null},post:{findUnique:async({where})=>records.get(where.id),updateMany:async({where,data})=>{const post=records.get(where.id);Object.assign(post,data);return {count:1};}}};
 const api=load('lib/fetchDispatch.ts',{'@/lib/prisma':{prisma:{$transaction:run=>run(tx)}},'@prisma/client':{},'@/lib/renderDownload':{renderConfig:async()=>({platforms:['facebook']})},'@/lib/fetchDownloadSnapshot':{fetchStageFor,readDownloadSnapshot:value=>value}});
 const add=(id,url=`https://www.facebook.com/reel/${id}`)=>records.set(id,{id,sourceUrl:url,status:'queued',updatedAt:new Date(),fetchDownloadSnapshot:null});
 add('a');add('b');assert.equal(await api.assignFetchStage('a'),'download');assert.equal(await api.assignFetchStage('b'),'render');
 assert.equal(await api.assignFetchStage('b'),'render');assert.equal(counter,'2');
 add('c');add('d');blocked=true;await api.assignFetchStage('c');assert.equal(await api.assignFetchStage('d'),'download');
 blocked=false;add('photo','https://www.facebook.com/page/posts/pfbid');assert.equal(await api.assignFetchStage('photo'),'download');
 add('instagram','https://www.instagram.com/reel/abc');assert.equal(await api.assignFetchStage('instagram'),'download');
});

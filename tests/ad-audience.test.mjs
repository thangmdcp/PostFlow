import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as audience from "../lib/adAudience.ts";
import { applyAdvantageAudience, applyAdvantagePlacements } from "../lib/adAdvantage.ts";
import { templateBlueprintFromSettings } from "../lib/adTemplateBlueprint.ts";

const defaults = audience.DEFAULT_AUDIENCE_SUGGESTIONS;
const option = id => ({ id, name: `Option ${id}` });
const base = { age_min: 20, age_max: 48, genders: [2], geo_locations: { countries: ["VN"] }, locales: [6],
  interests: [option("11")], custom_audiences: [option("12")], excluded_custom_audiences: [option("13")], exclusions: { behaviors: [option("14")] } };

test("default mode inherits template suggestions; explicit age_range wins over hard age", () => {
  assert.equal(audience.parseAudienceSuggestions(undefined).mode, "template");
  const snap = audience.resolveAudienceSnapshot(defaults, "act_1", base);
  assert.deepEqual(snap.targeting.age_range, [20,48]);
  assert.deepEqual(snap.targeting.genders, [2]);
  assert.deepEqual(audience.resolveAudienceSnapshot(defaults,"act_1",{...base,age_range:[25,35]}).targeting.age_range,[25,35]);
  assert.equal("genders" in audience.resolveAudienceSnapshot(defaults,"act_1",{...base,genders:[1,2]}).targeting,false);
  const before = JSON.stringify(snap);
  base.interests[0].name = "changed template";
  assert.equal(JSON.stringify(snap), before, "snapshot must not share nested references with a template");
});
test("custom replaces inclusions with one OR group and isolates custom audiences by account", () => {
  const value = {...defaults,mode:"custom",ageRange:[28,65],gender:"1",interests:[option("20")],behaviors:[option("21")],customAudiencesByAccount:{act_1:[option("22")],act_2:[option("23")]}};
  const snap = audience.resolveAudienceSnapshot(value,"act_2",base);
  assert.deepEqual(snap.targeting.age_range,[28,65]);
  assert.deepEqual(snap.targeting.genders,[1]);
  assert.equal(snap.targeting.flexible_spec.length,1);
  assert.deepEqual(snap.targeting.custom_audiences,[option("23")]);
  const result = audience.applyAudienceSnapshot({...base,targeting_automation:{advantage_audience:0}},snap,"2");
  assert.equal(result.age_min,20); assert.equal("age_max" in result,false); assert.equal("interests" in result,false);
  assert.deepEqual(result.geo_locations,base.geo_locations); assert.deepEqual(result.locales,[6]);
  assert.deepEqual(result.excluded_custom_audiences,base.excluded_custom_audiences);
  assert.equal(result.targeting_automation.advantage_audience,1);
});
test("none removes all template inclusions but freezes exclusions and keeps controls", () => {
  const snap=audience.resolveAudienceSnapshot({...defaults,mode:"none"},"act_1",base);
  const result=audience.applyAudienceSnapshot({...base,flexible_spec:[{interests:[option("33")]}]},snap,"act_1");
  for(const key of audience.AUDIENCE_INCLUSION_KEYS)assert.equal(key in result,false,key);
  assert.deepEqual(result.excluded_custom_audiences,base.excluded_custom_audiences);
  assert.deepEqual(result.exclusions,base.exclusions); assert.deepEqual(result.geo_locations,base.geo_locations);
  assert.equal(result.age_min,20);
});
test("all gender and absent age suggestion are omitted, hard minimum is strictly 18–25", () => {
  const snap=audience.resolveAudienceSnapshot({...defaults,mode:"custom"},"act_1",{});
  assert.deepEqual(snap.targeting,{});
  for(const min of [18,25,undefined])audience.validateAudienceMinimum(min);
  for(const min of [13,17,26,65,18.5,NaN])assert.throws(()=>audience.validateAudienceMinimum(min),audience.AdAudienceConfigurationError);
  assert.throws(()=>audience.applyAudienceSnapshot({age_min:26},snap,"act_1"));
});
test("malformed input/snapshot and mismatched destination never silently fall back", () => {
  for(const value of [{...defaults,mode:"oops"},{...defaults,ageRange:[17,65]},{...defaults,ageRange:[40,30]}, {...defaults,gender:1},
    {...defaults,interests:[option("not-id")]},{...defaults,customAudiencesByAccount:{wrong:[option("1")]}}])assert.throws(()=>audience.parseAudienceSuggestions(value));
  assert.equal(audience.parseAudienceSnapshot(null),null);
  for(const value of [{}, {version:1,mode:"custom",accountId:"act_1",targeting:{age_max:50}}])assert.throws(()=>audience.parseAudienceSnapshot(value));
  assert.throws(()=>audience.applyAudienceSnapshot({},audience.resolveAudienceSnapshot(defaults,"act_1",{}),"act_2"));
  assert.equal(audience.storedAudienceSuggestions("bad localStorage").mode,"template");
  const saved={...defaults,mode:"custom",gender:"2",ageRange:[25,45],customAudiencesByAccount:{act_1:[option("9")]}};
  assert.deepEqual(audience.storedAudienceSuggestions(JSON.stringify(saved)),saved);
});
test("legacy enabled Audience still strips hard gender; explicit snapshot restores suggestion only", () => {
  const old=applyAdvantageAudience(base,true);
  assert.equal("genders" in old,false); assert.equal("age_max" in old,false);
  const snap=audience.resolveAudienceSnapshot({...defaults,mode:"custom",gender:"2",ageRange:[25,35]},"act_1",base);
  const result=audience.applyAudienceSnapshot(old,snap,"act_1");
  assert.deepEqual(result.genders,[2]);assert.deepEqual(result.age_range,[25,35]);assert.equal("age_max" in result,false);
  assert.deepEqual(applyAdvantageAudience(base,false).genders,[2],"turning Audience off keeps manual targeting");
});

class MetaApiError extends Error { constructor(category) {super(`Meta ${category}`);this.category=category;} }
function serverFixture({ graph, templateAccount="act_1", targeting=base, invalidTargeting=false }={}) {
  const calls=[];
  const settings={blueprint:{version:1,name:"Template",objective:"OUTCOME_TRAFFIC",targeting,billingEvent:"IMPRESSIONS",optimizationGoal:"LINK_CLICKS"}};
  const mocks={"node:crypto":{createHash},"@/lib/prisma":{prisma:{fbAdAccount:{findUnique:async()=>({accessToken:"server-secret"})},campaignTemplate:{findFirst:async()=>({settings,adAccountId:templateAccount})}}},
    "@/lib/meta":{META_GRAPH_API:"https://graph.example/v25.0"},"@/lib/metaApiClient":{MetaApiError,metaRequestJson:async(raw,init)=>{const url=new URL(raw);calls.push(url);assert.equal(url.searchParams.has("access_token"),false);assert.equal(init.headers.Authorization,"Bearer server-secret");return {data:url.pathname.endsWith("targetingvalidation")?{data:JSON.parse(url.searchParams.get("targeting_list")).map(row=>({...row,valid:!invalidTargeting}))}:await graph(url)};}},
    "@/lib/adAudience":audience,"@/lib/adAdvantage":{applyAdvantagePlacements},"@/lib/adTemplateBlueprint":{templateBlueprintFromSettings},"@/lib/facebook":{fetchAdTemplateBlueprint:async()=>{throw new Error("should use saved template");}}};
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(new URL("../lib/adAudienceServer.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("module","exports","require",code)(module,module.exports,name=>{assert.ok(name in mocks,name);return mocks[name];});
  return {...module.exports,calls};
}
test("server verifies shared custom audiences on target account, preserves template exclusions and caches", async()=>{
  const f=serverFixture({templateAccount:"act_2",graph:url=>url.pathname.endsWith("customaudiences")?{data:[{id:"12",name:"Shared",delivery_status:{code:200}},{id:"13",name:"Excluded"}]}:{data:[]}});
  const snap=await f.resolvePostAdAudience("template","act_1",defaults,true,18);
  assert.deepEqual(snap.targeting.custom_audiences,[option("12")]);
  assert.equal(f.calls.length,3);
  await f.resolvePostAdAudience("template","act_1",defaults,true,18);assert.equal(f.calls.length,3);
  const sent=JSON.parse(f.calls.at(-1).searchParams.get("targeting_spec"));assert.deepEqual(sent.age_range,[20,48]);assert.deepEqual(sent.genders,[2]);
});
test("inaccessible cross-account audience fails before any estimate or mutation, never drops ID", async()=>{
  const f=serverFixture({templateAccount:"act_2",graph:()=>({data:[]})});
  await assert.rejects(f.resolvePostAdAudience("template","act_1",defaults,true,18),/không được dùng tệp/);
  assert.equal(f.calls.length,2);assert.ok(f.calls[1].pathname.endsWith("customaudiences"));
});
test("invalid targeting IDs fail explicit validation even when estimates would accept them",async()=>{
  const f=serverFixture({invalidTargeting:true,graph:()=>({data:[]})});
  await assert.rejects(f.resolvePostAdAudience("t","act_1",{...defaults,mode:"custom",interests:[option("999")]},true,18),/hết hiệu lực/);
  assert.equal(f.calls.length,1);assert.ok(f.calls[0].pathname.endsWith("targetingvalidation"));
});
test("legacy absent config and disabled Audience make no lookup; wrong hard min fails before lookup", async()=>{
  const f=serverFixture({graph:()=>{throw new Error("unexpected request");}});
  assert.equal(await f.resolvePostAdAudience("t","act_1",undefined,true,18),null);
  assert.equal(await f.resolvePostAdAudience("t","act_1",defaults,false,18),null);
  await assert.rejects(f.resolvePostAdAudience("t","act_1",defaults,true,30),/18 đến 25/);assert.equal(f.calls.length,0);
  assert.deepEqual(await f.audienceOptionsForAccount({accountId:"act_1",kind:"interest",query:""}),{options:[],nextCursor:null});
  assert.equal(f.calls.length,0,"empty remote search must not send a q-required error to Meta");
});
test("options pagination stays server-side, quota is retryable, permission errors are explicit", async()=>{
  const f=serverFixture({graph:()=>({data:[option("1")],paging:{next:"https://evil.invalid/?access_token=secret",cursors:{after:"page2"}}})});
  const result=await f.audienceOptionsForAccount({accountId:"act_1",kind:"interest",cursor:"page1"});
  assert.deepEqual(result,{options:[option("1")],nextCursor:"page2"});assert.equal(f.calls[0].searchParams.get("after"),"page1");
  await f.audienceOptionsForAccount({accountId:"act_1",kind:"interest",cursor:"page1"});assert.equal(f.calls.length,1);
  for(const category of ["rate_limit","transient","permission","token"]){
    const error=new MetaApiError(category);const broken=serverFixture({graph:()=>{throw error;}});
    await assert.rejects(broken.audienceOptionsForAccount({accountId:"act_1",kind:"interest",query:"mua sắm"}),cause=>["rate_limit","transient"].includes(category)?cause===error:cause instanceof audience.AdAudienceConfigurationError);
  }
});
test("custom audience search includes later Meta pages and paginates the filtered catalog",async()=>{
  const f=serverFixture({graph:url=>url.searchParams.has("after")?{data:[{id:"99",name:"Lookalike second page",subtype:"LOOKALIKE"}]}:{data:Array.from({length:30},(_,i)=>option(String(i+1))),paging:{next:"https://ignored",cursors:{after:"next"}}}});
  const page=await f.audienceOptionsForAccount({accountId:"act_1",kind:"custom"});assert.equal(page.options.length,25);assert.equal(page.nextCursor,"25");
  const more=await f.audienceOptionsForAccount({accountId:"act_1",kind:"custom",cursor:page.nextCursor});assert.equal(more.options.length,6);
  const found=await f.audienceOptionsForAccount({accountId:"act_1",kind:"custom",query:"lookalike"});assert.equal(found.options[0].id,"99");assert.equal(f.calls.length,2);
});
test("snapshot mode stays correct when custom-empty and none produce identical targeting", async()=>{
  const f=serverFixture({targeting:{geo_locations:{countries:["VN"]}},graph:()=>({data:[]})});
  assert.equal((await f.resolvePostAdAudience("t","act_1",{...defaults,mode:"none"},true,18)).mode,"none");
  assert.equal((await f.resolvePostAdAudience("t","act_1",{...defaults,mode:"custom"},true,18)).mode,"custom");
});
test("all confirmation routes save a snapshot before publishing/enqueueing; retry reads Post not config",()=>{
  const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
  for(const file of ["app/api/posts/[id]/schedule/route.ts","app/api/posts/[id]/publish/route.ts","app/api/posts/[id]/queue-publish/route.ts","lib/existingPostAds.ts"]){
    const code=read(file);assert.match(code,/resolvePostAdAudience\(/);assert.match(code,/adAudienceSnapshot:/);
  }
  assert.match(read("lib/autoAdsRunner.ts"),/parseAudienceSnapshot\(postFull\?\.adAudienceSnapshot\)/);
  assert.match(read("app/api/posts/bulk-unschedule/route.ts"),/adAudienceSnapshot: Prisma.DbNull/);
  assert.match(read("lib/existingPostAds.ts"),/adAudienceSnapshot: Prisma.DbNull/);
  for(const file of ["components/BatchImportClient.tsx","components/DashboardClient.tsx"]){assert.match(read(file),/batchAudienceSuggestions/);assert.match(read(file),/adAudienceSuggestions:/);}
  assert.match(read("components/AdsConfigPanel.tsx"),/audienceSuggestions: \{ \.\.\.DEFAULT_AUDIENCE_SUGGESTIONS \}/);
});

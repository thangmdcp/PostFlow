import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { META_GRAPH_API } from "@/lib/meta";
import { MetaApiError, metaRequestJson } from "@/lib/metaApiClient";
import { templateBlueprintFromSettings } from "@/lib/adTemplateBlueprint";
import { fetchAdTemplateBlueprint } from "@/lib/facebook";
import { applyAdvantagePlacements } from "@/lib/adAdvantage";
import { AdAudienceConfigurationError, applyAudienceSnapshot, parseAudienceSuggestions, resolveAudienceSnapshot, validateAudienceMinimum, type AdAudienceSnapshot, type AudienceOption } from "@/lib/adAudience";

type MetaList = {data?:Array<{id?:string;name?:string;type?:string;subtype?:string;valid?:boolean;delivery_status?:{code?:number;description?:string}}>;
  paging?:{next?:string;cursors?:{after?:string}}};
const cache=new Map<string,{until:number;value:unknown}>();
const inflight=new Map<string,Promise<unknown>>();
async function cached<T>(key:string,load:()=>Promise<T>):Promise<T> {
  const old=cache.get(key);if(old && old.until>Date.now())return old.value as T;
  if(inflight.has(key))return inflight.get(key) as Promise<T>;
  const promise=load().then(value=>{if(cache.size>=300)cache.delete(cache.keys().next().value!);cache.set(key,{until:Date.now()+300_000,value});return value;}).finally(()=>inflight.delete(key));
  inflight.set(key,promise);return promise;
}
async function account(accountId:string) {
  if(!/^act_\d+$/.test(accountId))throw new AdAudienceConfigurationError("TKQC không hợp lệ.");
  const row=await prisma.fbAdAccount.findUnique({where:{accountId},select:{accessToken:true}});
  if(!row?.accessToken)throw new AdAudienceConfigurationError("TKQC chưa kết nối hoặc thiếu quyền đọc đối tượng.");
  return row.accessToken;
}
function keyFor(...values:unknown[]){return createHash("sha256").update(JSON.stringify(values)).digest("hex");}
function searchText(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("vi").replace(/đ/g,"d");}
async function read<T>(accountId:string,token:string,path:string,query:Record<string,string>):Promise<T>{
  const url=new URL(`${META_GRAPH_API}/${path}`);Object.entries(query).forEach(([k,v])=>url.searchParams.set(k,v));
  try {return (await metaRequestJson<T>(url.toString(),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15_000),cache:"no-store"},{adAccountId:accountId.replace(/^act_/,"")})).data;}
  catch(error){
    if(error instanceof MetaApiError && !["rate_limit","transient"].includes(error.category))throw new AdAudienceConfigurationError(`Gợi ý đối tượng / ${accountId}: ${error.message}`);
    throw error;
  }
}
export async function audienceOptionsForAccount(input:{accountId:string;kind:string;query?:string;cursor?:string}) {
  const {accountId,kind}=input,token=await account(accountId);
  if(!["interest","behavior","custom"].includes(kind))throw new AdAudienceConfigurationError("Loại đối tượng không hợp lệ.");
  const query=(input.query??"").trim();const cursor=input.cursor??"";
  if(query.length>100 || cursor.length>2048)throw new AdAudienceConfigurationError("Từ khóa hoặc trang tìm kiếm quá dài.");
  if(kind!=="custom" && !query)return {options:[],nextCursor:null};
  if(kind==="behavior"){
    if(cursor && !/^\d{1,5}$/.test(cursor))throw new AdAudienceConfigurationError("Trang hành vi không hợp lệ.");
    const catalog=await cached(keyFor("behavior-catalog",accountId,token),async()=>{
      // Meta ignores q for behaviors. Read the complete taxonomy in both
      // languages, then perform deterministic search/pagination ourselves.
      const language=async(locale:string)=>{
        const rows:NonNullable<MetaList["data"]>=[];let after="";
        for(let page=0;page<20;page++){
          const result=await read<MetaList>(accountId,token,`${accountId}/targetingsearch`,{limit_type:"behaviors",q:"a",limit:"1000",locale,...(after?{after}:{})});
          rows.push(...(result.data??[]));
          const next=result.paging?.next?result.paging.cursors?.after:undefined;
          if(!next)return rows;
          if(next===after)throw new AdAudienceConfigurationError("Meta trả vòng lặp phân trang hành vi.");
          after=next;
        }
        throw new AdAudienceConfigurationError("Danh mục hành vi vượt giới hạn; không trả danh sách bị cắt.");
      };
      const [vi,en]=await Promise.all([language("vi_VN"),language("en_US")]);
      const names=new Map(en.filter(row=>row.id&&row.name).map(row=>[row.id!,row.name!]));
      const merged=new Map([...vi,...en].filter(row=>row.id&&row.name&&row.valid!==false).map(row=>[row.id!,row]));
      for(const row of vi)if(row.id&&row.name&&row.valid!==false)merged.set(row.id,row);
      return [...merged.values()].map(row=>({id:row.id!,name:row.name!,alias:names.get(row.id!)??""}));
    });
    const filtered=catalog.filter(row=>searchText(`${row.name} ${row.alias}`).includes(searchText(query))),offset=Number(cursor||0);
    return {options:filtered.slice(offset,offset+25).map(row=>({id:row.id,name:row.name})),nextCursor:offset+25<filtered.length?String(offset+25):null};
  }
  if(kind==="custom") {
    if(cursor && !/^\d{1,5}$/.test(cursor))throw new AdAudienceConfigurationError("Trang tệp đối tượng không hợp lệ.");
    // Meta does not expose name search on this edge. Cache the account's catalog
    // so searching includes every page, then paginate the safe filtered list.
    const all=await cached(keyFor("custom-catalog",accountId,token),async()=>{
      const rows:NonNullable<MetaList["data"]>=[];let after="";
      for(let page=0;page<100;page++){
        const result=await read<MetaList>(accountId,token,`${accountId}/customaudiences`,{fields:"id,name,subtype,delivery_status",limit:"100",...(after?{after}:{})});
        rows.push(...(result.data??[]));
        const next=result.paging?.next?result.paging.cursors?.after:undefined;
        if(!next)return rows;
        if(next===after)throw new AdAudienceConfigurationError("Meta trả vòng lặp phân trang tệp đối tượng. Hãy thử lại.");
        after=next;
      }
      throw new AdAudienceConfigurationError("Danh sách tệp vượt giới hạn truy vấn an toàn; không trả danh sách bị cắt.");
    });
    const term=searchText(query),offset=Number(cursor||0);
    const filtered=all.filter(row=>row.id&&row.name&&row.valid!==false&&(!term||searchText(row.name).includes(term)));
    return {options:filtered.slice(offset,offset+25).map(row=>({id:row.id!,name:row.name!,...(row.subtype?{subtype:row.subtype}:{}),
      ...(row.delivery_status?.code!=null && row.delivery_status.code!==200?{disabled:true,reason:row.delivery_status.description||"Meta chưa cho phép phân phối"}:{})})),nextCursor:offset+25<filtered.length?String(offset+25):null};
  }
  return cached(keyFor("options",accountId,token,kind,query,cursor),async()=>{
    const params:Record<string,string>={limit:"25",...(cursor?{after:cursor}:{})};
    Object.assign(params,{q:query,limit_type:kind==="interest"?"interests":"behaviors",locale:"vi_VN"});
    const result=await read<MetaList>(accountId,token,`${accountId}/targetingsearch`,params);
    return {options:(result.data??[]).filter(r=>r.id&&r.name&&r.valid!==false).map(r=>({id:r.id!,name:r.name!,...(r.subtype?{subtype:r.subtype}:{})})),
      nextCursor:result.paging?.next?result.paging.cursors?.after??null:null};
  });
}
async function verifyCustomAudiences(snapshot:AdAudienceSnapshot,token:string) {
  const requested=[...(snapshot.targeting.custom_audiences as AudienceOption[]??[]),...(snapshot.targeting.excluded_custom_audiences as AudienceOption[]??[])];
  if(!requested?.length)return;
  const remaining=new Set(requested.map(row=>row.id));let cursor="";
  for(let page=0;page<100 && remaining.size;page++) {
    const result=await read<MetaList>(snapshot.accountId,token,`${snapshot.accountId}/customaudiences`,{fields:"id,name,delivery_status",limit:"100",...(cursor?{after:cursor}:{})});
    for(const row of result.data??[])if(row.id && remaining.has(row.id)) {
      if(row.delivery_status?.code!=null && row.delivery_status.code!==200)throw new AdAudienceConfigurationError(`Tệp ${row.name||row.id} chưa dùng được: ${row.delivery_status.description||"Meta chưa cho phép phân phối"}.`);
      remaining.delete(row.id);
    }
    const next=result.paging?.next?result.paging.cursors?.after:undefined;
    if(!next || next===cursor)break;cursor=next;
  }
  if(remaining.size)throw new AdAudienceConfigurationError(`TKQC ${snapshot.accountId} không được dùng tệp ${[...remaining].join(", ")}. Chọn lại tệp của TKQC đích hoặc chọn Không dùng gợi ý.`);
}
async function verifyTargetingIds(snapshot:AdAudienceSnapshot,token:string) {
  const requested=new Map<string,{type:string;id:string}>();
  const skip=new Set(["custom_audiences","excluded_custom_audiences","connections","excluded_connections","friends_of_connections","dynamic_audience_ids"]);
  const collect=(node:Record<string,unknown>)=>{
    for(const [type,value] of Object.entries(node)){
      if(type==="flexible_spec" && Array.isArray(value))for(const group of value)collect(group as Record<string,unknown>);
      else if(type==="exclusions" && value && typeof value==="object")collect(value as Record<string,unknown>);
      else if(!skip.has(type) && Array.isArray(value))for(const row of value){
        if(row && typeof row==="object" && "id" in row){
          const id=String(row.id);
          if(!/^\d+$/.test(id))throw new AdAudienceConfigurationError("ID targeting trong template không hợp lệ.");
          requested.set(`${type}:${id}`,{type,id});
        }
      }
    }
  };
  collect(snapshot.targeting);
  if(!requested.size)return;
  const list=[...requested.values()];
  await cached(keyFor("validate-ids",snapshot.accountId,token,list),async()=>{
    // delivery_estimate can silently ignore invalid IDs; require explicit valid=true.
    for(let offset=0;offset<list.length;offset+=50){
      const batch=list.slice(offset,offset+50);
      const result=await read<MetaList>(snapshot.accountId,token,`${snapshot.accountId}/targetingvalidation`,{targeting_list:JSON.stringify(batch)});
      for(const option of batch){
        const found=result.data?.find(row=>row.id===option.id && (!row.type||row.type===option.type));
        if(found?.valid!==true)throw new AdAudienceConfigurationError(`Gợi ý ${option.type} ${option.id} đã hết hiệu lực hoặc TKQC ${snapshot.accountId} không được sử dụng. Hãy chọn lại.`);
      }
    }
    return true;
  });
}
export async function resolvePostAdAudience(templateId:string|undefined,accountId:string|undefined,value:unknown,audienceEnabled:boolean,ageMin:number|undefined):Promise<AdAudienceSnapshot|null> {
  if(value===undefined || !templateId || !audienceEnabled)return null;
  if(!accountId)throw new AdAudienceConfigurationError("Phải chọn TKQC trước khi lưu gợi ý đối tượng.");
  if(ageMin===undefined)throw new AdAudienceConfigurationError("Chưa chọn tuổi tối thiểu bắt buộc cho Audience.");
  validateAudienceMinimum(ageMin);
  const config=parseAudienceSuggestions(value),token=await account(accountId);
  const template=await prisma.campaignTemplate.findFirst({where:{campaignId:templateId},select:{settings:true,adAccountId:true}});
  if(!template)throw new AdAudienceConfigurationError("Không tìm thấy template của gợi ý đối tượng.");
  let blueprint=templateBlueprintFromSettings(template.settings);
  if(!blueprint){if(template.adAccountId!==accountId)throw new AdAudienceConfigurationError("Template thiếu snapshot; quét và lưu lại trước khi dùng chéo TKQC.");blueprint=await fetchAdTemplateBlueprint(templateId,token);}
  const snapshot=resolveAudienceSnapshot(config,accountId,blueprint.targeting);
  // Validate original account-bound inclusions, BEFORE portability strips them.
  // A shared audience may be used; an inaccessible one must never disappear.
  // This endpoint validates audiences, not stale template placements. The clone
  // applies the independently validated manual/automatic placement snapshot.
  const targeting=applyAdvantagePlacements(applyAudienceSnapshot({...blueprint.targeting,age_min:ageMin},snapshot,accountId));
  return cached(keyFor("snapshot",accountId,token,snapshot,targeting,blueprint.optimizationGoal),async()=>{
    await verifyTargetingIds(snapshot,token);
    await verifyCustomAudiences(snapshot,token);
    await read(accountId,token,`${accountId}/delivery_estimate`,{targeting_spec:JSON.stringify(targeting),optimization_goal:blueprint!.optimizationGoal});
    return snapshot;
  });
}

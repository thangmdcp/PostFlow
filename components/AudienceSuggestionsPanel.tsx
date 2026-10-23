"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { DEFAULT_AUDIENCE_SUGGESTIONS, resolveAudienceSnapshot, type AudienceOption, type BatchAudienceSuggestions } from "@/lib/adAudience";
import { templateBlueprintFromSettings } from "@/lib/adTemplateBlueprint";
type AvailableAudienceOption = AudienceOption & {disabled?:boolean;reason?:string;subtype?:string};

function AudiencePicker({accountId,kind,value,onChange,label}:{accountId:string;kind:"interest"|"behavior"|"custom";value:AudienceOption[];onChange:(options:AudienceOption[])=>void;label:string}) {
  const [query,setQuery]=useState("");const [options,setOptions]=useState<AvailableAudienceOption[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const generation=useRef(0);const abort=useRef<AbortController|null>(null);
  const load=async(term:string,after?:string)=>{
    const own=++generation.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
    setBusy(true);setError("");
    if(!after){setOptions([]);setCursor(null);}
    try{
      const params=new URLSearchParams({accountId,kind,q:term,...(after?{cursor:after}:{})});
      const response=await fetch(`/api/ads/audience-options?${params}`,{signal:controller.signal});const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Không đọc được đối tượng");
      if(own===generation.current){setOptions(old=>after?[...old,...data.options.filter((r:AudienceOption)=>!old.some(x=>x.id===r.id))]:data.options);setCursor(data.nextCursor);}
    }catch(cause){if(!controller.signal.aborted && own===generation.current)setError(cause instanceof Error?cause.message:"Không đọc được đối tượng");}
    finally{if(own===generation.current)setBusy(false);}
  };
  useEffect(()=>{const timer=setTimeout(()=>load(query),300);return()=>{clearTimeout(timer);generation.current++;abort.current?.abort();};},[accountId,kind,query]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="space-y-1.5"><p className="text-[10px] font-medium text-slate-500">{label}</p>
    {kind!=="custom" && <p className="text-[10px] text-slate-400">Nhập từ khóa để tìm trên Meta.</p>}
    <CustomSelect ariaLabel={label} value="" placeholder={`Tìm/chọn ${label.toLowerCase()}`} options={options.filter(row=>!value.some(x=>x.id===row.id)).map(row=>({value:row.id,label:`${row.subtype==="LOOKALIKE"?"Lookalike · ":""}${row.name}${row.reason?` · ${row.reason}`:""}`,disabled:row.disabled}))}
      onSearchChange={setQuery} loading={busy} onLoadMore={cursor?()=>load(query,cursor):undefined}
      onChange={id=>{const option=options.find(row=>row.id===id);if(option && !option.disabled && value.length<50)onChange([...value,{id:option.id,name:option.name}]);}} />
    <div className="flex flex-wrap gap-1">{value.map(row=><span key={row.id} className="flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[10px] text-blue-700 dark:bg-blue-950"><span>{row.name}</span><button type="button" aria-label={`Bỏ ${row.name}`} onClick={()=>onChange(value.filter(x=>x.id!==row.id))}><X size={11}/></button></span>)}</div>
    {error && <p className="text-[10px] text-red-500" role="alert">{error} <button type="button" className="underline" onClick={()=>load(query)}>Thử lại</button></p>}
  </div>;
}

export function AudienceSuggestionsPanel({value,onChange,enabled,accounts,templates,rows,templateId}:{
  value?:BatchAudienceSuggestions;onChange:(config:BatchAudienceSuggestions)=>void;enabled:boolean;
  accounts:{accountId:string;name?:string|null}[];templates:{campaignId:string;templateName:string;settings?:Record<string,unknown>}[];
  rows:{accountId:string;templateId?:string}[];templateId:string;
}) {
  const config=value??DEFAULT_AUDIENCE_SUGGESTIONS;const patch=(next:Partial<BatchAudienceSuggestions>)=>onChange({...config,...next});
  const activeAccounts=accounts.filter(account=>rows.some(row=>row.accountId===account.accountId));
  const choices=activeAccounts.length?activeAccounts:accounts;
  const [selected,setSelected]=useState("");const accountId=choices.some(a=>a.accountId===selected)?selected:choices[0]?.accountId??"";
  const [customAge,setCustomAge]=useState(!!config.ageRange);
  useEffect(()=>{setCustomAge(!!value?.ageRange);},[value?.ageRange]);
  return <section className="rounded-lg border p-2.5 space-y-2" aria-label="Gợi ý đối tượng">
    <p className="text-[11px] font-semibold">Gợi ý đối tượng</p>
    <p className="text-[10px] text-slate-500">Meta có thể phân phối ngoài gợi ý; đây không phải giới hạn bắt buộc.</p>
    {!enabled && <p className="text-[10px] text-amber-600">Bật Advantage+ Audience để áp dụng. Lựa chọn được giữ khi tắt.</p>}
    <fieldset disabled={!enabled} className={`space-y-2 ${enabled?"":"opacity-50"}`}>
      <CustomSelect disabled={!enabled} ariaLabel="Chế độ gợi ý đối tượng" value={config.mode} onChange={mode=>patch({mode:mode as BatchAudienceSuggestions["mode"]})}
        options={[{value:"template",label:"Theo template"},{value:"custom",label:"Tự chọn"},{value:"none",label:"Không dùng gợi ý"}]} />
      {config.mode==="template" && <div className="space-y-2 text-[10px] text-slate-500">{(rows.length?rows:[{accountId,templateId}]).map((row,index)=>{
        const template=templates.find(t=>t.campaignId===(row.templateId||templateId));const blueprint=templateBlueprintFromSettings(template?.settings);
        let summary="Chưa có dữ liệu template. Hãy quét và lưu lại template.";
        try{if(blueprint){const seed=resolveAudienceSnapshot(DEFAULT_AUDIENCE_SUGGESTIONS,row.accountId,blueprint.targeting).targeting;
          const flexible=seed.flexible_spec as Array<Record<string,AudienceOption[]>>|undefined;
          const names=[...(seed.interests as AudienceOption[]??[]),...(seed.behaviors as AudienceOption[]??[]),...(flexible??[]).flatMap(g=>[...(g.interests??[]),...(g.behaviors??[])]),...(seed.custom_audiences as AudienceOption[]??[])].map(option=>option.name||option.id);
          summary=[seed.age_range?`Tuổi ${(seed.age_range as number[]).join("–")}${(seed.age_range as number[])[1]===65?"+":""}`:"Không gợi ý tuổi",Array.isArray(seed.genders)&&seed.genders.length===1?seed.genders[0]===1?"Nam":"Nữ":"Tất cả giới tính",...names].join(" · ");
        }}catch(error){summary=error instanceof Error?error.message:"Template không hợp lệ";}
        return <p key={row.accountId+index}><strong>{accounts.find(a=>a.accountId===row.accountId)?.name||row.accountId||"TKQC"} · {template?.templateName||"Chưa chọn template"}</strong><br/>{summary}</p>;
      })}</div>}
      {config.mode==="none" && <p className="text-[10px] text-slate-500">Không gửi gợi ý bao gồm. Giữ khu vực, ngôn ngữ, tuổi tối thiểu và các loại trừ.</p>}
      {config.mode==="custom" && <div className="space-y-3">
        <label className="flex items-center gap-2 text-[10px]"><input type="checkbox" checked={customAge} onChange={e=>{setCustomAge(e.target.checked);patch({ageRange:e.target.checked?[18,65]:null});}}/>Gợi ý khoảng tuổi</label>
        {customAge && <div className="flex items-center gap-2 text-xs"><input aria-label="Tuổi gợi ý từ" type="number" min={18} max={65} value={config.ageRange?.[0]??18} onChange={e=>patch({ageRange:[Number(e.target.value),config.ageRange?.[1]??65]})} className="w-20 rounded border bg-transparent p-1.5"/><span>–</span><input aria-label="Tuổi gợi ý đến" type="number" min={18} max={65} value={config.ageRange?.[1]??65} onChange={e=>patch({ageRange:[config.ageRange?.[0]??18,Number(e.target.value)]})} className="w-20 rounded border bg-transparent p-1.5"/><span className="text-[10px] text-slate-400">65 = 65+</span></div>}
        <CustomSelect disabled={!enabled} ariaLabel="Giới tính gợi ý" value={config.gender} onChange={gender=>patch({gender:gender as BatchAudienceSuggestions["gender"]})} options={[{value:"",label:"Tất cả giới tính"},{value:"1",label:"Nam"},{value:"2",label:"Nữ"}]} />
        {choices.length>1 && <CustomSelect disabled={!enabled} ariaLabel="TKQC tìm gợi ý" value={accountId} onChange={setSelected} options={choices.map(a=>({value:a.accountId,label:a.name||a.accountId}))}/>}
        {!accountId?<p className="text-[10px] text-amber-600">Chọn TKQC để tìm đối tượng.</p>:enabled && <>
          <AudiencePicker key={`interest-${accountId}`} accountId={accountId} kind="interest" label="Sở thích" value={config.interests} onChange={interests=>patch({interests})}/>
          <AudiencePicker key={`behavior-${accountId}`} accountId={accountId} kind="behavior" label="Hành vi" value={config.behaviors} onChange={behaviors=>patch({behaviors})}/>
          <p className="text-[10px] text-slate-400">Tuổi, giới tính, sở thích và hành vi dùng chung cho các bài. Tệp dưới đây chỉ dùng cho {choices.find(a=>a.accountId===accountId)?.name||accountId}.</p>
          <AudiencePicker key={`custom-${accountId}`} accountId={accountId} kind="custom" label="Tệp đối tượng có sẵn" value={config.customAudiencesByAccount[accountId]??[]} onChange={options=>patch({customAudiencesByAccount:{...config.customAudiencesByAccount,[accountId]:options}})}/>
        </>}
      </div>}
    </fieldset>
  </section>;
}

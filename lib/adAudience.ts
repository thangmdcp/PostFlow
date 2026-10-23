export type AudienceMode = "template" | "custom" | "none";
export interface AudienceOption { id: string; name: string; }
export interface BatchAudienceSuggestions {
  mode: AudienceMode;
  ageRange: [number, number] | null;
  gender: "" | "1" | "2";
  interests: AudienceOption[];
  behaviors: AudienceOption[];
  customAudiencesByAccount: Record<string, AudienceOption[]>;
}
export interface AdAudienceSnapshot {
  version: 1;
  mode: AudienceMode;
  accountId: string;
  targeting: Record<string, unknown>;
}
export const DEFAULT_AUDIENCE_SUGGESTIONS: BatchAudienceSuggestions = {
  mode: "template", ageRange: null, gender: "", interests: [], behaviors: [], customAudiencesByAccount: {},
};
export class AdAudienceConfigurationError extends Error {
  readonly code = "AD_AUDIENCE_INVALID";
  readonly status = 400;
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function audienceOptions(value: unknown): AudienceOption[] {
  if (!Array.isArray(value) || value.length > 50) throw new AdAudienceConfigurationError("Mỗi nhóm gợi ý tối đa 50 lựa chọn.");
  const result: AudienceOption[] = [];
  for (const item of value) {
    const row = object(item);
    if (!row || typeof row.id !== "string" || !/^\d+$/.test(row.id) || typeof row.name !== "string" || row.name.length > 300) throw new AdAudienceConfigurationError("ID hoặc tên gợi ý đối tượng không hợp lệ.");
    if (!result.some(option => option.id === row.id)) result.push({id:row.id,name:row.name});
  }
  return result;
}
export function parseAudienceSuggestions(value: unknown): BatchAudienceSuggestions {
  const row = object(value);
  if (!row) return {...DEFAULT_AUDIENCE_SUGGESTIONS, customAudiencesByAccount:{}};
  if (!["template","custom","none"].includes(String(row.mode))) throw new AdAudienceConfigurationError("Chế độ gợi ý đối tượng không hợp lệ.");
  let ageRange: [number,number] | null = null;
  if (row.ageRange != null) {
    if (!Array.isArray(row.ageRange) || row.ageRange.length !== 2 || row.ageRange.some(n=>!Number.isInteger(n) || Number(n)<18 || Number(n)>65) || row.ageRange[0]>row.ageRange[1]) throw new AdAudienceConfigurationError("Tuổi gợi ý phải từ 18 đến 65+, tuổi đầu không lớn hơn tuổi cuối.");
    ageRange = [row.ageRange[0],row.ageRange[1]];
  }
  if (row.gender != null && (typeof row.gender !== "string" || !["","1","2"].includes(row.gender))) throw new AdAudienceConfigurationError("Giới tính gợi ý không hợp lệ.");
  const accounts=object(row.customAudiencesByAccount) ?? {};
  if(Object.keys(accounts).length>100)throw new AdAudienceConfigurationError("Quá nhiều TKQC trong cấu hình gợi ý.");
  const customAudiencesByAccount:Record<string,AudienceOption[]>={};
  for(const [key,options] of Object.entries(accounts)) {
    if(!/^act_\d+$/.test(key))throw new AdAudienceConfigurationError("TKQC của tệp đối tượng không hợp lệ.");
    customAudiencesByAccount[key]=audienceOptions(options);
  }
  return {mode:row.mode as AudienceMode,ageRange,gender:(row.gender??"") as BatchAudienceSuggestions["gender"],
    interests:audienceOptions(row.interests??[]),behaviors:audienceOptions(row.behaviors??[]),customAudiencesByAccount};
}
/** Malformed legacy localStorage must not prevent opening a modal. */
export function storedAudienceSuggestions(value: unknown): BatchAudienceSuggestions {
  try { return parseAudienceSuggestions(typeof value === "string" ? JSON.parse(value) : value); }
  catch { return parseAudienceSuggestions(null); }
}
export const AUDIENCE_INCLUSION_KEYS = ["age_range","genders","flexible_spec","interests","behaviors","custom_audiences",
  "education_schools","education_majors","education_statuses","college_years","work_employers","work_positions","industries",
  "life_events","family_statuses","relationship_statuses","interested_in","generation","moms","income","net_worth",
  "home_ownership","home_type","home_value","household_composition","office_type","user_adclusters","dynamic_audience_ids",
  "connections","friends_of_connections"] as const;
export const AUDIENCE_EXCLUSION_KEYS = ["excluded_custom_audiences","excluded_connections","excluded_user_adclusters","exclusions"] as const;
export function resolveAudienceSnapshot(value: unknown, accountId: string, template: Record<string,unknown>): AdAudienceSnapshot {
  const config=parseAudienceSuggestions(value);
  const targeting:Record<string,unknown>={};
  for(const key of AUDIENCE_EXCLUSION_KEYS)if(template[key]!==undefined)targeting[key]=JSON.parse(JSON.stringify(template[key]));
  if(config.mode === "template") {
    for(const key of AUDIENCE_INCLUSION_KEYS)if(template[key]!==undefined)targeting[key]=JSON.parse(JSON.stringify(template[key]));
    if(!targeting.age_range && (template.age_min!=null || template.age_max!=null))targeting.age_range=[template.age_min??18,template.age_max??65];
    if(targeting.age_range)parseAudienceSuggestions({...DEFAULT_AUDIENCE_SUGGESTIONS,mode:"custom",ageRange:targeting.age_range});
    if(targeting.genders && (!Array.isArray(targeting.genders) || targeting.genders.some(g=>g!==1&&g!==2)))throw new AdAudienceConfigurationError("Template có giới tính gợi ý không hợp lệ.");
    if(Array.isArray(targeting.genders)){
      const genders=[...new Set(targeting.genders)];
      if(genders.length===1)targeting.genders=genders;else delete targeting.genders;
    }
  } else if(config.mode === "custom") {
    if(config.ageRange)targeting.age_range=config.ageRange;
    if(config.gender)targeting.genders=[Number(config.gender)];
    if(config.interests.length || config.behaviors.length)targeting.flexible_spec=[{
      ...(config.interests.length?{interests:config.interests}:{}),...(config.behaviors.length?{behaviors:config.behaviors}:{})}];
    const audiences=config.customAudiencesByAccount[accountId];
    if(audiences?.length)targeting.custom_audiences=audiences;
  }
  return {version:1,mode:config.mode,accountId,targeting};
}
export function parseAudienceSnapshot(value: unknown): AdAudienceSnapshot | null {
  if(value == null)return null;
  const row=object(value),targeting=object(row?.targeting);
  if(!row || row.version!==1 || !["template","custom","none"].includes(String(row.mode)) || typeof row.accountId!=="string" || !/^act_\d+$/.test(row.accountId) || !targeting
    || Object.keys(targeting).some(key=>![...AUDIENCE_INCLUSION_KEYS,...AUDIENCE_EXCLUSION_KEYS].includes(key as typeof AUDIENCE_INCLUSION_KEYS[number])))throw new AdAudienceConfigurationError("Snapshot gợi ý đối tượng không hợp lệ; không tự dùng lại template.");
  if(targeting.age_range!=null)parseAudienceSuggestions({...DEFAULT_AUDIENCE_SUGGESTIONS,ageRange:targeting.age_range});
  if(targeting.genders!=null && (!Array.isArray(targeting.genders)||targeting.genders.some(g=>g!==1&&g!==2)))throw new AdAudienceConfigurationError("Snapshot có giới tính gợi ý không hợp lệ.");
  const validateGroups=(node:Record<string,unknown>)=>{
    for(const key of ["interests","behaviors","custom_audiences","excluded_custom_audiences"]){
      const list=node[key];
      if(list!==undefined && (!Array.isArray(list)||list.some(item=>!object(item)||typeof item.id!=="string"||!/^\d+$/.test(item.id))))throw new AdAudienceConfigurationError("Snapshot chứa ID gợi ý không hợp lệ.");
    }
    if(node.flexible_spec!==undefined){
      if(!Array.isArray(node.flexible_spec)||node.flexible_spec.some(group=>!object(group)))throw new AdAudienceConfigurationError("Snapshot có nhóm gợi ý không hợp lệ.");
      for(const group of node.flexible_spec)validateGroups(group as Record<string,unknown>);
    }
  };
  validateGroups(targeting);
  return row as unknown as AdAudienceSnapshot;
}
export function validateAudienceMinimum(ageMin: number | undefined) {
  if(ageMin!==undefined && (!Number.isInteger(ageMin)||ageMin<18||ageMin>25))throw new AdAudienceConfigurationError("Advantage+ Audience: tuổi tối thiểu bắt buộc chỉ từ 18 đến 25. Hãy dùng khoảng tuổi gợi ý cho độ tuổi cao hơn.");
}
export function applyAudienceSnapshot(targeting: Record<string,unknown>,snapshot: AdAudienceSnapshot,accountId:string):Record<string,unknown> {
  if(snapshot.accountId!==`act_${accountId.replace(/^act_/,"")}`)throw new AdAudienceConfigurationError("TKQC không khớp snapshot gợi ý đối tượng.");
  validateAudienceMinimum(targeting.age_min as number|undefined);
  const next={...targeting};
  delete next.age_max;
  delete next.targeting_optimization;
  delete next.targeting_relaxation_types;
  for(const key of AUDIENCE_INCLUSION_KEYS)delete next[key];
  for(const key of AUDIENCE_EXCLUSION_KEYS)delete next[key];
  return {...next,...snapshot.targeting,targeting_automation:{...(object(next.targeting_automation)??{}),advantage_audience:1}};
}

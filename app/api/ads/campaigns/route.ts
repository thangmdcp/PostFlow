import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { META_GRAPH_API } from "@/lib/meta";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("adAccountId");
  const query = searchParams.get("query")?.trim().toLowerCase();

  if (!adAccountId) {
    return NextResponse.json({ error: "adAccountId required" }, { status: 400 });
  }

  const adAccount = await prisma.fbAdAccount.findUnique({ where: { accountId: adAccountId } });
  if (!adAccount) {
    return NextResponse.json({ error: "Ad account not found" }, { status: 404 });
  }

  const campaignFields = query
    ? "id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,spend_cap,bid_strategy,buying_type,start_time,stop_time,special_ad_categories,configured_status"
    : "id,name,status";
  const campaignUrl = new URL(`${META_GRAPH_API}/${adAccountId}/campaigns`);
  campaignUrl.searchParams.set("fields", campaignFields);
  campaignUrl.searchParams.set("limit", query ? "200" : "50");
  campaignUrl.searchParams.set("access_token", adAccount.accessToken);
  const res = await fetch(campaignUrl);
  const data = await res.json();
  if (data.error) {
    return NextResponse.json({ error: data.error.message }, { status: 400 });
  }

  if (!query) return NextResponse.json({ campaigns: data.data ?? [] });
  const campaign = (data.data ?? []).find((item: { name?: string }) => item.name?.toLowerCase().includes(query));
  if (!campaign) return NextResponse.json({ error: "Không tìm thấy campaign với tên này" }, { status: 404 });

  const adsetFields = [
    "id", "name", "status", "effective_status", "campaign_id", "optimization_goal", "billing_event", "bid_strategy", "bid_amount",
    "daily_budget", "lifetime_budget", "budget_remaining", "destination_type", "pacing_type", "attribution_spec", "promoted_object", "start_time", "end_time",
    "targeting{age_min,age_max,genders,geo_locations,locales,publisher_platforms,facebook_positions,instagram_positions,device_platforms,flexible_spec,exclusions,custom_audiences,excluded_custom_audiences,targeting_automation}",
  ].join(",");
  const adsetsUrl = new URL(`${META_GRAPH_API}/${campaign.id}/adsets`);
  adsetsUrl.searchParams.set("fields", adsetFields);
  adsetsUrl.searchParams.set("limit", "50");
  adsetsUrl.searchParams.set("access_token", adAccount.accessToken);
  const adsetsRes = await fetch(adsetsUrl);
  const adsetsData = await adsetsRes.json();
  if (adsetsData.error) return NextResponse.json({ error: adsetsData.error.message }, { status: 400 });
  const adsets = adsetsData.data ?? [];
  await Promise.all(adsets.map(async (adset: { id: string; ads?: unknown[] }) => {
    const adsUrl = new URL(`${META_GRAPH_API}/${adset.id}/ads`);
    adsUrl.searchParams.set("fields", "id,name,status,effective_status,creative{id,name,body,title,object_type,call_to_action_type,link_url,image_url,thumbnail_url,video_id,applink_treatment}");
    adsUrl.searchParams.set("limit", "20");
    adsUrl.searchParams.set("access_token", adAccount.accessToken);
    const adsData = await fetch(adsUrl).then((response) => response.json());
    adset.ads = adsData.data ?? [];
  }));
  return NextResponse.json({ campaign: { ...campaign, adsets } }, { headers: { "cache-control": "no-store" } });
}

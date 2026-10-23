import { NextResponse } from "next/server";
import { configureExistingAds, cancelExistingAds } from "@/lib/existingPostAds";
import { BudgetPolicyError } from "@/lib/adBudgetPolicy";
import { AdAudienceConfigurationError } from "@/lib/adAudience";
export const maxDuration = 300;
export async function POST(request: Request) {
  try { return NextResponse.json(await configureExistingAds(await request.json()), { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể cấu hình Ads.", ...(error instanceof BudgetPolicyError || error instanceof AdAudienceConfigurationError ? { code: error.code } : {}) }, { status: error instanceof BudgetPolicyError || error instanceof AdAudienceConfigurationError ? error.status : 409 }); }
}
export async function DELETE(request: Request) {
  try { return NextResponse.json({ count: await cancelExistingAds((await request.json()).postIds) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể hủy lịch." }, { status: 400 }); }
}

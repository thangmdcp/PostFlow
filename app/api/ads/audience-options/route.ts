import { NextResponse } from "next/server";
import { audienceOptionsForAccount } from "@/lib/adAudienceServer";
import { AdAudienceConfigurationError } from "@/lib/adAudience";
import { MetaApiError } from "@/lib/metaApiClient";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const q=new URL(request.url).searchParams;
    return NextResponse.json(await audienceOptionsForAccount({accountId:q.get("accountId")??"",kind:q.get("kind")??"",query:q.get("q")??"",cursor:q.get("cursor")??""}),{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const rate=error instanceof MetaApiError && error.category==="rate_limit";
    return NextResponse.json({error:rate?"Meta đang giới hạn truy vấn đối tượng. Hãy chờ rồi thử lại.":error instanceof Error?error.message:"Không đọc được đối tượng.",
      code:error instanceof AdAudienceConfigurationError?error.code:rate?"META_RATE_LIMIT":"AUDIENCE_LOOKUP_FAILED"},
      {status:error instanceof AdAudienceConfigurationError?400:rate?429:502,headers:rate?{"Retry-After":String(error.retryAfterSeconds??60)}:{}});
  }
}

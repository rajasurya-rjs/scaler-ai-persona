import { NextResponse } from "next/server";
import { indexMeta } from "@/lib/retriever";
import { calendarConfigured } from "@/lib/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quick liveness + config check. Hit /api/health after deploy to confirm the
// index loaded and which integrations are wired.
export async function GET() {
  try {
    const meta = indexMeta();
    return NextResponse.json({
      ok: true,
      persona: meta.name,
      github: meta.githubUsername,
      builtAt: meta.builtAt,
      embedModel: meta.embedModel,
      stats: meta.stats,
      calendarConfigured: calendarConfigured(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

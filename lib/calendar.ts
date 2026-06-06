// Real Google Calendar booking (free). Uses an OAuth2 refresh token minted once
// via `npm run get-google-token`. Two operations the agent calls as tools:
//   - getAvailability(): real free slots (freeBusy.query ∩ working hours)
//   - bookMeeting():      creates a real event + sends invites
//
// NOTE: this runs in the Next.js server runtime, where `new Date()` is fine.

import { google } from "googleapis";
import { env, envInt } from "./env";

export interface Slot {
  startISO: string;
  endISO: string;
  /** Human label in the booking timezone, e.g. "Tue, Jun 10, 2:30 PM IST". */
  label: string;
}

export interface BookResult {
  success: boolean;
  htmlLink?: string;
  startISO?: string;
  endISO?: string;
  error?: string;
}

function cfg() {
  return {
    calendarId: env("GOOGLE_CALENDAR_ID", "primary"),
    tz: env("BOOKING_TIMEZONE", "UTC"),
    durationMin: envInt("BOOKING_DURATION_MIN", 30),
    windowDays: envInt("BOOKING_WINDOW_DAYS", 14),
    workStart: env("BOOKING_WORK_START", "10:00"),
    workEnd: env("BOOKING_WORK_END", "18:00"),
    workDays: env("BOOKING_WORK_DAYS", "1,2,3,4,5").split(",").map((d) => parseInt(d.trim(), 10)),
    hostEmail: env("BOOKING_HOST_EMAIL"),
    leadMinutes: 120, // don't offer slots starting within 2h
  };
}

function oauthClient() {
  const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = env("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Calendar is not configured. Set GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN (run `npm run get-google-token`).",
    );
  }
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export function calendarConfigured(): boolean {
  return Boolean(
    env("GOOGLE_OAUTH_CLIENT_ID") &&
      env("GOOGLE_OAUTH_CLIENT_SECRET") &&
      env("GOOGLE_OAUTH_REFRESH_TOKEN"),
  );
}

// --- timezone helpers (no external tz lib) ----------------------------------

function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** Wall-clock time in `timeZone` → the corresponding UTC Date. */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - off);
}

function localParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string],
  };
}

function labelFor(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

// --- public API -------------------------------------------------------------

export async function getAvailability(limit = 5): Promise<Slot[]> {
  const c = cfg();
  const auth = oauthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const windowEnd = new Date(now.getTime() + c.windowDays * 86400_000);

  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: windowEnd.toISOString(),
      timeZone: c.tz,
      items: [{ id: c.calendarId }],
    },
  });
  const busy = (fb.data.calendars?.[c.calendarId]?.busy ?? []).map((b) => ({
    start: new Date(b.start as string).getTime(),
    end: new Date(b.end as string).getTime(),
  }));

  const [wsH, wsM] = c.workStart.split(":").map(Number);
  const [weH, weM] = c.workEnd.split(":").map(Number);
  const earliest = now.getTime() + c.leadMinutes * 60_000;

  const slots: Slot[] = [];
  for (let dayOffset = 0; dayOffset <= c.windowDays && slots.length < limit; dayOffset++) {
    const dayProbe = new Date(now.getTime() + dayOffset * 86400_000);
    const lp = localParts(dayProbe, c.tz);
    if (!c.workDays.includes(lp.weekday)) continue;

    // Walk slot start times across the working window for this local day.
    let h = wsH;
    let mi = wsM;
    while (h < weH || (h === weH && mi < weM)) {
      const start = zonedToUtc(lp.year, lp.month, lp.day, h, mi, c.tz);
      const end = new Date(start.getTime() + c.durationMin * 60_000);

      const endLocal = zonedToUtc(lp.year, lp.month, lp.day, weH, weM, c.tz);
      const fitsDay = end.getTime() <= endLocal.getTime();
      const farEnough = start.getTime() >= earliest;
      const free = !busy.some((b) => start.getTime() < b.end && end.getTime() > b.start);

      if (fitsDay && farEnough && free) {
        slots.push({ startISO: start.toISOString(), endISO: end.toISOString(), label: labelFor(start, c.tz) });
        if (slots.length >= limit) break;
      }

      mi += c.durationMin;
      while (mi >= 60) {
        mi -= 60;
        h += 1;
      }
    }
  }
  return slots;
}

export async function bookMeeting(args: {
  startISO: string;
  attendeeName: string;
  attendeeEmail: string;
  notes?: string;
}): Promise<BookResult> {
  const c = cfg();
  try {
    // --- Guard against bad tool args (esp. from voice, where the model may fill
    //     the schema's example values or guess a date instead of asking). ---
    const email = (args.attendeeEmail ?? "").trim();
    const emailValid =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      !/example\.(com|org|net)$/i.test(email) &&
      !/your\.?email|name@|test@/i.test(email);
    if (!emailValid) {
      return {
        success: false,
        error:
          "I don't have a valid email for the invite yet. Ask the caller for their real email and read it back to confirm the spelling, then book.",
      };
    }
    const name = (args.attendeeName ?? "").trim();
    if (!name || /^your name$/i.test(name)) {
      return { success: false, error: "I still need the caller's real name before booking — please ask for it." };
    }

    const start = new Date(args.startISO);
    if (isNaN(start.getTime()) || start.getTime() < Date.now()) {
      return {
        success: false,
        error:
          "That start time is invalid or in the past. Call get_availability again and book using the EXACT startISO value it returns — do not construct the date yourself.",
      };
    }
    const end = new Date(start.getTime() + c.durationMin * 60_000);

    const auth = oauthClient();
    const calendar = google.calendar({ version: "v3", auth });

    // Guard: re-check the slot is still free (avoid double-booking races).
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: c.calendarId }],
      },
    });
    const stillBusy = (fb.data.calendars?.[c.calendarId]?.busy ?? []).length > 0;
    if (stillBusy) {
      return { success: false, error: "That slot was just taken — let me offer another time." };
    }

    const attendees = [{ email: args.attendeeEmail, displayName: args.attendeeName }];
    if (c.hostEmail) attendees.push({ email: c.hostEmail, displayName: "Host" });

    const res = await calendar.events.insert({
      calendarId: c.calendarId,
      sendUpdates: "all",
      requestBody: {
        summary: `Interview: ${args.attendeeName} ↔ ${env("PERSONA_NAME", "Candidate")}`,
        description:
          `Scheduled via AI persona chat/voice agent.\n\n` +
          (args.notes ? `Notes: ${args.notes}\n` : ""),
        start: { dateTime: start.toISOString(), timeZone: c.tz },
        end: { dateTime: end.toISOString(), timeZone: c.tz },
        attendees,
      },
    });

    return {
      success: true,
      htmlLink: res.data.htmlLink ?? undefined,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

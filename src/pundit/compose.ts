import type { PunditEvent } from "./events.js";

export interface Teams {
  p1: string;
  p2: string;
}

export type ProbPhrasingHint =
  | "both_probs"
  | "dominant_tighten"
  | "long_shot_comeback"
  | "dominant_celebrate"
  | "single_after"
  | "move_swing"
  | "none";

/** Fast Anthropic model — override via ANTHROPIC_MODEL env. */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function probDelta(ev: PunditEvent): number {
  return (ev.probAfter ?? 0) - (ev.probBefore ?? 0);
}

export function probPhrasingHint(ev: PunditEvent): ProbPhrasingHint {
  const before = ev.probBefore ?? 0;
  const after = ev.probAfter ?? 0;
  const delta = after - before;

  if (ev.kind === "move") {
    if (before === after) return "none";
    return Math.abs(delta) >= 4 ? "move_swing" : "move_swing";
  }

  if (ev.kind === "red") {
    if (before === after) return "single_after";
    if (Math.abs(delta) >= 4) return "both_probs";
    if (after >= 85) return "dominant_tighten";
    return "single_after";
  }

  if (ev.kind === "goal") {
    if (before === after) {
      if (after <= 15) return "long_shot_comeback";
      return "dominant_celebrate";
    }
    if (Math.abs(delta) >= 4) return "both_probs";
    if (after >= 85) return "dominant_tighten";
    if (after <= 15) return "long_shot_comeback";
    return "dominant_celebrate";
  }

  return "none";
}

const variantIdx = {
  both_probs: 0,
  dominant_tighten: 0,
  long_shot_comeback: 0,
  dominant_celebrate: 0,
};

function pickVariant(
  key: keyof typeof variantIdx,
  variants: string[],
): string {
  const line = variants[variantIdx[key] % variants.length]!;
  variantIdx[key] += 1;
  return line;
}

function templateFallback(ev: PunditEvent, teams: Teams): string {
  const min = `${ev.matchMin}'`;
  const s1 = ev.scoreP1;
  const s2 = ev.scoreP2;

  switch (ev.kind) {
    case "kickoff":
      return `🏟️ ${teams.p1} vs ${teams.p2} is under way! I'll ping you the moment anything happens.`;
    case "goal": {
      const scorer = ev.teamName ?? "They";
      const before = ev.probBefore ?? 0;
      const after = ev.probAfter ?? 0;
      const hint = probPhrasingHint(ev);
      switch (hint) {
        case "both_probs":
          return pickVariant("both_probs", [
              `⚽ GOAL! ${scorer} make it ${s1}-${s2} (${min}). ${scorer} now ${after}% to win (was ${before}%).`,
              `⚽ ${scorer} score! ${s1}-${s2} at ${min} — the market now gives them ${after}% (was ${before}%).`,
              `⚽ It's ${s1}-${s2} to ${scorer} (${min})! Win chance jumps to ${after}% from ${before}%.`,
            ]);
        case "dominant_tighten":
          return pickVariant("dominant_tighten", [
              `⚽ GOAL! ${scorer} tighten their grip — ${s1}-${s2} at ${min}. ${after}% to win.`,
              `⚽ ${scorer} pad the lead — ${s1}-${s2} (${min}). Now ${after}% to win.`,
            ]);
        case "long_shot_comeback":
          return pickVariant("long_shot_comeback", [
              `⚽ ${scorer} pull one back — ${s1}-${s2}! Still an uphill climb at ${min}.`,
              `⚽ ${scorer} give themselves a lifeline — ${s1}-${s2} at ${min}!`,
              `⚽ Hope for ${scorer}! ${s1}-${s2} at ${min} but plenty still to do.`,
            ]);
        case "dominant_celebrate":
          return pickVariant("dominant_celebrate", [
              `⚽ ${scorer} turn the screw — ${s1}-${s2} (${min})!`,
              `⚽ Another one! ${scorer} stretch it to ${s1}-${s2} (${min}).`,
              `⚽ ${scorer} are running away with it — ${s1}-${s2} at ${min}.`,
              `⚽ ${scorer} again! ${s1}-${s2} and cruising (${min}).`,
            ]);
        default:
          return `⚽ GOAL! ${scorer} make it ${s1}-${s2} (${min}).`;
      }
    }
    case "red": {
      const carded = ev.teamName ?? "A team";
      const benef = ev.probTeam ?? "Their opponents";
      const before = ev.probBefore ?? 0;
      const after = ev.probAfter ?? 0;
      const hint = probPhrasingHint(ev);
      if (hint === "both_probs") {
        return `🟥 Red card! ${carded} are down to 10 men (${min}). ${benef} now ${after}% to win (was ${before}%).`;
      }
      if (hint === "dominant_tighten") {
        return `🟥 Red card! ${carded} down to 10 (${min}). ${benef} tighten their grip — ${after}% to win.`;
      }
      return `🟥 Red card! ${carded} are down to 10 men (${min}). ${benef} now ${after}% to win.`;
    }
    case "move": {
      const team = ev.teamName ?? "One side";
      const before = ev.probBefore ?? 0;
      const after = ev.probAfter ?? 0;
      if (before === after) {
        return `📈 Something's shifting (${min}) — keep an eye on ${team}, no goal yet.`;
      }
      return `📈 Big swing (${min}) — the market has turned toward ${team}: ${before}% → ${after}%, no goal yet.`;
    }
    case "fulltime":
      return `🏁 Full time: ${teams.p1} ${s1}-${s2} ${teams.p2}.`;
  }
}

function eventFacts(ev: PunditEvent, teams: Teams): Record<string, unknown> {
  const delta = probDelta(ev);
  return {
    kind: ev.kind,
    p1: teams.p1,
    p2: teams.p2,
    score: `${ev.scoreP1}-${ev.scoreP2}`,
    minute: ev.matchMin,
    featuredTeam: ev.teamName ?? ev.probTeam,
    probTeam: ev.probTeam,
    probBeforePct: ev.probBefore,
    probAfterPct: ev.probAfter,
    probDeltaPctPoints: delta,
    phrasingHint: probPhrasingHint(ev),
    magnitudePctPoints: ev.magnitude,
  };
}

async function composeWithLlm(
  ev: PunditEvent,
  teams: Teams,
  apiKey: string,
): Promise<string | null> {
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      system:
        "You are an excited but concise football commentator messaging a fan during a live match. " +
        "1-2 short sentences. Plain language, NO betting jargon, NO decimals. Express chances as a " +
        "whole percentage. You may use ONE emoji. Never mention odds, fair value, or markets as math — " +
        "say 'the market now gives X an N% chance' in human terms. " +
        "NEVER cite a probability that did not meaningfully change (probBefore equals probAfter). " +
        "NEVER say 'N% to win — up from N%'. Follow phrasingHint in the user JSON: " +
        "both_probs = cite before and after; dominant_tighten = after% only, team already favoured; " +
        "long_shot_comeback = lead with the goal/score, NO win% (underdog); " +
        "dominant_celebrate = celebrate score only, skip redundant win%.",
      messages: [
        {
          role: "user",
          content: JSON.stringify(eventFacts(ev, teams)),
        },
      ],
    }),
  });

  if (!res.ok) return null;
  const body = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = body.content?.find((c) => c.type === "text")?.text?.trim();
  return text || null;
}

export async function composeAlert(
  ev: PunditEvent,
  teams: Teams,
): Promise<{ text: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    try {
      const llm = await composeWithLlm(ev, teams, apiKey);
      if (llm) return { text: llm };
    } catch {
      // fall through to template
    }
  }
  return { text: templateFallback(ev, teams) };
}

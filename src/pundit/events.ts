import { EventEmitter } from "node:events";
import type { FeedEvent, OddsPayload, ScorePayload } from "../types.js";
import type { FeedSource } from "../feed/feedSource.js";
import { FairBook } from "../engine/fairBook.js";
import { marketKeyFromParts, type Outcome } from "../engine/types.js";
import { deriveFairLines } from "../util/fairValue.js";

export const KEY_1X2 = marketKeyFromParts("1X2_PARTICIPANT_RESULT", "FT", null);

export type PunditEventKind = "kickoff" | "goal" | "red" | "move" | "fulltime";

export interface PunditEvent {
  kind: PunditEventKind;
  matchMin: number;
  scoreP1: number;
  scoreP2: number;
  teamName?: string;
  probTeam?: string;
  probBefore?: number;
  probAfter?: number;
  magnitude?: number;
}

export interface PunditDetectorConfig {
  moveThreshold: number;
  moveCooldownMs: number;
  settleDelayMs: number;
  goalRedSuppressMs: number;
}

export const DEFAULT_PUNDIT_DETECTOR_CONFIG: PunditDetectorConfig = {
  moveThreshold: 0.08,
  moveCooldownMs: 120_000,
  settleDelayMs: 15_000,
  goalRedSuppressMs: 90_000,
};

interface FairSnapshot {
  ts: number;
  part1: number;
  part2: number;
  draw: number;
}

interface PendingSettle {
  kind: "goal" | "red";
  detectTs: number;
  effectiveEmitTs: number;
  matchMin: number;
  scoreP1: number;
  scoreP2: number;
  teamName: string;
  probTeam: string;
  featuredOutcome: "part1" | "part2";
  probBefore?: number;
}

function statVal(stats: Record<string, number>, k: number): number {
  const v = stats[String(k)] ?? stats[k];
  return typeof v === "number" ? v : 0;
}

function statsFrom(data: ScorePayload): Record<string, number> {
  return (data.Stats as Record<string, number> | undefined) ?? {};
}

export function matchMs(ts: number, startMs: number): number {
  return Math.max(0, ts - startMs);
}

export function matchMin(ts: number, startMs: number): number {
  return Math.floor(matchMs(ts, startMs) / 60_000);
}

export function winProbPct(fair: number): number {
  return Math.round(fair * 100);
}

export class PunditEventDetector extends EventEmitter {
  private readonly fairBook = new FairBook();
  private readonly cfg: PunditDetectorConfig;
  private startMs = 0;
  private teams = { p1: "Team 1", p2: "Team 2" };

  private prevG1 = 0;
  private prevG2 = 0;
  private prevRedP1 = 0;
  private prevRedP2 = 0;

  private kickoffEmitted = false;
  private fulltimeEmitted = false;
  private lastAlertMatchMs = Number.NEGATIVE_INFINITY;
  private goalRedMatchTimes: number[] = [];
  private pending: PendingSettle[] = [];
  private currentMatchMs = 0;
  private currentEventTs = 0;
  private finalScore = { g1: 0, g2: 0 };
  private readonly fairHistory: FairSnapshot[] = [];
  /** Goal scorelines already emitted or pending — suppress score-feed echoes. */
  private readonly alertedScorelines = new Set<string>();

  /** Pre-index goal/red score timestamps so move alerts suppress before same-ts score events. */
  preloadScoreIncrements(scores: ScorePayload[], startMs: number): void {
    let g1 = 0;
    let g2 = 0;
    let redP1 = 0;
    let redP2 = 0;
    const sorted = [...scores].sort(
      (a, b) => (a.Ts ?? a.ts ?? 0) - (b.Ts ?? b.ts ?? 0),
    );
    for (const row of sorted) {
      const ts = typeof row.Ts === "number" ? row.Ts : typeof row.ts === "number" ? row.ts : startMs;
      if (ts < startMs) continue;
      const stats = statsFrom(row);
      const ng1 = statVal(stats, 1);
      const ng2 = statVal(stats, 2);
      const nredP1 = statVal(stats, 5);
      const nredP2 = statVal(stats, 6);
      if (ng1 > g1 || ng2 > g2 || nredP1 > redP1 || nredP2 > redP2) {
        this.goalRedMatchTimes.push(matchMs(ts, startMs));
      }
      g1 = ng1;
      g2 = ng2;
      redP1 = nredP1;
      redP2 = nredP2;
    }
  }

  constructor(cfg: Partial<PunditDetectorConfig> = {}) {
    super();
    this.cfg = { ...DEFAULT_PUNDIT_DETECTOR_CONFIG, ...cfg };
  }

  setStartMs(startMs: number): void {
    this.startMs = startMs;
    this.fairBook.setStartMs(startMs);
  }

  setTeams(p1: string, p2: string): void {
    this.teams = { p1, p2 };
  }

  attach(feed: FeedSource): void {
    feed.on("event", (e) => this.onFeedEvent(e));
    feed.on("end", () => this.onFeedEnd());
  }

  private teamForOutcome(outcome: "part1" | "part2"): string {
    return outcome === "part1" ? this.teams.p1 : this.teams.p2;
  }

  private readWinPct(outcome: Outcome): number {
    const m = this.fairBook.getMarket(KEY_1X2);
    if (!m) return 0;
    return winProbPct(m.fairProb[outcome] ?? 0);
  }

  private recordFairFromOdds(data: OddsPayload, ts: number): void {
    if (data.SuperOddsType !== "1X2_PARTICIPANT_RESULT" || !data.InRunning) return;
    const line = deriveFairLines(data);
    const part1 = line.outcomes.find((o) => o.name === "part1")?.fairProb ?? 0;
    const part2 = line.outcomes.find((o) => o.name === "part2")?.fairProb ?? 0;
    const draw = line.outcomes.find((o) => o.name === "draw")?.fairProb ?? 0;
    if (part1 + part2 + draw < 0.05) return;
    this.fairHistory.push({ ts, part1, part2, draw });
    if (this.fairHistory.length > 8000) this.fairHistory.shift();
  }

  private rawForOutcome(s: FairSnapshot, outcome: Outcome): number {
    if (outcome === "part1") return s.part1;
    if (outcome === "part2") return s.part2;
    return s.draw;
  }

  /**
   * Pre-reprice win %: if odds at detectTs already jumped, use prevFairProb from that tick;
   * else last valid 1X2 fair strictly before detectTs.
   */
  private readPreGoalFair(outcome: Outcome, detectTs: number): number {
    const windowStart = detectTs - 120_000;
    let minRaw = Infinity;
    for (const snap of this.fairHistory) {
      if (snap.ts >= detectTs || snap.ts < windowStart) continue;
      const raw = this.rawForOutcome(snap, outcome);
      if (raw >= 0.05 && raw <= 0.95) minRaw = Math.min(minRaw, raw);
    }
    if (minRaw === Infinity) {
      const detectMs = matchMs(detectTs, this.startMs);
      for (let back = 1_000; back <= 120_000; back += 1_000) {
        const fair = this.fairBook.fairAsOf(KEY_1X2, Math.max(0, detectMs - back));
        if (!fair) continue;
        const raw = fair[outcome] ?? 0;
        if (raw >= 0.05 && raw <= 0.95) minRaw = Math.min(minRaw, raw);
      }
    }
    if (minRaw === Infinity) return this.readWinPctBeforeSettle(outcome, detectTs);
    return winProbPct(minRaw);
  }

  private readWinPctBeforeSettle(
    outcome: Outcome,
    detectTs: number,
  ): number {
    const m = this.fairBook.getMarket(KEY_1X2);
    if (m && m.lastTs === detectTs) {
      const prev = m.prevFairProb[outcome] ?? 0;
      if (prev >= 0.001) return winProbPct(prev);
    }
    for (let i = this.fairHistory.length - 1; i >= 0; i--) {
      const snap = this.fairHistory[i]!;
      if (snap.ts >= detectTs) continue;
      const raw = this.rawForOutcome(snap, outcome);
      if (raw >= 0.001) return winProbPct(raw);
    }
    if (m) return winProbPct(m.fairProb[outcome] ?? 0);
    return 0;
  }

  private scoreKey(g1: number, g2: number): string {
    return `${g1}-${g2}`;
  }

  private shouldScheduleGoal(g1: number, g2: number): boolean {
    const key = this.scoreKey(g1, g2);
    if (this.alertedScorelines.has(key)) return false;
    if (
      this.pending.some(
        (p) => p.kind === "goal" && this.scoreKey(p.scoreP1, p.scoreP2) === key,
      )
    ) {
      return false;
    }
    return true;
  }

  private markGoalScoreline(g1: number, g2: number): void {
    this.alertedScorelines.add(this.scoreKey(g1, g2));
  }

  private resolveProbBefore(p: PendingSettle): number {
    return p.probBefore ?? this.readPreGoalFair(p.featuredOutcome, p.detectTs);
  }

  private tryScheduleGoal(input: {
    ts: number;
    scoreP1: number;
    scoreP2: number;
    teamName: string;
    probTeam: string;
    featuredOutcome: "part1" | "part2";
  }): void {
    if (!this.shouldScheduleGoal(input.scoreP1, input.scoreP2)) return;
    this.markGoalScoreline(input.scoreP1, input.scoreP2);
    this.scheduleSettle({ kind: "goal", ...input });
  }

  private emitAlert(ev: PunditEvent): void {
    this.lastAlertMatchMs = this.currentMatchMs;
    this.emit("alert", ev);
  }

  private onFeedEvent(e: FeedEvent): void {
    this.currentEventTs = e.ts;
    this.currentMatchMs = matchMs(e.ts, this.startMs);

    if (e.type === "score") {
      this.handleScore(e);
    }

    this.fairBook.onEvent(e);

    if (e.type === "odds") {
      this.recordFairFromOdds(e.data, e.ts);
      this.handleOdds(e.data, e.ts);
      this.updatePendingReprice(e.ts);
    }

    this.flushPending(e.ts);
  }

  private handleOdds(data: OddsPayload, ts: number): void {
    if (ts < this.startMs) return;

    if (!this.kickoffEmitted && data.InRunning) {
      this.kickoffEmitted = true;
      this.emitAlert({
        kind: "kickoff",
        matchMin: matchMin(ts, this.startMs),
        scoreP1: this.prevG1,
        scoreP2: this.prevG2,
      });
    }

    this.checkMove(ts);
  }

  private handleScore(e: FeedEvent & { type: "score" }): void {
    const { data, ts } = e;
    if (ts < this.startMs) return;

    const stats = statsFrom(data);
    const g1 = statVal(stats, 1);
    const g2 = statVal(stats, 2);
    const redP1 = statVal(stats, 5);
    const redP2 = statVal(stats, 6);

    if (g1 > this.prevG1) {
      this.tryScheduleGoal({
        ts,
        scoreP1: g1,
        scoreP2: g2,
        teamName: this.teams.p1,
        probTeam: this.teams.p1,
        featuredOutcome: "part1",
      });
    }
    if (g2 > this.prevG2) {
      this.tryScheduleGoal({
        ts,
        scoreP1: g1,
        scoreP2: g2,
        teamName: this.teams.p2,
        probTeam: this.teams.p2,
        featuredOutcome: "part2",
      });
    }
    if (redP1 > this.prevRedP1) {
      this.scheduleSettle({
        kind: "red",
        ts,
        scoreP1: g1,
        scoreP2: g2,
        teamName: this.teams.p1,
        probTeam: this.teams.p2,
        featuredOutcome: "part2",
      });
    }
    if (redP2 > this.prevRedP2) {
      this.scheduleSettle({
        kind: "red",
        ts,
        scoreP1: g1,
        scoreP2: g2,
        teamName: this.teams.p2,
        probTeam: this.teams.p1,
        featuredOutcome: "part1",
      });
    }

    this.prevG1 = g1;
    this.prevG2 = g2;
    this.prevRedP1 = redP1;
    this.prevRedP2 = redP2;
    this.finalScore = { g1, g2 };

    const action = String(data.Action ?? "").toLowerCase();
    if (action === "game_finalised" || action === "game_finalized") {
      this.emitFulltime(g1, g2, ts);
    }
  }

  private updatePendingReprice(ts: number): void {
    const jump = this.fairBook.getJump(KEY_1X2);
    const m = this.fairBook.getMarket(KEY_1X2);
    if (!m) return;

    for (const p of this.pending) {
      if (ts <= p.detectTs) continue;
      p.effectiveEmitTs = Math.max(p.effectiveEmitTs, ts + 2_000);
      if (jump < 0.005) continue;
      const prev = m.prevFairProb[p.featuredOutcome] ?? 0;
      if (prev < 0.001) continue;
      const prevPct = winProbPct(prev);
      p.probBefore =
        p.probBefore !== undefined
          ? Math.min(p.probBefore, prevPct)
          : prevPct;
    }
  }

  private scheduleSettle(input: {
    kind: "goal" | "red";
    ts: number;
    scoreP1: number;
    scoreP2: number;
    teamName: string;
    probTeam: string;
    featuredOutcome: "part1" | "part2";
  }): void {
    const atMs = matchMs(input.ts, this.startMs);
    this.goalRedMatchTimes.push(atMs);
    this.pending.push({
      kind: input.kind,
      detectTs: input.ts,
      effectiveEmitTs: input.ts + this.cfg.settleDelayMs,
      matchMin: matchMin(input.ts, this.startMs),
      scoreP1: input.scoreP1,
      scoreP2: input.scoreP2,
      teamName: input.teamName,
      probTeam: input.probTeam,
      featuredOutcome: input.featuredOutcome,
      probBefore: this.readPreGoalFair(input.featuredOutcome, input.ts),
    });
  }

  private flushPending(eventTs: number, forceAll = false): void {
    const ready: PendingSettle[] = [];
    const remaining: PendingSettle[] = [];
    for (const p of this.pending) {
      if (forceAll || eventTs >= p.effectiveEmitTs) ready.push(p);
      else remaining.push(p);
    }
    this.pending = remaining;

    for (const p of ready) {
      const probBefore = this.resolveProbBefore(p);
      const probAfter = this.readWinPct(p.featuredOutcome);
      this.emitAlert({
        kind: p.kind,
        matchMin: p.matchMin,
        scoreP1: p.scoreP1,
        scoreP2: p.scoreP2,
        teamName: p.teamName,
        probTeam: p.probTeam,
        probBefore,
        probAfter,
      });
    }
  }

  private checkMove(ts: number): void {
    if (ts < this.startMs) return;

    const jump = this.fairBook.getJump(KEY_1X2);
    if (jump < this.cfg.moveThreshold) return;

    const m = this.fairBook.getMarket(KEY_1X2);
    if (!m || !m.inRunning) return;

    const d1 = Math.abs((m.fairProb.part1 ?? 0) - (m.prevFairProb.part1 ?? 0));
    const d2 = Math.abs((m.fairProb.part2 ?? 0) - (m.prevFairProb.part2 ?? 0));
    if (d1 < 1e-6 && d2 < 1e-6) return;

    const featuredOutcome: "part1" | "part2" = d1 >= d2 ? "part1" : "part2";
    const probBefore = winProbPct(m.prevFairProb[featuredOutcome] ?? 0);
    const probAfter = winProbPct(m.fairProb[featuredOutcome] ?? 0);

    for (const t of this.goalRedMatchTimes) {
      if (Math.abs(this.currentMatchMs - t) <= this.cfg.goalRedSuppressMs) return;
    }

    if (this.currentMatchMs - this.lastAlertMatchMs < this.cfg.moveCooldownMs) {
      return;
    }

    this.emitAlert({
      kind: "move",
      matchMin: matchMin(ts, this.startMs),
      scoreP1: this.prevG1,
      scoreP2: this.prevG2,
      teamName: this.teamForOutcome(featuredOutcome),
      probTeam: this.teamForOutcome(featuredOutcome),
      probBefore,
      probAfter,
      magnitude: Math.abs(probAfter - probBefore),
    });
  }

  private emitFulltime(g1: number, g2: number, ts: number): void {
    if (this.fulltimeEmitted) return;
    this.fulltimeEmitted = true;
    this.emitAlert({
      kind: "fulltime",
      matchMin: matchMin(ts, this.startMs),
      scoreP1: g1,
      scoreP2: g2,
    });
  }

  private onFeedEnd(): void {
    this.flushPending(this.currentEventTs, true);
    if (!this.fulltimeEmitted) {
      this.emitFulltime(
        this.finalScore.g1,
        this.finalScore.g2,
        this.startMs + this.currentMatchMs,
      );
    }
  }
}

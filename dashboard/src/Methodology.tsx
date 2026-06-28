import type { CSSProperties } from "react";
import { theme } from "./theme";
import type { DashboardPayload } from "./data";
import { fmt } from "./data";

interface Props {
  data: DashboardPayload;
}

export function Methodology({ data }: Props) {
  const c = data.meta.config;
  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>Methodology & verifiability</h2>
      <div style={{ color: theme.text, fontSize: 14, lineHeight: 1.7, maxWidth: 900 }}>
        <p>
          Fair value = de-margined consensus (TxLINE Stable Price, <code>Pct</code>). Every quote is
          priced off a TxLINE MessageId anchored on-chain (daily Merkle root) — pricing is
          cryptographically auditable.
        </p>
        <p>
          Spread is captured from uninformed flow by construction; no predictive edge over consensus
          is claimed.
        </p>
        <p style={{ fontFamily: theme.mono, fontSize: 13, color: theme.muted }}>
          Simulation: Poisson taker flow (λ={c.takerLambdaPerMin}/min), quote latency Λ=
          {c.quoteLatencyMs}ms, symmetric half-spread δ={fmt(c.halfSpread, 3)}, protect cooldown{" "}
          {c.protectCooldownMs / 1000}s after jump &gt; {fmt(c.repriceJumpThreshold, 2)}.
        </p>
      </div>
    </section>
  );
}

const panelStyle: CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  padding: "24px 28px",
  marginBottom: 48,
};

const titleStyle: CSSProperties = {
  margin: "0 0 16px",
  fontFamily: theme.sans,
  fontSize: 18,
  fontWeight: 600,
  color: theme.text,
};

import { theme } from "./theme";
import type { DashboardPayload } from "./data";
import { fmt } from "./data";

interface Props {
  data: DashboardPayload;
}

export function Header({ data }: Props) {
  const { meta } = data;
  const cfg = meta.config;
  return (
    <header
      style={{
        borderBottom: `1px solid ${theme.border}`,
        padding: "24px 32px",
        background: theme.panel,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: theme.sans,
          fontSize: 22,
          fontWeight: 600,
          color: theme.text,
        }}
      >
        txline-mm — on-chain-verifiable in-play market maker
      </h1>
      <p
        style={{
          margin: "12px 0 0",
          fontFamily: theme.mono,
          fontSize: 20,
          color: theme.text,
        }}
      >
        {meta.participant1} {meta.finalG1}-{meta.finalG2} {meta.participant2}
      </p>
      <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 14 }}>
        {meta.network} · TxLINE de-margined consensus · {meta.bookmaker}
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 16,
        }}
      >
        {[
          `δ=${fmt(cfg.halfSpread, 3)}`,
          `latency=${cfg.quoteLatencyMs}ms`,
          `seeds=${cfg.seedCount}`,
          `markets=${meta.marketKeys.length}`,
          `odds=${meta.oddsCount}`,
        ].map((chip) => (
          <span
            key={chip}
            style={{
              fontFamily: theme.mono,
              fontSize: 13,
              padding: "4px 10px",
              border: `1px solid ${theme.border}`,
              borderRadius: 4,
              color: theme.on,
            }}
          >
            {chip}
          </span>
        ))}
      </div>
    </header>
  );
}

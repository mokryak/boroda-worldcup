export function StatusPill({ tone, children }: { tone: "open" | "closed" | "neutral"; children: React.ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function LoadingState({ label }: { label: string }) {
  return (
    <section className="panel loading-state" aria-live="polite">
      <span className="spinner" aria-hidden />
      <p>{label}</p>
    </section>
  );
}

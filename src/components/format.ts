export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatLocalTimeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "локальное время";
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru", {
    day: "numeric",
    month: "long"
  }).format(new Date(value));
}

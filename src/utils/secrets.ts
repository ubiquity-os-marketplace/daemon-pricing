export function normalizeMultilineSecret(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

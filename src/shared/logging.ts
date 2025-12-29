import { Logs } from "@ubiquity-os/ubiquity-os-logger";

type ErrorWithStatus = { status?: number | string; response?: { status?: number | string } };

export function getErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as ErrorWithStatus;
  const directStatus = candidate.status ?? candidate.response?.status;
  if (typeof directStatus === "number" && Number.isFinite(directStatus)) return directStatus;
  if (typeof directStatus === "string" && directStatus.trim()) {
    const parsed = Number.parseInt(directStatus, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (err instanceof Error) {
    const match = err.message.match(/LLM API error:\s*(\d{3})/i);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function logByStatus(
  logger: Pick<Logs, "warn" | "error">,
  message: string,
  err: unknown,
  metadata: Record<string, unknown> = {}
) {
  if (err && typeof err === "object" && "logMessage" in err) {
    const logType = (err as { logMessage?: { type?: string } }).logMessage?.type;
    if (logType === "warn") {
      return logger.warn(message, { err, ...metadata });
    }
    if (logType === "error") {
      return logger.error(message, { err, ...metadata });
    }
  }
  const status = getErrorStatus(err);
  const payload = { err, ...metadata, ...(status ? { status } : {}) };
  if (status && status >= 500) {
    return logger.error(message, payload);
  }
  if (status && status >= 400) {
    return logger.warn(message, payload);
  }
  return logger.error(message, payload);
}

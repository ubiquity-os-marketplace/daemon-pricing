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
    const match = /LLM API error:\s*(\d{3})/i.exec(err.message);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function logByStatus(
  logger: Pick<Logs, "info" | "ok" | "debug" | "warn" | "error">,
  message: string,
  err: unknown,
  metadata: Record<string, unknown> = {}
) {
  if (err && typeof err === "object" && "logMessage" in err) {
    const logType = (err as { logMessage?: { type?: string } }).logMessage?.type;
    const logTypeMap: Record<string, keyof typeof logger> = {
      info: "info",
      ok: "ok",
      debug: "debug",
      warn: "warn",
      error: "error",
    };
    const method = logType ? logTypeMap[logType] : undefined;
    if (method) {
      return logger[method](message, { err, ...metadata });
    }
  }
  const status = getErrorStatus(err);
  const payload = { err, ...metadata, ...(status ? { status } : {}) };
  const statusMap: Array<{ min: number; method: keyof typeof logger }> = [
    { min: 500, method: "error" },
    { min: 400, method: "warn" },
    { min: 300, method: "debug" },
    { min: 200, method: "ok" },
    { min: 100, method: "info" },
  ];
  const match = status ? statusMap.find((entry) => status >= entry.min) : undefined;
  if (match) {
    return logger[match.method](message, payload);
  }
  return logger.error(message, payload);
}

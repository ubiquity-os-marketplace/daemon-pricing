type ConfigEntry = {
  owner: string;
  repo: string;
  path: string;
  ref?: string | null;
  content: string;
};

const configStore = new Map<string, string>();

function getKey(entry: Omit<ConfigEntry, "content">): string {
  const ref = entry.ref ?? "default";
  return `${entry.owner}/${entry.repo}:${entry.path}:${ref}`;
}

export function setConfig(entry: ConfigEntry): void {
  configStore.set(getKey(entry), entry.content);
}

export function getConfig(entry: Omit<ConfigEntry, "content">): string | null {
  return configStore.get(getKey(entry)) ?? null;
}

export function resetConfig(): void {
  configStore.clear();
}

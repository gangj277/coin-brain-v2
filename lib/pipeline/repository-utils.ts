export function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

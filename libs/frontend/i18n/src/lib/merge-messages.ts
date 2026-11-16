export function mergeMessages(
  fallback: Record<string, unknown>,
  translated: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...fallback };
  for (const [key, value] of Object.entries(translated)) {
    const original = fallback[key];
    merged[key] =
      isMessageGroup(original) && isMessageGroup(value) ? mergeMessages(original, value) : value;
  }
  return merged;
}

function isMessageGroup(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

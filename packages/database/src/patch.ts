// Callers provide an explicit field allowlist. Undefined leaves a field alone;
// null clears it. Preserve request field ordering for metadata-only events.
export function definedPatch<T extends object, K extends keyof T>(
  input: T,
  allowed: readonly K[],
): { values: Pick<T, K>; changedFields: K[] } {
  const changedFields = (Object.keys(input) as K[]).filter(
    (key) => allowed.includes(key) && input[key] !== undefined,
  );
  const values = Object.fromEntries(changedFields.map((key) => [key, input[key]])) as Pick<T, K>;
  return { values, changedFields };
}

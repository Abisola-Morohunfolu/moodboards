// Column names are supplied by repositories, never by HTTP input.
export function patchColumns<T extends object>(
  input: T,
  columns: Record<keyof T, string>,
  start = 2,
) {
  const keys = (Object.keys(input) as (keyof T & string)[]).filter(
    (key) => input[key] !== undefined,
  );
  return {
    assignments: keys.map((key, index) => `${columns[key]}=$${start + index}`).join(', '),
    values: keys.map((key) => input[key]),
    changedFields: keys,
  };
}

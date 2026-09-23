/** Keeps each `IN (...)` list well under Postgres's 32,767 bind-parameter limit per statement. */
export function chunked<T>(items: T[], size = 5_000): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

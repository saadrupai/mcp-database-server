// SQL safety guard for AI-generated queries. Defense in depth:
//   1) this lexical check (single read-only statement, no dangerous keywords),
//   2) the database connection itself is opened READ-ONLY,
//   3) results are always capped with an outer LIMIT.
export class UnsafeQueryError extends Error {}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate|grant|revoke|load_extension)\b/i;

/** Remove string literals and comments so keyword checks can't be fooled or false-positive. */
function strip(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function guardQuery(sql: string, maxRows = 200): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!trimmed) throw new UnsafeQueryError("Query is empty.");
  if (trimmed.length > 5000) throw new UnsafeQueryError("Query is too long (max 5000 chars).");
  const bare = strip(trimmed);
  if (bare.includes(";")) throw new UnsafeQueryError("Only a single statement is allowed.");
  if (!/^\s*(select|with)\b/i.test(bare)) throw new UnsafeQueryError("Only SELECT (or WITH ... SELECT) queries are allowed.");
  const bad = FORBIDDEN.exec(bare);
  if (bad) throw new UnsafeQueryError(`Keyword "${bad[1].toUpperCase()}" is not allowed in read-only mode.`);
  return `SELECT * FROM (${trimmed}) LIMIT ${maxRows}`;
}

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { guardQuery, UnsafeQueryError } from "../src/guard.ts";
import { DbTools } from "../src/tools.ts";
import { seed } from "../src/seed.ts";

let dbPath: string;
before(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), "mcp-")), "test.db");
  seed(dbPath);
});

test("guard allows read-only queries and caps rows", () => {
  assert.equal(guardQuery("select * from orders;"), "SELECT * FROM (select * from orders) LIMIT 200");
  assert.doesNotThrow(() => guardQuery("WITH t AS (SELECT 1 x) SELECT * FROM t"));
  assert.doesNotThrow(() => guardQuery("SELECT 'drop table x; delete' AS harmless_text"), "keywords inside strings are fine");
});

test("guard blocks writes, multiple statements and tricks", () => {
  for (const sql of [
    "DELETE FROM orders",
    "UPDATE customers SET email='x'",
    "select 1; drop table orders",
    "SELECT * FROM orders WHERE id IN (SELECT id FROM orders) ; DELETE FROM orders",
    "PRAGMA table_info(orders)",
    "ATTACH DATABASE '/tmp/x' AS x",
    "select 1 /* ; */ ; insert into orders values (1)",
    "",
  ]) {
    assert.throws(() => guardQuery(sql), UnsafeQueryError, sql);
  }
});

test("tools: list, describe, query and summary", () => {
  const t = new DbTools(dbPath);
  const tables = JSON.parse(t.call("list_tables", {}).text);
  assert.deepEqual(tables.map((x: { table: string }) => x.table), ["customers", "order_items", "orders", "products"]);

  const desc = JSON.parse(t.call("describe_table", { table: "orders" }).text);
  assert.ok(desc.columns.some((c: { name: string }) => c.name === "status"));
  assert.deepEqual(desc.foreign_keys, [{ column: "customer_id", references: "customers.id" }]);

  const q = JSON.parse(t.call("run_query", { sql: "SELECT country, COUNT(*) n FROM customers GROUP BY country ORDER BY n DESC" }).text);
  assert.equal(q.rows[0].country, "US");

  const s = JSON.parse(t.call("sales_summary", { group_by: "category" }).text);
  assert.ok(s.length >= 4 && s[0].revenue_usd > 0);
});

test("tools return errors (not crashes) for bad input, and the DB is truly read-only", () => {
  const t = new DbTools(dbPath);
  assert.equal(t.call("describe_table", { table: "users; drop" }).isError, true);
  assert.match(t.call("run_query", { sql: "DELETE FROM orders" }).text, /Only SELECT/);
  assert.match(t.call("run_query", { sql: "SELECT nope FROM orders" }).text, /Query failed/);
  // Even bypassing the guard, the connection refuses writes:
  assert.throws(() => (t as any).db.exec("DELETE FROM orders"), /readonly/i);
});

test("speaks MCP over stdio (initialize → tools/list → tools/call)", async () => {
  const proc = spawn(process.execPath, ["--no-warnings", "src/index.ts"], { env: { ...process.env, DB_PATH: dbPath } });
  const rl = createInterface({ input: proc.stdout });
  const pending = new Map<number, (v: any) => void>();
  rl.on("line", (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); });
  let id = 0;
  const rpc = (method: string, params?: object) => new Promise<any>((resolve) => {
    const i = ++id; pending.set(i, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
  });
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.equal(init.result.serverInfo.name, "company-database");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const list = await rpc("tools/list");
    assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["list_tables", "describe_table", "run_query", "sales_summary"]);

    const call = await rpc("tools/call", { name: "sales_summary", arguments: { group_by: "month" } });
    assert.equal(call.result.isError, false);
    assert.match(call.result.content[0].text, /2026-01/);

    const bad = await rpc("tools/call", { name: "run_query", arguments: { sql: "DROP TABLE orders" } });
    assert.equal(bad.result.isError, true);

    const unknown = await rpc("does/not/exist");
    assert.equal(unknown.error.code, -32601);
  } finally {
    proc.kill();
  }
});

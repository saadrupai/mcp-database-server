// The MCP tools exposed to the AI. Each returns JSON text the model can reason over.
import { DatabaseSync } from "node:sqlite";
import { guardQuery, UnsafeQueryError } from "./guard.ts";

export interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const TOOLS: Tool[] = [
  {
    name: "list_tables",
    description: "List all tables in the database with their row counts. Call this first to explore.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "describe_table",
    description: "Show columns (name, type, nullable, primary key) and foreign keys for one table, plus 3 sample rows.",
    inputSchema: { type: "object", properties: { table: { type: "string" } }, required: ["table"] },
  },
  {
    name: "run_query",
    description: "Run a READ-ONLY SQL query (SQLite dialect). Only SELECT/WITH. Results are capped at 200 rows. Money columns ending in _cents are integers in cents.",
    inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  },
  {
    name: "sales_summary",
    description: "Pre-built business report: revenue, order count and average order value for paid orders, grouped by month, product, category or country.",
    inputSchema: {
      type: "object",
      properties: { group_by: { type: "string", enum: ["month", "product", "category", "country"] } },
      required: ["group_by"],
    },
  },
];

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class DbTools {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true }); // the AI can never write
  }

  call(name: string, args: Record<string, unknown>): { text: string; isError: boolean } {
    try {
      return { text: JSON.stringify(this.dispatch(name, args), null, 2), isError: false };
    } catch (e) {
      const msg = e instanceof UnsafeQueryError ? e.message : `Query failed: ${(e as Error).message}`;
      return { text: msg, isError: true }; // tool errors go back to the model so it can fix the query
    }
  }

  private tables(): string[] {
    return (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  }

  private dispatch(name: string, args: Record<string, unknown>): unknown {
    switch (name) {
      case "list_tables":
        return this.tables().map((t) => ({ table: t, rows: (this.db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get() as { n: number }).n }));

      case "describe_table": {
        const t = String(args.table ?? "");
        if (!IDENT.test(t) || !this.tables().includes(t)) throw new UnsafeQueryError(`Unknown table "${t}". Use list_tables.`);
        const cols = this.db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; type: string; notnull: number; pk: number }[];
        const fks = this.db.prepare(`PRAGMA foreign_key_list("${t}")`).all() as { from: string; table: string; to: string }[];
        return {
          table: t,
          columns: cols.map((c) => ({ name: c.name, type: c.type, nullable: !c.notnull, primary_key: !!c.pk })),
          foreign_keys: fks.map((f) => ({ column: f.from, references: `${f.table}.${f.to}` })),
          sample_rows: this.db.prepare(`SELECT * FROM "${t}" LIMIT 3`).all(),
        };
      }

      case "run_query": {
        const sql = guardQuery(String(args.sql ?? ""));
        const rows = this.db.prepare(sql).all();
        return { row_count: rows.length, truncated: rows.length === 200, rows };
      }

      case "sales_summary": {
        const g = String(args.group_by);
        const key: Record<string, string> = {
          month: "substr(o.created_at, 1, 7)", product: "p.name", category: "p.category", country: "c.country",
        };
        if (!key[g]) throw new UnsafeQueryError("group_by must be one of month, product, category, country.");
        return this.db.prepare(`
          SELECT ${key[g]} AS ${g},
                 ROUND(SUM(i.quantity * i.unit_price_cents) / 100.0, 2) AS revenue_usd,
                 COUNT(DISTINCT o.id) AS orders,
                 ROUND(SUM(i.quantity * i.unit_price_cents) / 100.0 / COUNT(DISTINCT o.id), 2) AS avg_order_usd
          FROM orders o
          JOIN order_items i ON i.order_id = o.id
          JOIN products p ON p.id = i.product_id
          JOIN customers c ON c.id = o.customer_id
          WHERE o.status = 'paid'
          GROUP BY 1 ORDER BY ${g === "month" ? "1" : "revenue_usd DESC"}`).all();
      }
    }
    throw new UnsafeQueryError(`Unknown tool "${name}".`);
  }
}

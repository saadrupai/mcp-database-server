// Minimal, dependency-free Model Context Protocol server over stdio
// (newline-delimited JSON-RPC 2.0). Implements: initialize, ping, tools/list, tools/call.
import { createInterface } from "node:readline";
import { TOOLS, DbTools } from "./tools.ts";

const PROTOCOL_VERSION = "2025-06-18";

interface Request { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, any> }

export function handle(tools: DbTools, req: Request): object | null {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: req.id ?? null, error: { code, message } });

  if (req.id === undefined) return null; // notifications (e.g. notifications/initialized) get no reply

  switch (req.method) {
    case "initialize":
      return ok({
        protocolVersion: req.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "company-database", version: "1.0.0" },
        instructions: "Read-only access to the company database. Start with list_tables, then describe_table, then run_query.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = req.params?.name;
      if (!TOOLS.some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      const r = tools.call(name, req.params?.arguments ?? {});
      return ok({ content: [{ type: "text", text: r.text }], isError: r.isError });
    }
    default:
      return err(-32601, `Method not found: ${req.method}`);
  }
}

export function serve(dbPath: string): void {
  const tools = new DbTools(dbPath);
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let res: object | null;
    try {
      res = handle(tools, JSON.parse(line));
    } catch {
      res = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
  // Logs must go to stderr: stdout is reserved for the protocol.
  console.error(`[company-database] MCP server ready (db: ${dbPath})`);
}

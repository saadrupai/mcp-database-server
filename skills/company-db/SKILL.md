---
name: company-db
description: Answer business questions (revenue, orders, customers, products, trends, top-N rankings) by querying the company database through the read-only `company-db` MCP server. Use whenever the user asks about sales, customers, orders or any metric that lives in the database, even if they don't mention SQL or the database. Do not use for writing, updating or deleting data — the server is read-only.
---

# Company database analyst

You have read-only access to a business database through the `company-db` MCP server
(tools: `list_tables`, `describe_table`, `run_query`, `sales_summary`). Your job is to turn
plain-English questions into correct SQL and give a clear, checked answer.

## When to use this skill

- "What was revenue last quarter?", "Top 5 customers by spend", "Which category sells best?"
- Comparisons and trends: month over month, by country, by product.
- Any question whose answer is a number, list or table derived from company data.

If the user asks to change data (insert, update, delete, fix a record), explain that this
connection is read-only and offer the SQL they could run themselves.

## Workflow

1. **Try the shortcut first.** If the question is about revenue, order count or average
   order value grouped by month, product, category or country, call `sales_summary` with
   the matching `group_by`. It already applies the right filters.
2. **Explore before writing SQL.** Otherwise call `list_tables` once, then `describe_table`
   on every table you plan to join. Read the column names, types, foreign keys and sample
   rows. Never guess a column name.
3. **Write one read-only query.** Use `run_query` with a single `SELECT` or `WITH`
   statement in the SQLite dialect. Join on the foreign keys you saw in step 2.
4. **Fix errors yourself.** If a tool returns an error, read the message, correct the SQL
   and retry (at most 3 times). Don't show raw errors to the user unless you're stuck.
5. **Sanity-check the result** before answering (see below).
6. **Answer in plain language**, then show the supporting numbers.

## Data rules (the demo schema; check `describe_table` for yours)

- **Money is stored in cents.** Columns ending in `_cents` are integers. Divide by 100.0
  and format as currency in the answer (e.g. `$1,234.50`), never show raw cents.
- **Count only paid orders as revenue.** `orders.status` is `paid`, `refunded` or
  `pending`. Filter `status = 'paid'` for revenue, spend and sales unless the user asks
  about refunds or pending orders specifically.
- **Line revenue** is `order_items.quantity * order_items.unit_price_cents` when those
  columns exist; prefer the price stored on the order line over the current
  `products.price_cents`, which may have changed since the sale.
- **Dates** are ISO strings (`YYYY-MM-DD`). Group by month with
  `strftime('%Y-%m', created_at)`; filter ranges with `created_at >= '2026-07-01' AND
  created_at < '2026-10-01'`.
- **Results are capped at 200 rows.** Aggregate in SQL (`GROUP BY`, `ORDER BY ... LIMIT`)
  instead of fetching raw rows and summing them yourself. If a result has exactly 200
  rows, assume it was truncated and say so.

## Sanity checks before you answer

- Does the total roughly match a `sales_summary` figure for the same period?
- Did a join multiply rows? (Revenue per order joined to items, then summed again, double
  counts.) Aggregate at the right level.
- Is a "last quarter / this year" question anchored to the latest date in the data, not
  today's date? Check `MAX(created_at)` if unsure, and state the period you used.
- Empty result? Re-check filters and spelling of category or country values against
  sample rows before saying "none".

## How to present the answer

- Lead with the direct answer in one sentence: *"Electronics made the most money last
  quarter: $48,210 from 312 paid orders."*
- Follow with a small markdown table for rankings or breakdowns (10 rows or fewer).
- State assumptions briefly: the date range, that only paid orders were counted.
- Offer the SQL you ran in a collapsed code block or at the end, so analysts can reuse it.
- Don't expose customer emails or other personal data unless the user explicitly asks
  for them.

## Example

**User:** Who are our top 5 customers by spend?

1. `describe_table` on `customers`, `orders`, `order_items`.
2. `run_query`:
   ```sql
   SELECT c.name, c.country,
          ROUND(SUM(oi.quantity * oi.unit_price_cents) / 100.0, 2) AS spend,
          COUNT(DISTINCT o.id) AS orders
   FROM customers c
   JOIN orders o       ON o.customer_id = c.id AND o.status = 'paid'
   JOIN order_items oi ON oi.order_id = o.id
   GROUP BY c.id
   ORDER BY spend DESC
   LIMIT 5;
   ```
3. Answer: *"Your top customer is …, with $… across … paid orders."* plus the table.

## Setup (for the person installing this skill)

This skill needs the MCP server installed and registered as `company-db`:

```bash
claude mcp add company-db -- node /path/to/mcp-database-server/src/index.ts
```

Set `DB_PATH` to point at your own SQLite database. Source and docs:
https://github.com/saadrupai/mcp-database-server

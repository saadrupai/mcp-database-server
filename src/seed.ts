// Creates a realistic demo e-commerce database (fictional "Acme Shop").
// Deterministic pseudo-random data so tests and screenshots are reproducible.
import { DatabaseSync } from "node:sqlite";

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

export function seed(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    DROP TABLE IF EXISTS order_items; DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS customers;
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      country TEXT NOT NULL, signed_up DATE NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
      status TEXT NOT NULL CHECK (status IN ('paid','refunded','pending')), created_at DATE NOT NULL);
    CREATE TABLE order_items (order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL);
  `);
  const r = rng(42);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const products: [string, string, number][] = [
    ["Wireless Earbuds", "Audio", 7900], ["Noise-Cancelling Headphones", "Audio", 19900], ["Smart Watch", "Wearables", 24900],
    ["Fitness Band", "Wearables", 5900], ["USB-C Charger 65W", "Accessories", 3900], ["Laptop Stand", "Accessories", 4900],
    ["Mechanical Keyboard", "Peripherals", 12900], ["Ergonomic Mouse", "Peripherals", 6900], ["4K Webcam", "Peripherals", 14900],
    ["Portable SSD 1TB", "Storage", 10900],
  ];
  const insP = db.prepare("INSERT INTO products (name, category, price_cents) VALUES (?, ?, ?)");
  for (const p of products) insP.run(...p);

  const first = ["Liam", "Emma", "Noah", "Olivia", "Ava", "Lucas", "Mia", "Ethan", "Sofia", "Arjun", "Fatima", "Yuki", "Omar", "Chloe", "Mateo"];
  const last = ["Smith", "Garcia", "Khan", "Müller", "Rossi", "Tanaka", "Silva", "Brown", "Ahmed", "Dubois"];
  const countries = ["US", "US", "US", "UK", "DE", "CA", "AU", "FR", "IN", "BD"];
  const insC = db.prepare("INSERT INTO customers (name, email, country, signed_up) VALUES (?, ?, ?, ?)");
  for (let i = 1; i <= 120; i++) {
    const f = pick(first), l = pick(last);
    insC.run(`${f} ${l}`, `${f}.${l}${i}@example.com`.toLowerCase(), pick(countries), `2026-${String(1 + Math.floor(r() * 10)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`);
  }

  const insO = db.prepare("INSERT INTO orders (customer_id, status, created_at) VALUES (?, ?, ?)");
  const insI = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let o = 1; o <= 600; o++) {
    const month = 1 + Math.floor(r() * 10);
    const status = r() < 0.9 ? "paid" : r() < 0.5 ? "refunded" : "pending";
    insO.run(1 + Math.floor(r() * 120), status, `2026-${String(month).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`);
    const lines = 1 + Math.floor(r() * 3);
    for (let k = 0; k < lines; k++) {
      const pid = 1 + Math.floor(r() * products.length);
      insI.run(o, pid, 1 + Math.floor(r() * 2), products[pid - 1][2]);
    }
  }
  db.exec("COMMIT");
  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? "demo.db";
  seed(path);
  console.log(`seeded ${path}`);
}

const exists = await pool.query(
  "SELECT 1 FROM stripe_events WHERE id = $1",
  [event.id]
);

if (exists.rowCount > 0) {
  console.log("🔁 Duplicate webhook ignored");
  return res.json({ received: true });
}

await pool.query(
  "INSERT INTO stripe_events (id) VALUES ($1)",
  [event.id]
);

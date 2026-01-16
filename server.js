require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");

const pool = require("./db");
pool.query("SELECT 1")
  .then(() => console.log("✅ DB connected"))
  .catch(err => console.error("❌ DB connection failed:", err));

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
if (
  process.env.STRIPE_SECRET_KEY.includes("test") &&
  process.env.STRIPE_WEBHOOK_SECRET.includes("live")
) {
  throw new Error("Stripe keys mismatch: test + live");
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; 
const MAX_TOKEN_USES = 5;

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const ALLOWED_PRICES = [
  "price_1SokWfAG2360Iu0s5hr6g5JH", // Basic
  "price_1SokXdAG2360Iu0s7lZJWy3z", // Premium
];

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
     console.error("❌ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
 if (event.type === "checkout.session.completed") {
    const seen = await pool.query(
      "SELECT 1 FROM stripe_events WHERE id = $1",
      [event.id]
    );

    if (seen.rowCount > 0) return res.json({ received: true });

    await pool.query(
      "INSERT INTO stripe_events (id) VALUES ($1)",
      [event.id]
    );

    const session = event.data.object;
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription
    );

     const priceId = subscription.items.data[0].price.id;
      if (!ALLOWED_PRICES.includes(priceId)) {
        return res.json({ received: true });
      }

    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO access_tokens (token, session_id) VALUES ($1, $2)",
      [token, session.id]
    );

    console.log("✅ Access token stored:", token);
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static("public"));

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId } = req.body;

    if (!priceId) {
      return res.status(400).json({ error: "Missing priceId" });
    }

    if (!ALLOWED_PRICES.includes(priceId)) {
      return res.status(400).json({ error: "Invalid priceId" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription", 
     line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
  console.error("Stripe FULL error:", err);
  res.status(500).json({ error: err.message });
}
});

app.get("/checkout-session", async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  } try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    res.json({
      status: session.payment_status,
      customer_email: session.customer_details?.email,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to retrieve session" });
  }
});

app.get("/access", async (req, res) => {
  const { token } = req.query;

  await pool.query(
  `DELETE FROM access_tokens
   WHERE created_at < NOW() - INTERVAL '7 days'`
);

  if (access.email && access.email !== req.query.email) {
  return res.status(403).send("❌ This link is tied to another email");
}
  if (!token) {
    return res.status(400).send("❌ Missing access token");
  }

  const result = await pool.query(
    `SELECT * FROM access_tokens WHERE token = $1`,
    [token]
  );

  if (result.rows.length === 0) {
    return res.status(403).send("❌ Invalid or expired access link");
  }

  const access = result.rows[0];

  const expired =
  Date.now() - new Date(access.created_at).getTime() > TOKEN_TTL_MS;

if (expired) {
  return res.status(403).send("❌ Access link expired");
}

if (access.used >= access.max_uses) {
  return res.status(403).send("❌ Usage limit reached");
}
await pool.query(
  `UPDATE access_tokens SET used = used + 1 WHERE token = $1`,
  [token]
);

res.sendFile(
  path.join(__dirname, "public", "product.html")
);
});
const PORT = process.env.PORT || 4242;

  app.get("/redirect-after-success", async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).send("Missing session ID");
  }

  const result = await pool.query(
    `SELECT token FROM access_tokens WHERE session_id = $1`,
    [session_id]
  );

  if (result.rows.length === 0) {
    return res.status(404).send("Access link not found");
  }
const { token } = result.rows[0];

  res.redirect(`/access?token=${token}`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
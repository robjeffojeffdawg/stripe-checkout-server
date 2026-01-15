require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; 
const MAX_TOKEN_USES = 5;

app.use(
  "/webhook",
  express.raw({ type: "application/json" })
);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use(express.json());
app.use(express.static("public"));

const ALLOWED_PRICES = [
  "price_1SokWfAG2360Iu0s5hr6g5JH", // Basic
  "price_1SokXdAG2360Iu0s7lZJWy3z", // Premium
];

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

app.post("/webhook",  
  express.raw({ type: "application/json" }),
  async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

if (event.type === "checkout.session.completed") {
  const session = event.data.object;
const token = crypto.randomBytes(32).toString("hex");

const pool = require("./db");

 await pool.query(
    `INSERT INTO access_tokens (token, session_id)
     VALUES ($1, $2)`,
    [token, session.id]
  );

  console.log("✅ Access token stored in DB:", token);
}

  res.json({ received: true });

  res.status(404).json({ error: "Access token not found" });
});

const path = require("path");

app.get("/access", async (req, res) => {
  const { token } = req.query;

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

  if (access.used) {
    return res.status(403).send("❌ This access link has already been used");
  }

  await pool.query(
    `UPDATE access_tokens SET used = true WHERE token = $1`,
    [token]
  );

  res.send("✅ Access granted. Welcome to the product.");

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
});
const PORT = process.env.PORT || 4242;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");
const path = require("path");

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

const PORT = process.env.PORT || 10000;

const ALLOWED_PRICES = [
  "price_1SokWfAG2360Iu0s5hr6g5JH", // Basic
  "price_1SokXdAG2360Iu0s7lZJWy3z", // Premium
];

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      console.error("❌ Missing Stripe signature header");
      return res.status(400).send("Missing signature");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  
    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
  
        if (session.payment_status && session.payment_status !== "paid") {
          console.warn("⚠️ checkout.session.completed but payment_status != paid:", session.id, session.payment_status);
          return res.json({ received: true });
        }
  
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription
        );
  
        const priceId = subscription.items.data[0].price.id;
  
        if (!ALLOWED_PRICES.includes(priceId)) {
          console.warn("⚠️ checkout.session.completed with disallowed price:", priceId, "session:", session.id);
          return res.json({ received: true });
        }
  
        console.log("✅ checkout.session.completed validated for session:", session.id);
        return res.json({ received: true });
      }
    } catch (err) {
      console.error("❌ Error processing webhook event:", err);
      return res.status(500).send("Webhook processing error");
    }
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

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { token },
      success_url: `${process.env.BASE_URL}/redirect-after-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel.html`,
    });

    await pool.query(
      `
      INSERT INTO access_tokens (
        token,
        session_id,
        created_at,
        expires_at,
        used,
        max_uses
      )
      VALUES ($1, $2, NOW(), $3, 0, 5)
      `,
      [token, session.id, expiresAt]
    );

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/redirect-after-success", async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).send("Missing session ID");
    }
  
    const result = await pool.query(
      `SELECT token FROM access_tokens WHERE session_id = $1`,
      [session_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Session not found");
    }
  
    res.redirect(`/access?token=${result.rows[0].token}`);
  } catch (err) {
    console.error("❌ Redirect error:", err);
    res.status(500).send("Internal server error");
  }
});

app.get("/access", async (req, res) => {
  try {
    const { token } = req.query;
  
    if (!token) {
      return res.status(400).send("❌ Missing access token");
    }

  const result = await pool.query(
    `
    SELECT *
    FROM access_tokens
    WHERE token = $1
      AND expires_at > NOW()
    `,
    [token]
  );

  if (result.rows.length === 0) {
    return res.status(403).send("❌ Invalid or expired access link");
  }

  const access = result.rows[0];

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
  } catch (err) {
    console.error("❌ Access error:", err);
    res.status(500).send("Internal server error");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
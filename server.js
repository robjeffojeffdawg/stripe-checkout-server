require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const path = require("path");
const crypto = require("crypto");


// TEMP token store (memory only)
const accessTokens = new Map();
// token -> { sessionId, createdAt }

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = process.env.PORT || 10000;


if (
  process.env.STRIPE_SECRET_KEY.includes("test") &&
  process.env.STRIPE_WEBHOOK_SECRET.includes("live")
) {
  throw new Error("Stripe keys mismatch: test + live");
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => { // Changed bodyParser to express
  const sig = req.headers["stripe-signature"];

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
    const session = event.data.object;

    if (session.payment_status !== "paid") {
      return res.json({ received: true });
    }

    // Generate permanent access token
    const token = crypto.randomBytes(32).toString("hex");

    accessTokens.set(token, {
      sessionId: session.id,
      createdAt: Date.now(),
    });

    console.log("✅ Payment confirmed. Token created:", token);

    return res.json({ received: true });
  }
  
  res.json({ received: true }); // Added default response for other event types
}); // Added closing brace and parenthesis for webhook POST route

app.use(express.json());

app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card", "wechat_pay"],
      payment_method_options: {
        wechat_pay: {
          client: "web",
        },
      },
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/exchange-session-for-token", (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  for (const [token, data] of accessTokens.entries()) {
    if (data.sessionId === session_id) {
      return res.json({ token });
    }
  }

  return res.status(404).json({ error: "Token not found yet" });
});

app.get("/access", (req, res) => {
  const { token } = req.query;

  if (!token || !accessTokens.has(token)) {
    return res.status(403).send("❌ Invalid access link");
  }

  res.sendFile(path.join(__dirname, "protected", "product.html"));
});

app.get("/product.html", (req, res) => {
  res.status(403).send("Forbidden");
});

app.use(express.static("public"));

app.get("/checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(
      req.query.session_id
    );
    res.json(session);
  } catch (err) {
    console.error("❌ Session fetch error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get("/verify-session", async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ valid: false });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid") {
      return res.json({ valid: true });
    }

    return res.json({ valid: false });
  } catch (err) {
    console.error("Session verification error:", err.message);
    return res.status(500).json({ valid: false });
  }
});

app.listen(PORT, "0.0.0.0", () => { 
  console.log(`✅ Server running on port ${PORT}`);
});
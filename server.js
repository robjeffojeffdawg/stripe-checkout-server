require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs"); // Added missing fs import

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = process.env.PORT || 10000;

console.log("ENV CHECK", {
  STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_ID: !!process.env.STRIPE_PRICE_ID,
  BASE_URL: !!process.env.BASE_URL,
})

if (
  !process.env.STRIPE_SECRET_KEY ||
  !process.env.STRIPE_WEBHOOK_SECRET ||
  !process.env.STRIPE_PRICE_ID ||
  !process.env.BASE_URL
) {
  throw new Error("❌ Missing Stripe environment variables")
}

if (
  process.env.STRIPE_SECRET_KEY.includes("test") &&
  process.env.STRIPE_WEBHOOK_SECRET.includes("live")
) {
  throw new Error("Stripe keys mismatch: test + live");
}
console.log("✅ Stripe keys loaded");

const accessTokens = new Map();

app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"]

    let event

    try {
      event = stripe.webhooks.constructEvent(
        req.body, // ✅ RAW BUFFER
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error("❌ Webhook signature verification failed.", err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }
    console.log("🔔 Webhook event:", event.type)

if (event.type === "checkout.session.completed") {
  const session = event.data.object

  if (session.payment_status !== "paid") {
    return res.json({ received: true })
  }

  const token = crypto.randomBytes(32).toString("hex")

  sessionTokens.set(session.id, token)

  console.log("✅ Token created for session:", session.id)

  return res.json({ received: true })
}

    // handle event here
    res.json({ received: true })
  }
)

app.use(express.json());
app.use(express.static("public"));

app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
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
    console.error("🔥 Stripe session error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/exchange-session-for-token", (req, res) => {
  const { session_id } = req.query

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" })
  }

  const token = sessionTokens.get(session_id)

  if (!token) {
    return res.status(404).json({ error: "Token not ready yet" })
  }

  res.json({ token })
})

app.get("/access", (req, res) => {
  const { token } = req.query;

  const data = accessTokens.get(token)

if (!data) {
  return res.status(403).send("❌ Invalid access link");
}

// optional: 24h expiry
const MAX_AGE = 24 * 60 * 60 * 1000
if (Date.now() - data.createdAt > MAX_AGE) {
  accessTokens.delete(token)
  return res.status(403).send("❌ Access link expired");
}
  res.sendFile(path.join(__dirname, "protected", "product.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/download", (req, res) => {
  try {
    const { file, token } = req.query;

    console.log("⬇️ Download hit");
    console.log("➡️ file:", file);
    console.log("➡️ token:", token);
    console.log("➡️ tokens available:", [...accessTokens.keys()]);

    if (!token || !accessTokens.has(token)) {
      console.warn("❌ Invalid token");
      return res.status(403).send("❌ Invalid token");
    }

    const ALLOWED_FILES = ["premium.zip"];

    if (!ALLOWED_FILES.includes(file)) {
      console.warn("❌ File not allowed:", file);
      return res.status(403).send("❌ File not allowed");
    }

    const downloadsDir = path.join(__dirname, "downloads");
    console.log("📁 downloads dir:", downloadsDir);

    if (!fs.existsSync(downloadsDir)) {
      console.error("❌ downloads directory does NOT exist");
      return res.status(500).send("Downloads directory missing");
    }

    console.log("📦 files in downloads:", fs.readdirSync(downloadsDir));

    const filePath = path.join(downloadsDir, file);
    console.log("📄 full file path:", filePath);

    if (!fs.existsSync(filePath)) {
      console.error("❌ file missing on disk");
      return res.status(404).send("❌ File not found");
    }

    console.log("✅ Serving file now");
    res.download(filePath);

  } catch (err) {
    console.error("🔥 DOWNLOAD ROUTE CRASHED:", err);
    res.status(500).send("Internal server error");
  }
});

app.get("/product.html", (req, res) => {
  res.status(403).send("Forbidden");
});

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
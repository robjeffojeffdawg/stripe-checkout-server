import express from "express";
import Stripe from "stripe";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

import { pool } from './db.js';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express()
const PORT = process.env.PORT || 10000
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// 🔑 SINGLE SOURCE OF TRUTH
const sessionTokens = new Map() // sessionId -> token
const accessTokens = new Map()  // token -> metadata

if (
  !process.env.STRIPE_SECRET_KEY ||
  !process.env.STRIPE_WEBHOOK_SECRET ||
  !process.env.STRIPE_PRICE_ID ||
  !process.env.BASE_URL
) {
  throw new Error("❌ Missing Stripe environment variables")
}

console.log("✅ Stripe keys loaded")

app.get('/setup-complete', async (req, res) => {
  const { setup_intent } = req.query;

  if (!setup_intent) {
    return res.status(400).send('Missing setup_intent');
  }

  try {
    const setupIntent = await stripe.setupIntents.retrieve(setup_intent);

    if (!setupIntent.payment_method) {
      // ❌ Redirect-only UnionPay or unsupported card
      return res.send(`
        <h2>Card could not be saved</h2>
        <p>This card cannot be saved for future payments.</p>
        <p>Please try another card.</p>
      `);
    }

    // ✅ Card saved successfully
    return res.send(`
      <h2>Card saved successfully</h2>
      <p>You can now proceed.</p>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send('Error checking card');
  }
});

// =====================
// NORMAL MIDDLEWARE
// =====================
app.use(express.json())
app.use(express.static("public"))

app.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

async function getStripeCustomerIdFromDB(userId) {
  const result = await pool.query(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0]?.stripe_customer_id || null;
}

async function saveStripeCustomerIdToDB(userId, customerId) {
  await pool.query(
    'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
    [customerId, userId]
  );
}

app.post('/create-setup-intent', async (req, res) => {
  try {
    const userId = 'unionpay_client_001';
const email = 'client@email.com';

    // 2️⃣ check if we already have a Stripe customer
    let customerId = await getStripeCustomerIdFromDB(userId);

    // 3️⃣ if not, create one ONCE
    if (!customerId) {
      const customer = await stripe.customers.create({ email });
      customerId = customer.id;

      // 4️⃣ persist the mapping
      await saveStripeCustomerIdToDB(userId, customerId);
    }

    // 5️⃣ create SetupIntent using THAT customer
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    // 6️⃣ return client secret
    res.json({
      clientSecret: setupIntent.client_secret,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =====================
// CREATE CHECKOUT
// =====================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel.html`,
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error("🔥 Stripe error:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// =====================
// SESSION → TOKEN
// =====================
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

// =====================
// PROTECTED ACCESS
// =====================
app.get("/access", (req, res) => {
  const { token } = req.query
  const data = accessTokens.get(token)

  if (!data) {
    return res.status(403).send("❌ Invalid access link")
  }

  res.sendFile(path.join(__dirname, "protected", "product.html"))
})

// =====================
// DOWNLOAD
// =====================

app.get("/download", (req, res) => {
  const { token, file } = req.query

  if (!token || !sessionTokens.has(token)) {
    return res.status(404).send("❌ Invalid or expired access token.")
  }

  const filePath = path.join(__dirname, "protected", file)

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("❌ File not found.")
  }

  res.download(filePath)
})

// =====================
// 🔔 STRIPE WEBHOOK
// =====================
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"]
    let event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message)
      return res.status(400).send(`Webhook Error`)
    }

    console.log("🔔 Webhook event:", event.type)

    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const token = crypto.randomBytes(32).toString("hex")

      sessionTokens.set(session.id, token)
      accessTokens.set(token, {
        sessionId: session.id,
        createdAt: Date.now(),
      })

      console.log("✅ Token created for session:", session.id)
    }

    res.json({ received: true })
  }
)

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`)
})

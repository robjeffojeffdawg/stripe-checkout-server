import express from "express";
import Stripe from "stripe";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

console.log("Checking customer in DB...");

import { pool } from './db.js';

console.log("Customer check complete");

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express()
const PORT = process.env.PORT || 10000
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

if (
  !process.env.STRIPE_SECRET_KEY ||
  !process.env.STRIPE_WEBHOOK_SECRET ||
  !process.env.STRIPE_PRICE_ID ||
  !process.env.BASE_URL
) {
  throw new Error("❌ Missing Stripe environment variables")
}

console.log("✅ Stripe keys loaded")

// =====================
// NORMAL MIDDLEWARE
// =====================
app.use(express.json())
app.use(express.static("public"))

// Terms
app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "terms.html"));
});

// Privacy
app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy.html"));
});

// Contact
app.get("/contact", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "contact.html"));
});

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

async function savePaymentMethodToDB(userId, paymentMethodId) {
  await pool.query(
    'UPDATE users SET stripe_payment_method_id = $1 WHERE id = $2',
    [paymentMethodId, userId]
  );
}

// =====================
// CREATE SETUP SESSION
// =====================
app.post("/create-setup-session", async (req, res) => {
  try {
    const userId = "unionpay_client_001";
    const email = "client@email.com";

    console.log("➡️ create-setup-session hit");

    const amount = Number(req.body.amount);
    const currency = req.body.currency === "cny" ? "cny" : "usd";

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const customer = await stripe.customers.create({ email });
    const customerId = customer.id;

    // UnionPay note:
    // - "unionpay" covers both physical UnionPay cards AND UnionPay digital wallets.
    // - SetupIntent mode saves the card details in Stripe for future off-session charges,
    //   which works for UnionPay cards that support it (most do via Stripe's network).
    // - CNY requires a Stripe account with CNY enabled. If your account is USD-only,
    //   use currency: "usd" — UnionPay cards still work, just billed in USD.
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,

      // Both card (Visa/Mastercard) and UnionPay (card + digital wallet) are enabled.
      // Stripe will automatically show UnionPay as an option for Chinese cardholders.
      payment_method_types: ["card", "unionpay"],

      // Pass currency so the downstream PaymentIntent uses the right one.
      // Note: Stripe SetupIntent mode doesn't take a currency, but we store it
      // in metadata so the charge step uses it correctly.
      metadata: {
        amount: amount,
        currency: currency,
      },

      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Setup session failed:", err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// =====================
// SUCCESS — CHARGE
// =====================
app.get("/success", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(
      req.query.session_id,
      { expand: ["setup_intent"] }
    );

    const setupIntent = session.setup_intent;
    const paymentMethodId = setupIntent.payment_method;
    const amount = Number(session.metadata.amount);
    const currency = session.metadata.currency || "usd";

    if (!amount || amount < 1) {
      return res.status(400).send("Invalid amount");
    }

    // Retrieve the payment method so we can check its type
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    const pmType = paymentMethod.type; // "card" or "unionpay"

    console.log(`💳 Payment method type: ${pmType}, currency: ${currency}`);

    // UnionPay cards ARE supported for off-session charges via Stripe when saved
    // through a SetupIntent. We confirm off_session the same way as regular cards.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Stripe uses smallest currency unit (fen for CNY, cents for USD)
      currency: currency,
      customer: session.customer,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
    });

    console.log(`✅ Charge successful: ${paymentIntent.id}`);

    // TODO: grant access here (token, DB flag, etc)

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Payment successful</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              max-width: 600px;
              margin: 80px auto;
              text-align: center;
            }
            .btn-primary {
              display: inline-block;
              margin-top: 24px;
              padding: 12px 20px;
              background: black;
              color: white;
              text-decoration: none;
              border-radius: 6px;
            }
          </style>
        </head>
        <body>
          <h2>✅ Payment successful</h2>
          <p>Your payment method has been saved securely.</p>
          <p>You now have access to your purchase.</p>
          <a href="/dashboard" class="btn-primary">Continue</a>
        </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ Success handling failed:", err);

    // Handle the specific case where a UnionPay card cannot be charged off-session
    // (rare, but possible if the card issuer blocks it)
    if (err.code === "authentication_required" || err.code === "card_declined") {
      return res.status(402).send(`
        <!DOCTYPE html>
        <html lang="en">
          <head><meta charset="UTF-8" /><title>Authentication needed</title></head>
          <body style="font-family:system-ui;max-width:600px;margin:80px auto;text-align:center;">
            <h2>⚠️ Additional authentication required</h2>
            <p>Your bank requires you to approve this payment directly.</p>
            <p>Please contact support or try a different card.</p>
            <a href="/index.html">Try again</a>
          </body>
        </html>
      `);
    }

    res.status(500).send("Something went wrong");
  }
});

// =====================
// CANCEL
// =====================
app.get("/cancel", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Payment not completed</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            max-width: 600px;
            margin: 80px auto;
            text-align: center;
          }
          a {
            display: inline-block;
            margin-top: 20px;
            color: #000;
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <h2>Payment not completed</h2>
        <p>No charge was made.</p>
        <a href="/index.html">Try again</a>
      </body>
    </html>
  `);
});

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
      return res.status(400).send("Webhook Error");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      console.log("✅ Checkout session completed:", {
        sessionId: session.id,
        customerId: session.customer,
        setupIntent: session.setup_intent,
      });
    }

    res.json({ received: true });
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`)
})

import express from "express";
import Stripe from "stripe";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const sessionTokens = new Map();
const accessTokens = new Map();

dotenv.config();

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
// MIDDLEWARE
// =====================
app.use(express.json())
app.use(express.static("public"))

app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "terms.html"));
});

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy.html"));
});

app.get("/contact", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "contact.html"));
});

app.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

// =====================
// CREATE SETUP SESSION
// =====================
app.post("/create-setup-session", async (req, res) => {
  try {
    const email = "client@email.com";

    console.log("➡️ create-setup-session hit");

    const amount = Number(req.body.amount);
    const currency = req.body.currency === "cny" ? "cny" : "usd";

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const customer = await stripe.customers.create({ email });

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customer.id,
      payment_method_types: ["card"],
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

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    console.log(`💳 Payment method type: ${paymentMethod.type}, currency: ${currency}`);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
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
            body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; text-align: center; }
            .btn-primary { display: inline-block; margin-top: 24px; padding: 12px 20px; background: black; color: white; text-decoration: none; border-radius: 6px; }
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
          body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; text-align: center; }
          a { display: inline-block; margin-top: 20px; color: #000; text-decoration: underline; }
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
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).send("Webhook Error");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent);
        const paymentMethodId = setupIntent.payment_method;
        const amount = Number(session.metadata.amount);
        const currency = session.metadata.currency || "usd";

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: currency,
          customer: session.customer,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
        });

        console.log("✅ Webhook charge successful:", paymentIntent.id);
      } catch (err) {
        console.error("❌ Webhook charge failed:", err.message);
      }
    }

    res.json({ received: true });
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`)
})

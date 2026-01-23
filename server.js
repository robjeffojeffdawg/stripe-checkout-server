require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const path = require("path");

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

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
   
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook verification failed:", err.message);
      return res.status(400).send("Webhook Error");
    }
  
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.payment_status === "paid") {
        console.log("✅ Payment confirmed via webhook:", session.id); // Fixed: removed semicolon before parenthesis
      }
    }
    
    res.json({ received: true });
  } // Added closing brace for the webhook POST handler
); // Added closing parenthesis for app.post

app.use(express.json());
app.use(express.static("public"));

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
}); // Added closing brace and parenthesis for the GET handler

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
  console.log(`✅ Server running on port ${PORT}`); // Fixed: added backticks for template literal
});
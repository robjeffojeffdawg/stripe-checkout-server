require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      success_url: `${process.env.BASE_URL}/success.html`,
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

app.post("/webhook", (req, res) => {
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

    console.log("✅ Payment confirmed for session:", session.id);
  }

  res.json({ received: true });
});

 const PORT = process.env.PORT || 4242;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// Secure one-time Stripe Checkout with token-based digital delivery

require("dotenv").config()

const express = require("express")
const Stripe = require("stripe")
const path = require("path")
const crypto = require("crypto")
const fs = require("fs")

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

// =====================
// NORMAL MIDDLEWARE
// =====================
app.use(express.json())
app.use(express.static("public"))

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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`)
})

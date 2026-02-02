const stripe = Stripe('pk_test_XXXX'); // your publishable key

async function init() {
  // 1️⃣ Ask backend for SetupIntent
  const res = await fetch('/create-setup-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'client@email.com',
      userId: 'special-client-id',
    }),
  });

  const { clientSecret } = await res.json();

  // 2️⃣ Initialize Elements
  const elements = stripe.elements({
    clientSecret,
  });

  // 3️⃣ Create Payment Element (card-only implicitly)
  const paymentElement = elements.create('payment', {
    fields: {
      billingDetails: {
        email: 'auto',
      },
    },
  });

  paymentElement.mount('#payment-element');

  // 4️⃣ Confirm SetupIntent
  document.getElementById('submit').addEventListener('click', async () => {
    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
      return_url: window.location.origin + '/setup-complete'
,
      },
    });

    if (error) {
      document.getElementById('error').innerText = error.message;
    }
  });
}

init();

// ─────────────────────────────────────────────────────────────────
// TeeRadar – Routes: Prenumerationer & Stripe Webhook
// ─────────────────────────────────────────────────────────────────

import { Router } from 'express';
import Stripe from 'stripe';
import { addSubscriber } from '../services/supabase.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── POST /api/subscribe ──────────────────────────────────────────
router.post('/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Ogiltig e-postadress' });
  }

  try {
    await addSubscriber(email);
    res.json({ success: true });
  } catch (err) {
    console.error('[/subscribe]', err.message);
    res.status(500).json({ error: 'Kunde inte spara prenumeration' });
  }
});

// ── POST /api/webhook/stripe ─────────────────────────────────────
// Stripe webhook – säkerhetskopia om frontend-confirm misslyckas
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,  // Kräver raw body – se index.js
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[Webhook] Signaturfel:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    console.log(`✅ [Webhook] Betalning lyckad: ${pi.id}`);
    // Booking-bekräftelse hanteras via /bookings/confirm från frontend
    // Webhook är backup om frontend-anropet misslyckas
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    console.log(`❌ [Webhook] Betalning misslyckad: ${pi.id}`);
    // TODO: Frigör GolfManager-hold
  }

  res.json({ received: true });
});

export default router;

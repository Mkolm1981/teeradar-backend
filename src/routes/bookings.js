// ─────────────────────────────────────────────────────────────────
// TeeRadar – Routes: Bokningar & Betalning
// Hanterar hold → Stripe → bekräftelse → GolfManager
// ─────────────────────────────────────────────────────────────────

import { Router } from 'express';
import Stripe from 'stripe';
import { makeReservation, confirmReservation, cancelReservation } from '../services/golfmanager.js';
import { createBooking, createHold, getHoldByPaymentIntent, deleteHold, updateBookingStatus } from '../services/supabase.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SERVICE_FEE = 2.50;  // €2.50 per spelare

// ── Generera bokningsnummer ──────────────────────────────────────
function generateBookingRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'TR-';
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

// ── POST /api/bookings/hold ──────────────────────────────────────
// Steg 1: Prereservera tid hos GolfManager + skapa Stripe PaymentIntent
router.post('/hold', async (req, res) => {
  const {
    courseSlug,
    startFull,
    idType,
    idResource,
    gmTenant,
    gmVersion,
    players,
    playerNames,
    homeClub,
    email,
    displayPrice,   // Pris per spelare (vår marginal inkluderad)
    originalPrice,
  } = req.body;

  // Validering
  if (!courseSlug || !startFull || !idType || !gmTenant || !email) {
    return res.status(400).json({ error: 'Saknade fält' });
  }

  try {
    // 1. Prereservera hos GolfManager
    const prereservations = await makeReservation({
      tenant: gmTenant,
      idResource,
      start: startFull,
      idType,
      name: playerNames[0] || 'TeeRadar Kund',
      email,
      slots: players,
      version: gmVersion === 'V3' ? 'v3' : 'v1',
    });

    const gmIds = Array.isArray(prereservations)
      ? prereservations.map(r => r.id)
      : [prereservations?.id];

    if (!gmIds[0]) {
      return res.status(502).json({ error: 'GolfManager prereservation misslyckades' });
    }

    // 2. Beräkna totalpris
    const greenfeeTotal = displayPrice * players;
    const serviceFeeTotal = SERVICE_FEE * players;
    const totalCents = Math.round((greenfeeTotal + serviceFeeTotal) * 100);

    // 3. Skapa Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'eur',
      metadata: {
        courseSlug,
        startFull,
        players: String(players),
        gmTenant,
        gmIds: JSON.stringify(gmIds),
        gmVersion: gmVersion || 'v1',
        email,
      },
      receipt_email: email,
    });

    // 4. Spara hold i databasen
    const expiresAt = new Date(Date.now() + 12 * 60 * 1000).toISOString();
    await createHold({
      stripe_payment_intent_id: paymentIntent.id,
      gm_ids: gmIds,
      gm_tenant: gmTenant,
      gm_version: gmVersion || 'v1',
      course_slug: courseSlug,
      start_time: startFull,
      players,
      email,
      display_price: displayPrice,
      original_price: originalPrice,
      service_fee: SERVICE_FEE,
      total_amount: greenfeeTotal + serviceFeeTotal,
      player_names: playerNames,
      home_club: homeClub,
      expires_at: expiresAt,
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalAmount: greenfeeTotal + serviceFeeTotal,
      greenfeeTotal,
      serviceFeeTotal,
      expiresAt,
    });

  } catch (err) {
    console.error('[/bookings/hold]', err.message);
    res.status(500).json({ error: 'Kunde inte prereservera tid' });
  }
});

// ── POST /api/bookings/confirm ───────────────────────────────────
// Anropas från frontend efter lyckad Stripe-betalning
router.post('/confirm', async (req, res) => {
  const { paymentIntentId } = req.body;

  if (!paymentIntentId) {
    return res.status(400).json({ error: 'paymentIntentId krävs' });
  }

  try {
    // 1. Verifiera betalning hos Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(402).json({ error: 'Betalning ej genomförd' });
    }

    // 2. Hämta hold från databasen
    const hold = await getHoldByPaymentIntent(paymentIntentId);
    if (!hold) {
      return res.status(404).json({ error: 'Hold hittades inte' });
    }

    // 3. Bekräfta hos GolfManager
    await confirmReservation(
      hold.gm_ids,
      hold.gm_tenant,
      hold.gm_version === 'V3' ? 'v3' : 'v1'
    );

    // 4. Skapa bokningspost i databasen
    const bookingRef = generateBookingRef();
    const booking = await createBooking({
      booking_ref: bookingRef,
      course_slug: hold.course_slug,
      start_time: hold.start_time,
      players: hold.players,
      email: hold.email,
      player_names: hold.player_names,
      home_club: hold.home_club,
      display_price: hold.display_price,
      original_price: hold.original_price,
      service_fee: hold.service_fee,
      total_amount: hold.total_amount,
      gm_ids: hold.gm_ids,
      gm_tenant: hold.gm_tenant,
      stripe_payment_intent_id: paymentIntentId,
      status: 'confirmed',
    });

    // 5. Rensa hold
    await deleteHold(hold.id);

    // 6. TODO: Skicka bekräftelsemejl (Resend)

    res.json({
      success: true,
      bookingRef,
      booking,
    });

  } catch (err) {
    console.error('[/bookings/confirm]', err.message);
    res.status(500).json({ error: 'Bekräftelse misslyckades' });
  }
});

// ── GET /api/bookings/:ref ───────────────────────────────────────
// Hämta bokningsinformation via bokningsreferens
router.get('/:ref', async (req, res) => {
  try {
    const { getBookingByRef } = await import('../services/supabase.js');
    const booking = await getBookingByRef(req.params.ref);
    if (!booking) return res.status(404).json({ error: 'Bokning hittades inte' });
    res.json(booking);
  } catch (err) {
    console.error('[/bookings/:ref]', err.message);
    res.status(500).json({ error: 'Kunde inte hämta bokning' });
  }
});

// ── POST /api/bookings/:ref/cancel ───────────────────────────────
// Avboka
router.post('/:ref/cancel', async (req, res) => {
  try {
    const { getBookingByRef } = await import('../services/supabase.js');
    const booking = await getBookingByRef(req.params.ref);
    if (!booking) return res.status(404).json({ error: 'Bokning hittades inte' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Redan avbokad' });

    // Avboka hos GolfManager
    await cancelReservation(
      booking.gm_ids,
      booking.gm_tenant,
      booking.gm_version === 'V3' ? 'v3' : 'v1'
    );

    // Uppdatera status
    await updateBookingStatus(booking.id, 'cancelled');

    // TODO: Stripe-återbetalning

    res.json({ success: true });
  } catch (err) {
    console.error('[/bookings/:ref/cancel]', err.message);
    res.status(500).json({ error: 'Avbokning misslyckades' });
  }
});

export default router;

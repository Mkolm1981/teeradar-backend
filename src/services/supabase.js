// ─────────────────────────────────────────────────────────────────
// TeeRadar – Supabase Service
// Hanterar all databaskommunikation
// ─────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service key används i backend
);

export default supabase;

// ─────────────────────────────────────────────────────────────────
// KLUBBAR
// ─────────────────────────────────────────────────────────────────

export async function getCourses({ lastMinuteOnly = false } = {}) {
  let query = supabase
    .from('courses')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (lastMinuteOnly) query = query.eq('has_last_minute', true);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCourseBySlug(slug) {
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .eq('slug', slug)
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────
// SISTA-MINUTEN DEALS
// ─────────────────────────────────────────────────────────────────

export async function getActiveDeals() {
  const { data, error } = await supabase
    .from('last_minute_deals')
    .select('*, courses(name, slug, location, area, image, rating, holes, par)')
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createDeal(deal) {
  const { data, error } = await supabase
    .from('last_minute_deals')
    .insert(deal)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function expireOldDeals() {
  const { error } = await supabase
    .from('last_minute_deals')
    .update({ active: false })
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────
// BOKNINGAR
// ─────────────────────────────────────────────────────────────────

export async function createBooking(booking) {
  const { data, error } = await supabase
    .from('bookings')
    .insert(booking)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getBookingByRef(bookingRef) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, courses(name, location, image)')
    .eq('booking_ref', bookingRef)
    .single();
  if (error) throw error;
  return data;
}

export async function updateBookingStatus(id, status, extra = {}) {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status, ...extra })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────
// PRERESERVATIONER (holds)
// ─────────────────────────────────────────────────────────────────

export async function createHold(hold) {
  const { data, error } = await supabase
    .from('holds')
    .insert(hold)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getHoldByPaymentIntent(paymentIntentId) {
  const { data, error } = await supabase
    .from('holds')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHold(id) {
  const { error } = await supabase
    .from('holds')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────
// PRENUMERANTER (email-deals)
// ─────────────────────────────────────────────────────────────────

export async function addSubscriber(email) {
  const { data, error } = await supabase
    .from('subscribers')
    .upsert({ email, active: true }, { onConflict: 'email' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getActiveSubscribers() {
  const { data, error } = await supabase
    .from('subscribers')
    .select('email')
    .eq('active', true);
  if (error) throw error;
  return data;
}

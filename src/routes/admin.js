// src/routes/admin.js
// Admin-routes för TeeRadar backend
// Skyddas med x-admin-password header

import { Router } from 'express';
import supabase from '../services/supabase.js';
import { runLastMinuteEngine } from '../services/lastMinute.js';

const router = Router();

// ── Auth middleware ──────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TeeRadar2026!';

function requireAdmin(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(requireAdmin);

// ── GET /api/admin/stats ─────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

    const [bookingsToday, bookingsWeek, bookingsMonth, activeCourses, subscribers, activeDeals] =
      await Promise.all([
        supabase.from('bookings').select('id', { count: 'exact' })
          .gte('created_at', todayStart.toISOString()).eq('status', 'confirmed'),
        supabase.from('bookings').select('id', { count: 'exact' })
          .gte('created_at', weekStart.toISOString()).eq('status', 'confirmed'),
        supabase.from('bookings').select('id,total_amount', { count: 'exact' })
          .gte('created_at', monthStart.toISOString()).eq('status', 'confirmed'),
        supabase.from('courses').select('id', { count: 'exact' }).eq('active', true),
        supabase.from('subscribers').select('id', { count: 'exact' }).eq('active', true),
        supabase.from('last_minute_deals').select('id', { count: 'exact' })
          .eq('active', true).gt('expires_at', now.toISOString()),
      ]);

    const revenueMonth = (bookingsMonth.data || [])
      .reduce((s, b) => s + (b.total_amount || 0), 0);

    res.json({
      bookings_today: bookingsToday.count || 0,
      bookings_week:  bookingsWeek.count  || 0,
      bookings_month: bookingsMonth.count  || 0,
      revenue_month:  Math.round(revenueMonth * 100) / 100,
      active_courses: activeCourses.count  || 0,
      subscribers:    subscribers.count    || 0,
      active_deals:   activeDeals.count    || 0,
      last_sm_run:    null, // TODO: spara i settings-tabell
    });
  } catch (err) {
    console.error('[admin/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/bookings ──────────────────────────────────────
router.get('/bookings', async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 50, 500);
    const status = req.query.status;
    const from   = req.query.from;
    const to     = req.query.to;

    let q = supabase.from('bookings').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status && status !== 'alla') q = q.eq('status', status);
    if (from) q = q.gte('start_time', from);
    if (to)   q = q.lte('start_time', to);

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[admin/bookings]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/courses ───────────────────────────────────────
router.get('/courses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[admin/courses]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/courses/:id ─────────────────────────────────
router.patch('/courses/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updates = req.body;

    // Tillåtna fält att uppdatera
    const allowed = [
      'name', 'area', 'country', 'active', 'has_last_minute',
      'from_price', 'rating', 'holes', 'par', 'difficulty',
      'description', 'image', 'gm_tenant', 'gm_resource_id',
      'gm_version', 'booking_system', 'has_buggy', 'has_restaurant',
      'has_pro_shop', 'has_driving_range',
    ];
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([k]) => allowed.includes(k))
    );
    filtered.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('courses')
      .update(filtered)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[admin/courses/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/subscribers ───────────────────────────────────
router.get('/subscribers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[admin/subscribers]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/subscribers/:id ───────────────────────────
router.delete('/subscribers/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('subscribers')
      .update({ active: false })
      .eq('id', Number(req.params.id));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/run-sm-engine ────────────────────────────────
router.post('/run-sm-engine', async (req, res) => {
  try {
    console.log('[Admin] Manuell SM-motor körning startad');
    // Kör asynkront så vi kan svara snabbt
    runLastMinuteEngine().catch(err =>
      console.error('[Admin SM] Fel:', err.message)
    );
    res.json({ success: true, message: 'SM-motor startad', deals_created: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/deals ─────────────────────────────────────────
router.get('/deals', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('last_minute_deals')
      .select('*, courses(name, slug, location)')
      .order('start_time', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Kickback-rapport ─────────────────────────────────────────────
// GET /api/admin/kickback-report?period=2026-04
router.get('/kickback-report', async (req, res) => {
  try {
    const period = req.query.period || new Date().toISOString().slice(0, 7);
    const start  = `${period}-01T00:00:00`;
    const end    = new Date(new Date(`${period}-01`).getFullYear(),
                            new Date(`${period}-01`).getMonth() + 1, 0)
                   .toISOString().slice(0, 10) + 'T23:59:59';

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .gte('created_at', start)
      .lte('created_at', end)
      .eq('status', 'confirmed')
      .not('home_club', 'is', null);

    if (error) throw error;

    // Gruppera per hemmaklubb
    const byClub = {};
    const MARGIN = 0.20;
    const KICKBACK_PCT = Number(process.env.KICKBACK_DEFAULT_PERCENT || 30) / 100;

    (bookings || []).forEach((b) => {
      if (!b.home_club) return;
      if (!byClub[b.home_club]) byClub[b.home_club] = { bookings: [], total_greenfee: 0, our_margin: 0, kickback: 0 };
      const greenfee = (b.display_price || 0) * (b.players || 1);
      const margin   = greenfee * MARGIN;
      const kickback = margin * KICKBACK_PCT;
      byClub[b.home_club].bookings.push(b);
      byClub[b.home_club].total_greenfee += greenfee;
      byClub[b.home_club].our_margin     += margin;
      byClub[b.home_club].kickback       += kickback;
    });

    res.json({
      period,
      kickback_percent: KICKBACK_PCT * 100,
      clubs: Object.entries(byClub).map(([club, data]) => ({
        club,
        bookings_count: data.bookings.length,
        total_greenfee: Math.round(data.total_greenfee * 100) / 100,
        our_margin:     Math.round(data.our_margin * 100) / 100,
        kickback:       Math.round(data.kickback * 100) / 100,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

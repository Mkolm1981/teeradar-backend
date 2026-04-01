// ─────────────────────────────────────────────────────────────────
// TeeRadar – Admin Routes
// Skyddas av x-admin-password header
// ─────────────────────────────────────────────────────────────────

import { Router } from 'express';
import supabase from '../services/supabase.js';
import { runLastMinuteEngine } from '../services/lastMinute.js';

const router = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TeeRadar2026!';

// ── Auth middleware ──────────────────────────────────────────────
router.use((req, res, next) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── In-memory SM-logg ────────────────────────────────────────────
const smLog = [];

// ── GET /api/admin/stats ─────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [bookingsRes, coursesRes, subscribersRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, booking_ref, course_slug, start_time, players, total_amount, email, status, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('courses').select('id, active'),
      supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('active', true),
    ]);

    if (bookingsRes.error) throw bookingsRes.error;
    if (coursesRes.error) throw coursesRes.error;

    const bookings = bookingsRes.data || [];
    const courses  = coursesRes.data || [];
    const recent   = bookings.slice(0, 10);

    // Hämta kursnamn för de senaste bokningarna
    const slugs = [...new Set(recent.map(b => b.course_slug))];
    const { data: courseNames } = slugs.length
      ? await supabase.from('courses').select('slug, name').in('slug', slugs)
      : { data: [] };

    const nameMap = Object.fromEntries((courseNames || []).map(c => [c.slug, c.name]));

    const totalRevenue = bookings
      .filter(b => b.status !== 'cancelled')
      .reduce((sum, b) => sum + (b.total_amount || 0), 0);

    res.json({
      totalBookings: bookings.length,
      totalRevenue: Math.round(totalRevenue),
      activeCourses: courses.filter(c => c.active).length,
      subscribers: subscribersRes.count || 0,
      recentBookings: recent.map(b => ({
        ...b,
        course_name: nameMap[b.course_slug] || b.course_slug,
      })),
    });
  } catch (err) {
    console.error('[admin/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/bookings ──────────────────────────────────────
router.get('/bookings', async (req, res) => {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, booking_ref, course_slug, start_time, players, total_amount, email, status, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const slugs = [...new Set(bookings.map(b => b.course_slug))];
    const { data: courseNames } = slugs.length
      ? await supabase.from('courses').select('slug, name').in('slug', slugs)
      : { data: [] };

    const nameMap = Object.fromEntries((courseNames || []).map(c => [c.slug, c.name]));

    res.json(
      bookings.map(b => ({
        ...b,
        course_name: nameMap[b.course_slug] || b.course_slug,
      }))
    );
  } catch (err) {
    console.error('[admin/bookings]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/subscribers ───────────────────────────────────
router.get('/subscribers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers')
      .select('id, email, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[admin/subscribers]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/courses ───────────────────────────────────────
// Returnerar ALLA banor (inkl. inaktiva)
router.get('/courses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[admin/courses]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/admin/courses/:id ───────────────────────────────────
router.put('/courses/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Ogiltigt id' });
  }

  const allowed = [
    'name', 'description', 'image', 'active', 'gm_version',
    'from_price', 'has_buggy', 'has_restaurant', 'has_pro_shop', 'has_driving_range',
  ];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Inga giltiga fält att uppdatera' });
  }

  try {
    const { data, error } = await supabase
      .from('courses')
      .update({ ...updates, updated_at: new Date().toISOString() })
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

// ── POST /api/admin/sm/run ───────────────────────────────────────
router.post('/sm/run', async (req, res) => {
  const start = Date.now();
  try {
    await runLastMinuteEngine();
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      status: 'success',
      message: `SM-motor kördes manuellt – klar på ${duration}s`,
    };
    smLog.unshift(entry);
    if (smLog.length > 50) smLog.pop();
    res.json({ message: entry.message });
  } catch (err) {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      status: 'error',
      message: `SM-motor misslyckades: ${err.message}`,
    };
    smLog.unshift(entry);
    if (smLog.length > 50) smLog.pop();
    console.error('[admin/sm/run]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/sm/log ────────────────────────────────────────
router.get('/sm/log', (req, res) => {
  res.json(smLog.slice(0, 50));
});

export default router;

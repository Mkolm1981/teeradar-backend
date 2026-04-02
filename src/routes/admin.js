// ─────────────────────────────────────────────────────────────────
// TeeRadar – Admin Routes
// Skyddas av x-admin-password header
// ─────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import supabase from '../services/supabase.js';
import { runLastMinuteEngine } from '../services/lastMinute.js';
import { ALL_CLUBS } from '../../scripts/seed-clubs.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    'name', 'description', 'image', 'image_map', 'active', 'gm_version',
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

// ── POST /api/admin/upload ───────────────────────────────────────
// Laddar upp bild till Supabase Storage, returnerar publik URL
// type: 'image' (presentationsbild) eller 'map' (banakarta)
router.post('/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Ingen fil uppladdad' });

  const { slug, type } = req.body;
  if (!slug || !['image', 'map'].includes(type)) {
    return res.status(400).json({ error: 'slug och type (image|map) krävs' });
  }

  const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
  const bucket = 'course-images';
  const path = `${slug}/${type}.${ext}`;

  try {
    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    res.json({ url: publicUrl });
  } catch (err) {
    console.error('[admin/upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/run-sm-engine (alias) ────────────────────────
router.post('/run-sm-engine', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/seed-clubs ───────────────────────────────────
// Kör seeden direkt via admin-API (en gång)
router.post('/seed-clubs', async (req, res) => {
  try {
    const rows = ALL_CLUBS.map((c, i) => ({
      slug: c.slug,
      name: c.name,
      area: c.area,
      location: c.location,
      gm_version: c.gm_version,
      active: false,
      has_last_minute: false,
      rating: 0,
      reviews: 0,
      holes: 18,
      par: 72,
      difficulty: 'medium',
      from_price: 0,
      image: '',
      lat: 0,
      lng: 0,
      sort_order: i + 1,
    }));

    const BATCH = 50;
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('courses')
        .upsert(batch, { onConflict: 'slug', ignoreDuplicates: true })
        .select('slug');

      if (error) throw error;
      inserted += data?.length ?? 0;
      skipped += batch.length - (data?.length ?? 0);
    }

    res.json({
      message: `Seed klar: ${inserted} insatta, ${skipped} redan existerande`,
      inserted,
      skipped,
      total: ALL_CLUBS.length,
    });
  } catch (err) {
    console.error('[admin/seed-clubs]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;

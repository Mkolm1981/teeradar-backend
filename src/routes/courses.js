// ─────────────────────────────────────────────────────────────────
// TeeRadar – Routes: Sökning, Deals, Banor
// ─────────────────────────────────────────────────────────────────

import { Router } from 'express';
import axios from 'axios';
import { searchMultipleCourses, searchAvailability } from '../services/golfmanager.js';
import { getCourses, getCourseBySlug, getActiveDeals } from '../services/supabase.js';

const router = Router();

// ── GET /api/courses ─────────────────────────────────────────────
router.get('/courses', async (req, res) => {
  try {
    const courses = await getCourses();
    res.json(courses);
  } catch (err) {
    console.error('[/courses]', err.message);
    res.status(500).json({ error: 'Kunde inte hämta klubbar' });
  }
});

// ── GET /api/courses/:slug ───────────────────────────────────────
router.get('/courses/:slug', async (req, res) => {
  try {
    const course = await getCourseBySlug(req.params.slug);
    if (!course) return res.status(404).json({ error: 'Klubb hittades inte' });
    res.json(course);
  } catch (err) {
    console.error('[/courses/:slug]', err.message);
    res.status(500).json({ error: 'Kunde inte hämta klubb' });
  }
});

// ── GET /api/deals ───────────────────────────────────────────────
router.get('/deals', async (req, res) => {
  try {
    const deals = await getActiveDeals();
    res.json(deals);
  } catch (err) {
    console.error('[/deals]', err.message);
    res.status(500).json({ error: 'Kunde inte hämta deals' });
  }
});

// ── GET /api/debug/gm ────────────────────────────────────────────
// Debug: Visa råsvar från GolfManager utan normalisering
router.get('/debug/gm', async (req, res) => {
  try {
    const username = process.env.GOLFMANAGER_USERNAME;
    const password = process.env.GOLFMANAGER_API_KEY;
    const baseUrl  = process.env.GOLFMANAGER_V1_BASE_URL || 'https://mt-com.golfmanager.app/api';
    const date     = req.query.date || '2026-04-09';
    const resource = req.query.resource || 1;

    const encoded = Buffer.from(`${username}:${password}`).toString('base64');

    const response = await axios.get(`${baseUrl}/searchAvailability`, {
      headers: { Authorization: `Basic ${encoded}` },
      params: {
        tenant:     'demo',
        start:      `${date}T00:00:00`,
        end:        `${date}T18:00:00`,
        slots:      2,
        idResource: resource,
      },
      timeout: 10000,
    });

    // Visa råsvaret + första elementet i detalj
    res.json({
      count:   Array.isArray(response.data) ? response.data.length : 0,
      first:   Array.isArray(response.data) ? response.data[0] : response.data,
      raw:     Array.isArray(response.data) ? response.data.slice(0, 3) : response.data,
    });
  } catch (err) {
    res.status(500).json({
      error:   err.message,
      status:  err.response?.status,
      data:    err.response?.data,
    });
  }
});

// ── GET /api/search ──────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const { date, destination, players = 2 } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'date krävs (YYYY-MM-DD)' });
  }

  try {
    let courses = await getCourses();

    if (destination && destination !== 'Alla') {
      courses = courses.filter(c =>
        c.area?.toLowerCase() === destination.toLowerCase() ||
        c.location?.toLowerCase().includes(destination.toLowerCase())
      );
    }

    const configured = courses.filter(c => c.gm_tenant && c.gm_resource_id);

    if (configured.length === 0) {
      return res.json([]);
    }

    const results = await searchMultipleCourses(
      configured.map(c => ({
        slug:      c.slug,
        tenant:    c.gm_tenant,
        idResource: c.gm_resource_id,
        gmVersion: c.gm_version,
      })),
      date,
      Number(players)
    );

    const combined = [];
    for (const result of results) {
      if (result.error || result.times.length === 0) continue;
      const course = configured.find(c => c.slug === result.courseSlug);
      if (!course) continue;

      for (const slot of result.times) {
        if (!slot.time) continue; // Hoppa över slots utan tid
        combined.push({
          id:             `${result.courseSlug}-${slot.id}`,
          course:         course.name,
          location:       course.location,
          area:           course.area,
          image:          course.image,
          rating:         course.rating,
          reviews:        course.reviews,
          holes:          course.holes,
          par:            course.par,
          difficulty:     course.difficulty,
          time:           slot.time,
          startFull:      slot.startFull,
          originalPrice:  slot.price,
          discountedPrice: Math.round((slot.price || 0) * 0.80),
          discount:       20,
          spotsLeft:      slot.maxSlots || 4,
          isLastMinute:   false,
          slug:           result.courseSlug,
          _gmTenant:      course.gm_tenant,
          _gmVersion:     course.gm_version,
          _gmIdType:      slot.idType,
          _gmIdResource:  slot.idResource,
        });
      }
    }

    combined.sort((a, b) => a.time.localeCompare(b.time));
    res.json(combined);
  } catch (err) {
    console.error('[/search]', err.message);
    res.status(500).json({ error: 'Sökning misslyckades' });
  }
});

// ── GET /api/courses/:slug/times ─────────────────────────────────
router.get('/courses/:slug/times', async (req, res) => {
  const { date, players = 2 } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'date krävs' });
  }

  try {
    const course = await getCourseBySlug(req.params.slug);
    if (!course) return res.status(404).json({ error: 'Klubb hittades inte' });

    if (!course.gm_tenant || !course.gm_resource_id) {
      return res.json([]);
    }

    const slots = await searchAvailability({
      tenant:     course.gm_tenant,
      date,
      idResource: course.gm_resource_id,
      slots:      Number(players),
      version:    course.gm_version === 'V3' ? 'v3' : 'v1',
    });

    const result = slots
      .filter(slot => slot.time) // Filtrera bort slots utan tid
      .map(slot => ({
        ...slot,
        displayPrice:  Math.round((slot.price || 0) * 0.80),
        originalPrice: slot.price,
        discount:      20,
        isLastMinute:  false,
      }));

    res.json(result);
  } catch (err) {
    console.error('[/courses/:slug/times]', err.message);
    res.status(500).json({ error: 'Kunde inte hämta tider' });
  }
});

export default router;

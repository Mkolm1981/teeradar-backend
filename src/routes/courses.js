// ─────────────────────────────────────────────────────────────────
// TeeRadar – Routes: Sökning, Deals, Banor
// ─────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { searchMultipleCourses, searchAvailability } from '../services/golfmanager.js';
import { getCourses, getCourseBySlug, getActiveDeals } from '../services/supabase.js';

const router = Router();

// ── GET /api/courses ─────────────────────────────────────────────
// Returnerar alla aktiva klubbar (ersätter allCourses.ts mock)
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
// Returnerar en specifik klubb
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
// Returnerar aktiva sista-minuten-deals (ersätter liveDeals.ts mock)
router.get('/deals', async (req, res) => {
  try {
    const deals = await getActiveDeals();
    res.json(deals);
  } catch (err) {
    console.error('[/deals]', err.message);
    res.status(500).json({ error: 'Kunde inte hämta deals' });
  }
});

// ── GET /api/search ──────────────────────────────────────────────
// Söker lediga tider (ersätter mockSearchResults.ts)
// Query params: date, destination, players
router.get('/search', async (req, res) => {
  const { date, destination, players = 2 } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'date krävs (YYYY-MM-DD)' });
  }

  try {
    // Hämta klubbar att söka mot
    let courses = await getCourses();

    // Filtrera på destination om angiven
    if (destination && destination !== 'Alla') {
      courses = courses.filter(c =>
        c.area?.toLowerCase() === destination.toLowerCase() ||
        c.location?.toLowerCase().includes(destination.toLowerCase())
      );
    }

    // Söker bara mot klubbar med GM-konfiguration
    const configured = courses.filter(c => c.gm_tenant && c.gm_resource_id);

    if (configured.length === 0) {
      return res.json([]);
    }

    // Sök parallellt mot alla klubbar
    const results = await searchMultipleCourses(
      configured.map(c => ({
        slug: c.slug,
        tenant: c.gm_tenant,
        idResource: c.gm_resource_id,
        gmVersion: c.gm_version,
      })),
      date,
      Number(players)
    );

    // Kombinera med klubbinfo och normalisera
    const combined = [];
    for (const result of results) {
      if (result.error || result.times.length === 0) continue;
      const course = configured.find(c => c.slug === result.courseSlug);
      if (!course) continue;

      for (const slot of result.times) {
        combined.push({
          id: `${result.courseSlug}-${slot.id}`,
          course: course.name,
          location: course.location,
          area: course.area,
          image: course.image,
          rating: course.rating,
          reviews: course.reviews,
          holes: course.holes,
          par: course.par,
          difficulty: course.difficulty,
          time: slot.time,
          startFull: slot.startFull,
          originalPrice: slot.price,
          discountedPrice: Math.round(slot.price * 0.80),  // 20% marginal
          discount: 20,
          spotsLeft: slot.maxSlots || 4,
          isLastMinute: false,
          slug: result.courseSlug,
          // Interna fält för bokningsprocessen
          _gmTenant: course.gm_tenant,
          _gmVersion: course.gm_version,
          _gmIdType: slot.idType,
          _gmIdResource: slot.idResource,
        });
      }
    }

    // Sortera på tid
    combined.sort((a, b) => a.time.localeCompare(b.time));

    res.json(combined);
  } catch (err) {
    console.error('[/search]', err.message);
    res.status(500).json({ error: 'Sökning misslyckades' });
  }
});

// ── GET /api/courses/:slug/times ─────────────────────────────────
// Hämtar tillgängliga tider för en specifik bana (bansidan)
router.get('/courses/:slug/times', async (req, res) => {
  const { date, players = 2 } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'date krävs' });
  }

  try {
    const course = await getCourseBySlug(req.params.slug);
    if (!course) return res.status(404).json({ error: 'Klubb hittades inte' });

    if (!course.gm_tenant || !course.gm_resource_id) {
      return res.json([]);  // Klubb utan GM-koppling
    }

    const slots = await searchAvailability({
      tenant: course.gm_tenant,
      date,
      idResource: course.gm_resource_id,
      slots: Number(players),
      version: course.gm_version === 'V3' ? 'v3' : 'v1',
    });

    // Lägg på prislogik
    const result = slots.map(slot => ({
      ...slot,
      displayPrice: Math.round(slot.price * 0.80),
      originalPrice: slot.price,
      discount: 20,
      isLastMinute: false,
    }));

    res.json(result);
  } catch (err) {
    console.error('[/courses/:slug/times]', err.message);
    res.status(500).json({ error: 'Kunde inte hämta tider' });
  }
});

export default router;

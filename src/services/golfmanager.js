// ─────────────────────────────────────────────────────────────────
// TeeRadar – GolfManager Service
// Hanterar all kommunikation mot GolfManager API (V1 + V3)
// Baserat på Carlos instruktioner, mars 2026
// ─────────────────────────────────────────────────────────────────

import axios from 'axios';

// ── Klienter för V1 och V3 ──────────────────────────────────────
function getV1Client(tenant) {
  const t        = tenant || process.env.GOLFMANAGER_TENANT || 'demo';
  const username = process.env.GOLFMANAGER_USERNAME;
  const password = process.env.GOLFMANAGER_API_KEY;

  const params  = { tenant: t };
  const headers = {};

  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }

  return axios.create({
    baseURL: process.env.GOLFMANAGER_V1_BASE_URL || 'https://mt.golfmanager.app/api',
    timeout: 12000,
    params,
    headers,
  });
}

function getV3Client(tenant) {
  const t   = tenant || process.env.GOLFMANAGER_V3_TENANT;
  const key = process.env.GOLFMANAGER_V3_API_KEY;

  if (!process.env.GOLFMANAGER_V3_BASE_URL) {
    throw new Error('GOLFMANAGER_V3_BASE_URL saknas i miljövariabler');
  }

  return axios.create({
    baseURL: process.env.GOLFMANAGER_V3_BASE_URL,
    timeout: 12000,
    headers: {
      'key':    key,
      'tenant': t,
      'Content-Type': 'application/json',
    },
  });
}

function getClient(version = 'v1', tenant) {
  return version === 'v3' ? getV3Client(tenant) : getV1Client(tenant);
}

// ─────────────────────────────────────────────────────────────────
// 1. SETUP – Hämta grunddata per klubb
// ─────────────────────────────────────────────────────────────────

export async function getTenants(version = 'v1') {
  const client = getClient(version);
  const res = await client.get('/tenants');
  return res.data;
}

export async function getResources(tenant, version = 'v1') {
  const client = getClient(version, tenant);
  const res = await client.get('/resources');
  return res.data;
}

export async function getAvailabilityTypes(tenant, version = 'v1') {
  const client = getClient(version, tenant);
  const res = await client.get('/availabilityTypes');
  return res.data;
}

// ─────────────────────────────────────────────────────────────────
// 2. SÖK LEDIGA TIDER
// ─────────────────────────────────────────────────────────────────

export async function searchAvailability({ tenant, date, idResource, slots = 2, version = 'v1' }) {
  const client = getClient(version, tenant);

  const start = `${date}T00:00:00`;
  const end   = `${date}T18:00:00`;

  const res = await client.get('/searchAvailability', {
    params: { start, end, idResource, slots },
  });

  // GolfManager returnerar: [{ date, slots, types: [{start, price, idType, max, min, ...}] }]
  const results = [];
  for (const slot of (res.data || [])) {
    const types = slot.types || [];
    for (const t of types) {
      const startStr = t.start || slot.date || '';
      const timePart = startStr.length >= 16 ? startStr.slice(11, 16) : '';
      const maxSlots = t.max || 4;
      const minSlots = t.min || 1;
      results.push({
        id:            t.id || t.idType || `${startStr}-${t.idType}`,
        time:          timePart,
        startFull:     startStr,
        idType:        t.idType,
        idResource:    t.idResource || idResource,
        price:         t.price,
        originalPrice: t.rack || t.price,
        minSlots,
        maxSlots,
        spotsLeft:     slot.slots || maxSlots,
        name:          t.name || '',
        tags:          t.tags || [],
        isLastMinute:  false,
        tenant,
        version,
      });
    }
  }
  return results;
}

export async function searchMultipleCourses(courseConfigs, date, slots) {
  const promises = courseConfigs.map(async (course) => {
    try {
      const times = await searchAvailability({
        tenant:     course.tenant,
        date,
        idResource: course.idResource,
        slots,
        version:    course.gmVersion === 'V3' ? 'v3' : 'v1',
      });
      return { courseSlug: course.slug, times, error: null };
    } catch (err) {
      console.error(`GolfManager error for ${course.slug}:`, err.message);
      return { courseSlug: course.slug, times: [], error: err.message };
    }
  });

  return Promise.all(promises);
}

// ─────────────────────────────────────────────────────────────────
// 3. BOKNINGSFLÖDE
// ─────────────────────────────────────────────────────────────────

export async function makeReservation({ tenant, idResource, start, idType, name, email, slots = 2, version = 'v1' }) {
  const client = getClient(version, tenant);

  const timeout = new Date(Date.now() + 12 * 60 * 1000).toISOString().slice(0, 19);

  const reservations = Array.from({ length: slots }, (_, i) => ({
    idResource,
    start,
    name:    i === 0 ? name : `${name} (spelare ${i + 1})`,
    email,
    idType,
    timeout,
  }));

  const res = await client.get('/makeReservation', {
    params: { reservations: JSON.stringify(reservations) },
  });

  return res.data;
}

export async function confirmReservation(ids, tenant, version = 'v1') {
  const client = getClient(version, tenant);
  const res = await client.get('/confirmReservation', {
    params: { ids: JSON.stringify(ids) },
  });
  return res.data;
}

export async function cancelReservation(ids, tenant, version = 'v1') {
  const client = getClient(version, tenant);
  const res = await client.get('/cancelReservation', {
    params: { ids: JSON.stringify(ids) },
  });
  return res.data;
}

export async function getBookings(tenant, version = 'v1') {
  const client = getClient(version, tenant);
  const res = await client.get('/bookings');
  return res.data;
}

// ─────────────────────────────────────────────────────────────────
// 4. FELHANTERING
// ─────────────────────────────────────────────────────────────────

export function handleGolfManagerError(err) {
  if (err.response) {
    const status = err.response.status;
    const data   = err.response.data;
    if (status === 401) return { code: 'AUTH_FAILED', message: 'Ogiltig API-nyckel eller användarnamn' };
    if (status === 404) return { code: 'NOT_FOUND',   message: 'Resursen hittades inte' };
    if (status === 409) return { code: 'SLOT_TAKEN',  message: 'Starttiden är redan bokad' };
    if (status === 422) return { code: 'VALIDATION',  message: data?.message || 'Ogiltiga parametrar' };
    return { code: 'API_ERROR', message: data?.message || `HTTP ${status}` };
  }
  if (err.code === 'ECONNABORTED') return { code: 'TIMEOUT',  message: 'GolfManager svarar inte' };
  if (err.code === 'ENOTFOUND')    return { code: 'NETWORK',  message: 'Kan inte nå GolfManager' };
  return { code: 'UNKNOWN', message: err.message };
}

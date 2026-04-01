// ─────────────────────────────────────────────────────────────────
// TeeRadar – GolfManager Service
// Hanterar all kommunikation mot GolfManager API (V1 + V3)
// Baserat på Carlos instruktioner, mars 2026
// ─────────────────────────────────────────────────────────────────

import axios from 'axios';

// ── Klienter för V1 och V3 ──────────────────────────────────────
function getV1Client(tenant) {
  const t = tenant || process.env.GOLFMANAGER_TENANT || 'demo';
  const key = process.env.GOLFMANAGER_API_KEY;

  const params = { tenant: t };
  const headers = {};
  if (key) headers['Authorization'] = `Basic ${Buffer.from(`user:${key}`).toString('base64')}`;

  return axios.create({
    baseURL: process.env.GOLFMANAGER_V1_BASE_URL,
    timeout: 12000,
    params,
    headers,
  });
}

function getV3Client(tenant) {
  const t = tenant || process.env.GOLFMANAGER_V3_TENANT;
  const key = process.env.GOLFMANAGER_V3_API_KEY;

  return axios.create({
    baseURL: process.env.GOLFMANAGER_V3_BASE_URL,
    timeout: 12000,
    headers: {
      'key': key,
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

// Hämta anslutna klubbar/tenants
export async function getTenants(version = 'v1') {
  const client = getClient(version);
  const res = await client.get('/tenants');
  return res.data;
}

// Hämta resurser (tees) för en specifik klubb
export async function getResources(tenant, version = 'v1') {
  const client = getClient(version, tenant);
  const res = await client.get('/resources');
  return res.data;
}

// Hämta tillgängliga bokningstyper/priser
export async function getAvailabilityTypes(tenant, version = 'v1') {
  const client = getClient(version, tenant);
  const res = await client.get('/availabilityTypes');
  return res.data;
}

// ─────────────────────────────────────────────────────────────────
// 2. SÖK LEDIGA TIDER
// ─────────────────────────────────────────────────────────────────

/**
 * Sök lediga starttider för en specifik bana och datum
 * @param {Object} params
 * @param {string} params.tenant - Klubbens tenant-ID
 * @param {string} params.date - Datum, t.ex. "2026-04-15"
 * @param {number} params.idResource - Resurs-ID (tee/bana)
 * @param {number} params.slots - Antal spelare
 * @param {string} params.version - 'v1' eller 'v3'
 */
export async function searchAvailability({ tenant, date, idResource, slots = 2, version = 'v1' }) {
  const client = getClient(version, tenant);

  const start = `${date}T00:00:00`;
  const end   = `${date}T18:00:00`;

  const res = await client.get('/searchAvailability', {
    params: { start, end, idResource, slots },
  });

  // Normalisera svaret till TeeRadar-format
  return (res.data || []).map(slot => ({
    id: slot.id,
    time: slot.start?.slice(11, 16) || '',    // "08:40"
    startFull: slot.start,                     // "2026-04-15T08:40:00"
    idType: slot.idType,
    idResource: slot.idResource || idResource,
    price: slot.price,
    originalPrice: slot.price,                 // Justera med vår marginal i route
    minSlots: slot.minSlots || 1,
    maxSlots: slot.maxSlots || 4,
    spotsLeft: slot.maxSlots || 4,
    isLastMinute: false,                       // Sätts av sista-minuten-motorn
    tenant,
    version,
  }));
}

// Hämta tider för FLERA banor parallellt (används på startsidan/sökresultatsidan)
export async function searchMultipleCourses(courseConfigs, date, slots) {
  const promises = courseConfigs.map(async (course) => {
    try {
      const times = await searchAvailability({
        tenant: course.tenant,
        date,
        idResource: course.idResource,
        slots,
        version: course.gmVersion === 'V3' ? 'v3' : 'v1',
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

/**
 * Prereservera en tid (hold i 10 minuter medan kunden betalar)
 * @param {Object} params
 * @param {string} params.tenant
 * @param {number} params.idResource
 * @param {string} params.start - ISO-tid, t.ex. "2026-04-15T08:40:00"
 * @param {number} params.idType
 * @param {string} params.name - Kundens namn
 * @param {string} params.email - Kundens email
 * @param {number} params.slots - Antal spelare
 * @param {string} params.version
 */
export async function makeReservation({ tenant, idResource, start, idType, name, email, slots = 2, version = 'v1' }) {
  const client = getClient(version, tenant);

  // Hold i 12 minuter (lite extra marginal)
  const timeout = new Date(Date.now() + 12 * 60 * 1000).toISOString().slice(0, 19);

  // Skapa en reservation per spelare
  const reservations = Array.from({ length: slots }, (_, i) => ({
    idResource,
    start,
    name: i === 0 ? name : `${name} (spelare ${i + 1})`,
    email,
    idType,
    timeout,
  }));

  const res = await client.get('/makeReservation', {
    params: { reservations: JSON.stringify(reservations) },
  });

  return res.data; // Array av prereservationer med ID:n
}

/**
 * Bekräfta bokning efter lyckad betalning
 * @param {string[]} ids - Array av prereservations-ID:n
 * @param {string} tenant
 * @param {string} version
 */
export async function confirmReservation(ids, tenant, version = 'v1') {
  const client = getClient(version, tenant);

  const res = await client.get('/confirmReservation', {
    params: { ids: JSON.stringify(ids) },
  });

  return res.data;
}

/**
 * Avboka en bokning
 * @param {string[]} ids
 * @param {string} tenant
 * @param {string} version
 */
export async function cancelReservation(ids, tenant, version = 'v1') {
  const client = getClient(version, tenant);

  const res = await client.get('/cancelReservation', {
    params: { ids: JSON.stringify(ids) },
  });

  return res.data;
}

// Hämta bekräftade bokningar (för verifiering)
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
    const data = err.response.data;

    if (status === 401) return { code: 'AUTH_FAILED', message: 'Ogiltig API-nyckel' };
    if (status === 404) return { code: 'NOT_FOUND', message: 'Resursen hittades inte' };
    if (status === 409) return { code: 'SLOT_TAKEN', message: 'Starttiden är redan bokad' };
    if (status === 422) return { code: 'VALIDATION', message: data?.message || 'Ogiltiga parametrar' };

    return { code: 'API_ERROR', message: data?.message || `HTTP ${status}` };
  }

  if (err.code === 'ECONNABORTED') return { code: 'TIMEOUT', message: 'GolfManager svarar inte' };
  if (err.code === 'ENOTFOUND') return { code: 'NETWORK', message: 'Kan inte nå GolfManager' };

  return { code: 'UNKNOWN', message: err.message };
}

// ─────────────────────────────────────────────────────────────────
// TeeRadar – API Client (Frontend)
// Lägg denna fil i: src/api/client.ts
//
// Ersätter mock-imports i hela appen.
// Byt ut en fil i taget:
//   allCourses.ts      → getCourses()
//   searchResults.ts   → searchTimes()
//   liveDeals.ts       → getDeals() + getCourseTimes()
// ─────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Banor ────────────────────────────────────────────────────────

export async function getCourses(): Promise<CourseEntry[]> {
  return apiFetch('/api/courses');
}

export async function getCourse(slug: string): Promise<CourseEntry> {
  return apiFetch(`/api/courses/${slug}`);
}

export async function getCourseTimes(slug: string, date: string, players = 2) {
  return apiFetch(`/api/courses/${slug}/times?date=${date}&players=${players}`);
}

// ── Sista-minuten deals ──────────────────────────────────────────

export async function getDeals() {
  return apiFetch('/api/deals');
}

// ── Sökning ──────────────────────────────────────────────────────

export async function searchTimes(params: {
  date: string;
  destination?: string;
  players?: number;
}) {
  const q = new URLSearchParams({
    date: params.date,
    destination: params.destination || 'Alla',
    players: String(params.players || 2),
  });
  return apiFetch(`/api/search?${q}`);
}

// ── Bokningar ────────────────────────────────────────────────────

export async function createHold(data: HoldRequest) {
  return apiFetch<HoldResponse>('/api/bookings/hold', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function confirmBooking(paymentIntentId: string) {
  return apiFetch<{ bookingRef: string }>('/api/bookings/confirm', {
    method: 'POST',
    body: JSON.stringify({ paymentIntentId }),
  });
}

export async function getBooking(ref: string) {
  return apiFetch(`/api/bookings/${ref}`);
}

// ── Prenumeration ────────────────────────────────────────────────

export async function subscribe(email: string) {
  return apiFetch('/api/subscribe', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

// ── Typer ────────────────────────────────────────────────────────

export interface CourseEntry {
  id: number;
  slug: string;
  name: string;
  location: string;
  area: string;
  lat: number;
  lng: number;
  from_price: number;
  rating: number;
  reviews: number;
  holes: number;
  par: number;
  difficulty: string;
  has_last_minute: boolean;
  last_minute_from?: number;
  image: string;
  gm_version?: string;
}

export interface HoldRequest {
  courseSlug: string;
  startFull: string;
  idType: number;
  idResource: number;
  gmTenant: string;
  gmVersion: string;
  players: number;
  playerNames: string[];
  homeClub?: string;
  email: string;
  displayPrice: number;
  originalPrice: number;
}

export interface HoldResponse {
  clientSecret: string;
  paymentIntentId: string;
  totalAmount: number;
  greenfeeTotal: number;
  serviceFeeTotal: number;
  expiresAt: string;
}

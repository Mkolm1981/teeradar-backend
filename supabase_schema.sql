-- ═══════════════════════════════════════════════════════════════
-- TeeRadar – Supabase Databastabeller
-- Kör detta i Supabase SQL-editor under: Database → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── 1. COURSES (golfklubbar) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  location        TEXT,
  area            TEXT,
  lat             DECIMAL(9,6),
  lng             DECIMAL(9,6),
  description     TEXT,
  image           TEXT,
  rating          DECIMAL(3,1) DEFAULT 4.5,
  reviews         INT DEFAULT 0,
  holes           INT DEFAULT 18,
  par             INT DEFAULT 72,
  difficulty      TEXT DEFAULT 'Medel',
  from_price      INT,           -- Agentpris från GolfManager (cent/hel €)
  has_last_minute BOOLEAN DEFAULT false,
  last_minute_from INT,          -- Lägsta SM-pris (för display)
  active          BOOLEAN DEFAULT true,
  sort_order      INT DEFAULT 99,

  -- GolfManager-konfiguration
  gm_tenant       TEXT,          -- t.ex. "finca-cortesin"
  gm_resource_id  INT,           -- Resurs-ID (tee) från /resources
  gm_version      TEXT DEFAULT 'V1',  -- 'V1' eller 'V3'
  gm_api_key      TEXT,          -- Krypterad, sätts per klubb efter avtal

  -- Faciliteter
  has_buggy       BOOLEAN DEFAULT true,
  has_restaurant  BOOLEAN DEFAULT true,
  has_pro_shop    BOOLEAN DEFAULT true,
  has_driving_range BOOLEAN DEFAULT true,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. LAST_MINUTE_DEALS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS last_minute_deals (
  id              SERIAL PRIMARY KEY,
  course_id       INT REFERENCES courses(id),
  start_time      TIMESTAMPTZ NOT NULL,
  display_price   INT NOT NULL,      -- Pris vi visar (med vår marginal)
  original_price  INT NOT NULL,      -- Ordinarie pris (stryks)
  discount_percent INT NOT NULL,
  spots_left      INT DEFAULT 4,
  gm_slot_id      TEXT,
  gm_id_type      INT,
  gm_id_resource  INT,
  gm_tenant       TEXT,
  gm_version      TEXT DEFAULT 'V1',
  gm_reservation_ids JSONB,         -- Fylls i när bokning görs
  active          BOOLEAN DEFAULT true,
  released_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. HOLDS (prereservationer under betalning) ───────────────────
CREATE TABLE IF NOT EXISTS holds (
  id              SERIAL PRIMARY KEY,
  stripe_payment_intent_id TEXT UNIQUE NOT NULL,
  gm_ids          JSONB NOT NULL,    -- Array av GolfManager prereservations-ID:n
  gm_tenant       TEXT NOT NULL,
  gm_version      TEXT DEFAULT 'V1',
  course_slug     TEXT NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,
  players         INT NOT NULL,
  email           TEXT NOT NULL,
  player_names    JSONB,
  home_club       TEXT,
  display_price   DECIMAL(10,2),
  original_price  DECIMAL(10,2),
  service_fee     DECIMAL(10,2) DEFAULT 2.50,
  total_amount    DECIMAL(10,2),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. BOOKINGS (bekräftade bokningar) ───────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id              SERIAL PRIMARY KEY,
  booking_ref     TEXT UNIQUE NOT NULL,   -- t.ex. "TR-K7M2NR"
  course_slug     TEXT NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,
  players         INT NOT NULL,
  email           TEXT NOT NULL,
  player_names    JSONB,
  home_club       TEXT,
  display_price   DECIMAL(10,2),
  original_price  DECIMAL(10,2),
  service_fee     DECIMAL(10,2),
  total_amount    DECIMAL(10,2),
  gm_ids          JSONB,
  gm_tenant       TEXT,
  gm_version      TEXT DEFAULT 'V1',
  stripe_payment_intent_id TEXT,
  status          TEXT DEFAULT 'confirmed',  -- confirmed | cancelled | no_show
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. SUBSCRIBERS (deal-prenumeranter) ──────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id         SERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- EXEMPELDATA – 3 bekräftade GolfManager-klubbar
-- Uppdatera gm_tenant och gm_resource_id när Carlos ger credentials
-- ═══════════════════════════════════════════════════════════════

INSERT INTO courses (slug, name, location, area, lat, lng, from_price, rating, reviews, holes, par, difficulty, has_last_minute, last_minute_from, sort_order, gm_tenant, gm_resource_id, gm_version, image)
VALUES
  ('finca-cortesin',      'Finca Cortesin Golf',      'Casares',    'Estepona',   36.3442, -5.2673, 220, 4.9, 189, 18, 72, 'Expert',     true,  120, 1, 'finca-cortesin',  1, 'V1', 'https://readdy.ai/api/search-image?query=Finca%20Cortesin%20luxury%20golf&width=400&height=240&seq=1'),
  ('la-reserva-sotogrande','La Reserva Club Sotogrande','Sotogrande','Sotogrande', 36.2887, -5.3131, 185, 4.9, 212, 18, 71, 'Utmanande',  true,   95, 2, 'la-reserva',      1, 'V1', 'https://readdy.ai/api/search-image?query=La+Reserva+Sotogrande+golf&width=400&height=240&seq=2'),
  ('la-cala-america',     'La Cala Campo América',    'La Cala',    'Marbella',   36.4963, -4.9537,  95, 4.7, 218, 18, 72, 'Medel',      true,   45, 3, 'la-cala',         1, 'V1', 'https://readdy.ai/api/search-image?query=La+Cala+golf+Marbella&width=400&height=240&seq=3'),
  ('greenlife-marbella',  'Greenlife Golf Marbella',  'Marbella',   'Marbella',   36.5002, -4.9483,  75, 4.6, 143, 18, 72, 'Medel',      true,   38, 4, 'greenlife',       1, 'V3', 'https://readdy.ai/api/search-image?query=Greenlife+golf+Marbella&width=400&height=240&seq=4'),
  ('real-club-sotogrande','Real Club de Golf Sotogrande','Sotogrande','Sotogrande',36.2999, -5.2978, 110, 4.8, 256, 18, 72, 'Utmanande',  false,  null, 5, 'real-sotogrande', 1, 'V3', 'https://readdy.ai/api/search-image?query=Real+Club+Sotogrande+golf&width=400&height=240&seq=5')
ON CONFLICT (slug) DO NOTHING;

-- ── Index för prestanda ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deals_active       ON last_minute_deals(active, expires_at);
CREATE INDEX IF NOT EXISTS idx_deals_course       ON last_minute_deals(course_id);
CREATE INDEX IF NOT EXISTS idx_bookings_ref       ON bookings(booking_ref);
CREATE INDEX IF NOT EXISTS idx_bookings_email     ON bookings(email);
CREATE INDEX IF NOT EXISTS idx_holds_payment      ON holds(stripe_payment_intent_id);

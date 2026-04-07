// src/index.js (uppdaterad – lägger till admin-routes)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import courseRoutes  from './routes/courses.js';
import bookingRoutes from './routes/bookings.js';
import miscRoutes    from './routes/misc.js';
import adminRoutes   from './routes/admin.js';
import { scheduleSMEngine, runLastMinuteEngine } from './services/lastMinute.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────
app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }));

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://teeradar.se',
    'https://www.teeradar.se',
  ],
  credentials: true,
}));

app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────
app.use('/api', courseRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api', miscRoutes);
app.use('/api/webhook', miscRoutes);
app.use('/api/admin', adminRoutes);

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    env: process.env.NODE_ENV,
    gm_tenant: process.env.GOLFMANAGER_TENANT,
    timestamp: new Date().toISOString(),
  });
});

// ── Starta ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 TeeRadar Backend startar på port ${PORT}`);
  console.log(`   ENV:    ${process.env.NODE_ENV}`);
  console.log(`   Tenant: ${process.env.GOLFMANAGER_TENANT || 'demo'}`);
  console.log(`   Admin:  /api/admin/* (lösenordsskyddad)\n`);

  scheduleSMEngine();

  if (process.env.NODE_ENV === 'development' && process.env.RUN_SM_ON_START === 'true') {
    console.log('🧪 [Dev] Kör SM-motor direkt...');
    runLastMinuteEngine();
  }
});

export default app;

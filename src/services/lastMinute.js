// ─────────────────────────────────────────────────────────────────
// TeeRadar – Sista-Minuten Motor
// Kör kl 20:00 varje kväll, hämtar och publicerar deals
// ─────────────────────────────────────────────────────────────────

import cron from 'node-cron';
import { searchAvailability } from './golfmanager.js';
import { getCourses, createDeal, expireOldDeals } from './supabase.js';

// ── Prislogik ───────────────────────────────────────────────────
// TeeRadar tar agentpris från GolfManager och lägger på marginal
const MARGIN_PERCENT    = 0.20;   // 20% marginal
const SERVICE_FEE       = 2.50;   // €2.50 per spelare

function calculatePrices(gmPrice) {
  const ourPrice = Math.round(gmPrice * (1 - MARGIN_PERCENT));  // Vi tar 20%
  const discount = Math.round((1 - ourPrice / gmPrice) * 100);
  return { displayPrice: ourPrice, originalPrice: gmPrice, discount };
}

// ── Sista 3 timmar: sänk priset ytterligare ─────────────────────
export function applyUrgencyDiscount(deal) {
  const minutesLeft = (new Date(deal.start_time) - new Date()) / 60000;
  if (minutesLeft <= 180) {
    const extra = Math.round(deal.display_price * 0.10);  // -10% extra
    return { ...deal, display_price: deal.display_price - extra, urgency: true };
  }
  return deal;
}

// ── Hämta och publicera deals för en klubb ──────────────────────
async function fetchDealsForCourse(course) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  try {
    const slots = await searchAvailability({
      tenant: course.gm_tenant,
      date: dateStr,
      idResource: course.gm_resource_id,
      slots: 1,
      version: course.gm_version === 'V3' ? 'v3' : 'v1',
    });

    // Filtrera bara sista-minuten-tider (taggade med idType som är SM-typ)
    // eller alla tider om klubben inte har SM-typ – vi sätter rabatt ändå
    const deals = slots.map(slot => {
      const { displayPrice, originalPrice, discount } = calculatePrices(slot.price);

      return {
        course_id: course.id,
        gm_reservation_ids: null,        // Fylls i när bokning görs
        start_time: slot.startFull,
        display_price: displayPrice,
        original_price: originalPrice,
        discount_percent: discount,
        spots_left: slot.maxSlots || 4,
        gm_slot_id: slot.id,
        gm_id_type: slot.idType,
        gm_id_resource: slot.idResource,
        gm_tenant: course.gm_tenant,
        gm_version: course.gm_version,
        active: true,
        expires_at: new Date(slot.startFull).toISOString(),  // Försvinner vid teetid
        released_at: new Date().toISOString(),
      };
    });

    return deals;
  } catch (err) {
    console.error(`❌ [SM Motor] Fel för ${course.name}:`, err.message);
    return [];
  }
}

// ── Huvudfunktion ───────────────────────────────────────────────
export async function runLastMinuteEngine() {
  console.log('⚡ [SM Motor] Startar kl 20:00...');

  try {
    // 1. Rensa gamla utgångna deals
    await expireOldDeals();
    console.log('🧹 [SM Motor] Gamla deals rensade');

    // 2. Hämta alla aktiva klubbar med sista-minuten aktiverat
    const courses = await getCourses({ lastMinuteOnly: true });
    console.log(`📋 [SM Motor] ${courses.length} klubbar med SM aktiverat`);

    // 3. Hämta deals för varje klubb
    let totalDeals = 0;
    for (const course of courses) {
      if (!course.gm_tenant || !course.gm_resource_id) {
        console.log(`⚠️  [SM Motor] Hoppar ${course.name} – saknar GM-konfiguration`);
        continue;
      }

      const deals = await fetchDealsForCourse(course);

      // 4. Spara i databasen
      for (const deal of deals) {
        await createDeal(deal);
        totalDeals++;
      }

      console.log(`✅ [SM Motor] ${course.name}: ${deals.length} deals publicerade`);
    }

    console.log(`\n🎉 [SM Motor] Klar! ${totalDeals} deals publicerade totalt`);

  } catch (err) {
    console.error('❌ [SM Motor] Kritiskt fel:', err.message);
  }
}

// ── Registrera cron-jobb ─────────────────────────────────────────
export function scheduleSMEngine() {
  // Kör kl 20:00 varje kväll (Spain = UTC+2 sommartid = kl 18:00 UTC)
  cron.schedule('0 18 * * *', () => {
    console.log('⏰ [Cron] Kl 20:00 CET – startar SM-motor');
    runLastMinuteEngine();
  }, { timezone: 'Europe/Madrid' });

  // Rensa utgångna deals var 30:e minut
  cron.schedule('*/30 * * * *', () => {
    expireOldDeals().catch(err => console.error('[Cron] expireOldDeals fel:', err.message));
  });

  console.log('✅ [Cron] SM-motor schemalagd kl 20:00 (Madrid-tid)');
}

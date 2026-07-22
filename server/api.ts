import { Router } from 'express';
import { pool } from './db.js';

function parseWKT(wkt: string): [number, number][] {
  const matches = wkt.match(/[-]?\d+\.?\d*\s+[-]?\d+\.?\d*/g);
  if (!matches) return [];
  return matches.map(pt => {
    const parts = pt.trim().split(/\s+/);
    return [parseFloat(parts[0]), parseFloat(parts[1])];
  });
}

const router = Router();

const NEON_COLORS = [
  { color: [0, 243, 255] as [number, number, number], str: 'var(--neon-blue)' },
  { color: [0, 255, 102] as [number, number, number], str: 'var(--neon-green)' },
  { color: [188, 19, 254] as [number, number, number], str: 'var(--neon-violet)' },
  { color: [255, 145, 0] as [number, number, number], str: 'var(--neon-orange)' },
  { color: [255, 0, 85] as [number, number, number], str: '#ff0055' }
];

// GET /api/stations/suggest?q=台北火車
router.get('/stations/suggest', async (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q || q.length < 1) return res.json([]);

  try {
    const result = await pool.query(
      `SELECT uid, name_zh, lon, lat
       FROM stations
       WHERE name_zh LIKE $1
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json(result.rows.map(r => ({
      uid: r.uid,
      name: r.name_zh,
      lon: parseFloat(r.lon),
      lat: parseFloat(r.lat)
    })));
  } catch (err) {
    console.error('[api] /stations/suggest error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/stations/nearby?lon=121.51&lat=25.04&radius=100
router.get('/stations/nearby', async (req, res) => {
  const lon = parseFloat(req.query.lon as string);
  const lat = parseFloat(req.query.lat as string);
  const radius = parseFloat(req.query.radius as string) || 100;

  if (isNaN(lon) || isNaN(lat)) {
    return res.status(400).json({ error: 'invalid coordinates' });
  }

  try {
    const result = await pool.query(
      `SELECT uid, name_zh, lon, lat, distance
       FROM (
         SELECT uid, name_zh, lon, lat,
           (6371000 * acos(
             LEAST(1.0, cos(radians($2)) * cos(radians(lat)) *
             cos(radians(lon) - radians($1)) +
             sin(radians($2)) * sin(radians(lat)))
           )) AS distance
         FROM stations
         WHERE
           lat BETWEEN $2 - ($3 / 111000.0) AND $2 + ($3 / 111000.0)
           AND lon BETWEEN $1 - ($3 / (111000.0 * cos(radians($2)))) AND $1 + ($3 / (111000.0 * cos(radians($2))))
       ) sub
       WHERE distance <= $3
       ORDER BY distance ASC
       LIMIT 20`,
      [lon, lat, radius]
    );
    res.json(result.rows.map(r => ({
      uid: r.uid,
      name: r.name_zh,
      lon: parseFloat(r.lon),
      lat: parseFloat(r.lat),
      distance: Math.round(r.distance)
    })));
  } catch (err) {
    console.error('[api] /stations/nearby error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/routes?station=台北火車站
router.get('/routes', async (req, res) => {
  const station = (req.query.station as string) || '';
  if (!station) return res.status(400).json({ error: 'station required' });

  try {
    const stationsRes = await pool.query(
      `SELECT uid, lon, lat, city FROM stations WHERE name_zh LIKE $1 LIMIT 5`,
      [`%${station}%`]
    );
    if (stationsRes.rows.length === 0) {
      return res.json({ routes: [], center: null });
    }

    const centerStation = stationsRes.rows[0];
    const stationCity = (centerStation.city as string) || 'Taipei';

    const { getTDXToken } = await import('./sync.js');
    const token = await getTDXToken();

    // Query ETA for the station's own city first, then the other city as fallback
    const citiesToQuery = stationCity === 'NewTaipei'
      ? ['NewTaipei', 'Taipei']
      : ['Taipei', 'NewTaipei'];

    const uniqueRoutes = new Map<string, { name: string; city: string }>();

    for (const etaCity of citiesToQuery) {
      const etaRes = await fetch(
        `https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City/${etaCity}?$filter=contains(StopName/Zh_tw,'${station}')&$select=RouteName,RouteUID&$format=JSON`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!etaRes.ok) continue;

      const etaData = await etaRes.json() as Record<string, unknown>[];
      for (const item of (etaData || [])) {
        const uid = item.RouteUID as string;
        const name = (item.RouteName as Record<string, string> | undefined)?.Zh_tw;
        if (uid && name && !uniqueRoutes.has(uid)) {
          uniqueRoutes.set(uid, { name, city: etaCity });
        }
      }
    }

    const routes: unknown[] = [];
    let colorIdx = 0;

    for (const [uid, { name, city: routeCity }] of uniqueRoutes.entries()) {
      if (routes.length >= 10) break;

      let path: [number, number][] | null = null;

      // Try DB geometry first
      const shapeRes = await pool.query(
        `SELECT geometry FROM route_shapes WHERE uid = $1`,
        [uid]
      );

      if (shapeRes.rows.length > 0) {
        const geo = shapeRes.rows[0].geometry as { path: [number, number][] };
        path = geo.path;
      } else {
        // DB is empty or missing this route — fetch directly from TDX Shape API
        const tdxShapeRes = await fetch(
          `https://tdx.transportdata.tw/api/basic/v2/Bus/Shape/City/${routeCity}?$filter=RouteUID eq '${uid}'&$format=JSON`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (tdxShapeRes.ok) {
          const shapeData = await tdxShapeRes.json() as Record<string, unknown>[];
          if (shapeData && shapeData.length > 0 && shapeData[0].Geometry) {
            path = parseWKT(shapeData[0].Geometry as string);
          }
        }
      }

      if (path && path.length > 0) {
        const c = NEON_COLORS[colorIdx % NEON_COLORS.length];
        routes.push({ id: uid, name, color: c.color, neonColorStr: c.str, path });
        colorIdx++;
      }
    }

    res.json({
      routes,
      center: [parseFloat(centerStation.lon), parseFloat(centerStation.lat)]
    });
  } catch (err) {
    console.error('[api] /routes error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// POST /api/admin/sync
router.post('/admin/sync', async (_req, res) => {
  const { runFullSync } = await import('./sync.js');
  res.json({ message: '同步已在背景啟動' });
  runFullSync().catch(console.error);
});

// GET /api/admin/sync-log
router.get('/admin/sync-log', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[api] /admin/sync-log error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

export default router;

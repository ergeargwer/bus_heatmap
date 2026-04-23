import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { initDB, pool } from './db.js';
import api from './api.js';
import { runFullSync } from './sync.js';

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api', api);

cron.schedule('0 3 * * 1', () => {
  console.log('[cron] weekly sync starting');
  runFullSync().catch(console.error);
}, {
  timezone: 'Asia/Taipei'
});

async function main() {
  await initDB();
  console.log('[db] schema initialized');

  const count = await pool.query('SELECT COUNT(*) FROM stations');
  if (parseInt(count.rows[0].count) === 0) {
    console.log('[db] empty database detected, starting initial import (estimated 10-20 minutes)');
    runFullSync().catch(console.error);
  } else {
    console.log(`[db] ${count.rows[0].count} stations already in DB, skipping initial import`);
  }

  app.listen(PORT, () => {
    console.log(`[server] backend running on port ${PORT}`);
  });
}

main().catch(err => {
  console.error('[server] startup failed:', err);
  process.exit(1);
});

import { buildApp } from './app.js';
import { createPool } from './db.js';
import { config } from './config.js';

const db = createPool();
const app = buildApp(db, { logger: true });
app.listen({ port: config.port, host: '0.0.0.0' }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
const stop = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

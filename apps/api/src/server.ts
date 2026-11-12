import { buildApp } from './app.js';
import { createPool } from './db.js';
import { config } from './config.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';

const db = createPool();
const app = buildApp(db, { logger: true });

// Serve the web app (apps/web/dist) from the same origin when it has been built.
const webDist = process.env.WEB_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/v1/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
}
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

export const config = {
  port: Number(process.env.PORT ?? 8080),
  /** Application role (no BYPASSRLS). */
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://orchard_app:orchard_app@localhost:5432/orchard',
  /** Superuser/migration role. */
  migrationUrl: process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orchard',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me-dev-only-secret',
  jwtTtl: process.env.JWT_TTL ?? '30d',
  weatherProvider: (process.env.WEATHER_PROVIDER ?? 'synthetic') as 'open-meteo' | 'visual-crossing' | 'synthetic',
  /** Self-hosted Open-Meteo or commercial customer-api.open-meteo.com — the free hosted API is non-commercial only. */
  openMeteoBaseUrl: process.env.OPEN_METEO_URL ?? 'http://localhost:8081',
  openMeteoApiKey: process.env.OPEN_METEO_API_KEY,
  visualCrossingKey: process.env.VISUAL_CROSSING_KEY,
  pushProvider: (process.env.PUSH_PROVIDER ?? 'log') as 'expo' | 'log',
  workerIntervalMin: Number(process.env.WORKER_INTERVAL_MIN ?? 60),
};

if (process.env.NODE_ENV === 'production' && config.jwtSecret.startsWith('dev-only')) {
  throw new Error('JWT_SECRET must be set in production');
}

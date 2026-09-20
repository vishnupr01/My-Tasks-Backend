import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './chat/redis-io.adapter';

// The frontend dev server now runs over HTTPS (required for getUserMedia /
// microphone access from a phone over LAN, since browsers only allow that
// API on secure contexts). Once the page is HTTPS, browsers block its
// fetch/WebSocket calls to a plain-HTTP backend as mixed content -- so the
// backend has to serve HTTPS too, using the same self-signed cert.
const certDir = path.join(__dirname, '..', '..', 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');
const httpsOptions =
  fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, httpsOptions ? { httpsOptions } : undefined);

  // In production the allowed origin is exactly FRONTEND_URL and nothing
  // else. In development we accept localhost and any private-network
  // address, because the dev frontend is reached both from this machine
  // and from a phone on the same Wi-Fi -- and the router reassigns this
  // machine's LAN IP periodically, so pinning one address means CORS
  // silently starts rejecting everything the next time that happens.
  const isProduction = process.env.NODE_ENV === 'production';
  const PRIVATE_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

  app.enableCors({
    origin: (origin, callback) => {
      // No Origin header: same-origin navigations, curl, native clients.
      if (!origin) return callback(null, true);
      if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return callback(null, true);
      if (!isProduction && PRIVATE_ORIGIN.test(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // REDIS_URL unset -> Socket.IO's default in-memory adapter, correct for a
  // single instance (today's deployment). Set it when you actually run more
  // than one backend instance and WebSocket broadcasts start crossing
  // process boundaries -- no other code changes needed either way.
  //
  // If it's set but Redis happens to be unreachable, fail soft: log a
  // warning and keep booting in single-instance mode, rather than taking
  // the whole backend down because a broadcast optimization isn't available.
  if (process.env.REDIS_URL) {
    try {
      const redisIoAdapter = new RedisIoAdapter(app);
      await redisIoAdapter.connectToRedis(process.env.REDIS_URL);
      app.useWebSocketAdapter(redisIoAdapter);
      console.log('WebSocket: Redis adapter connected (multi-instance broadcast enabled)');
    } catch (err) {
      console.warn(`WebSocket: REDIS_URL set but unreachable (${(err as Error).message}) -- falling back to single-instance in-memory adapter`);
    }
  } else {
    console.log('WebSocket: REDIS_URL not set, running single-instance (in-memory adapter)');
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Backend running on ${httpsOptions ? 'https' : 'http'}://localhost:${port}`);
}

bootstrap();

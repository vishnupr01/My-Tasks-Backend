import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, RedisClientType } from 'redis';

// Socket.IO's default adapter only broadcasts to sockets connected to the
// SAME process. With one backend instance that's invisible -- everyone's on
// it. The moment there's more than one instance behind a load balancer, a
// message sent by a client on instance A would never reach a client on
// instance B, since server.to(room).emit() only sees local sockets.
//
// The Redis adapter fixes this: every instance publishes room events to a
// shared Redis pub/sub channel, and every instance is also subscribed, so
// server.to(room).emit() reaches sockets on ANY instance transparently.
// ChatGateway itself doesn't need to know which mode it's in -- same API
// either way.
export class RedisIoAdapter extends IoAdapter {
  private pubClient?: RedisClientType;
  private subClient?: RedisClientType;
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(redisUrl: string): Promise<void> {
    this.pubClient = createClient({ url: redisUrl });
    this.subClient = this.pubClient.duplicate();
    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}

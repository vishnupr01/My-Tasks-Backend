import { Module } from '@nestjs/common';
import { CodeGateway } from './code.gateway';
import { CodeSyncService } from './code-sync.service';

// PrismaModule is @Global, so nothing needs importing here. The gateway
// attaches to the same Socket.IO server ChatGateway created, which is how
// it inherits that gateway's JWT handshake middleware.
@Module({
  providers: [CodeGateway, CodeSyncService],
  exports: [CodeSyncService],
})
export class CodeModule {}

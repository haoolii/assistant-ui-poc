import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { LlmModule } from '../llm/llm.module';
import { RunController } from './run.controller';
import { RunService } from './run.service';

@Module({
  imports: [ChatModule, LlmModule],
  controllers: [RunController],
  providers: [RunService],
})
export class RunModule {}

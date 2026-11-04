import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm-provider';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llmProvider: LlmProvider,
  ) {}

  @Get()
  getHealth() {
    return { status: 'ok', service: 'be' };
  }

  @Get('mock-llm')
  async getMockLlmHealth() {
    try {
      await this.llmProvider.checkHealth();
      return { status: 'ok', service: 'mock-llm' };
    } catch {
      throw new ServiceUnavailableException('MockLLM is unavailable.');
    }
  }
}

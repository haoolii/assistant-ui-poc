import { Module } from '@nestjs/common';
import { LLM_PROVIDER } from './llm-provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Module({
  providers: [
    OpenAiCompatibleProvider,
    {
      provide: LLM_PROVIDER,
      useExisting: OpenAiCompatibleProvider,
    },
  ],
  exports: [LLM_PROVIDER, OpenAiCompatibleProvider],
})
export class LlmModule {}

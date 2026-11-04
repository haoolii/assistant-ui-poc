import Joi from 'joi';

export const environmentSchema = Joi.object({
  PORT: Joi.number().port().default(3000),
  FE_ORIGIN: Joi.string().uri().default('http://localhost:4200'),
  MOCK_LLM_BASE_URL: Joi.string().uri().default('http://localhost:3100/v1'),
  MOCK_LLM_MODEL: Joi.string().default('mock-model'),
  LLM_TIMEOUT_MS: Joi.number().integer().positive().default(30000),
});

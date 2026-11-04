import Joi from 'joi';

export const environmentSchema = Joi.object({
  PORT: Joi.number().port().default(3100),
});

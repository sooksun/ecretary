import { Body } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

/**
 * Convenience decorator: `@ZBody(MySchema) body: z.infer<typeof MySchema>`
 */
export const ZBody = <T>(schema: ZodSchema<T>): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

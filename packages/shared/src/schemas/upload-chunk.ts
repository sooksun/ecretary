import { z } from 'zod';

/**
 * Multipart fields accompanying the audio file.
 * The actual file body is handled separately by the framework's multipart parser.
 */
export const UploadChunkMetaSchema = z.object({
  clientChunkId: z.string().min(8).max(120),
  chunkIndex: z.coerce.number().int().min(0).max(10_000),
  checksumSha256: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/, 'invalid sha256 hex')
    .optional(),
  durationSec: z.coerce.number().int().min(0).max(24 * 3600).optional(),
  startedAtSec: z.coerce.number().int().min(0).optional(),
  endedAtSec: z.coerce.number().int().min(0).optional(),
  mimeType: z.string().max(120).optional(),
});

export type UploadChunkMetaDto = z.infer<typeof UploadChunkMetaSchema>;

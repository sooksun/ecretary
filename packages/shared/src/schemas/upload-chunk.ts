import { z } from 'zod';

/**
 * Multipart fields accompanying the audio file.
 * The actual file body is handled separately by the framework's multipart parser.
 */
export const UploadChunkMetaSchema = z.object({
  // Becomes a path segment in the object-storage key
  // (`meetings/<id>/chunks/<clientChunkId>.<ext>`), so it must not carry `/`,
  // `..`, or anything else that changes the shape of that path. Mobile
  // generates `<meetingId>-<chunkIndex>-<8 hex>`, which this allows.
  clientChunkId: z
    .string()
    .min(8)
    .max(120)
    .regex(/^[A-Za-z0-9_-]+$/, 'clientChunkId allows only A-Z a-z 0-9 _ -'),
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

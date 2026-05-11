import { z } from 'zod';
import { MarkerType } from '../enums';

export const CreateMarkerSchema = z.object({
  markerType: z.enum([
    MarkerType.IMPORTANT,
    MarkerType.DECISION,
    MarkerType.ACTION,
    MarkerType.ISSUE,
    MarkerType.QUESTION,
    MarkerType.OTHER,
  ]),
  timestampSec: z.number().int().min(0),
  note: z.string().max(2000).optional().nullable(),
});

export type CreateMarkerDto = z.infer<typeof CreateMarkerSchema>;

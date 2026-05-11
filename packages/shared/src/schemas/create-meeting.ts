import { z } from 'zod';
import { MeetingType } from '../enums';

export const ParticipantInputSchema = z.object({
  name: z.string().min(1).max(120),
  roleLabel: z.string().max(120).optional().nullable(),
  attendanceStatus: z.enum(['present', 'absent', 'guest']).optional(),
});

export const CreateMeetingSchema = z.object({
  title: z.string().min(1).max(240),
  meetingType: z
    .enum([
      MeetingType.GENERAL,
      MeetingType.SCHOOL_ADMIN,
      MeetingType.PLC,
      MeetingType.PROJECT,
      MeetingType.PARENT_MEETING,
      MeetingType.COMMITTEE,
      MeetingType.TRAINING,
      MeetingType.SUPERVISION,
    ])
    .default(MeetingType.GENERAL),
  location: z.string().max(240).optional().nullable(),
  agendaText: z.string().max(8000).optional().nullable(),
  participants: z.array(ParticipantInputSchema).max(200).optional(),
});

export type CreateMeetingDto = z.infer<typeof CreateMeetingSchema>;

export const UpdateMeetingSchema = CreateMeetingSchema.partial();
export type UpdateMeetingDto = z.infer<typeof UpdateMeetingSchema>;

import { z } from "zod";

export const updateIssueSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "OVERRIDDEN"]),
  reason: z.string().optional(),
});

export const mergeIdentitiesSchema = z.object({
  sourceIdentityIds: z.array(z.string()).min(1),
  targetIdentityId: z.string(),
});

export const splitIdentitySchema = z.object({
  identityId: z.string(),
  stagedRowIds: z.array(z.string()).min(1),
  newFirstName: z.string().min(1),
  newLastName: z.string().min(1),
});

export const scheduleConfigSchema = z.object({
  uploadId: z.string(),
  startTime: z.string().default("08:00"),
  endTime: z.string().default("17:00"),
  defaultDuration: z.number().int().min(1).default(15),
  padCount: z.number().int().min(1).default(4),
  groupingWeight: z.number().int().min(0).max(100).default(70),
  efficiencyWeight: z.number().int().min(0).max(100).default(30),
  pauseStartTime: z.string().optional(),
  pauseEndTime: z.string().optional(),
  categoryConfigs: z
    .array(
      z.object({
        category: z.string().min(1),
        division: z.string().optional(),
        durationMinutes: z.number().int().min(1),
      }),
    )
    .default([]),
  pads: z
    .array(
      z.object({
        name: z.string().min(1),
        basePad: z.string().optional(),
        subLane: z.string().optional(),
        isLocked: z.boolean().default(false),
        laneOrder: z.number().int().default(0),
        blocks: z
          .array(
            z.object({
              startMin: z.number().int().min(0),
              endMin: z.number().int().min(1),
              reason: z.string().min(1),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export const generateScheduleSchema = z.object({
  uploadId: z.string(),
  scheduleConfigId: z.string(),
  allowJudgeReassignment: z.boolean().default(true),
});

export const patchScheduleSlotSchema = z.object({
  padId: z.string().optional(),
  startMin: z.number().int().min(0).optional(),
  endMin: z.number().int().min(1).optional(),
  isLocked: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

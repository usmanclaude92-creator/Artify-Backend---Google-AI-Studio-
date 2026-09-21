import { z } from "zod";

export const updateSettingSchema = z.object({
  value: z.unknown(),
  type: z.enum(["STRING", "NUMBER", "BOOLEAN", "JSON"]).default("STRING"),
  description: z.string().trim().max(500).optional(),
});
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

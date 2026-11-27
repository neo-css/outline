import { z } from "zod";
import { BaseSchema } from "../schema";

export const AuthConfigSchema = BaseSchema;

export type AuthConfigReq = z.infer<typeof AuthConfigSchema>;

export const AuthInfoSchema = BaseSchema;

export type AuthInfoReq = z.infer<typeof AuthInfoSchema>;

export const AuthSwitchWorkspaceSchema = BaseSchema.extend({
  body: z.object({ teamId: z.uuid() }),
});

export type AuthSwitchWorkspaceReq = z.infer<typeof AuthSwitchWorkspaceSchema>;

export const AuthDeleteSchema = BaseSchema;

export type AuthDeleteReq = z.infer<typeof AuthDeleteSchema>;

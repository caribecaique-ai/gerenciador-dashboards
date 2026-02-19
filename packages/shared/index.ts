import { z } from 'zod';

// Roles
export const UserRole = z.enum(['ADMIN', 'OPS', 'SALES', 'VIEWER']);
export type UserRole = z.infer<typeof UserRole>;

// Client Status
export const ClientStatus = z.enum(['ACTIVE', 'PAUSED']);
export type ClientStatus = z.infer<typeof ClientStatus>;

// Auth Schemas
export const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

// Client Schemas
export const CreateClientSchema = z.object({
    name: z.string().min(2),
    tags: z.array(z.string()).optional(),
    clickupWorkspaceId: z.string().optional(),
});

// Telemetry Schemas
export const HeartbeatSchema = z.object({
    token: z.string(),
    latency: z.number().optional(),
    errors: z.number().optional(),
});

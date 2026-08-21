import { z } from "zod";

/** Stable external software/licensing identity; distinct from DB id and catalog slug. */
export const productIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80);

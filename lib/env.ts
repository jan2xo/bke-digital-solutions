import "server-only";
import { parseEnvironment } from "@/lib/config/environment";

export const env = parseEnvironment(process.env);

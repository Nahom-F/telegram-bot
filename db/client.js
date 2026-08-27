// db/client.js
//
// The neon-http driver talks to Neon over plain HTTP, not a persistent TCP
// connection — the right choice for Vercel serverless functions, since
// there's no connection pool to exhaust or keep warm between invocations.

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.js";

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });

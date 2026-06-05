import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./db/schema";

let pool: Pool | undefined;
let db: AppDb | undefined;

export type AppDb = NodePgDatabase<typeof schema>;

export function getPool(): Pool {
	if (!pool) {
		const connectionString = process.env.DATABASE_URL;
		if (!connectionString) {
			throw new Error("DATABASE_URL is required");
		}

		pool = new Pool({ connectionString });
	}

	return pool;
}

export function createDb(targetPool: Pool): AppDb {
	return drizzle(targetPool, { schema });
}

export function getDb(): AppDb {
	db ??= createDb(getPool());
	return db;
}

export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = undefined;
		db = undefined;
	}
}

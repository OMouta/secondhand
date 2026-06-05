import { Pool } from "pg";
import schemaSql from "./schema.sql?raw";

let pool: Pool | undefined;
let migration: Promise<void> | undefined;

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

export async function migratePool(targetPool: Pool): Promise<void> {
	await targetPool.query(schemaSql);
}

export async function migrateDatabase(): Promise<void> {
	await migratePool(getPool());
}

export function ensureDatabase(): Promise<void> {
	migration ??= migrateDatabase();
	return migration;
}

export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = undefined;
		migration = undefined;
	}
}

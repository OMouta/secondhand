import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./db/schema";

let pool: Pool | undefined;
let db: AppDb | undefined;
let migration: Promise<void> | undefined;

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

export async function migrateDb(targetDb: AppDb): Promise<void> {
	await migrate(targetDb, {
		migrationsFolder: "./drizzle",
		migrationsSchema: "public",
	});
}

export async function migratePool(targetPool: Pool): Promise<void> {
	await migrateDb(createDb(targetPool));
}

export async function migrateDatabase(): Promise<void> {
	await migrateDb(getDb());
}

export function ensureDatabase(): Promise<void> {
	migration ??= migrateDatabase();
	return migration;
}

export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = undefined;
		db = undefined;
		migration = undefined;
	}
}

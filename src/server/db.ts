import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

let pool: Pool | undefined;

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

export async function migrateDatabase(): Promise<void> {
	const schemaPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"schema.sql",
	);
	const schema = await readFile(schemaPath, "utf8");
	await getPool().query(schema);
}

export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = undefined;
	}
}

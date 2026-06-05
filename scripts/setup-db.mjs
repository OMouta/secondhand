import { readFile } from "node:fs/promises";
import { Client } from "pg";

const env = await loadEnv();
const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is required");
}

const targetUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));

if (!databaseName) {
	throw new Error("DATABASE_URL must include a database name");
}

const maintenanceUrl = new URL(targetUrl);
maintenanceUrl.pathname = "/postgres";

const maintenance = new Client({ connectionString: maintenanceUrl.toString() });
await maintenance.connect();

try {
	const exists = await maintenance.query(
		"select 1 from pg_database where datname = $1",
		[databaseName],
	);

	if (exists.rowCount === 0) {
		await maintenance.query(`create database ${quoteIdentifier(databaseName)}`);
		console.log(`created database ${databaseName}`);
	} else {
		console.log(`database ${databaseName} already exists`);
	}
} finally {
	await maintenance.end();
}

const target = new Client({ connectionString: targetUrl.toString() });
await target.connect();

try {
	await target.query("create extension if not exists vector");
	console.log("pgvector extension is ready");
} finally {
	await target.end();
}

async function loadEnv() {
	try {
		const body = await readFile(new URL("../.env", import.meta.url), "utf8");
		return Object.fromEntries(
			body
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"))
				.map((line) => {
					const index = line.indexOf("=");
					if (index === -1) {
						return [line, ""];
					}
					const key = line.slice(0, index).trim();
					const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
					return [key, value];
				}),
		);
	} catch (error) {
		if (error && error.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

function quoteIdentifier(value) {
	return `"${value.replaceAll('"', '""')}"`;
}

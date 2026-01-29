#!/usr/bin/env node

import { MongoClient } from 'mongodb';
import muri from 'mongodb-uri';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: '../.env' });

const MONGO_HOST = process.env.MONGO_HOST;
const MONGO_PORT = process.env.MONGO_PORT;

const dbPort = MONGO_PORT ? parseInt(MONGO_PORT) : 27017;
const databasesToDrop = ['drz-mng-dev', 'drz-wrk-dev'];

const connStr = muri.format({
	scheme: 'mongodb',
	hosts: [
		{
			host: MONGO_HOST || 'localhost',
			port: dbPort
		}
	]
});

async function dropDevDatabases() {
	const client = new MongoClient(connStr);

	try {
		console.log('🔌 Connecting to MongoDB at', connStr);
		await client.connect();

		const admin = client.db().admin();

		// List all databases to check if they exist
		const { databases } = await admin.listDatabases();
		const dbNames = databases.map((db) => db.name);

		for (const dbName of databasesToDrop) {
			if (dbNames.includes(dbName)) {
				console.log(`🗑️  Dropping database: ${dbName}`);
				await client.db(dbName).dropDatabase();
				console.log(`✅ Successfully dropped database: ${dbName}`);
			} else {
				console.log(`⚠️  Database ${dbName} does not exist, skipping`);
			}
		}

		console.log('🎉 Database drop completed');
	} catch (error) {
		console.error('❌ Error dropping databases:', error);
		process.exit(1);
	} finally {
		await client.close();
		console.log('🔌 MongoDB connection closed');
	}
}

// Run the script
dropDevDatabases().catch(console.error);

#!/usr/bin/env node

import { MongoClient } from 'mongodb';
import muri from 'mongodb-uri';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: '../.env' });

const MONGO_HOST = process.env.MONGO_HOST;
const MONGO_PORT = process.env.MONGO_PORT;

const dbPort = MONGO_PORT ? parseInt(MONGO_PORT) : 27017;
const dbName = 'drz-mng-test'; // Manager test database

const connStr = muri.format({
  scheme: 'mongodb',
  hosts: [
    {
      host: MONGO_HOST || 'localhost',
      port: dbPort
    }
  ]
});

// Test data for processes and domains
const testProcesses = [
  {
    pid: 'test-process-1',
    status: 'completed',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    currentStep: {
      maxPathLength: 3,
      maxPathProps: 2,
      seeds: ['https://example.com/resource1'],
      predLimit: {
        limType: 'blacklist',
        limPredicates: []
      },
      followDirection: true
    },
    steps: [
      {
        maxPathLength: 3,
        maxPathProps: 2,
        seeds: ['https://example.com/resource1'],
        predLimit: {
          limType: 'blacklist',
          limPredicates: []
        },
        followDirection: true
      }
    ],
    notification: {
      email: 'test@example.com',
      webhook: '',
      ssePath: '/sse/test-process-1'
    },
    timeToLastResource: '2h 30m',
    timeRunning: '5h 15m'
  },
  {
    pid: 'test-process-2',
    status: 'running',
    createdAt: new Date('2024-01-02T10:00:00Z'),
    updatedAt: new Date('2024-01-02T11:00:00Z'),
    currentStep: {
      maxPathLength: 4,
      maxPathProps: 3,
      seeds: ['https://example.com/resource2'],
      predLimit: {
        limType: 'whitelist',
        limPredicates: ['http://www.w3.org/1999/02/22-rdf-syntax-ns#type']
      },
      followDirection: false
    },
    steps: [
      {
        maxPathLength: 4,
        maxPathProps: 3,
        seeds: ['https://example.com/resource2'],
        predLimit: {
          limType: 'whitelist',
          limPredicates: ['http://www.w3.org/1999/02/22-rdf-syntax-ns#type']
        },
        followDirection: false
      }
    ],
    notification: {
      email: '',
      webhook: 'https://example.com/webhook',
      ssePath: '/sse/test-process-2'
    },
    timeToLastResource: null,
    timeRunning: '1h 45m'
  }
];

const testDomains = [
  {
    origin: 'example.com',
    status: 'ready',
    lastAccessed: new Date('2024-01-01T10:00:00Z'),
    crawl: {
      nextAllowed: new Date('2024-01-02T10:00:00Z'),
      delay: 5,
      queued: 2,
      success: 10,
      ongoing: 1,
      failed: 0,
      pathHeads: 3
    },
    warnings: {
      E_ROBOTS_TIMEOUT: 1,
      E_RESOURCE_TIMEOUT: 0,
      E_DOMAIN_NOT_FOUND: 0,
      E_UNKNOWN: 2
    },
    robots: {
      status: 'done',
      checked: new Date('2024-01-01T09:00:00Z')
    },
    lastWarnings: [
      { errType: 'E_UNKNOWN', timestamp: new Date('2024-01-01T09:30:00Z') },
      { errType: 'E_ROBOTS_TIMEOUT', timestamp: new Date('2024-01-01T09:45:00Z') }
    ]
  },
  {
    origin: 'test.org',
    status: 'crawling',
    lastAccessed: new Date('2024-01-01T11:00:00Z'),
    crawl: {
      nextAllowed: new Date('2024-01-03T10:00:00Z'),
      delay: 10,
      queued: 5,
      success: 25,
      ongoing: 2,
      failed: 1,
      pathHeads: 7
    },
    warnings: {
      E_ROBOTS_TIMEOUT: 0,
      E_RESOURCE_TIMEOUT: 2,
      E_DOMAIN_NOT_FOUND: 0,
      E_UNKNOWN: 0
    },
    robots: {
      status: 'error',
      checked: new Date('2024-01-01T08:00:00Z')
    },
    lastWarnings: [{ errType: 'E_RESOURCE_TIMEOUT', timestamp: new Date('2024-01-01T10:30:00Z') }]
  }
];

async function setupTestData() {
  const client = new MongoClient(connStr);

  try {
    console.log('🔌 Connecting to MongoDB at', connStr);
    await client.connect();

    const db = client.db(dbName);

    // Clear existing test data
    console.log('🧹 Clearing existing test data...');
    await db.collection('processes').deleteMany({ pid: { $regex: /^test-/ } });
    await db.collection('domains').deleteMany({ origin: { $regex: /(example\.com|test\.org)/ } });

    // Insert test processes
    console.log('📝 Inserting test processes...');
    if (testProcesses.length > 0) {
      const result = await db.collection('processes').insertMany(testProcesses);
      console.log(`✅ Inserted ${result.insertedCount} test processes`);
    }

    // Insert test domains
    console.log('📝 Inserting test domains...');
    if (testDomains.length > 0) {
      const result = await db.collection('domains').insertMany(testDomains);
      console.log(`✅ Inserted ${result.insertedCount} test domains`);
    }

    console.log('🎉 Test data setup completed successfully!');
    console.log('📊 Test data summary:');
    console.log(`   - Processes: ${testProcesses.length}`);
    console.log(`   - Domains: ${testDomains.length}`);
    console.log('');
    console.log('🧪 You can now run integration tests with real data from drz-mng-test database!');
  } catch (error) {
    console.error('❌ Error setting up test data:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run the script
setupTestData().catch(console.error);

import { getDatabase } from '@netlify/database';
import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.js';

const connect = () => drizzle({ client: getDatabase(), schema });
let database: ReturnType<typeof connect> | undefined;

export const getDb = () => database ??= connect();

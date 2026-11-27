import { boolean, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: integer().primaryKey().generatedByDefaultAsIdentity({ startWith: 1000 }),
  n: text('name').notNull(),
  c: text('category').notNull(),
  p: integer('price').notNull(),
  o: integer('previous_price'),
  d: text('description').notNull(),
  cols: jsonb('colours').$type<string[]>().notNull(),
  imgs: jsonb('images').$type<string[]>().notNull(),
  deleted: boolean().notNull().default(false),
});

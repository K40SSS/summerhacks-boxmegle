import { pgTable, uuid, text, jsonb, timestamp, serial } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  uuid: uuid('uuid').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  record: jsonb('record'),
  maxStats: jsonb('max_stats'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const publicQueue = pgTable('public_queue', {
  id: serial('id').primaryKey(),
  userUuid: uuid('user_uuid').references(() => users.uuid),
  joinedAt: timestamp('joined_at').defaultNow(),
});

export const privateRooms = pgTable('private_rooms', {
  code: text('code').primaryKey(),
  hostUuid: uuid('host_uuid').references(() => users.uuid),
  createdAt: timestamp('created_at').defaultNow(),
});

export const gameSessions = pgTable('game_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  player1Uuid: uuid('player1_uuid').references(() => users.uuid),
  player2Uuid: uuid('player2_uuid').references(() => users.uuid),
  token: text('token').notNull(),
  status: text('status').default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const completedGames = pgTable('completed_games', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => gameSessions.id),
  winnerUuid: uuid('winner_uuid').references(() => users.uuid),
  strongestPunch: jsonb('strongest_punch'),
  replayKey: text('replay_key'), // Supabase Storage object key
  completedAt: timestamp('completed_at').defaultNow(),
});

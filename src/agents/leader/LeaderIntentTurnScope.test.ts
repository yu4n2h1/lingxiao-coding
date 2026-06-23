import test from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_KEYS } from '../../core/SessionStateKeys.js';
import { LEADER_META_TOOLS } from '../../contracts/constants/leaderToolDefinitions.js';

function makeState() {
  const state = new Map<string, unknown>();
  return {
    getSessionState(_sessionId: string, key: string): unknown | null {
      return state.has(key) ? state.get(key)! : null;
    },
    setSessionState(_sessionId: string, key: string, value: unknown): void {
      state.set(key, value);
    },
    deleteSessionState(_sessionId: string, key: string): void {
      state.delete(key);
    },
    raw: state,
  };
}

function shouldExposeRecordCapabilityIntentTool(db: { getSessionState(sessionId: string, key: string): unknown | null }, sessionId: string): boolean {
  const currentRaw = db.getSessionState(sessionId, SESSION_KEYS.CURRENT_USER_TURN_ID);
  const recordedRaw = db.getSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_TURN_ID);
  const currentTurnId = typeof currentRaw === 'number' ? currentRaw : typeof currentRaw === 'string' ? Number(currentRaw) : NaN;
  const recordedTurnId = typeof recordedRaw === 'number' ? recordedRaw : typeof recordedRaw === 'string' ? Number(recordedRaw) : NaN;
  if (!Number.isFinite(currentTurnId) || currentTurnId <= 0) return true;
  return !Number.isFinite(recordedTurnId) || Math.trunc(recordedTurnId) !== Math.trunc(currentTurnId);
}

function visibleMetaToolNames(db: { getSessionState(sessionId: string, key: string): unknown | null }, sessionId: string): string[] {
  const metaTools = shouldExposeRecordCapabilityIntentTool(db, sessionId)
    ? LEADER_META_TOOLS
    : LEADER_META_TOOLS.filter((tool) => tool.function.name !== 'record_capability_intent');
  return metaTools.map((tool) => tool.function.name);
}

test('record_capability_intent is exposed before a turn is recorded and hidden afterwards', () => {
  const db = makeState();
  const sessionId = 's-intent';

  db.setSessionState(sessionId, SESSION_KEYS.CURRENT_USER_TURN_ID, 7);
  assert.equal(visibleMetaToolNames(db, sessionId).includes('record_capability_intent'), true);

  db.setSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_TURN_ID, 7);
  assert.equal(visibleMetaToolNames(db, sessionId).includes('record_capability_intent'), false);

  db.setSessionState(sessionId, SESSION_KEYS.CURRENT_USER_TURN_ID, 8);
  assert.equal(visibleMetaToolNames(db, sessionId).includes('record_capability_intent'), true);
});

test('beginning a new user turn must clear stale intent state and traces', () => {
  const db = makeState();
  const sessionId = 's-intent-clear';

  db.setSessionState(sessionId, SESSION_KEYS.CURRENT_USER_TURN_ID, 2);
  db.setSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_PROFILE, '{"primaryIntent":"implement"}');
  db.setSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_TURN_ID, 2);
  db.setSessionState(sessionId, SESSION_KEYS.AUTONOMY_DECISION_TRACE, '{"toolName":"create_task"}');

  const nextTurn = 3;
  db.setSessionState(sessionId, SESSION_KEYS.CURRENT_USER_TURN_ID, nextTurn);
  db.deleteSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_PROFILE);
  db.deleteSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_TURN_ID);
  db.deleteSessionState(sessionId, SESSION_KEYS.AUTONOMY_DECISION_TRACE);

  assert.equal(db.getSessionState(sessionId, SESSION_KEYS.CURRENT_USER_TURN_ID), 3);
  assert.equal(db.getSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_PROFILE), null);
  assert.equal(db.getSessionState(sessionId, SESSION_KEYS.CAPABILITY_INTENT_TURN_ID), null);
  assert.equal(db.getSessionState(sessionId, SESSION_KEYS.AUTONOMY_DECISION_TRACE), null);
});

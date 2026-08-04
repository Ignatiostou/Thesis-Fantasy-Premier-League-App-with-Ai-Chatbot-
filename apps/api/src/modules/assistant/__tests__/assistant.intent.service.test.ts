import { describe, it, expect } from 'vitest';
import { detectAssistantIntent, getIntentConfidence } from '../assistant.intent.service.js';

describe('detectAssistantIntent', () => {

  // ── GENERAL_HELP fallback ─────────────────────────────────────────────────

  it('returns GENERAL_HELP for an empty message', () => {
    expect(detectAssistantIntent('')).toBe('GENERAL_HELP');
  });

  it('returns GENERAL_HELP when no keywords match', () => {
    expect(detectAssistantIntent('hello how are you')).toBe('GENERAL_HELP');
  });

  it('returns GENERAL_HELP for gibberish', () => {
    expect(detectAssistantIntent('asdfghjkl qwerty')).toBe('GENERAL_HELP');
  });

  // ── CAPTAINCY ─────────────────────────────────────────────────────────────

  it('detects CAPTAINCY from "captain"', () => {
    expect(detectAssistantIntent('who should be my captain this week')).toBe('CAPTAINCY');
  });

  it('detects CAPTAINCY from "armband"', () => {
    expect(detectAssistantIntent('who gets the armband')).toBe('CAPTAINCY');
  });

  it('detects CAPTAINCY from "vc"', () => {
    expect(detectAssistantIntent('who should be my vc pick')).toBe('CAPTAINCY');
  });

  it('detects CAPTAINCY from Greek αρχηγ', () => {
    expect(detectAssistantIntent('ποιος παίρνει αρχηγό')).toBe('CAPTAINCY');
  });

  // ── TRANSFER_ADVICE ───────────────────────────────────────────────────────

  it('detects TRANSFER_ADVICE from "transfer in"', () => {
    expect(detectAssistantIntent('who should i transfer in this week')).toBe('TRANSFER_ADVICE');
  });

  it('detects TRANSFER_ADVICE from explicit transfer language', () => {
    expect(detectAssistantIntent('i want to transfer out a player this gameweek')).toBe('TRANSFER_ADVICE');
  });

  it('detects TRANSFER_ADVICE from "sell"', () => {
    expect(detectAssistantIntent('should i sell haaland')).toBe('TRANSFER_ADVICE');
  });

  it('detects TRANSFER_ADVICE from Greek μεταγραφ', () => {
    expect(detectAssistantIntent('πρέπει να κάνω μεταγραφή')).toBe('TRANSFER_ADVICE');
  });

  // ── TRANSFER_EVALUATION ───────────────────────────────────────────────────

  it('detects TRANSFER_EVALUATION from "worth it"', () => {
    expect(detectAssistantIntent('is this transfer worth it')).toBe('TRANSFER_EVALUATION');
  });

  it('detects TRANSFER_EVALUATION from "take the hit"', () => {
    expect(detectAssistantIntent('should i take the hit and transfer salah')).toBe('TRANSFER_EVALUATION');
  });

  it('detects TRANSFER_EVALUATION from "worth the hit"', () => {
    expect(detectAssistantIntent('is it worth the hit to get haaland')).toBe('TRANSFER_EVALUATION');
  });

  it('detects TRANSFER_EVALUATION from Greek αξίζει', () => {
    expect(detectAssistantIntent('αξίζει να κάνω μεταγραφή')).toBe('TRANSFER_EVALUATION');
  });

  // ── PLAYER_COMPARISON ─────────────────────────────────────────────────────

  it('detects PLAYER_COMPARISON from "vs"', () => {
    expect(detectAssistantIntent('salah vs haaland who is better')).toBe('PLAYER_COMPARISON');
  });

  it('detects PLAYER_COMPARISON from "compare"', () => {
    expect(detectAssistantIntent('compare saka and salah for me')).toBe('PLAYER_COMPARISON');
  });

  it('detects PLAYER_COMPARISON from "or"', () => {
    expect(detectAssistantIntent('should i pick saka or palmer')).toBe('PLAYER_COMPARISON');
  });

  it('detects PLAYER_COMPARISON from Greek καλύτερ', () => {
    expect(detectAssistantIntent('ποιος είναι καλύτερος')).toBe('PLAYER_COMPARISON');
  });

  // ── BENCH_ORDER ───────────────────────────────────────────────────────────

  it('detects BENCH_ORDER from "bench order"', () => {
    expect(detectAssistantIntent('what is my optimal bench order')).toBe('BENCH_ORDER');
  });

  it('detects BENCH_ORDER from "auto sub"', () => {
    expect(detectAssistantIntent('who should be first auto sub')).toBe('BENCH_ORDER');
  });

  it('detects BENCH_ORDER from Greek παγκ', () => {
    expect(detectAssistantIntent('ποια είναι η σειρά παγκ')).toBe('BENCH_ORDER');
  });

  // ── FORMATION_ADVICE ──────────────────────────────────────────────────────

  it('detects FORMATION_ADVICE from "formation"', () => {
    expect(detectAssistantIntent('what formation should i play')).toBe('FORMATION_ADVICE');
  });

  it('detects FORMATION_ADVICE from "lineup"', () => {
    expect(detectAssistantIntent('help me set my lineup')).toBe('FORMATION_ADVICE');
  });

  it('detects FORMATION_ADVICE from "442"', () => {
    expect(detectAssistantIntent('is 442 better than 433 for my squad')).toBe('FORMATION_ADVICE');
  });

  // ── CHIP_ADVICE ───────────────────────────────────────────────────────────

  it('detects CHIP_ADVICE from "wildcard"', () => {
    expect(detectAssistantIntent('should i use my wildcard now')).toBe('CHIP_ADVICE');
  });

  it('detects CHIP_ADVICE from "free hit"', () => {
    expect(detectAssistantIntent('is this a good week for free hit')).toBe('CHIP_ADVICE');
  });

  it('detects CHIP_ADVICE from "bench boost" with chip context', () => {
    expect(detectAssistantIntent('when should i activate my bench boost chip')).toBe('CHIP_ADVICE');
  });

  it('detects CHIP_ADVICE from multiple chip keywords', () => {
    expect(detectAssistantIntent('should i play my wildcard chip or free hit chip')).toBe('CHIP_ADVICE');
  });

  // ── INITIAL_SQUAD ─────────────────────────────────────────────────────────

  it('detects INITIAL_SQUAD from "build my team"', () => {
    expect(detectAssistantIntent('help me build my team from scratch')).toBe('INITIAL_SQUAD');
  });

  it('detects INITIAL_SQUAD from "15 players"', () => {
    expect(detectAssistantIntent('i need to pick my 15 players')).toBe('INITIAL_SQUAD');
  });

  // ── ONBOARDING ────────────────────────────────────────────────────────────

  it('detects ONBOARDING from "profile"', () => {
    expect(detectAssistantIntent('i want to update my profile')).toBe('ONBOARDING');
  });

  it('detects ONBOARDING from "preferences"', () => {
    expect(detectAssistantIntent('change my preferences')).toBe('ONBOARDING');
  });

  // ── Weighted scoring ──────────────────────────────────────────────────────

  it('prefers CAPTAINCY over TRANSFER when captain keywords dominate', () => {
    expect(detectAssistantIntent('should i captain salah or transfer him out')).toBe('CAPTAINCY');
  });

  it('prefers TRANSFER_EVALUATION over TRANSFER_ADVICE for hit questions', () => {
    expect(detectAssistantIntent('is it worth it to transfer haaland out')).toBe('TRANSFER_EVALUATION');
  });

  it('is case-insensitive', () => {
    expect(detectAssistantIntent('WHO SHOULD BE MY CAPTAIN')).toBe('CAPTAINCY');
    expect(detectAssistantIntent('TRANSFER IN SAKA')).toBe('TRANSFER_ADVICE');
  });

  it('handles mixed case', () => {
    expect(detectAssistantIntent('My Captain Pick For GW34')).toBe('CAPTAINCY');
  });
});

// ── getIntentConfidence ───────────────────────────────────────────────────────

describe('getIntentConfidence', () => {

  it('returns HIGH confidence for strong unambiguous message', () => {
    const result = getIntentConfidence('captain captaincy who should be my captain pick this week');
    expect(result.intent).toBe('CAPTAINCY');
    expect(result.confidence).toBe('HIGH');
  });

  it('returns LOW confidence for a single weak keyword', () => {
    const result = getIntentConfidence('transfer');
    expect(result.intent).toBe('TRANSFER_ADVICE');
    expect(result.confidence).toBe('LOW');
  });

  it('returns MEDIUM confidence for a moderate match', () => {
    const result = getIntentConfidence('who is my captain');
    expect(result.intent).toBe('CAPTAINCY');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('includes scores for all matched intents', () => {
    const result = getIntentConfidence('should i captain salah or transfer him');
    expect(result.scores).toHaveProperty('CAPTAINCY');
    expect(result.scores).toHaveProperty('TRANSFER_ADVICE');
    expect(result.scores['CAPTAINCY']).toBeGreaterThan(result.scores['TRANSFER_ADVICE']);
  });

  it('returns GENERAL_HELP with LOW confidence for no matches', () => {
    const result = getIntentConfidence('hello there');
    expect(result.intent).toBe('GENERAL_HELP');
    expect(result.confidence).toBe('LOW');
  });
});
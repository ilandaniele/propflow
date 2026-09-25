/**
 * Shared voice types (Phase 8, item A) — the contract every voice module (B
 * inbound, C outbound, W wiring) and calls.ts/usage.ts/dnc.ts build against.
 */

export type CallDirection = 'inbound' | 'outbound';
export type CallPurpose = 'inbound' | 'speed_to_lead' | 'visit_confirmation' | 'reactivation';
export type CallStatus = 'queued' | 'dialing' | 'in_progress' | 'ended' | 'failed' | 'skipped' | 'blocked';
export type CallOutcome = 'answered' | 'no_answer' | 'busy' | 'voicemail' | 'failed' | 'abandoned';

export interface AgentCallRecord {
  id: string;
  orgId: string;
  sessionId: string | null;
  leadId: string | null;
  visitId: string | null;
  direction: CallDirection;
  purpose: CallPurpose;
  status: CallStatus;
  vapiCallId: string | null;
  customerPhone: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  outcome: CallOutcome | null;
  summary: string | null;
  costUsd: string | null;
  createdAt: Date;
}

export interface VoiceChannel {
  orgId: string;
  channelId: string;
  phoneNumberId: string;
  displayPhoneE164: string | null;
}

export interface VoiceCallContext {
  orgId: string;
  callId: string;
  sessionId: string;
  leadId: string | null;
  customerPhone: string | null;
  purpose: CallPurpose;
  visitId: string | null;
}

export const VOICE_JOB_KINDS = {
  outboundCall: 'voice.outbound_call',
  visitConfirmationMessage: 'voice.visit_confirmation_message',
} as const;

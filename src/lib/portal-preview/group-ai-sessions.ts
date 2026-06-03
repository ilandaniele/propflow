/**
 * Pure grouping function for AI chat messages → session groups.
 *
 * Groups a flat list of ai_chat_messages rows by session_id (uuid — always present,
 * the DB column is NOT NULL). Returns up to 10 sessions sorted by started_at DESC.
 *
 * Security note: this is a pure in-memory transform of already-fetched rows.
 * It does NOT perform any DB calls and does NOT reference internal_notes.
 */

import type { AISession } from './types';

interface RawAIChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  profile_id?: string;
  org_id?: string;
}

const SESSION_LIMIT = 10;
const USER_PREVIEW_LENGTH = 80;

/**
 * Group a flat array of ai_chat_messages into AISession[] sorted by started_at DESC.
 *
 * @param messages - Raw rows from ai_chat_messages, any order.
 * @returns Up to SESSION_LIMIT AISession objects, newest session first.
 */
export function groupAISessions(messages: RawAIChatMessage[]): AISession[] {
  if (messages.length === 0) {
    return [];
  }

  // Accumulate data per session_id in a single pass.
  const sessionMap = new Map<
    string,
    {
      started_at: string;
      message_count: number;
      last_user_content: string;
      last_user_created_at: string;
    }
  >();

  for (const msg of messages) {
    const sid = msg.session_id;
    const existing = sessionMap.get(sid);

    if (!existing) {
      sessionMap.set(sid, {
        started_at: msg.created_at,
        message_count: 1,
        last_user_content: msg.role === 'user' ? msg.content : '',
        last_user_created_at: msg.role === 'user' ? msg.created_at : '',
      });
    } else {
      existing.message_count += 1;

      // Track the earliest message as started_at (min created_at).
      if (msg.created_at < existing.started_at) {
        existing.started_at = msg.created_at;
      }

      // Track the latest user message for the preview.
      if (msg.role === 'user' && msg.created_at > existing.last_user_created_at) {
        existing.last_user_content = msg.content;
        existing.last_user_created_at = msg.created_at;
      }
    }
  }

  // Convert map to AISession[], sort by started_at DESC, cap at SESSION_LIMIT.
  const sessions: AISession[] = [];
  for (const [session_id, data] of sessionMap) {
    sessions.push({
      session_id,
      started_at: data.started_at,
      message_count: data.message_count,
      last_user_preview: data.last_user_content.slice(0, USER_PREVIEW_LENGTH),
    });
  }

  sessions.sort((a, b) => {
    if (b.started_at < a.started_at) return -1;
    if (b.started_at > a.started_at) return 1;
    return 0;
  });

  return sessions.slice(0, SESSION_LIMIT);
}

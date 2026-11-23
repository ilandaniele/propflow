import { createTranslator } from 'next-intl';
import messages from '@/messages/es.json';

const bot = messages.ownerAssistantBot;
const t = createTranslator({ locale: 'es', messages: { ownerAssistantBot: bot } });

export type ReplyKey = keyof typeof bot;

export function reply(key: ReplyKey, values?: Record<string, string>): string {
  return t(`ownerAssistantBot.${key}`, values);
}

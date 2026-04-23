// apps/web/src/lib/hooks/useChat.ts

'use client';

import { useState, useCallback, useRef } from 'react';
import type { AssistantMessageDto, AssistantChatResponse } from '@fpl/types';

export interface ChatMessage {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  createdAt: string;
}

type StreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta';   content:   string }
  | { type: 'done' }
  | { type: 'error';   message:   string };

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function useChat() {
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSession = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`${API_BASE}/ai/sessions/${sid}/messages`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const json = await res.json();
      const msgs: AssistantMessageDto[] = json.data?.messages ?? [];
      setSessionId(sid);
      setMessages(
        msgs
          .filter((m) => m.role !== 'SYSTEM')
          .map((m) => ({
            id:        m.id,
            role:      m.role === 'USER' ? 'user' : 'assistant',
            content:   m.content,
            createdAt: m.createdAt,
          })),
      );
    } catch { /* ignore */ }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    setError(null);

    const tempUserId      = `user-${Date.now()}`;
    const tempAssistantId = `assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: 'user', content: text.trim(), createdAt: new Date().toISOString() },
      { id: tempAssistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() },
    ]);

    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/ai/chat/stream`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ message: text.trim(), sessionId: sessionId ?? undefined }),
        signal:      abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: StreamEvent;
          try { evt = JSON.parse(line.slice(6)) as StreamEvent; } catch { continue; }

          if (evt.type === 'session' && !sessionId) setSessionId(evt.sessionId);

          if (evt.type === 'delta') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId ? { ...m, content: m.content + evt.content } : m,
              ),
            );
          }

          if (evt.type === 'error') throw new Error(evt.message);
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setError('Failed to get a response. Please try again.');
      setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [sessionId, isStreaming]);

  const newSession = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { sessionId, messages, isStreaming, error, sendMessage, newSession, stopStreaming, loadSession };
}
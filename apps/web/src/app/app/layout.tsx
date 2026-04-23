import { ReactNode } from 'react';
import AppShell from '@/components/AppShell';
import { ChatWidget } from '@/components/chatbot/ChatWidget';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      {children}
      <ChatWidget />
    </AppShell>
  );
}
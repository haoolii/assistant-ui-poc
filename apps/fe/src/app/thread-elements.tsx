// Adapted text-only subset of the official assistant-ui Thread registry element:
// https://r.assistant-ui.com/base/thread.json
import { MessagePrimitive } from '@assistant-ui/react';

export function ThreadWelcome() {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
      <p className="aui-thread-welcome-message-inner text-2xl font-medium tracking-tight">
        How can I help you today?
      </p>
    </div>
  );
}

export function UserMessage() {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-(--composer-radius) px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root data-slot="aui_assistant-message-root" data-role="assistant">
      <div data-slot="aui_assistant-message-content" className="text-foreground px-2 leading-relaxed wrap-break-word">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  deleteRoom,
  cancelRun,
  listRooms,
  renameRoom,
  type Room,
} from '../api/chat-client';
import { useChat } from './use-chat';
import {
  AssistantMessage,
  ThreadWelcome,
  UserMessage,
} from './thread-elements';
import './app.css';

function Chat({
  room,
  onRoom,
  onRefresh,
  onBusy,
  initialDraft,
  onRestart,
  onPark,
  onActivity,
  resolving,
  canSend,
}: {
  room: Room | null;
  onRoom: (room: Room) => void;
  onRefresh: () => void;
  onBusy: (busy: boolean) => void;
  initialDraft: string;
  onRestart: (room: Room, draft: string) => void;
  onPark: (
    room: Room,
    runId: string,
    draft: string,
    additional: string,
  ) => void;
  onActivity: (roomId: string) => void;
  resolving: boolean;
  canSend: () => boolean;
}) {
  const {
    runtime,
    busy,
    loading,
    stopping,
    error,
    creationUnknown,
    locked,
    send,
    retryHistory,
    stop,
    hasMore,
    loadingOlder,
    pageError,
    pageVersion,
    loadOlder,
    canLeaveUnresolved,
    leaveUnresolved,
  } = useChat(
    room,
    onRoom,
    onRefresh,
    onBusy,
    initialDraft,
    onRestart,
    onPark,
    onActivity,
  );
  const conversation = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const initialScroll = useRef(false);
  const userScroll = useRef(false);
  function older(retry = false) {
    const element = conversation.current;
    if (!element || loadingOlder || !hasMore || busy || locked) return;
    anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    void loadOlder(retry);
  }
  useLayoutEffect(() => {
    const element = conversation.current;
    if (element && anchor.current) {
      element.scrollTop =
        anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = null;
    }
  }, [pageVersion]);
  useLayoutEffect(() => {
    if (!loading && !initialScroll.current && conversation.current) {
      conversation.current.scrollTop = conversation.current.scrollHeight;
      initialScroll.current = true;
    }
  }, [loading]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root asChild>
        <main className="chat">
          <header className="chat-header">
            <div>
              <span className="eyebrow">YOUR WORKSPACE / CHAT</span>
              <h1>{room?.title || 'New conversation'}</h1>
            </div>
            <span className="connection">
              <i /> Connected via AG-UI
            </span>
          </header>
          <ThreadPrimitive.Viewport
            className="conversation aui-thread-root bg-background"
            aria-live="polite"
            autoScroll={!loadingOlder}
            ref={conversation}
            onWheel={(event) => {
              userScroll.current = true;
              if (
                event.deltaY < 0 &&
                event.currentTarget.scrollTop <= 0 &&
                !pageError
              ) {
                userScroll.current = false;
                older();
              }
            }}
            onTouchStart={() => {
              userScroll.current = true;
            }}
            onKeyDown={() => {
              userScroll.current = true;
            }}
            onScroll={(event) => {
              if (
                userScroll.current &&
                event.currentTarget.scrollTop <= 0 &&
                !pageError
              ) {
                userScroll.current = false;
                older();
              }
            }}
          >
            {loading ? (
              <p className="notice">Loading conversation...</p>
            ) : (
              <>
                <AuiIf condition={(state) => state.thread.isEmpty}>
                  <div className="thread-welcome">
                    <ThreadWelcome />
                  </div>
                </AuiIf>
                <AuiIf condition={(state) => !state.thread.isEmpty}>
                  <div className="thread-messages mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-y-6 px-4 pt-4">
                    {hasMore && (
                      <div className="history-control">
                        {pageError ? (
                          <button type="button" onClick={() => older(true)}>
                            Retry older messages
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={loadingOlder || busy || locked}
                            onClick={() => older()}
                          >
                            {loadingOlder
                              ? 'Loading older messages...'
                              : 'Load older messages'}
                          </button>
                        )}
                        {pageError && <p role="alert">{pageError}</p>}
                      </div>
                    )}
                    <ThreadPrimitive.Messages>
                      {({ message }) =>
                        message.role === 'user' ? (
                          <UserMessage />
                        ) : (
                          <AssistantMessage />
                        )
                      }
                    </ThreadPrimitive.Messages>
                  </div>
                </AuiIf>
              </>
            )}
          </ThreadPrimitive.Viewport>
          <div className="composer-area">
            {error && (
              <div className="error" role="alert">
                {error}{' '}
                {locked && !busy && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={retryHistory}
                  >
                    Retry history
                  </button>
                )}
                {canLeaveUnresolved && (
                  <button type="button" onClick={leaveUnresolved}>
                    Leave and resolve later
                  </button>
                )}
                {creationUnknown && (
                  <button type="button" onClick={onRefresh}>
                    Refresh conversations
                  </button>
                )}
              </div>
            )}
            <ComposerPrimitive.Root
              className="aui-composer-root relative flex w-full flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSend()) void send();
              }}
            >
              <div className="border-foreground/10 focus-within:border-foreground/25 flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color]">
                <ComposerPrimitive.Input
                  placeholder="Ask anything..."
                  aria-label="Message"
                  disabled={busy || resolving}
                  className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
                  rows={1}
                />
                <div className="aui-composer-action-wrapper relative flex items-center justify-end">
                  {busy ? (
                    <button
                      className="thread-send"
                      type="button"
                      aria-label={stopping ? 'Stopping' : 'Stop generating'}
                      disabled={stopping}
                      onClick={stop}
                    >
                      <SquareIcon className="size-3.5 fill-current" />
                    </button>
                  ) : (
                    <ComposerPrimitive.Send
                      className="thread-send"
                      aria-label="Send message"
                      disabled={loading || locked || loadingOlder || resolving}
                      onClick={(event) => {
                        event.preventDefault();
                        if (canSend()) void send();
                      }}
                    >
                      <ArrowUpIcon className="size-4" />
                    </ComposerPrimitive.Send>
                  )}
                </div>
              </div>
            </ComposerPrimitive.Root>
            <p className="footnote">
              Responses are generated by a mock model and may be unpredictable.
            </p>
          </div>
        </main>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<Room | null>(null);
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const busyRef = useRef(false);
  const resolvingRef = useRef(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<
    Record<string, { runId: string; draft: string; additional: string }>
  >({});
  const listVersion = useRef(0);
  const activity = useRef(new Map<string, number>());
  const activityVersion = useRef(0);
  async function refresh(clearError = true) {
    const version = ++listVersion.current;
    const beforeActivity = activityVersion.current;
    try {
      const result = await listRooms();
      if (version !== listVersion.current) return;
      const moves = [...activity.current.entries()]
        .filter(([, sequence]) => sequence > beforeActivity)
        .sort((left, right) => right[1] - left[1]);
      const movedIds = new Set(moves.map(([id]) => id));
      activity.current.clear();
      setRooms([
        ...moves.flatMap(([id]) => result.filter((room) => room.id === id)),
        ...result.filter((room) => !movedIds.has(room.id)),
      ]);
      if (clearError) setError('');
    } catch (err) {
      if (version !== listVersion.current) return;
      setError(err instanceof Error ? err.message : 'Could not load rooms.');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  function select(room: Room | null, restoredDraft = '') {
    setSelected(room);
    setDraft(restoredDraft);
    setKey((value) => value + 1);
  }
  async function resolve(room: Room) {
    const item = pending[room.id];
    if (!item || busyRef.current) return;
    busyRef.current = true;
    resolvingRef.current = true;
    setBusy(true);
    setResolving(true);
    try {
      const result = await cancelRun(item.runId, room.id);
      setPending((current) => {
        const next = { ...current };
        delete next[room.id];
        return next;
      });
      setError('');
      select(
        room,
        result.started
          ? item.additional
          : item.additional
            ? `${item.draft}\n${item.additional}`
            : item.draft,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not resolve the run.',
      );
    } finally {
      resolvingRef.current = false;
      busyRef.current = false;
      setBusy(false);
      setResolving(false);
    }
  }
  async function remove(room: Room) {
    if (!window.confirm('Delete this conversation?')) return;
    ++listVersion.current;
    try {
      await deleteRoom(room.id);
      ++listVersion.current;
      if (selected?.id === room.id) select(null);
      setRooms((current) => current.filter((item) => item.id !== room.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete room.');
    } finally {
      void refresh(false);
    }
  }
  async function rename(room: Room) {
    const title = window.prompt('Conversation title', room.title || '');
    if (title === null || !title.trim()) return;
    ++listVersion.current;
    try {
      const updated = await renameRoom(room.id, title.trim());
      ++listVersion.current;
      if (selected?.id === room.id) setSelected(updated);
      setRooms((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename room.');
    } finally {
      void refresh(false);
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">✳</span>
          <div>
            <strong>thoughtspace</strong>
            <small>YOUR AI WORKSPACE</small>
          </div>
        </div>
        <button
          className="new-chat"
          disabled={busy}
          onClick={() => select(null)}
        >
          <span>＋</span> New conversation
        </button>
        <div className="sidebar-label">
          RECENT CONVERSATIONS <span>{rooms.length}</span>
        </div>
        <nav aria-label="Conversations">
          {rooms
            .filter((room) => room.status === 'regular')
            .map((room) => (
              <div
                className={`room ${selected?.id === room.id ? 'room--active' : ''}`}
                key={room.id}
              >
                <button
                  className="room-select"
                  disabled={busy || !!pending[room.id]}
                  onClick={() => select(room)}
                >
                  <span>◌</span> {room.title || 'Untitled conversation'}
                </button>
                {pending[room.id] && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve(room)}
                    aria-label={`Resolve ${room.title || 'conversation'}`}
                  >
                    Resolve
                  </button>
                )}
                <button
                  title="Rename"
                  disabled={busy || !!pending[room.id]}
                  aria-label="Rename conversation"
                  onClick={() => void rename(room)}
                >
                  ✎
                </button>
                <button
                  title="Delete"
                  disabled={busy || !!pending[room.id]}
                  aria-label="Delete conversation"
                  onClick={() => void remove(room)}
                >
                  ×
                </button>
              </div>
            ))}
          {rooms.length === 0 && (
            <p className="sidebar-empty">
              Your conversations will appear here.
            </p>
          )}
        </nav>
        {error && (
          <p className="sidebar-error" role="alert">
            {error} <button onClick={() => void refresh()}>Retry</button>
          </p>
        )}
        <div className="sidebar-footer">
          <div className="profile">Y</div>
          <div>
            <strong>Your workspace</strong>
            <small>Personal space</small>
          </div>
          <span>···</span>
        </div>
      </aside>
      <Chat
        key={key}
        room={selected}
        onRoom={(room) => {
          ++listVersion.current;
          setRooms((current) => [
            room,
            ...current.filter((item) => item.id !== room.id),
          ]);
          setSelected(room);
        }}
        onRefresh={() => void refresh()}
        onBusy={(value) => {
          if (!value && resolvingRef.current) return;
          busyRef.current = value;
          setBusy(value);
        }}
        onActivity={(id) => {
          activity.current.set(id, ++activityVersion.current);
          setRooms((current) => {
            const room = current.find((item) => item.id === id);
            return room
              ? [room, ...current.filter((item) => item.id !== id)]
              : current;
          });
        }}
        resolving={resolving}
        canSend={() => !busyRef.current}
        initialDraft={draft}
        onRestart={(room, text) => select(room, text)}
        onPark={(room, runId, text, additional) => {
          setPending((current) => ({
            ...current,
            [room.id]: { runId, draft: text, additional },
          }));
          setError(
            'The previous run is unresolved. Resolve it before retrying its message.',
          );
          select(null);
        }}
      />
    </div>
  );
}

export default App;

import { HttpAgent } from '@ag-ui/client';
import { fromAgUiMessages, useAgUiRuntime } from '@assistant-ui/react-ag-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BE_BASE_URL } from '../api/be-client';
import {
  createRoom,
  getHistory,
  cancelRun,
  type Message,
  type Room,
} from '../api/chat-client';

function convert(messages: Message[]) {
  return fromAgUiMessages(
    messages
      .filter(
        (message) =>
          message.role === 'user' ||
          (message.role === 'assistant' &&
            message.content.some((part) => part.text.length)),
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content.map((part) => part.text).join(''),
      })),
  );
}

export function useChat(
  room: Room | null,
  onRoom: (room: Room) => void,
  onRefresh: () => void,
  onBusy: (busy: boolean) => void,
  initialDraft: string,
  onRestart: (room: Room, draft: string) => void,
  onPark: (
    room: Room,
    runId: string,
    draft: string,
    additional: string,
  ) => void,
  onActivity: (roomId: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!room);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pageError, setPageError] = useState('');
  const [pageVersion, setPageVersion] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [creationUnknown, setCreationUnknown] = useState(false);
  const [messages, setMessages] = useState<
    ReturnType<
      ReturnType<typeof useAgUiRuntime>['thread']['getState']
    >['messages']
  >([]);
  const roomRef = useRef<Room | null>(null);
  const lock = useRef(!!room);
  const active = useRef(false);
  const cancelled = useRef(false);
  const failed = useRef(false);
  const paging = useRef(false);
  const pendingCreate = useRef<{
    cancelled: boolean;
    controller: AbortController;
  } | null>(null);
  const submission = useRef<{
    runId?: string;
    rejected: boolean;
    draft: string;
    settling: boolean;
    transportInvoked: boolean;
  } | null>(null);
  const settleRef = useRef<
    | ((
        attempt: NonNullable<typeof submission.current>,
        failed?: boolean,
      ) => void)
    | null
  >(null);
  const mounted = useRef(true);
  const retired = useRef(false);
  const [agent] = useState(() => {
    const agent = new HttpAgent({
      url: `${BE_BASE_URL}/runs`,
      fetch: async (url, init) => {
        if (retired.current)
          throw new DOMException('Transport retired.', 'AbortError');
        const body = JSON.parse(String(init.body)) as { runId: string };
        const current = submission.current;
        if (current) {
          current.runId = body.runId;
          current.transportInvoked = true;
        }
        const response = await fetch(url, init);
        if (
          current &&
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 409
        )
          current.rejected = true;
        return response;
      },
    });
    const runAgent = agent.runAgent.bind(agent);
    agent.runAgent = (parameters, subscriber) => {
      if (retired.current)
        return Promise.reject(
          new DOMException('Transport retired.', 'AbortError'),
        );
      const attempt = submission.current;
      if (attempt && parameters?.runId) attempt.runId = parameters.runId;
      const result = runAgent(parameters, subscriber);
      void result.then(
        () => {
          if (attempt) setTimeout(() => settleRef.current?.(attempt), 0);
        },
        () => {
          if (attempt) setTimeout(() => settleRef.current?.(attempt, true), 0);
        },
      );
      return result;
    };
    return agent;
  });
  const runtime = useAgUiRuntime({
    agent,
    onError: (err) => {
      failed.current = true;
      setError(err.message);
      const attempt = submission.current;
      if (attempt) {
        setTimeout(() => {
          if (!runtime.thread.getState().isRunning)
            settleRef.current?.(attempt, true);
        }, 0);
      }
    },
  });
  const beforeRun = useRef<typeof messages>([]);
  const recovery = useRef(false);
  const draftRestored = useRef(false);

  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    if (initialDraft) runtime.thread.composer.setText(initialDraft);
  }, [initialDraft, runtime]);

  const loadInitial = useCallback(
    async (id: string) => {
      const page = await getHistory(id);
      if (!mounted.current || roomRef.current?.id !== id) return;
      if (page.messages.some((message) => message.status === 'in_progress')) {
        throw new Error(
          'A response is still in progress. Retry loading history.',
        );
      }
      runtime.thread.reset(convert(page.messages.reverse()));
      setCursor(page.nextCursor);
    },
    [runtime],
  );

  async function reconcile(id: string) {
    const attempt = submission.current;
    if (!attempt) throw new Error('Run status is unknown. Retry recovery.');
    if (attempt.rejected) {
      runtime.thread.reset(beforeRun.current);
      const draft = runtime.thread.composer.getState().text;
      runtime.thread.composer.setText(
        draft ? `${attempt.draft}\n${draft}` : attempt.draft,
      );
      return;
    }
    if (!attempt.runId) {
      if (attempt.transportInvoked)
        throw new Error(
          'Run status is unknown. Leave this conversation and resolve it before retrying.',
        );
      retired.current = true;
      agent.abortRun();
      const currentRoom = roomRef.current;
      if (!currentRoom) throw new Error('Conversation is unavailable.');
      const draft = runtime.thread.composer.getState().text;
      onBusy(false);
      onRestart(
        currentRoom,
        draft ? `${attempt.draft}\n${draft}` : attempt.draft,
      );
      return;
    }
    {
      let run: Awaited<ReturnType<typeof cancelRun>>;
      try {
        run = await cancelRun(attempt.runId, id);
      } catch {
        throw new Error(
          'Run status is unknown. Retry recovery before sending another message.',
        );
      }
      if (!mounted.current || roomRef.current?.id !== id) return;
      if (run.chatRoomId !== id)
        throw new Error('Run belongs to another conversation.');
      if (!run.started) {
        runtime.thread.reset(beforeRun.current);
        const draft = runtime.thread.composer.getState().text;
        runtime.thread.composer.setText(
          draft ? `${attempt.draft}\n${draft}` : attempt.draft,
        );
        return;
      }
      {
        const page = await getHistory(id);
        if (!mounted.current || roomRef.current?.id !== id) return;
        const recent = convert(page.messages.reverse());
        const byId = new Map(recent.map((message) => [message.id, message]));
        const prior = beforeRun.current.map(
          (message) => byId.get(message.id) ?? message,
        );
        const ids = new Set(prior.map((message) => message.id));
        runtime.thread.reset([
          ...prior,
          ...recent.filter((message) => !ids.has(message.id)),
        ]);
        return;
      }
    }
  }

  settleRef.current = (attempt, forcedFailure = false) => {
    if (!mounted.current || submission.current !== attempt || attempt.settling)
      return;
    const id = roomRef.current?.id;
    if (!id) return;
    attempt.settling = true;
    active.current = false;
    if (!cancelled.current && !failed.current && !forcedFailure) {
      onActivity(id);
      lock.current = false;
      submission.current = null;
      setBusy(false);
      onBusy(false);
      return;
    }
    recovery.current = true;
    setStopping(true);
    cancelled.current = false;
    void reconcile(id)
      .then(() => {
        if (mounted.current && submission.current === attempt) {
          recovery.current = false;
          submission.current = null;
          lock.current = false;
          setBusy(false);
          setStopping(false);
          onBusy(false);
        }
      })
      .catch((err: Error) => {
        if (mounted.current && submission.current === attempt) {
          setError(err.message);
          setBusy(false);
          setStopping(false);
        }
      });
  };

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = runtime.thread.subscribe(() => {
      const state = runtime.thread.getState();
      if (mounted.current) setMessages(state.messages);
      if (state.isRunning) active.current = true;
      if (active.current && !state.isRunning) {
        if (submission.current) settleRef.current?.(submission.current);
      }
    });
    return () => {
      mounted.current = false;
      if (pendingCreate.current) {
        pendingCreate.current.cancelled = true;
        pendingCreate.current.controller.abort();
      }
      unsubscribe();
      agent.abortRun();
    };
  }, [runtime, agent]);

  useEffect(() => {
    if (roomRef.current?.id === room?.id) return;
    roomRef.current = room;
    if (!room) return;
    const id = room.id;
    agent.threadId = id;
    lock.current = true;
    setLoading(true);
    setError('');
    setCreationUnknown(false);
    void loadInitial(id)
      .then(() => {
        if (mounted.current && roomRef.current?.id === id) {
          lock.current = false;
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (mounted.current && roomRef.current?.id === id) {
          setError(err.message);
          setLoading(false);
        }
      });
  }, [room, agent, loadInitial]);

  async function loadOlder(retry = false) {
    const id = roomRef.current?.id;
    if (
      !id ||
      !cursor ||
      paging.current ||
      lock.current ||
      (pageError && !retry)
    )
      return;
    if (retry) setPageError('');
    paging.current = true;
    setLoadingOlder(true);
    try {
      const page = await getHistory(id, cursor);
      if (!mounted.current || roomRef.current?.id !== id) return;
      const current = runtime.thread.getState().messages;
      const ids = new Set(current.map((message) => message.id));
      runtime.thread.reset([
        ...convert(page.messages.reverse()).filter(
          (message) => !ids.has(message.id ?? ''),
        ),
        ...current,
      ]);
      setCursor(page.nextCursor);
      setPageVersion((version) => version + 1);
    } catch (err) {
      if (mounted.current)
        setPageError(
          err instanceof Error ? err.message : 'Could not load older messages.',
        );
    } finally {
      paging.current = false;
      if (mounted.current) setLoadingOlder(false);
    }
  }

  async function send() {
    const draft = runtime.thread.composer.getState().text;
    const value = draft.trim();
    if (!value || lock.current || paging.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setStopping(false);
    setError('');
    setCreationUnknown(false);
    failed.current = false;
    let creation: { cancelled: boolean; controller: AbortController } | null =
      null;
    try {
      let current = roomRef.current;
      if (!current) {
        creation = { cancelled: false, controller: new AbortController() };
        pendingCreate.current = creation;
        current = await createRoom(creation.controller.signal);
        pendingCreate.current = null;
        if (!mounted.current) return;
        roomRef.current = current;
        agent.threadId = current.id;
        onRoom(current);
        onRefresh();
        if (creation.cancelled) {
          lock.current = false;
          setBusy(false);
          setStopping(false);
          onBusy(false);
          return;
        }
      }
      agent.threadId = current.id;
      beforeRun.current = runtime.thread.getState().messages;
      const attempt: NonNullable<typeof submission.current> = {
        rejected: false,
        draft,
        settling: false,
        transportInvoked: false,
      };
      submission.current = attempt;
      runtime.thread.composer.setText('');
      runtime.thread.append({
        role: 'user',
        content: [{ type: 'text', text: value }],
      });
      setTimeout(() => {
        if (
          submission.current === attempt &&
          !attempt.settling &&
          !runtime.thread.getState().isRunning &&
          !attempt.runId
        )
          settleRef.current?.(attempt, true);
      }, 5000);
    } catch (err) {
      pendingCreate.current = null;
      if (!mounted.current) return;
      if (submission.current && !submission.current.runId) {
        runtime.thread.composer.setText(submission.current.draft);
        submission.current = null;
      }
      lock.current = false;
      setBusy(false);
      setStopping(false);
      onBusy(false);
      if (creation) {
        setCreationUnknown(true);
        setError(
          'Room creation could not be confirmed. Refresh conversations to check for an empty room.',
        );
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not send message.',
        );
      }
    }
  }

  function retryHistory() {
    const id = roomRef.current?.id;
    if (!id) return;
    setLoading(true);
    void (recovery.current ? reconcile(id) : loadInitial(id))
      .then(() => {
        if (mounted.current) {
          recovery.current = false;
          submission.current = null;
          lock.current = false;
          setError('');
          onBusy(false);
        }
      })
      .catch((err: Error) => {
        if (mounted.current) setError(err.message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }

  function stop() {
    if (pendingCreate.current) {
      pendingCreate.current.cancelled = true;
      setStopping(true);
    } else {
      cancelled.current = true;
      runtime.thread.cancelRun();
    }
  }

  function leaveUnresolved() {
    const attempt = submission.current;
    const currentRoom = roomRef.current;
    if (!attempt?.runId || !currentRoom) return;
    retired.current = true;
    agent.abortRun();
    onBusy(false);
    const additional = runtime.thread.composer.getState().text;
    onPark(currentRoom, attempt.runId, attempt.draft, additional);
  }

  return {
    runtime,
    busy,
    loading,
    stopping,
    error,
    creationUnknown,
    messages,
    locked: lock.current,
    send,
    retryHistory,
    stop,
    hasMore: !!cursor,
    loadingOlder,
    pageError,
    pageVersion,
    loadOlder,
    canLeaveUnresolved:
      recovery.current && !!submission.current?.runId && !busy,
    leaveUnresolved,
  };
}

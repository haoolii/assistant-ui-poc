# AI Chat POC Implementation Plan

## 1. Project Goal

This project is an Nx monorepo proof of concept containing three applications:

- `apps/fe`: React frontend using assistant-ui.
- `apps/be`: NestJS backend for chat rooms, message history, and LLM integration.
- `apps/mock-llm`: Stateless NestJS service that simulates an LLM with SSE responses.

The applications communicate through the following protocols:

```text
React / assistant-ui
        |
        | AG-UI 1.0 (POST + SSE)
        v
NestJS BE
  |-- Chat room REST API
  |-- Message history REST API
  |-- AG-UI run endpoint
  |-- In-memory chat store
  `-- LlmProvider abstraction
        |
        | OpenAI Responses API compatible
        | POST /v1/responses
        v
NestJS MockLLM
```

The protocols must remain separate:

| Scope                   | Protocol                               |
| ----------------------- | -------------------------------------- |
| FE to BE chat streaming | AG-UI 1.0 HTTP + SSE                   |
| BE to MockLLM           | OpenAI Responses API compatible subset |
| Chat rooms and history  | REST + OpenAPI + RFC 9457              |

The frontend must not consume OpenAI events directly. MockLLM must not emit AG-UI events. The BE converts provider events into AG-UI events.

## 2. Workspace Structure

```text
apps/
  fe/
  be/
  mock-llm/
libs/
  contracts/
  config/
```

Suggested local ports:

| Application | Port |
| ----------- | ---: |
| FE          | 4200 |
| BE          | 3000 |
| MockLLM     | 3100 |

## 3. BE API Design

### 3.1 Conventions

- Use `/api/v1` as the API prefix.
- Keep the POC API contract in `DOCS.md`; generated Swagger/OpenAPI is deferred.
- Validate requests with the NestJS global `ValidationPipe`.
- Return REST errors as RFC 9457 `application/problem+json` responses.
- Use cursor pagination for list endpoints.
- Serialize dates as ISO 8601 UTC strings.
- Use UUID or ULID identifiers.
- Return `204 No Content` after a successful deletion.
- Do not expose stack traces or internal provider errors to clients.

### 3.2 REST Endpoints

```http
GET    /api/v1/health

POST   /api/v1/chat-rooms
GET    /api/v1/chat-rooms?cursor={cursor}&limit=20
GET    /api/v1/chat-rooms/{chatRoomId}
PATCH  /api/v1/chat-rooms/{chatRoomId}
DELETE /api/v1/chat-rooms/{chatRoomId}

GET    /api/v1/chat-rooms/{chatRoomId}/messages?cursor={cursor}&limit=50
POST   /api/v1/runs
```

`POST /api/v1/chat-rooms` creates an empty chat room only when the user sends the first message. It does not call MockLLM and does not open an SSE stream.

Create chat room request:

```json
{}
```

Create chat room response:

```http
HTTP/1.1 201 Created
Location: /api/v1/chat-rooms/room_xxx
```

```json
{
  "id": "room_xxx",
  "title": null,
  "status": "regular",
  "createdAt": "2026-11-04T10:00:00.000Z",
  "updatedAt": "2026-11-04T10:00:00.000Z"
}
```

Message response:

```json
{
  "id": "msg_xxx",
  "chatRoomId": "room_xxx",
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Hello"
    }
  ],
  "status": "completed",
  "createdAt": "2026-11-04T10:00:00.000Z"
}
```

`content` should remain an array even when the POC only supports text. This allows future image, file, and tool-result content without changing the storage model.

### 3.3 Initial UI and First Message Flow

The main chat area starts empty. Entering the application must not create a chat room automatically.

On application load, the FE only loads the left-side chat history:

```http
GET /api/v1/chat-rooms?limit=20
```

The response is `200 OK` with an empty `chatRooms` array when the BE has no in-memory history. The main chat area remains empty until the user selects a room or sends a first message.

When the user sends the first message from the empty screen:

1. The FE calls `POST /api/v1/chat-rooms` and receives a new `chatRoomId`.
2. The FE calls `POST /api/v1/runs` with that ID as `RunAgentInput.threadId`.
3. The BE stores the user message, calls MockLLM, and streams AG-UI events to the FE.
4. The FE inserts the new room into the left-side history and selects it.

When the user sends another message in an existing room, the FE only calls `POST /api/v1/runs`.

### 3.4 Continued Conversation and Context Ownership

MockLLM is stateless. Every `POST /v1/responses` request must therefore contain the context required to answer the current turn.

Responsibilities are split as follows:

| Component | Responsibility                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| FE        | Load room history, hydrate the assistant-ui runtime, and send AG-UI `RunAgentInput.messages`.                                           |
| BE        | Own the canonical room history, reconcile messages by ID, order and filter context, inject server-owned instructions, and call MockLLM. |
| MockLLM   | Generate one response from the supplied `input`; never retain rooms or previous turns.                                                  |

When an existing room is selected or restored after a browser reload:

1. The FE calls `GET /api/v1/chat-rooms/{chatRoomId}/messages?limit=50`.
2. The BE returns the room's messages in chronological order.
3. The FE hydrates the assistant-ui runtime with those messages.
4. When the user sends the next message, assistant-ui includes the visible conversation in `RunAgentInput.messages`.

The BE must not blindly proxy that array to MockLLM. For each run it must:

1. Confirm that `threadId` identifies an existing room.
2. Upsert incoming messages by `message.id`, so resending the complete AG-UI history does not create duplicates.
3. Read the canonical ordered history from `InMemoryChatStore`.
4. Include completed `user` and `assistant` messages plus the latest user message.
5. Exclude failed or incomplete assistant messages from model context.
6. Prepend the server-owned `developer` instruction.
7. Convert the normalized history into OpenAI Responses API `input` and call MockLLM.

Example provider request for a continued conversation:

```json
{
  "model": "mock-model",
  "input": [
    {
      "role": "developer",
      "content": "You are the assistant for this application."
    },
    {
      "role": "user",
      "content": "What is an LLM?"
    },
    {
      "role": "assistant",
      "content": "An LLM is a large language model."
    },
    {
      "role": "user",
      "content": "Can you explain that more simply?"
    }
  ],
  "stream": true
}
```

The first POC version sends all eligible text messages in the room. Token counting, sliding windows, truncation, summarization, and provider-side conversation IDs are deferred. If context management is added later, it belongs in the BE rather than the FE or MockLLM.

### 3.5 Error Format

REST errors use RFC 9457:

```http
Content-Type: application/problem+json
```

```json
{
  "type": "https://example.local/problems/chat-room-not-found",
  "title": "Chat room not found",
  "status": 404,
  "detail": "Chat room room_xxx does not exist.",
  "instance": "/api/v1/chat-rooms/room_xxx",
  "requestId": "req_xxx"
}
```

## 4. AG-UI Run Endpoint

The FE opens a run through the BE:

```http
POST /api/v1/runs
Content-Type: application/json
Accept: text/event-stream
```

The body follows AG-UI `RunAgentInput`:

```json
{
  "threadId": "room_xxx",
  "runId": "run_xxx",
  "protocolVersion": "1.0",
  "messages": [
    {
      "id": "msg_user_1",
      "role": "user",
      "content": "Hello"
    }
  ]
}
```

Minimum successful event sequence:

```text
RUN_STARTED
TEXT_MESSAGE_START
TEXT_MESSAGE_CONTENT
TEXT_MESSAGE_CONTENT
TEXT_MESSAGE_END
RUN_FINISHED
```

Example response:

```text
data: {"type":"RUN_STARTED","threadId":"room_xxx","runId":"run_xxx"}

data: {"type":"TEXT_MESSAGE_START","messageId":"msg_assistant_1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"msg_assistant_1","delta":"Hello"}

data: {"type":"TEXT_MESSAGE_END","messageId":"msg_assistant_1"}

data: {"type":"RUN_FINISHED","threadId":"room_xxx","runId":"run_xxx"}
```

Implementation rules:

- Reject malformed input, failed authentication, or missing chat rooms with an HTTP `4xx` before opening the stream.
- Treat `threadId` as the chat room identifier and return `404` when it is not present in the in-memory store.
- Emit `RUN_ERROR` when an error occurs after the SSE stream has opened.
- Put exactly one complete AG-UI event in each SSE `data` payload.
- Stop the upstream LLM request when the client disconnects.
- Keep assistant output as `in_progress` in memory while streaming and mark it `completed` after success.
- Upsert input messages by message ID because `RunAgentInput.messages` contains the complete visible history.
- Build MockLLM input from canonical `InMemoryChatStore` history after reconciliation, not directly from the untrusted request array.
- Inject server-owned `developer` instructions in the BE; the FE cannot override them.
- Exclude failed and incomplete assistant messages from subsequent model context.
- Do not invent a second token-streaming event format.

`/api/v1/runs` is a fixed transport URL for assistant-ui's `HttpAgent`. AG-UI does not require an `/agent` path; it only requires a POST carrying `RunAgentInput` and a `text/event-stream` response. Keeping the run endpoint fixed avoids rebuilding the agent whenever the selected chat room changes.

## 5. MockLLM API

MockLLM implements a documented subset of the OpenAI Responses API:

```http
POST /v1/responses
```

Supported request fields:

- `model`
- `input`
- `stream`
- `temperature`
- `max_output_tokens`

Example request:

```json
{
  "model": "mock-model",
  "input": [
    {
      "role": "user",
      "content": "Hello"
    }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_output_tokens": 1024
}
```

Unsupported fields must either be explicitly ignored or rejected with `400 Bad Request`. `DOCS.md` must state that MockLLM is only a compatible subset.

### 5.1 Streaming Events

Minimum event sequence:

```text
response.created
response.output_item.added
response.content_part.added
response.output_text.delta
response.output_text.done
response.output_item.done
response.completed
```

Errors use `error` and `response.failed` events.

Mock behavior:

- Randomly select a response from a fixed response pool.
- Split the response into multiple text deltas.
- Add a small random delay between deltas.
- Stop generation when the client aborts the connection.
- Support deterministic triggers such as `mock:error` for manually checking failure handling.
- Remain stateless and never store chat rooms or messages.

## 6. LLM Provider Abstraction

The BE must not expose OpenAI DTOs throughout the domain layer. Define an internal provider interface:

```ts
interface LlmProvider {
  streamResponse(
    input: LlmRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamEvent>;
}
```

`OpenAiCompatibleProvider` is responsible for:

1. Converting the BE-normalized context into Responses API input.
2. Calling `POST /v1/responses`.
3. Parsing provider SSE events.
4. Converting provider events into internal `LlmStreamEvent` values.
5. Normalizing provider errors and cancellation.

This boundary allows MockLLM to be replaced by OpenAI, Azure OpenAI, OpenRouter, or LiteLLM without changing chat controllers and services.

## 7. In-Memory State Model

The POC does not use Prisma, SQLite, PostgreSQL, or any other database. The BE owns a singleton `InMemoryChatStore` that keeps chat rooms, messages, and runs in process memory.

The store is intentionally non-durable:

- Browser reloads can restore history while the BE process remains running.
- Restarting the BE clears every chat room, message, and run.
- Multiple BE instances do not share state.
- This limitation is acceptable for the POC and must be documented in `DOCS.md` and the README.

### 7.1 ChatRoom

```text
id
title
status          regular | archived
createdAt
updatedAt
```

### 7.2 Message

```text
id
chatRoomId
role            system | developer | user | assistant | tool
content         JSON
status          in_progress | completed | failed
providerMessageId nullable
createdAt
updatedAt
```

### 7.3 Run

```text
id
chatRoomId
status          in_progress | completed | failed | cancelled
provider
model
errorCode       nullable
errorMessage    nullable
startedAt
completedAt     nullable
```

Keeping `Run` separate from `Message` makes provider execution state explicit and leaves room for token usage, latency, and error metadata.

The in-memory store should expose domain-oriented operations rather than leaking its internal `Map` objects:

```ts
interface ChatStore {
  createChatRoom(): ChatRoom;
  listChatRooms(input: { cursor?: string; limit: number }): ChatRoomPage;
  getChatRoom(chatRoomId: string): ChatRoom | undefined;
  updateChatRoom(
    chatRoomId: string,
    patch: UpdateChatRoom,
  ): ChatRoom | undefined;
  deleteChatRoom(chatRoomId: string): boolean;
  listMessages(chatRoomId: string, input: MessagePageInput): MessagePage;
  upsertMessage(message: Message): void;
  createRun(run: Run): void;
  updateRun(runId: string, patch: UpdateRun): Run | undefined;
}
```

Use insertion order plus opaque IDs for the POC cursor. `listChatRooms` sorts by `updatedAt` descending and returns at most `limit` items.

## 8. Cross-Cutting BE Configuration

Configure the BE with:

- Global DTO validation and transformation.
- RFC 9457 exception filter.
- Request ID middleware.
- Structured logging interceptor.
- CORS restricted to the FE origin.
- Environment variable validation at startup.
- LLM request timeout and cancellation.
- `MOCK_LLM_BASE_URL` configuration.
- One singleton `InMemoryChatStore` provider shared by the chat-room and run modules.

## 9. Implementation Phases

### Phase 1: Initialize Nx Workspace

1. Create an integrated Nx workspace.
2. Create the React `apps/fe` application.
3. Create the NestJS `apps/be` application.
4. Create the NestJS `apps/mock-llm` application.
5. Create `libs/contracts` and `libs/config` where shared code is justified.
6. Configure ports and environment variables.
7. Add a root command that starts all three applications.

### Phase 2: Establish API Conventions

1. Enable global validation in both NestJS applications.
2. Configure the BE `/api/v1` and MockLLM `/v1` prefixes.
3. Implement the RFC 9457 exception filter.
4. Add request IDs and structured logging.
5. Add health endpoints.
6. Validate environment variables at startup.

### Phase 3: Implement MockLLM

1. Define Responses API compatible DTOs.
2. Implement non-streaming `POST /v1/responses`.
3. Implement SSE when `stream` is `true`.
4. Add a fixed mock response pool.
5. Add text chunking and randomized delay.
6. Emit the Responses API lifecycle events.
7. Add error, delay, and abort simulation.
8. Manually inspect the stream with curl.

### Phase 4: Add the In-Memory Chat Store

1. Define the `ChatRoom`, `Message`, and `Run` domain models.
2. Define the `ChatStore` interface.
3. Implement a singleton `InMemoryChatStore` with process-local `Map` collections.
4. Implement chat room CRUD.
5. Implement cursor-paginated chat-room and message history.
6. Document DTOs, responses, and non-durable behavior in `DOCS.md`.
7. Delete a room's messages and runs when the room is deleted.

### Phase 5: Connect BE to MockLLM

1. Define the `LlmProvider` interface.
2. Implement `OpenAiCompatibleProvider`.
3. Call MockLLM through its configured base URL.
4. Parse `response.output_text.delta` events.
5. Propagate timeout and `AbortSignal` cancellation.
6. Normalize provider errors into domain errors.
7. Keep provider DTOs out of controllers and chat services.

### Phase 6: Implement the AG-UI Endpoint

1. Install `@ag-ui/core` and use its official event types.
2. Implement `POST /api/v1/runs`.
3. Validate `RunAgentInput`.
4. Resolve `threadId` through `InMemoryChatStore`.
5. Upsert input messages by message ID.
6. Read canonical ordered history from `InMemoryChatStore`.
7. Exclude failed or incomplete assistant messages.
8. Prepend the BE-owned `developer` instruction.
9. Create the run and latest user message.
10. Call `LlmProvider.streamResponse()` with the normalized context.
11. Convert provider deltas into `TEXT_MESSAGE_CONTENT` events.
12. Accumulate and store the complete assistant message in `InMemoryChatStore`.
13. Emit `RUN_FINISHED` on success.
14. Emit `RUN_ERROR` after an in-stream failure.
15. Mark the run as `cancelled` when the client disconnects.

### Phase 7: Connect the FE

1. Install assistant-ui, `@assistant-ui/react-ag-ui`, and `@ag-ui/client`.
2. Point a stable `HttpAgent` at `/api/v1/runs`.
3. Create the runtime with `useAgUiRuntime`.
4. Mount `AssistantRuntimeProvider`.
5. Load the sidebar with `GET /api/v1/chat-rooms?limit=20` without creating a room.
6. Render an empty main chat area until a room is selected or the first message is sent.
7. On the first message, create a room with `POST /api/v1/chat-rooms`, then start its run with `POST /api/v1/runs`.
8. Build the Thread, Message, and Composer UI.
9. Display streaming text, loading, cancellation, and errors.
10. Load an existing room's messages and hydrate the assistant-ui runtime.
11. Send the hydrated history plus the latest user turn through `RunAgentInput.messages`.
12. Connect chat-room CRUD and message history.
13. Keep attachments, tool calls, and reasoning UI out of the first version.

### Phase 8: Documentation and Minimal Verification

Avoid building a large unit or E2E test suite for this POC. Perform only the following verification:

1. Operate all REST endpoints with curl or an HTTP client.
2. Call MockLLM with curl and observe multiple deltas.
3. Confirm the BE converts MockLLM deltas into valid AG-UI events.
4. Confirm the FE progressively displays the response.
5. Reload the FE while the BE is still running and confirm rooms and messages are restored from memory.
6. Stop generation and confirm both BE and MockLLM streams are cancelled.
7. Trigger a MockLLM error and confirm the FE leaves its loading state.
8. Restart the BE and confirm the chat-room list becomes empty.
9. Send a follow-up question and confirm MockLLM receives the developer instruction, prior user turn, prior assistant turn, and latest user turn in order.
10. Run lint, typecheck, and a production build once.

## 10. First-Version Scope

Include:

- Text messages.
- Multiple chat rooms.
- Message history.
- Multi-turn context assembled by the BE.
- SSE streaming.
- Generation cancellation.
- MockLLM.
- Process-local in-memory chat history.

Defer:

- Authentication and multiple users.
- Tool calling.
- Attachments.
- Reasoning output.
- Message branching.
- SSE resumption.
- Automatic chat-room titles.
- Rate limiting.
- Swagger/OpenAPI generation.
- Prisma, SQLite, Redis, queues, and PostgreSQL.
- A large automated test suite.

## 11. References

- [AG-UI HTTP + SSE 1.0](https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse)
- [AG-UI Run Input](https://docs.ag-ui.com/spec/1.0/basic/run-input)
- [AG-UI Events](https://docs.ag-ui.com/concepts/events)
- [assistant-ui AG-UI Quickstart](https://www.assistant-ui.com/docs/runtimes/ag-ui/quickstart)
- [assistant-ui Threads API](https://www.assistant-ui.com/docs/cloud/api/threads)
- [assistant-ui Runs API](https://www.assistant-ui.com/docs/cloud/api/runs)
- [OpenAI Conversation State](https://platform.openai.com/docs/guides/conversation-state)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses/create)
- [OpenAI Streaming Responses](https://platform.openai.com/docs/guides/streaming-responses)
- [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

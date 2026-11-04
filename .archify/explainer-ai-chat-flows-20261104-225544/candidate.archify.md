# AI Chat POC：首次對話與持續對話 {#ai-chat-flows}

**BE 負責最終 context。** 以下兩張圖直接展開 FE、BE 內部元件與 MockLLM 的完整呼叫鏈。

- 第一張圖：載入 history、建立 room、完成第一輪回答。
- 第二張圖：hydrate history、重建 canonical context、完成後續回答。[](source:agui-run-input)
- MockLLM 無狀態，每輪都由 BE 傳入完整 Responses API input。[](source:openai-context)

@answer scope="POC · text only · process-local memory · stateless MockLLM"
@meta locale=zh-TW quality_profile=showcase
@source agui-run-input title="AG-UI 1.0 Run Input" url=https://docs.ag-ui.com/spec/1.0/basic/run-input
@source openai-context title="OpenAI Conversation State" url=https://platform.openai.com/docs/guides/conversation-state

## 首次進入與第一輪對話 {#first-run span=12}

@sequence id=first-run-flow title="首次建立 room、建立 Run、轉換完整 SSE lifecycle"
| actor fe | FE · React | frontend |
| actor rooms | BE · Rooms Ctrl | backend |
| actor runs | BE · Runs Ctrl | backend |
| actor service | BE · Run Service | backend |
| actor memory | BE · Memory | backend |
| actor provider | BE · LLM Provider | backend |
| actor mock | MockLLM · API | external |
| phase | 進入 app |
| fe | rooms | GET /api/v1/chat-rooms?cursor=&limit=20 | emphasis |
| rooms | memory | listChatRooms(cursor, 20) |
| memory | rooms | ChatRoomPage（可為空） | return |
| rooms | fe | 200 { chatRooms, nextCursor } | return |
| phase | 首次送出 |
| fe | rooms | POST /api/v1/chat-rooms {} | emphasis |
| rooms | memory | createChatRoom() |
| memory | rooms | ChatRoom { id, title: null } | return |
| rooms | fe | 201 Created + Location + ChatRoom | return |
| fe | runs | POST /api/v1/runs · JSON + Accept SSE | emphasis |
| runs | service | executeRun(RunAgentInput, AbortSignal) |
| service | memory | getChatRoom(threadId) |
| memory | service | ChatRoom or not-found | return |
| service | memory | upsert user + create Run + assistant(in_progress) |
| memory | service | Run(in_progress) + assistant messageId | return |
| service | runs | yield RUN_STARTED { threadId, runId } | return |
| runs | fe | SSE data: RUN_STARTED | dashed |
| service | provider | streamResponse(LlmRequest, AbortSignal) | emphasis |
| provider | mock | POST /v1/responses { input, stream: true } | emphasis |
| mock | provider | 200 Content-Type: text/event-stream | return |
| mock | provider | response.created | dashed |
| provider | service | LlmStreamEvent.started(providerResponseId) | dashed |
| mock | provider | response.output_item.added | dashed |
| mock | provider | response.content_part.added | dashed |
| service | runs | yield TEXT_MESSAGE_START { messageId } | return |
| runs | fe | SSE data: TEXT_MESSAGE_START | dashed |
| mock | provider | response.output_text.delta（重複 N 次） | dashed |
| provider | service | LlmStreamEvent.textDelta(delta) | dashed |
| service | runs | yield TEXT_MESSAGE_CONTENT { delta } | dashed |
| runs | fe | SSE data: TEXT_MESSAGE_CONTENT | dashed |
| mock | provider | response.output_text.done | dashed |
| mock | provider | response.output_item.done | dashed |
| mock | provider | response.completed | return |
| provider | service | LlmStreamEvent.completed(usage) | return |
| service | memory | update assistant(completed) + Run(completed) |
| memory | service | updated records | return |
| service | runs | yield TEXT_MESSAGE_END | return |
| runs | fe | SSE data: TEXT_MESSAGE_END | dashed |
| service | runs | yield RUN_FINISHED { threadId, runId } | return |
| runs | fe | SSE data: RUN_FINISHED; close body | return |

## 載入歷史與持續對話 context {#continued-run span=12}

@sequence id=continued-run-flow title="載入 history、去重過濾、組裝 context、完成後續回答"
| actor fe2 | FE · React | frontend |
| actor rooms2 | BE · Rooms Ctrl | backend |
| actor runs2 | BE · Runs Ctrl | backend |
| actor context | BE · Context Svc | backend |
| actor memory2 | BE · Memory | backend |
| actor provider2 | BE · LLM Provider | backend |
| actor mock2 | MockLLM · API | external |
| phase | 選取既有 room |
| fe2 | rooms2 | GET /api/v1/chat-rooms/{id}/messages?cursor=&limit=50 | emphasis |
| rooms2 | memory2 | listMessages(roomId, cursor, 50) |
| memory2 | rooms2 | MessagePage ordered by createdAt ASC | return |
| rooms2 | fe2 | 200 { messages, nextCursor } → hydrate runtime | return |
| phase | 送出 follow-up |
| fe2 | runs2 | POST /api/v1/runs · full visible messages | emphasis |
| runs2 | context | executeRun(input, AbortSignal) |
| context | memory2 | getChatRoom(threadId) |
| memory2 | context | ChatRoom | return |
| context | memory2 | upsert every incoming message by messageId |
| memory2 | context | reconciliation complete | return |
| context | memory2 | listMessages(roomId) |
| memory2 | context | canonical ordered history | return |
| context | provider2 | streamResponse(developer + eligible history + latest) | emphasis |
| provider2 | mock2 | POST /v1/responses { input, stream: true } | emphasis |
| mock2 | provider2 | 200 text/event-stream + response.created | dashed |
| provider2 | context | LlmStreamEvent.started | dashed |
| context | runs2 | yield RUN_STARTED + TEXT_MESSAGE_START | return |
| runs2 | fe2 | SSE: RUN_STARTED + TEXT_MESSAGE_START | dashed |
| mock2 | provider2 | response.output_text.delta（重複 N 次） | dashed |
| provider2 | context | LlmStreamEvent.textDelta(delta) | dashed |
| context | runs2 | yield TEXT_MESSAGE_CONTENT { delta } | dashed |
| runs2 | fe2 | SSE: TEXT_MESSAGE_CONTENT | dashed |
| mock2 | provider2 | response.output_text.done + response.completed | return |
| provider2 | context | LlmStreamEvent.completed(usage) | return |
| context | memory2 | store assistant + mark Run completed |
| memory2 | context | completed records | return |
| context | runs2 | yield TEXT_MESSAGE_END + RUN_FINISHED | return |
| runs2 | fe2 | SSE terminal events; close response | return |

## Context 與異常規則 {#context-rules span=12}

| 階段 | BE 必須執行 | 結果 |
| --- | --- | --- |
| Reconcile | 依 `messageId` upsert FE 傳來的完整 history | 重送 history 不會產生重複訊息 |
| Filter | 只保留 completed `user` / `assistant` 文字訊息與最新 user turn | failed / incomplete assistant 不進模型 context |
| Instruct | 在 canonical history 前加入 server-owned `developer` instruction | FE 無法覆寫系統規則 |
| Pre-stream error | validation、room not found、auth failure | HTTP 4xx + `application/problem+json`，不開 SSE |
| In-stream error | MockLLM `error` 或 `response.failed` | 更新 Run=failed，送 `RUN_ERROR`，不送 `RUN_FINISHED` |
| Disconnect | FE 關閉連線 | `AbortSignal` 傳到 Provider / MockLLM，更新 Run=cancelled |

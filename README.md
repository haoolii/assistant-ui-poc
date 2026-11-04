我現在要做一個 POC 專案
先幫我使用 nx 建立三個 app

1. FE (react)
2. BE (nestjs)
3. MockLLM (nestjs)

僅串接 BE 實現 react + assistant ui + ag-ui 串接 AI 對話的部分
BE 會有 chatRoom 等等一系列串接LLM 與儲存歷史對話的部分
MockLLM 只是模擬 LLM 回答，會隨機回應幾個固定內容，不是真的LLM，無狀態，會需要用SSE方式回傳

分為幾個步驟

1. 先把專案初始化完成 (3個APP)
2. 先建立 MockLLM 的 Mock API 與 Mock DATA
3. BE 串接 MockLLM 確保 可以接上
4. FE 測試串接 BE
5. LLM 完整API MOCK 功能
6. BE 完整 API
7. FE 完整串接

Step 6 的 BE API 已完成，包含 chat room CRUD、訊息歷史、AG-UI SSE run endpoint，以及 BE 到 MockLLM 的多輪對話 context 組裝。

Step 7 的 FE 使用 assistant-ui AG-UI runtime 與 HttpAgent 連接 BE。啟動 `npm run dev` 後開啟 `http://localhost:4200`；可建立對話、串流、停止、重新載入歷史、重新命名及刪除對話。`VITE_BE_BASE_URL` 可設定 BE API 位址，預設為 `http://localhost:3000/api/v1`。`mock:slow` 和 `mock:error` 可用來觀察停止與錯誤處理。

目前 chat room、message 與 run 僅儲存在 BE process 內的 memory。重新啟動 BE 會清除所有資料，多個 BE instance 之間也不會共享狀態；此限制符合目前 POC 範圍。

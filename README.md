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


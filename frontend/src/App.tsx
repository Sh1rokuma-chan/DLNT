/**
 * DLNT v2 App — Phase 1 プレースホルダー
 * Phase 3 で Discord DM風レイアウトに置き換える
 */
export default function App() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">DLNT v2</h1>
        <p className="text-gray-400 mb-2">AIエージェントプラットフォーム</p>
        <p className="text-sm text-gray-500">
          Phase 1 — API稼働中 | フロントエンドは Phase 3 で実装予定
        </p>
        <div className="mt-8 space-y-2 text-sm text-gray-400">
          <p>
            API: <a href="/api/system/health" className="text-blue-400 underline">/api/system/health</a>
          </p>
          <p>
            Docs: <a href="/api/docs" className="text-blue-400 underline">/api/docs</a>
          </p>
        </div>
      </div>
    </div>
  )
}

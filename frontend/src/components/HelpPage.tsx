import { X, Keyboard, Bot, Cpu, Server, Shield, Globe } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'

const AGENTS = [
  { icon: '🔍', name: 'Scout', desc: 'Web調査・情報収集。SearXNG 経由で検索し、出典付きレポートを生成。' },
  { icon: '⚡', name: 'Coder', desc: 'コード実行・分析。Python/シェル実行とファイル操作が得意。' },
  { icon: '📚', name: 'Archivist', desc: 'ドキュメント横断検索。RAG + ベクトル検索で社内知識を引き出す。' },
  { icon: '📝', name: 'Scribe', desc: '議事録・レポート生成。音声ファイルの文字起こしにも対応。' },
]

const SHORTCUTS = [
  { key: '⌘1 – ⌘4', desc: 'エージェントを切替' },
  { key: '⌘N', desc: '新しい会話を開始' },
  { key: '⌘K', desc: '会話を検索' },
  { key: 'Esc', desc: 'AI生成を停止' },
  { key: 'Enter', desc: 'メッセージを送信' },
  { key: 'Shift+Enter', desc: '改行' },
]

export function HelpPage() {
  const { helpOpen, setHelpOpen } = useChatStore()
  if (!helpOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => setHelpOpen(false)}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-gray-800 border border-gray-700 rounded-2xl w-[520px] max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">T</span>
            </div>
            <h2 className="text-base font-bold text-white">Tak AI Chat — 使い方ガイド</h2>
          </div>
          <button
            onClick={() => setHelpOpen(false)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* セキュリティ・プライバシー */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={15} className="text-green-400" />
              <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wide">閉域ネットワーク動作</h3>
            </div>
            <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-4 space-y-2.5">
              <div className="flex items-start gap-2">
                <Shield size={13} className="text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-gray-300 leading-relaxed">
                  <strong className="text-green-300">完全ローカル処理</strong> — 会話データ・ファイル・音声はすべてこのマシン内で処理されます。
                  外部サーバーへのアップロードや学習への利用は一切ありません。
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Globe size={13} className="text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-gray-300 leading-relaxed">
                  <strong className="text-green-300">Web接続は検索時のみ</strong> — インターネット接続は Web検索ツール（SearXNG）使用時に限定されます。
                  入力バーの <span className="inline-flex items-center px-1 py-0.5 bg-gray-700 rounded text-[10px]"><Globe size={9} className="mr-0.5" />Web検索</span> ボタンで ON/OFF を切り替えられます。
                  OFF にすると完全オフラインで動作します。
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Server size={13} className="text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-gray-300 leading-relaxed">
                  <strong className="text-green-300">LLM もローカル</strong> — AI モデル (Ollama) はこのマシン上で動作しています。
                  OpenAI や Google 等のクラウド API は使用していません。
                </p>
              </div>
            </div>
          </section>

          {/* エージェント */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Bot size={15} className="text-indigo-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">エージェント</h3>
            </div>
            <div className="space-y-2.5">
              {AGENTS.map(a => (
                <div key={a.name} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center text-base flex-shrink-0">
                    {a.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-200">{a.name}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{a.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Web検索のON/OFF */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Globe size={15} className="text-indigo-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Web検索の切替</h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              入力バー左側の <span className="inline-flex items-center px-1 py-0.5 bg-gray-700 rounded text-[10px]"><Globe size={9} className="mr-0.5" />アイコン</span> で Web検索の ON/OFF を切り替えます。
            </p>
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Globe size={12} className="text-indigo-400" />
                <span className="font-semibold text-indigo-300">ON</span>
                <span>— エージェントが必要に応じてWeb検索を使用（SearXNG経由）</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Globe size={12} className="text-gray-600" />
                <span className="font-semibold text-gray-400">OFF</span>
                <span>— 完全オフライン。ローカルの知識・ファイルのみで回答</span>
              </div>
            </div>
          </section>

          {/* キーボードショートカット */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Keyboard size={15} className="text-indigo-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">キーボードショートカット</h3>
            </div>
            <div className="space-y-1.5">
              {SHORTCUTS.map(s => (
                <div key={s.key} className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{s.desc}</span>
                  <kbd className="px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs text-gray-300 font-mono">{s.key}</kbd>
                </div>
              ))}
            </div>
          </section>

          {/* モデル選択 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={15} className="text-indigo-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">モデル選択</h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              右上のモデルセレクターで LLM を切替できます。
              カスタムモデル名を直接入力することも可能です。
            </p>
            <div className="mt-2 space-y-1">
              {[
                { name: 'gpt-oss:20b', label: 'GPT-OSS 20B', note: 'デフォルト・バランス型' },
                { name: 'qwen3.5:35b-a3b', label: 'Qwen3.5 35B-A3B', note: '高精度・重いタスク向け' },
              ].map(m => (
                <div key={m.name} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                  <span className="font-mono text-indigo-300">{m.name}</span>
                  <span className="text-gray-600">—</span>
                  <span>{m.note}</span>
                </div>
              ))}
            </div>
          </section>

          {/* システム情報 */}
          <section className="pb-1">
            <div className="flex items-center gap-2 mb-3">
              <Server size={15} className="text-indigo-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">システム情報</h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Ollama', 'FastAPI', 'PostgreSQL', 'pgvector', 'SearXNG', 'Whisper', 'React', 'Caddy'].map(t => (
                <span key={t} className="px-2 py-0.5 bg-gray-700/80 border border-gray-600/50 rounded text-xs text-gray-400">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-600">
              完全ローカル動作 — 全コンポーネントがこのマシン上で稼働しています
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

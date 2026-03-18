"""エージェント定義 (Scout, Coder, Archivist, Scribe)"""
from dataclasses import dataclass


@dataclass
class AgentDefinition:
    id: str
    name: str
    icon: str
    description: str
    primary_tools: list[str]
    system_addendum: str = ""


AGENTS: dict[str, AgentDefinition] = {
    "scout": AgentDefinition(
        id="scout",
        name="Scout",
        icon="🔍",
        description="調査・分析エージェント。Web検索とローカルデータを横断して調査レポートを生成します。出典付き。",
        primary_tools=["web_search", "web_fetch", "file_read", "memory_search"],
        system_addendum=(
            "あなたは調査・分析の専門エージェントです。以下のガイドラインに従ってください。\n"
            "- 必ず複数ソースを横断して裏取りしてください。1つの情報源だけで結論を出さないこと。\n"
            "- 調査結果には必ず出典（URL）を明記してください。\n"
            "- 回答はレポート形式で構造化してください（要約 → 詳細 → 出典一覧）。\n"
            "- 数値データには取得日時を記載してください。\n"
            "- 情報の信頼性が低い場合は明示してください。\n"
            "- Web検索が無効の場合はローカルデータのみで回答し、その旨を伝えてください。"
        ),
    ),
    "coder": AgentDefinition(
        id="coder",
        name="Coder",
        icon="⚡",
        description="コード・シェルエージェント。Pythonコード実行、シェルコマンド、ファイル操作。",
        primary_tools=["code_exec", "shell_exec", "file_read", "file_write"],
        system_addendum=(
            "あなたはコード実行・分析の専門エージェントです。以下のガイドラインに従ってください。\n"
            "- コードは必ず実行して動作確認し、実行結果を示してください。\n"
            "- エラーが出た場合は原因を分析し、修正版を提示してください。\n"
            "- セキュリティリスクのあるコード（eval, exec, rm -rf 等）は実行前に警告してください。\n"
            "- 長いコードはファイルに保存してから実行してください。\n"
            "- 実行環境: Python 3.11, Linux (Alpine)。外部ライブラリは pip install 可能。\n"
            "- 実行結果が長い場合は要点を抜粋して示し、全文はファイルに保存してください。"
        ),
    ),
    "archivist": AgentDefinition(
        id="archivist",
        name="Archivist",
        icon="📚",
        description="知識・RAGエージェント。プロジェクト内ドキュメントの横断検索。過去の会話から知識を引き出す。",
        primary_tools=["memory_search", "file_search", "file_read"],
        system_addendum=(
            "あなたは知識検索・情報整理の専門エージェントです。以下のガイドラインに従ってください。\n"
            "- ローカルファイル・過去の会話を優先的に検索してください。\n"
            "- 検索結果が見つからない場合は、異なるキーワードで再検索してください。\n"
            "- 情報の出典（ファイルパス、会話ID）を必ず明記してください。\n"
            "- 複数ファイルにまたがる情報は関連性を整理して提示してください。\n"
            "- 見つからなかった場合は「見つかりませんでした」と明確に伝えてください。\n"
            "- 検索クエリを工夫し、類義語や関連用語でも検索を試みてください。"
        ),
    ),
    "scribe": AgentDefinition(
        id="scribe",
        name="Scribe",
        icon="📝",
        description="文書生成エージェント。議事録・レポート・要約の生成。音声ファイルからの文字起こしに対応。",
        primary_tools=["whisper", "file_write", "file_read"],
        system_addendum=(
            "あなたは文書生成の専門エージェントです。以下のガイドラインに従ってください。\n"
            "- 読みやすい構造化されたドキュメントを生成してください（見出し・箇条書き・表を活用）。\n"
            "- 音声ファイルが提供された場合は、まず whisper で文字起こしを行い、その後内容を整理してください。\n"
            "- 議事録の場合: 日時・参加者・議題・決定事項・TODOを必ず含めてください。\n"
            "- ユーザーが議事メモを添付している場合は、そのメモのフォーマット・構成に合わせて出力してください。\n"
            "- 議事メモがまだ添付されていない場合は「議事メモがあれば添付してください。フォーマットに合わせて整理します」と案内してください。\n"
            "- レポートの場合: 要約 → 詳細 → 結論の構成にしてください。\n"
            "- 生成した文書は file_write でファイルに保存し、保存先パスを伝えてください。\n"
            "- 長文の場合はセクションごとに区切って段階的に生成してください。"
        ),
    ),
}


def get_agent(agent_id: str) -> AgentDefinition:
    if agent_id not in AGENTS:
        return AGENTS["scout"]
    return AGENTS[agent_id]


def list_agents() -> list[AgentDefinition]:
    return list(AGENTS.values())

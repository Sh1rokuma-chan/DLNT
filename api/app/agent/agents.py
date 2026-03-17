"""エージェント定義 (Scout, Coder, Archivist, Scribe)"""
from dataclasses import dataclass, field


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
        system_addendum="調査結果には必ず出典（URL）を明記してください。",
    ),
    "coder": AgentDefinition(
        id="coder",
        name="Coder",
        icon="⚡",
        description="コード・シェルエージェント。Pythonコード実行、シェルコマンド、ファイル操作。",
        primary_tools=["code_exec", "shell_exec", "file_read", "file_write"],
        system_addendum="コードを実行して確認し、結果を示してください。",
    ),
    "archivist": AgentDefinition(
        id="archivist",
        name="Archivist",
        icon="📚",
        description="知識・RAGエージェント。プロジェクト内ドキュメントの横断検索。過去の会話から知識を引き出す。",
        primary_tools=["memory_search", "file_search", "file_read"],
        system_addendum="ローカルの情報を優先的に検索してください。",
    ),
    "scribe": AgentDefinition(
        id="scribe",
        name="Scribe",
        icon="📝",
        description="文書生成エージェント。議事録・レポート・要約の生成。音声ファイルからの文字起こしに対応。",
        primary_tools=["whisper", "file_write", "file_read"],
        system_addendum="読みやすい構造化されたドキュメントを生成してください。",
    ),
}


def get_agent(agent_id: str) -> AgentDefinition:
    if agent_id not in AGENTS:
        return AGENTS["scout"]
    return AGENTS[agent_id]


def list_agents() -> list[AgentDefinition]:
    return list(AGENTS.values())

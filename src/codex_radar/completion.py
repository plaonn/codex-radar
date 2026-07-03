from __future__ import annotations

from typing import Dict


COMMANDS = ("hook", "sessions", "transcript", "tui", "watch", "path", "doctor", "completion")
GLOBAL_OPTIONS = ("--state-dir", "-h", "--help")
SESSION_FILTER_OPTIONS = ("--project", "--status", "--model", "--since")


def bash_completion() -> str:
    words = " ".join((*COMMANDS, *GLOBAL_OPTIONS, "--json", "--limit", *SESSION_FILTER_OPTIONS))
    return f"""# codex-radar bash completion
_codex_radar_complete() {{
  COMPREPLY=($(compgen -W "{words}" -- "${{COMP_WORDS[COMP_CWORD]}}"))
}}
complete -F _codex_radar_complete codex-radar
"""


def zsh_completion() -> str:
    commands = " ".join(COMMANDS)
    return f"""#compdef codex-radar
_arguments \\
  '1:command:({commands})' \\
  '*::arg:->args'
"""


def fish_completion() -> str:
    lines = [
        "# codex-radar fish completion",
        f"complete -c codex-radar -f -n '__fish_use_subcommand' -a '{' '.join(COMMANDS)}'",
        "complete -c codex-radar -l state-dir -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from sessions tui' -l project -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from sessions tui' -l status -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from sessions tui' -l model -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from sessions tui' -l since -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l interval -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l once",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l no-bell",
    ]
    return "\n".join(lines) + "\n"


COMPLETIONS: Dict[str, str] = {
    "bash": bash_completion(),
    "zsh": zsh_completion(),
    "fish": fish_completion(),
}


def completion_script(shell: str) -> str:
    return COMPLETIONS[shell]

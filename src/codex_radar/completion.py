from __future__ import annotations

from typing import Dict


COMMANDS = (
    "hook",
    "sessions",
    "transcript",
    "tui",
    "watch",
    "path",
    "doctor",
    "usage",
    "thread",
    "export",
    "config",
    "prune",
    "reconcile",
    "completion",
)
GLOBAL_OPTIONS = ("--state-dir", "-h", "--help")
SESSION_FILTER_OPTIONS = ("--project", "--status", "--model", "--since")
SESSION_TEXT_OPTIONS = ("--group-project",)
WATCH_OPTIONS = ("--interval", "--status", "--once", "--no-bell", "--include-existing", "--quiet-start")
PRUNE_OPTIONS = ("--retention-days", "--dry-run")
RECONCILE_OPTIONS = ("--dry-run",)
USAGE_OPTIONS = ("--codex-home", "--file-limit")
EXPORT_COMMANDS = ("state", "preview")
THREAD_COMMANDS = ("rpc", "doctor", "start", "list", "read", "send")


def bash_completion() -> str:
    words = " ".join(
        (
            *COMMANDS,
            *GLOBAL_OPTIONS,
            "--json",
            "--limit",
            *SESSION_FILTER_OPTIONS,
            *SESSION_TEXT_OPTIONS,
            *WATCH_OPTIONS,
            *PRUNE_OPTIONS,
            *RECONCILE_OPTIONS,
            *USAGE_OPTIONS,
            *EXPORT_COMMANDS,
            *THREAD_COMMANDS,
            "get",
            "set",
            "retention_days",
        )
    )
    return f"""# codex-radar bash completion
_codex_radar_complete() {{
  COMPREPLY=($(compgen -W "{words}" -- "${{COMP_WORDS[COMP_CWORD]}}"))
}}
complete -F _codex_radar_complete codex-radar
"""


def zsh_completion() -> str:
    commands = " ".join(COMMANDS)
    return f"""#compdef codex-radar
_codex_radar() {{
  if (( CURRENT == 2 )); then
    _values 'command' {commands}
    return
  fi
  if [[ $words[2] == export ]]; then
    if (( CURRENT == 3 )); then
      _values 'export command' state preview
      return
    fi
    case $words[3] in
      state) _arguments '--json[print versioned JSON contract]' ;;
      preview) _arguments '--limit=[maximum messages]:limit:' ;;
    esac
    return
  fi
  if [[ $words[2] == thread ]]; then
    if (( CURRENT == 3 )); then
      _values 'thread command' rpc doctor start list read send
      return
    fi
    case $words[3] in
      rpc|doctor|start|list|read|send)
        _arguments '--codex-command=[compatible Codex executable]:path:' '--cwd=[thread working directory]:directory:' '--model=[model override]:string:' '--effort=[reasoning effort]:string:' '--limit=[maximum threads]:integer:' '--turn-limit=[maximum turns]:integer:'
        ;;
    esac
    return
  fi
  _arguments '*::arg:->args'
}}
_codex_radar
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
        "complete -c codex-radar -n '__fish_seen_subcommand_from sessions' -l group-project",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l interval -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l status -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l once",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l no-bell",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l include-existing",
        "complete -c codex-radar -n '__fish_seen_subcommand_from watch' -l quiet-start",
        "complete -c codex-radar -n '__fish_seen_subcommand_from config' -a 'get set'",
        "complete -c codex-radar -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'retention_days'",
        "complete -c codex-radar -n '__fish_seen_subcommand_from prune' -l retention-days -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from prune' -l dry-run",
        "complete -c codex-radar -n '__fish_seen_subcommand_from reconcile' -l dry-run",
        "complete -c codex-radar -n '__fish_seen_subcommand_from usage' -l json",
        "complete -c codex-radar -n '__fish_seen_subcommand_from usage' -l codex-home -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from usage' -l file-limit -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from export; and not __fish_seen_subcommand_from state preview' -a 'state preview'",
        "complete -c codex-radar -n '__fish_seen_subcommand_from export; and __fish_seen_subcommand_from state' -l json",
        "complete -c codex-radar -n '__fish_seen_subcommand_from export; and __fish_seen_subcommand_from preview' -l limit -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from thread; and not __fish_seen_subcommand_from rpc doctor start list read send' -a 'rpc doctor start list read send'",
        "complete -c codex-radar -n '__fish_seen_subcommand_from rpc doctor start list read send' -l codex-command -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from start' -l cwd -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from start' -l model -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from start' -l effort -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from list' -l limit -r",
        "complete -c codex-radar -n '__fish_seen_subcommand_from read' -l turn-limit -r",
    ]
    return "\n".join(lines) + "\n"


COMPLETIONS: Dict[str, str] = {
    "bash": bash_completion(),
    "zsh": zsh_completion(),
    "fish": fish_completion(),
}


def completion_script(shell: str) -> str:
    return COMPLETIONS[shell]

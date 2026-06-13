//! `flowix-cli` 库入口 ── 同时被 `main.rs` 调用。
//!
//! 6 个子命令 + 4 个全局 flag (`--version` / `--help` / `--json` / `-j`), 手写 parser。

pub mod editor;
pub mod errors;
pub mod fmt;
pub mod paths;
pub mod store;

pub use errors::CliError;

/// 解析后的 CLI 命令。
pub enum Cli {
    Version,
    Notebooks {
        json: bool,
    },
    List {
        notebook: String,
        json: bool,
    },
    Show {
        id: String,
        json: bool,
    },
    New {
        notebook: String,
        name: Option<String>,
        from_stdin: bool,
        json: bool,
    },
    Delete {
        id: String,
        json: bool,
    },
    Search {
        query: String,
        notebook: Option<String>,
        limit: usize,
        json: bool,
    },
    Edit {
        id: String,
        json: bool,
    },
    Completion {
        shell: String,
    },
}

/// 跑 CLI 主入口。
pub fn run_cli(args: &[String]) -> Result<(), CliError> {
    let cli = match parse(args)? {
        Some(c) => c,
        None => return Ok(()),
    };
    match cli {
        Cli::Version => {
            println!("flowix-cli {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Cli::Notebooks { json } => {
            if json {
                store::cmd_notebooks_json()
            } else {
                store::cmd_notebooks()
            }
        }
        Cli::List { notebook, json } => {
            if json {
                store::cmd_list_json(&notebook)
            } else {
                store::cmd_list(&notebook)
            }
        }
        Cli::Show { id, json } => {
            if json {
                store::cmd_show_json(&id)
            } else {
                store::cmd_show(&id)
            }
        }
        Cli::New {
            notebook,
            name,
            from_stdin,
            json,
        } => store::cmd_new(&notebook, name.as_deref(), from_stdin, json),
        Cli::Delete { id, json } => store::cmd_delete(&id, json),
        Cli::Search {
            query,
            notebook,
            limit,
            json,
        } => store::cmd_search(&query, notebook.as_deref(), limit, json),
        Cli::Edit { id, json } => store::cmd_edit(&id, json),
        Cli::Completion { shell } => store::cmd_completion(&shell),
    }
}

/// 解析 argv。`Ok(None)` 表示"打印了 help 正常退出"。
fn parse(args: &[String]) -> Result<Option<Cli>, CliError> {
    // --json / -j 必须在第一位时也能工作 ── 直接 skip 它, 重新走 parse
    let args_filtered: Vec<String> =
        if matches!(args.first().map(String::as_str), Some("--json" | "-j")) {
            args.iter().skip(1).cloned().collect()
        } else {
            args.to_vec()
        };

    if let Some(first) = args_filtered.first().map(String::as_str) {
        match first {
            "--version" | "-V" => return Ok(Some(Cli::Version)),
            "--help" | "-h" | "help" => {
                print_help();
                return Ok(None);
            }
            _ => {}
        }
    }

    let json = args.iter().any(|a| a == "--json" || a == "-j");

    let verb = match args_filtered.first().map(String::as_str) {
        Some(v) => v,
        None => {
            print_help();
            return Ok(None);
        }
    };

    // 过滤掉 --json, 保留位置参数
    let pos: Vec<&str> = args_filtered
        .iter()
        .skip(1)
        .filter(|a| *a != "--json" && *a != "-j")
        .map(String::as_str)
        .collect();

    match verb {
        "notebooks" | "nb" | "notebook" => Ok(Some(Cli::Notebooks { json })),
        "list" => match pos.first() {
            Some(nb) => Ok(Some(Cli::List {
                notebook: nb.to_string(),
                json,
            })),
            None => Err(CliError::Usage(
                "usage: flowix-cli list <notebook> [--json]".into(),
            )),
        },
        "show" => match pos.first() {
            Some(id) => Ok(Some(Cli::Show {
                id: id.to_string(),
                json,
            })),
            None => Err(CliError::Usage(
                "usage: flowix-cli show <id> [--json]".into(),
            )),
        },
        "new" => match pos.first() {
            Some(nb) => {
                let second = pos.get(1).copied();
                let from_stdin = matches!(second, Some("-"));
                let name = if from_stdin {
                    None
                } else {
                    second.map(String::from)
                };
                Ok(Some(Cli::New {
                    notebook: nb.to_string(),
                    name,
                    from_stdin,
                    json,
                }))
            }
            None => Err(CliError::Usage(
                "usage: flowix-cli new <notebook> [name | -]".into(),
            )),
        },
        "delete" | "rm" => match pos.first() {
            Some(id) => Ok(Some(Cli::Delete {
                id: id.to_string(),
                json,
            })),
            None => Err(CliError::Usage("usage: flowix-cli delete <id>".into())),
        },
        "edit" | "e" => match pos.first() {
            Some(id) => Ok(Some(Cli::Edit {
                id: id.to_string(),
                json,
            })),
            None => Err(CliError::Usage("usage: flowix-cli edit <id>".into())),
        },
        "completion" => match pos.first() {
            Some(shell) => Ok(Some(Cli::Completion {
                shell: shell.to_string(),
            })),
            None => Err(CliError::Usage(
                "usage: flowix-cli completion <bash|zsh|fish>".into(),
            )),
        },
        "search" => {
            // 第一个 pos 是 query; 后面 --notebook <name> / --limit <n> 解析
            let query = pos.first().copied().unwrap_or("");
            if query.is_empty() {
                return Err(CliError::Usage(
                    "usage: flowix-cli search <query> [--notebook <nb>] [--limit <n>]".into(),
                ));
            }
            // 从原 args 里解析 --notebook / --limit (跳过 -j/--json 之外)
            let mut notebook: Option<String> = None;
            let mut limit: usize = 20;
            let mut i = 0;
            while i < args_filtered.len() {
                match args_filtered[i].as_str() {
                    "--notebook" | "-n" => {
                        notebook = args_filtered.get(i + 1).cloned();
                        i += 2;
                    }
                    "--limit" | "-l" => {
                        if let Some(n) = args_filtered.get(i + 1).and_then(|s| s.parse().ok()) {
                            limit = n;
                        }
                        i += 2;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            Ok(Some(Cli::Search {
                query: query.to_string(),
                notebook,
                limit,
                json,
            }))
        }
        other => Err(CliError::Usage(format!(
            "unknown command: `{other}`\n(run `flowix-cli --help` for usage)"
        ))),
    }
}

pub fn print_help() {
    let usage = "\
USAGE:
    flowix-cli [GLOBAL FLAGS] <COMMAND> [ARGS]

GLOBAL FLAGS:
    --version, -V      Print version and exit
    --help, -h         Print this help and exit
    --json, -j         Output as JSON (for notebooks / list / show)

COMMANDS:
    notebooks          List all notebooks
    list <notebook>    List notes in a notebook
    show <id>          Print a note to stdout
    new <notebook>     Create a new note
                       [name | -]  (editor / stdin)
    delete <id>        Delete a note
    edit <id>          Edit a note in $EDITOR
    search <query>     Full-text search
                       [--notebook <nb>] [--limit <n>]
    completion <sh>    Print shell completion (bash|zsh|fish)

ENVIRONMENT:
    FLOWIX_HOME        Override config dir (default: ~/.flowix)
    FLOWIX_DATA        Override data dir (default: <OS data dir>/flowix)

EXAMPLES:
    flowix-cli --version
    flowix-cli notebooks
    flowix-cli notebooks --json | jq
    flowix-cli list work
    flowix-cli list work --json | jq '.[] | select(.favorited)'
    flowix-cli show a1b2c3
    flowix-cli show a1b2c3 --json | jq '.body'
    echo \"# hello\" | flowix-cli new work -
    FLOWIX_HOME=/tmp/fx-test flowix-cli notebooks
";
    print!("{usage}");
}

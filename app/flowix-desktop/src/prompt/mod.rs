//! System prompt assembly for agents.

mod base;
mod behavior;
mod safety;
mod tools;

pub struct SystemPromptConfig<'a> {
    pub model: &'a str,
    pub tools_enabled: bool,
}

pub fn build_system_prompt(config: SystemPromptConfig<'_>) -> String {
    let mut sections = vec![
        base::section(config.model),
        behavior::section(),
        safety::section(),
    ];

    if config.tools_enabled {
        sections.push(tools::section());
    }

    sections
        .into_iter()
        .filter(|section| !section.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

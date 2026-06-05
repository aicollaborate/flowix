//! System prompt assembly for agents.

mod base;
mod behavior;
mod custom;
mod safety;
mod tools;

pub struct SystemPromptConfig<'a> {
    pub agent_name: &'a str,
    pub model: &'a str,
    pub user_prompt: &'a str,
    pub tools_enabled: bool,
}

pub fn build_system_prompt(config: SystemPromptConfig<'_>) -> String {
    let mut sections = vec![
        base::section(config.agent_name, config.model),
        behavior::section(),
        safety::section(),
    ];

    if config.tools_enabled {
        sections.push(tools::section());
    }

    if let Some(section) = custom::section(config.user_prompt) {
        sections.push(section);
    }

    sections
        .into_iter()
        .filter(|section| !section.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

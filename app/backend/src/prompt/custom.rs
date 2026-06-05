pub fn section(user_prompt: &str) -> Option<String> {
    let user_prompt = user_prompt.trim();
    if user_prompt.is_empty() {
        return None;
    }

    Some(format!(
        r#"# User Custom Instructions
Follow these additional user-configured instructions when they do not conflict with the higher-priority safety and tool rules above:

{}"#,
        user_prompt
    ))
}

use std::collections::HashMap;
use once_cell::sync::Lazy;

pub static MODEL_ALIASES: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("big-pickle", "glm-4.7");
    m.insert("big pickle", "glm-4.7");
    m.insert("bigpickle", "glm-4.7");
    m
});

pub static OPENROUTER_MAPPINGS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("glm-4.7", "z-ai/glm-4.7");
    m.insert("glm-4.7-free", "z-ai/glm-4.7");
    m
});

pub static OPENROUTER_PROVIDER_NAMES: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("z-ai", "Z.AI");
    m
});

pub fn resolve_alias(model_id: &str) -> Option<&'static str> {
    MODEL_ALIASES.get(model_id.to_lowercase().as_str()).copied()
}

pub fn get_openrouter_id(model_id: &str) -> Option<&'static str> {
    OPENROUTER_MAPPINGS.get(model_id.to_lowercase().as_str()).copied()
}

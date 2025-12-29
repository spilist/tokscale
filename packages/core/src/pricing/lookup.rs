use super::{aliases, litellm::ModelPricing};
use std::collections::HashMap;

const PROVIDER_PREFIXES: &[&str] = &[
    "openai/", "anthropic/", "google/", "meta-llama/", "mistralai/", 
    "deepseek/", "qwen/", "cohere/", "perplexity/", "x-ai/",
];

const FUZZY_BLOCKLIST: &[&str] = &["auto", "mini", "chat", "base"];

const MIN_FUZZY_MATCH_LEN: usize = 5;

/// Quality/speed tier suffixes that should be stripped for pricing lookup
/// These indicate provider-specific routing but don't affect the base model pricing
const TIER_SUFFIXES: &[&str] = &["-low", "-high", "-medium", "-free", ":low", ":high", ":medium", ":free"];

pub struct PricingLookup {
    litellm: HashMap<String, ModelPricing>,
    openrouter: HashMap<String, ModelPricing>,
    litellm_keys: Vec<String>,
    openrouter_keys: Vec<String>,
}

pub struct LookupResult {
    pub pricing: ModelPricing,
    pub source: String,
    pub matched_key: String,
}

impl PricingLookup {
    pub fn new(litellm: HashMap<String, ModelPricing>, openrouter: HashMap<String, ModelPricing>) -> Self {
        let mut litellm_keys: Vec<String> = litellm.keys().cloned().collect();
        litellm_keys.sort_by(|a, b| b.len().cmp(&a.len()));
        
        let mut openrouter_keys: Vec<String> = openrouter.keys().cloned().collect();
        openrouter_keys.sort_by(|a, b| b.len().cmp(&a.len()));
        
        Self { litellm, openrouter, litellm_keys, openrouter_keys }
    }
    
    pub fn lookup(&self, model_id: &str) -> Option<LookupResult> {
        self.lookup_with_source(model_id, None)
    }
    
    pub fn lookup_with_source(&self, model_id: &str, force_source: Option<&str>) -> Option<LookupResult> {
        let canonical = aliases::resolve_alias(model_id).unwrap_or(model_id);
        let lower = canonical.to_lowercase();
        
        let result = match force_source {
            Some("litellm") => self.lookup_litellm_only(&lower),
            Some("openrouter") => self.lookup_openrouter_only(&lower),
            _ => self.lookup_auto(&lower),
        };
        
        if result.is_some() {
            return result;
        }
        
        if let Some(stripped) = strip_tier_suffix(&lower) {
            return match force_source {
                Some("litellm") => self.lookup_litellm_only(stripped),
                Some("openrouter") => self.lookup_openrouter_only(stripped),
                _ => self.lookup_auto(stripped),
            };
        }
        
        None
    }
    
    fn lookup_auto(&self, model_id: &str) -> Option<LookupResult> {
        if let Some(result) = self.exact_match_litellm(model_id) {
            return Some(result);
        }
        
        if let Some(result) = self.exact_match_openrouter(model_id) {
            return Some(result);
        }
        
        if let Some(normalized) = normalize_model_name(model_id) {
            if let Some(result) = self.exact_match_litellm(&normalized) {
                return Some(result);
            }
            if let Some(result) = self.exact_match_openrouter(&normalized) {
                return Some(result);
            }
        }
        
        if let Some(result) = self.prefix_match_litellm(model_id) {
            return Some(result);
        }
        if let Some(result) = self.prefix_match_openrouter(model_id) {
            return Some(result);
        }
        
        if !is_fuzzy_eligible(model_id) {
            return None;
        }
        
        if let Some(result) = self.fuzzy_match_litellm(model_id) {
            return Some(result);
        }
        if let Some(result) = self.fuzzy_match_openrouter(model_id) {
            return Some(result);
        }
        
        None
    }
    
    fn lookup_litellm_only(&self, model_id: &str) -> Option<LookupResult> {
        if let Some(result) = self.exact_match_litellm(model_id) {
            return Some(result);
        }
        if let Some(normalized) = normalize_model_name(model_id) {
            if let Some(result) = self.exact_match_litellm(&normalized) {
                return Some(result);
            }
        }
        if let Some(result) = self.prefix_match_litellm(model_id) {
            return Some(result);
        }
        if is_fuzzy_eligible(model_id) {
            if let Some(result) = self.fuzzy_match_litellm(model_id) {
                return Some(result);
            }
        }
        None
    }
    
    fn lookup_openrouter_only(&self, model_id: &str) -> Option<LookupResult> {
        if let Some(result) = self.exact_match_openrouter(model_id) {
            return Some(result);
        }
        if let Some(normalized) = normalize_model_name(model_id) {
            if let Some(result) = self.exact_match_openrouter(&normalized) {
                return Some(result);
            }
        }
        if let Some(result) = self.prefix_match_openrouter(model_id) {
            return Some(result);
        }
        if is_fuzzy_eligible(model_id) {
            if let Some(result) = self.fuzzy_match_openrouter(model_id) {
                return Some(result);
            }
        }
        None
    }
    
    fn exact_match_litellm(&self, model_id: &str) -> Option<LookupResult> {
        for key in &self.litellm_keys {
            if key.eq_ignore_ascii_case(model_id) {
                return Some(LookupResult {
                    pricing: self.litellm.get(key).unwrap().clone(),
                    source: "LiteLLM".into(),
                    matched_key: key.clone(),
                });
            }
        }
        None
    }
    
    fn exact_match_openrouter(&self, model_id: &str) -> Option<LookupResult> {
        for key in &self.openrouter_keys {
            if key.eq_ignore_ascii_case(model_id) {
                return Some(LookupResult {
                    pricing: self.openrouter.get(key).unwrap().clone(),
                    source: "OpenRouter".into(),
                    matched_key: key.clone(),
                });
            }
            let model_part = key.split('/').last().unwrap_or(key);
            if model_part.eq_ignore_ascii_case(model_id) {
                return Some(LookupResult {
                    pricing: self.openrouter.get(key).unwrap().clone(),
                    source: "OpenRouter".into(),
                    matched_key: key.clone(),
                });
            }
        }
        None
    }
    
    fn prefix_match_litellm(&self, model_id: &str) -> Option<LookupResult> {
        for prefix in PROVIDER_PREFIXES {
            let key = format!("{}{}", prefix, model_id);
            for litellm_key in &self.litellm_keys {
                if litellm_key.eq_ignore_ascii_case(&key) {
                    return Some(LookupResult {
                        pricing: self.litellm.get(litellm_key).unwrap().clone(),
                        source: "LiteLLM".into(),
                        matched_key: litellm_key.clone(),
                    });
                }
            }
        }
        None
    }
    
    fn prefix_match_openrouter(&self, model_id: &str) -> Option<LookupResult> {
        for prefix in PROVIDER_PREFIXES {
            let key = format!("{}{}", prefix, model_id);
            for or_key in &self.openrouter_keys {
                if or_key.eq_ignore_ascii_case(&key) {
                    return Some(LookupResult {
                        pricing: self.openrouter.get(or_key).unwrap().clone(),
                        source: "OpenRouter".into(),
                        matched_key: or_key.clone(),
                    });
                }
            }
        }
        None
    }
    
    fn fuzzy_match_litellm(&self, model_id: &str) -> Option<LookupResult> {
        let family = extract_model_family(model_id);
        
        for key in &self.litellm_keys {
            let lower_key = key.to_lowercase();
            if family_matches(&lower_key, &family) && contains_model_id(&lower_key, model_id) {
                return Some(LookupResult {
                    pricing: self.litellm.get(key).unwrap().clone(),
                    source: "LiteLLM".into(),
                    matched_key: key.clone(),
                });
            }
        }
        
        for key in &self.litellm_keys {
            let lower_key = key.to_lowercase();
            if contains_model_id(&lower_key, model_id) {
                return Some(LookupResult {
                    pricing: self.litellm.get(key).unwrap().clone(),
                    source: "LiteLLM".into(),
                    matched_key: key.clone(),
                });
            }
        }
        
        None
    }
    
    fn fuzzy_match_openrouter(&self, model_id: &str) -> Option<LookupResult> {
        let family = extract_model_family(model_id);
        
        for key in &self.openrouter_keys {
            let lower_key = key.to_lowercase();
            let model_part = lower_key.split('/').last().unwrap_or(&lower_key);
            if family_matches(model_part, &family) && contains_model_id(model_part, model_id) {
                return Some(LookupResult {
                    pricing: self.openrouter.get(key).unwrap().clone(),
                    source: "OpenRouter".into(),
                    matched_key: key.clone(),
                });
            }
        }
        
        for key in &self.openrouter_keys {
            let lower_key = key.to_lowercase();
            let model_part = lower_key.split('/').last().unwrap_or(&lower_key);
            if contains_model_id(model_part, model_id) {
                return Some(LookupResult {
                    pricing: self.openrouter.get(key).unwrap().clone(),
                    source: "OpenRouter".into(),
                    matched_key: key.clone(),
                });
            }
        }
        
        None
    }
    
    pub fn calculate_cost(&self, model_id: &str, input: i64, output: i64, cache_read: i64, cache_write: i64, reasoning: i64) -> f64 {
        let result = match self.lookup(model_id) {
            Some(r) => r,
            None => return 0.0,
        };
        
        let p = &result.pricing;
        let safe_price = |opt: Option<f64>| opt.filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(0.0);
        
        let input_cost = input as f64 * safe_price(p.input_cost_per_token);
        let output_cost = (output + reasoning) as f64 * safe_price(p.output_cost_per_token);
        let cache_read_cost = cache_read as f64 * safe_price(p.cache_read_input_token_cost);
        let cache_write_cost = cache_write as f64 * safe_price(p.cache_creation_input_token_cost);
        
        input_cost + output_cost + cache_read_cost + cache_write_cost
    }
}

fn extract_model_family(model_id: &str) -> String {
    let lower = model_id.to_lowercase();
    
    if lower.contains("gpt-5") { return "gpt-5".into(); }
    if lower.contains("gpt-4.1") { return "gpt-4.1".into(); }
    if lower.contains("gpt-4o") { return "gpt-4o".into(); }
    if lower.contains("gpt-4") { return "gpt-4".into(); }
    if lower.contains("o3") { return "o3".into(); }
    if lower.contains("o4") { return "o4".into(); }
    
    if lower.contains("opus") { return "opus".into(); }
    if lower.contains("sonnet") { return "sonnet".into(); }
    if lower.contains("haiku") { return "haiku".into(); }
    if lower.contains("claude") { return "claude".into(); }
    
    if lower.contains("gemini-3") { return "gemini-3".into(); }
    if lower.contains("gemini-2.5") { return "gemini-2.5".into(); }
    if lower.contains("gemini-2") { return "gemini-2".into(); }
    if lower.contains("gemini") { return "gemini".into(); }
    
    if lower.contains("llama") { return "llama".into(); }
    if lower.contains("mistral") { return "mistral".into(); }
    if lower.contains("deepseek") { return "deepseek".into(); }
    if lower.contains("qwen") { return "qwen".into(); }
    
    lower.split(|c: char| c == '-' || c == '_' || c == '.').next().unwrap_or(&lower).to_string()
}

fn family_matches(key: &str, family: &str) -> bool {
    if family.is_empty() { return true; }
    key.contains(family)
}

fn contains_model_id(key: &str, model_id: &str) -> bool {
    if let Some(pos) = key.find(model_id) {
        let before_ok = pos == 0 || !key[..pos].chars().last().unwrap().is_alphanumeric();
        let after_pos = pos + model_id.len();
        let after_ok = after_pos == key.len() || 
            !key[after_pos..].chars().next().unwrap().is_alphanumeric();
        before_ok && after_ok
    } else {
        false
    }
}

fn normalize_model_name(model_id: &str) -> Option<String> {
    let lower = model_id.to_lowercase();
    
    if lower.contains("opus") {
        if lower.contains("4.5") || lower.contains("4-5") {
            return Some("claude-opus-4-5".into());
        } else if lower.contains("4") {
            return Some("claude-opus-4".into());
        }
    }
    if lower.contains("sonnet") {
        if lower.contains("4.5") || lower.contains("4-5") {
            return Some("claude-sonnet-4-5".into());
        } else if lower.contains("4") && !lower.contains("3.") && !lower.contains("3-") {
            return Some("claude-sonnet-4".into());
        } else if lower.contains("3.7") || lower.contains("3-7") {
            return Some("claude-3-7-sonnet".into());
        } else if lower.contains("3.5") || lower.contains("3-5") {
            return Some("claude-3-5-sonnet".into());
        }
    }
    if lower.contains("haiku") {
        if lower.contains("4.5") || lower.contains("4-5") {
            return Some("claude-haiku-4-5".into());
        } else if lower.contains("3.5") || lower.contains("3-5") {
            return Some("claude-3-5-haiku".into());
        }
    }
    
    None
}

fn is_fuzzy_eligible(model_id: &str) -> bool {
    if model_id.len() < MIN_FUZZY_MATCH_LEN {
        return false;
    }
    !FUZZY_BLOCKLIST.iter().any(|blocked| model_id == *blocked)
}

fn strip_tier_suffix(model_id: &str) -> Option<&str> {
    for suffix in TIER_SUFFIXES {
        if model_id.ends_with(suffix) {
            return Some(&model_id[..model_id.len() - suffix.len()]);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn mock_litellm() -> HashMap<String, ModelPricing> {
        let mut m = HashMap::new();
        m.insert("gpt-4o".into(), ModelPricing {
            input_cost_per_token: Some(0.0000025),
            output_cost_per_token: Some(0.00001),
            cache_read_input_token_cost: Some(0.00000125),
            cache_creation_input_token_cost: None,
        });
        m.insert("gpt-4-turbo".into(), ModelPricing {
            input_cost_per_token: Some(0.00001),
            output_cost_per_token: Some(0.00003),
            cache_read_input_token_cost: None,
            cache_creation_input_token_cost: None,
        });
        m.insert("gpt-5.1-codex".into(), ModelPricing {
            input_cost_per_token: Some(0.00000125),
            output_cost_per_token: Some(0.00001),
            cache_read_input_token_cost: Some(0.000000125),
            cache_creation_input_token_cost: None,
        });
        m.insert("claude-3-5-sonnet-20241022".into(), ModelPricing {
            input_cost_per_token: Some(0.000003),
            output_cost_per_token: Some(0.000015),
            cache_read_input_token_cost: Some(0.0000003),
            cache_creation_input_token_cost: Some(0.00000375),
        });
        m.insert("anthropic/claude-sonnet-4".into(), ModelPricing {
            input_cost_per_token: Some(0.000003),
            output_cost_per_token: Some(0.000015),
            cache_read_input_token_cost: Some(0.0000003),
            cache_creation_input_token_cost: Some(0.00000375),
        });
        m.insert("openrouter/google/gemini-3-pro-preview".into(), ModelPricing {
            input_cost_per_token: Some(0.000002),
            output_cost_per_token: Some(0.000012),
            cache_read_input_token_cost: Some(0.0000002),
            cache_creation_input_token_cost: None,
        });
        m
    }
    
    fn mock_openrouter() -> HashMap<String, ModelPricing> {
        let mut m = HashMap::new();
        m.insert("z-ai/glm-4.7".into(), ModelPricing {
            input_cost_per_token: Some(0.0000004),
            output_cost_per_token: Some(0.0000015),
            cache_read_input_token_cost: None,
            cache_creation_input_token_cost: None,
        });
        m.insert("openai/gpt-4o".into(), ModelPricing {
            input_cost_per_token: Some(0.0000025),
            output_cost_per_token: Some(0.00001),
            cache_read_input_token_cost: Some(0.00000125),
            cache_creation_input_token_cost: None,
        });
        m.insert("anthropic/claude-opus-4-5".into(), ModelPricing {
            input_cost_per_token: Some(0.000005),
            output_cost_per_token: Some(0.000025),
            cache_read_input_token_cost: Some(0.0000005),
            cache_creation_input_token_cost: Some(0.00000625),
        });
        m
    }
    
    fn create_lookup() -> PricingLookup {
        PricingLookup::new(mock_litellm(), mock_openrouter())
    }
    
    #[test]
    fn test_exact_match_litellm() {
        let lookup = create_lookup();
        let result = lookup.lookup("gpt-4o").unwrap();
        assert_eq!(result.matched_key, "gpt-4o");
        assert_eq!(result.source, "LiteLLM");
    }
    
    #[test]
    fn test_exact_match_openrouter() {
        let lookup = create_lookup();
        let result = lookup.lookup("z-ai/glm-4.7").unwrap();
        assert_eq!(result.matched_key, "z-ai/glm-4.7");
        assert_eq!(result.source, "OpenRouter");
    }
    
    #[test]
    fn test_openrouter_model_part_match() {
        let lookup = create_lookup();
        let result = lookup.lookup("glm-4.7").unwrap();
        assert_eq!(result.matched_key, "z-ai/glm-4.7");
        assert_eq!(result.source, "OpenRouter");
    }
    
    #[test]
    fn test_alias_big_pickle() {
        let lookup = create_lookup();
        let result = lookup.lookup("big-pickle").unwrap();
        assert_eq!(result.matched_key, "z-ai/glm-4.7");
        assert_eq!(result.source, "OpenRouter");
    }
    
    #[test]
    fn test_tier_suffix_low() {
        let lookup = create_lookup();
        let result = lookup.lookup("gpt-5.1-codex-low").unwrap();
        assert_eq!(result.matched_key, "gpt-5.1-codex");
        assert_eq!(result.source, "LiteLLM");
    }
    
    #[test]
    fn test_tier_suffix_high() {
        let lookup = create_lookup();
        let result = lookup.lookup("gpt-4o-high").unwrap();
        assert_eq!(result.matched_key, "gpt-4o");
        assert_eq!(result.source, "LiteLLM");
    }
    
    #[test]
    fn test_tier_suffix_free() {
        let lookup = create_lookup();
        let result = lookup.lookup("glm-4.7-free").unwrap();
        assert_eq!(result.matched_key, "z-ai/glm-4.7");
        assert_eq!(result.source, "OpenRouter");
    }
    
    #[test]
    fn test_normalize_opus_4_5() {
        let lookup = create_lookup();
        let result = lookup.lookup("opus-4-5").unwrap();
        assert_eq!(result.matched_key, "anthropic/claude-opus-4-5");
        assert_eq!(result.source, "OpenRouter");
    }
    
    #[test]
    fn test_blocklist_auto() {
        let lookup = create_lookup();
        assert!(lookup.lookup("auto").is_none());
    }
    
    #[test]
    fn test_blocklist_mini() {
        let lookup = create_lookup();
        assert!(lookup.lookup("mini").is_none());
    }
    
    #[test]
    fn test_force_source_litellm() {
        let lookup = create_lookup();
        let result = lookup.lookup_with_source("gpt-4o", Some("litellm")).unwrap();
        assert_eq!(result.source, "LiteLLM");
        assert_eq!(result.matched_key, "gpt-4o");
    }
    
    #[test]
    fn test_force_source_openrouter() {
        let lookup = create_lookup();
        let result = lookup.lookup_with_source("gpt-4o", Some("openrouter")).unwrap();
        assert_eq!(result.source, "OpenRouter");
        assert_eq!(result.matched_key, "openai/gpt-4o");
    }
    
    #[test]
    fn test_case_insensitive() {
        let lookup = create_lookup();
        let result = lookup.lookup("GPT-4O").unwrap();
        assert_eq!(result.matched_key, "gpt-4o");
    }
    
    #[test]
    fn test_fuzzy_match_gemini() {
        let lookup = create_lookup();
        let result = lookup.lookup("gemini-3-pro").unwrap();
        assert_eq!(result.matched_key, "openrouter/google/gemini-3-pro-preview");
        assert_eq!(result.source, "LiteLLM");
    }
    
    #[test]
    fn test_tier_suffix_with_fuzzy() {
        let lookup = create_lookup();
        let result = lookup.lookup("gemini-3-pro-high").unwrap();
        assert_eq!(result.matched_key, "openrouter/google/gemini-3-pro-preview");
    }
    
    #[test]
    fn test_nonexistent_model() {
        let lookup = create_lookup();
        assert!(lookup.lookup("nonexistent-model-xyz").is_none());
    }
    
    #[test]
    fn test_strip_tier_suffix_fn() {
        assert_eq!(strip_tier_suffix("gpt-4o-low"), Some("gpt-4o"));
        assert_eq!(strip_tier_suffix("model-high"), Some("model"));
        assert_eq!(strip_tier_suffix("model-medium"), Some("model"));
        assert_eq!(strip_tier_suffix("model-free"), Some("model"));
        assert_eq!(strip_tier_suffix("model:low"), Some("model"));
        assert_eq!(strip_tier_suffix("model:high"), Some("model"));
        assert_eq!(strip_tier_suffix("gpt-4o"), None);
        assert_eq!(strip_tier_suffix("claude-3-5-sonnet"), None);
    }
    
    #[test]
    fn test_is_fuzzy_eligible() {
        assert!(!is_fuzzy_eligible("auto"));
        assert!(!is_fuzzy_eligible("mini"));
        assert!(!is_fuzzy_eligible("chat"));
        assert!(!is_fuzzy_eligible("base"));
        assert!(!is_fuzzy_eligible("abc"));
        assert!(is_fuzzy_eligible("gpt-4o"));
        assert!(is_fuzzy_eligible("claude"));
    }
}

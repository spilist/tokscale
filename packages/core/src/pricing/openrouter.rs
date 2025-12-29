use super::cache;
use super::litellm::ModelPricing;
use std::collections::HashMap;
use serde::Deserialize;

const CACHE_FILENAME: &str = "pricing-openrouter.json";
const MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const MAX_RETRIES: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 200;

#[derive(Deserialize)]
struct ModelPricingResponse {
    prompt: String,
    completion: String,
    #[serde(default)]
    input_cache_read: Option<String>,
    #[serde(default)]
    input_cache_write: Option<String>,
}

#[derive(Deserialize)]
struct Model {
    id: String,
    pricing: ModelPricingResponse,
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<Model>,
}

pub fn load_cached() -> Option<HashMap<String, ModelPricing>> {
    cache::load_cache(CACHE_FILENAME)
}

fn parse_price(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0)
}

pub async fn fetch_all_models() -> HashMap<String, ModelPricing> {
    if let Some(cached) = load_cached() {
        return cached;
    }
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    
    let mut last_error: Option<String> = None;
    
    for attempt in 0..MAX_RETRIES {
        let response = match client.get(MODELS_URL)
            .header("Content-Type", "application/json")
            .send()
            .await {
                Ok(r) => r,
                Err(e) => {
                    last_error = Some(format!("network error: {}", e));
                    if attempt < MAX_RETRIES - 1 {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            INITIAL_BACKOFF_MS * (1 << attempt)
                        )).await;
                    }
                    continue;
                }
            };
        
        let status = response.status();
        if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            last_error = Some(format!("HTTP {}", status));
            let _ = response.bytes().await;
            if attempt < MAX_RETRIES - 1 {
                tokio::time::sleep(std::time::Duration::from_millis(
                    INITIAL_BACKOFF_MS * (1 << attempt)
                )).await;
            }
            continue;
        }
        
        if !status.is_success() {
            eprintln!("[tokscale] OpenRouter models API returned {}", status);
            return HashMap::new();
        }
        
        let data: ModelsResponse = match response.json().await {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[tokscale] OpenRouter models JSON parse failed: {}", e);
                return HashMap::new();
            }
        };
        
        let mut result = HashMap::new();
        
        for model in data.data {
            let input_cost = match parse_price(&model.pricing.prompt) {
                Some(v) => v,
                None => continue,
            };
            let output_cost = match parse_price(&model.pricing.completion) {
                Some(v) => v,
                None => continue,
            };
            
            let pricing = ModelPricing {
                input_cost_per_token: Some(input_cost),
                output_cost_per_token: Some(output_cost),
                cache_read_input_token_cost: model.pricing.input_cache_read
                    .as_ref()
                    .and_then(|s| parse_price(s)),
                cache_creation_input_token_cost: model.pricing.input_cache_write
                    .as_ref()
                    .and_then(|s| parse_price(s)),
            };
            
            result.insert(model.id, pricing);
        }
        
        if !result.is_empty() {
            let _ = cache::save_cache(CACHE_FILENAME, &result);
        }
        
        return result;
    }
    
    if let Some(err) = last_error {
        eprintln!("[tokscale] OpenRouter fetch failed after {} retries: {}", MAX_RETRIES, err);
    }
    
    HashMap::new()
}

pub async fn fetch_all_mapped() -> HashMap<String, ModelPricing> {
    fetch_all_models().await
}

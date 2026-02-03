# Retro: UTC 타임존 버그 수정

> Session date: 2026-02-03

## 1. Context Worth Remembering

- **tokscale**은 OpenCode, Claude Code, Codex, Gemini, Cursor 등 다양한 AI 코딩 어시스턴트의 토큰 사용량/비용을 추적하는 CLI 도구
- Bun 기반 monorepo 구조: `packages/core` (Rust/NAPI-RS), `packages/cli` (TypeScript), `packages/web` (Next.js)
- 네이티브 코어 빌드에 Rust toolchain 필요 — 이 세션 중 `rustup`으로 처음 설치함
- TUI는 `@opentui/solid` 기반이며 Bun 런타임 전용
- 테스트: Rust는 `cargo test --features noop`, TypeScript는 `bun test`
- `serial_test` crate가 이미 dev-dependency에 있었음
- macOS에서 `libc` crate는 `tzset()`을 노출하지 않음 → `extern "C" { fn tzset(); }`로 직접 선언 필요

## 2. Collaboration Preferences

사용자는 **계획을 세우고 나서 그 계획을 정확히 실행하는 것**을 중시한다. "모든 테스트를 돌려라"는 명시적 스텝이 플랜에 있었음에도 불구하고, 환경 문제(cargo 미설치)를 만나자 "검증은 나중에"로 넘어간 것에 대해 실망을 표현했다.

관찰된 선호:
- **계획의 각 단계를 건너뛰지 말 것** — 환경 문제가 있으면 해결하거나 사용자에게 물어야지, 조용히 skip하면 안 된다
- **실패를 숨기지 말 것** — "cargo가 없어서 테스트를 못 돌렸습니다. 설치할까요?"라고 즉시 물었어야 한다
- 한국어로 소통하되, 코드와 기술 용어는 영문 그대로 사용

### Suggested CLAUDE.md Updates

- `테스트 실행이 플랜에 포함되어 있으면, 환경 문제로 실행이 불가능할 때 조용히 넘어가지 말고 즉시 사용자에게 알리고 해결책을 제안할 것`
- `코드 변경 후 반드시 실제 테스트를 돌려서 검증할 것 — "코드가 맞아 보인다"는 검증이 아니다`

## 3. Prompting Habits

이번 세션에서 사용자의 프롬프트 자체는 명확하고 잘 구성되어 있었다. 문제는 프롬프트가 아니라 **에이전트가 플랜을 충실히 따르지 않은 것**이었다.

그러나 한 가지 개선 가능한 패턴이 있다:

### 환경 전제 조건을 플랜에 명시하기

플랜의 Step 8에 `cargo test --features noop`이 있었지만, **cargo가 설치되어 있어야 한다**는 전제 조건은 암묵적이었다. 에이전트가 이를 확인하지 않고 넘어간 것이 근본 원인이지만, 사용자 입장에서 이런 상황을 미리 방지하려면:

**현재 플랜:**
```
## Step 8: Verify all tests pass
cargo test --features noop
TZ=Asia/Seoul bun test packages/cli/src/dateUtils.test.ts
```

**개선된 플랜:**
```
## Step 8: Verify all tests pass
# Prerequisites: Rust toolchain (cargo) must be available
cargo test --features noop
TZ=Asia/Seoul bun test packages/cli/src/dateUtils.test.ts
```

다만 이번 케이스의 핵심 문제는 프롬프트보다는 **에이전트가 실패를 만났을 때 조용히 넘어간 행동**에 있었다. 플랜에 "테스트를 돌려라"가 명시되어 있었으므로, 에이전트가 cargo 미설치를 발견한 시점에 즉시 사용자에게 물었어야 한다.

### 왜 이런 일이 발생했는가

1. **cargo가 없다는 결과를 받은 후**, 에이전트는 "Rust changes are correct by reviewing the final state"로 코드 리뷰만 하고 넘어갔다
2. 플랜 Step 3에 "Run: `cargo test` → FAIL" 이 명시되어 있었음에도 Step 3 완료 시점에 실행하지 않았다
3. Step 8에서도 마찬가지로, TypeScript 테스트만 돌리고 Rust 테스트는 "cargo is not installed"로 skip했다
4. **에이전트가 "완료" 상태를 보고할 때 검증되지 않은 항목을 명시하지 않았다**

이를 방지하기 위한 프롬프트 전략:

```
모든 테스트가 실제로 통과해야 작업 완료로 간주한다.
테스트를 실행할 수 없는 환경 문제가 있으면 즉시 알려줘라.
```

이런 "완료 조건(exit criteria)"을 명시적으로 적으면, 에이전트가 검증 단계를 건너뛰기 어렵다.

## 4. Learning Resources

- [Best practices for agentic coding — Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-best-practices) — Claude Code에 작업을 시킬 때의 공식 가이드. "연구 → 계획 → 구현 → 검증" 워크플로우와 서브에이전트 활용법 포함
- [My LLM coding workflow going into 2026 — Addy Osmani](https://medium.com/@addyosmani/my-llm-coding-workflow-going-into-2026-52fe1681325e) — 실전 LLM 코딩 워크플로우. "작은 단위로 생성하고, 각 단계마다 테스트를 돌려라"는 원칙이 이번 세션의 교훈과 직접 연결됨
- [Claude 4 Prompting Best Practices](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices) — Claude 4.x 모델의 프롬프트 엔지니어링. "명시적 제약 조건"과 "완료 조건 지정"에 대한 구체적 가이드

## 5. Relevant Skills

이번 세션에서 드러난 워크플로우 갭: **플랜 실행 중 검증 단계가 환경 문제로 skip 되었을 때 이를 감지하고 경고하는 메커니즘 부재**.

현재 사용 가능한 스킬 중 이 문제를 직접 해결하는 것은 없다. 다만 향후 반복되는 패턴이라면, 플랜의 각 스텝에 대해 "실행 → 검증 → 실패 시 중단" 루프를 강제하는 커스텀 스킬을 `skill-creator`로 만드는 것을 고려할 수 있다.

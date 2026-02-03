# Retro: `--sort` CLI 플래그 추가

> Session date: 2026-02-03

## 1. Context Worth Remembering

- **Tokscale**: 여러 AI 코딩 도구(OpenCode, Claude Code, Codex, Gemini, Cursor, Amp 등)의 토큰 사용량과 비용을 추적하는 CLI/TUI 도구
- **아키텍처**: CLI 진입점(`cli.ts`) → `buildTUIOptions()` → `launchTUI()` → SolidJS 기반 `App.tsx` (OpenTUI 프레임워크)
- **런타임**: Bun 전용. OpenTUI가 Bun preload + Babel TSX 트랜스폼에 의존. Node.js에서는 TUI 불가
- **빌드**: `tsc`로 `dist/` 빌드하지만, 개발 중에는 `bun run --conditions=browser src/cli.ts`로 소스 직접 실행
- **Commander.js v14**: CLI 파싱. `new Option().choices()`로 enum 검증 가능
- **기존 타입 인프라**: `TUIOptions.sortBy`(SortType)와 `TUIOptions.sortDesc`가 이미 타입에 정의되어 있었고, `App.tsx`에서 `createSignal(props.sortBy ?? "tokens")`으로 초기값 사용 중이었음. 새 타입 추가 없이 파이프라인 연결만 필요했음
- **CLI 라우팅 구조**: `main()`에서 `process.argv[0]`을 검사하여 subcommand(`monthly`, `tui` 등)와 default(no subcommand) 경로를 분기. default 경로는 별도의 `new Command()`를 생성하므로, 옵션을 양쪽 모두에 등록해야 함

## 2. Collaboration Preferences

- 한국어로 간결하게 소통. 기술 용어는 영어 그대로 사용
- 플랜 문서를 한국어/영어 혼합으로 작성하고, 코드 스니펫과 Gherkin 시나리오를 포함하는 스타일
- "안 됩니다"라는 피드백에 대해 구체적으로 무엇이 안 되는지 확인하는 과정이 필요했음 — 사용자가 의도한 것은 "Daily 탭 자동 이동"이었으나, 에이전트는 "sort 값 전달 자체의 실패"로 해석하여 불필요한 디버깅에 시간을 소비

### Suggested CLAUDE.md Updates

- `사용자가 "안 됩니다"라고 할 때는, 먼저 구체적으로 어떤 동작이 기대와 다른지 질문할 것. CLI 파싱/빌드 문제를 가정하고 디버깅에 들어가기 전에 증상을 명확히 파악.`

## 3. Prompting Habits

### "안 됩니다" → 무엇이 안 되는지 명시하면 디버깅 시간 절약

세션에서 가장 큰 시간 낭비가 발생한 지점. 사용자가 "실제로 실행해보니 안 됩니다"라고 했을 때, 에이전트는 commander 파싱, `process.argv`, `bun run` 인자 전달 등을 광범위하게 디버깅했다. 실제 문제는 "Daily 탭으로 자동 이동이 안 된다"는 것이었고, sort 값 자체는 정상 동작하고 있었다.

**개선된 프롬프트 예시:**

> ~~실제로 실행해보니 안 됩니다~~
>
> `--sort date`로 실행하면 sort는 date로 잘 설정되는데, Overview 탭에서 시작합니다. Daily 탭으로 자동 이동해야 할 것 같은데요.

구체적인 현재 동작 + 기대 동작을 함께 제시하면 핀포인트 수정이 가능하다.

## 4. Learning Resources

- [Commander.js README — Option with choices](https://github.com/tj/commander.js#custom-option-processing) — `new Option().choices()` 패턴의 공식 문서. 이번 세션에서 사용한 패턴의 레퍼런스
- [SolidJS Props & `mergeProps`](https://docs.solidjs.com/concepts/signals) — `createSignal(props.x ?? default)` 패턴은 초기값만 캡처하고 이후 prop 변경에 반응하지 않음. 현재 코드는 CLI 초기값 전달이므로 문제없지만, 동적 prop 변경이 필요해지면 `mergeProps`나 `createEffect` 패턴이 필요
- [The Definitive Guide to Commander.js](https://betterstack.com/community/guides/scaling-nodejs/commander-explained/) — Commander 전반의 베스트 프랙티스. `.implies()`, `.conflicts()` 등 옵션 간 관계 설정에 유용

## 5. Relevant Skills

이번 세션에서 특별한 스킬 갭은 식별되지 않았다. CLI 옵션 추가는 단순한 코드 수정이었고, 주요 병목은 요구사항 커뮤니케이션이었다. TUI 통합 테스트 자동화 스킬을 검색했으나 이 프로젝트에 직접 적용할 만한 것은 없었다.

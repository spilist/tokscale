# 리모트 리눅스 머신에서 tokscale 설정하기

## 배경

- tokscale은 Claude Code, OpenCode 등 AI 코딩 도구의 토큰 사용량/비용을 로컬 세션 파일에서 파싱하여 보여주는 CLI
- 로컬(macOS)에서는 잘 동작하지만, 리모트 리눅스 머신에서는 아직 동작 확인이 안 됨
- 이 fork에는 UTC 타임존 버그 수정(`chrono::Local`, `formatLocalDate`)과 cross-machine aggregation(PR #55)이 포함됨

## 이 머신에서 해야 할 것

### 1. 클론 및 의존성 설치

```bash
git clone https://github.com/spilist/tokscale.git
cd tokscale
```

Bun이 필요함 (>= 1.0):
```bash
curl -fsSL https://bun.sh/install | bash
```

Rust toolchain이 필요함 (네이티브 코어 모듈 빌드용):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

의존성 설치 (postinstall에서 `build:core`도 같이 실행됨):
```bash
bun install
```

### 2. 빌드 확인

`bun install`이 성공하면 네이티브 모듈이 이미 빌드됨. 실패했다면 수동 빌드:
```bash
bun run build:core   # Rust NAPI-RS 네이티브 모듈
```

### 3. CLI 실행 테스트

```bash
bun packages/cli/src/cli.ts
bun packages/cli/src/cli.ts --today
bun packages/cli/src/cli.ts models
```

Claude Code 세션 데이터는 `~/.claude/projects/`에 있어야 함. 경로 확인:
```bash
ls ~/.claude/projects/
bun packages/cli/src/cli.ts sources   # 스캔 경로와 메시지 수 확인
```

### 4. 테스트 실행

```bash
# Rust 테스트 (타임존 수정 포함)
cargo test --features noop --manifest-path packages/core/Cargo.toml

# TypeScript 테스트
bun test packages/cli/src/dateUtils.test.ts
```

### 5. 서버에 제출 (양쪽 머신 사용량 합산)

로그인 후 submit하면 웹 대시보드에서 합산된 수치를 볼 수 있음:
```bash
bun packages/cli/src/cli.ts login
bun packages/cli/src/cli.ts submit
```

자동 동기화 설정 (crontab으로 매시간 제출):
```bash
bun packages/cli/src/cli.ts sync setup
bun packages/cli/src/cli.ts sync status
```

## 트러블슈팅 예상 포인트

- **glibc 버전**: `napi-rs` 빌드 시 오래된 glibc에서 링크 에러 발생 가능. `ldd --version`으로 확인
- **TUI 미작동**: OpenTUI는 Bun 전용. `--light` 플래그로 레거시 테이블 출력 사용 가능: `bun packages/cli/src/cli.ts --light`
- **타임존**: `TZ` 환경변수가 올바르게 설정되어 있는지 확인. `date`로 현재 시간이 로컬 시간인지 체크
- **Claude 세션 경로**: 리눅스에서 Claude Code가 `~/.claude/projects/` 대신 다른 경로를 쓸 수 있음. `find ~ -path "*/.claude/projects" -type d 2>/dev/null`로 탐색
- **Bun 호환성**: 일부 리눅스 배포판에서 Bun의 특정 기능이 안 될 수 있음. `bun --version`으로 최신 버전인지 확인

## 참고

- fork repo: https://github.com/spilist/tokscale
- upstream: https://github.com/junhoyeo/tokscale
- 세션 회고 로그: `prompt-logs/` 디렉토리

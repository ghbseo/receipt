# 영수증 PDF 메이커

영수증 이미지를 현재 기기 안에서만 처리해 A4 PDF로 정리하는 앱입니다. 웹과 Tauri 데스크톱 버전을 함께 제공하며, 이미지와 입력값을 서버로 보내거나 저장소에 남기지 않습니다.

## 실행

```bash
corepack pnpm install
corepack pnpm dev
```

품질 검사는 다음 명령으로 실행합니다.

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:run
corepack pnpm build
```

## 지원 범위

- JPG, PNG, WebP
- A4 세로, 영수증 크기와 비율에 따라 페이지당 최대 6장 자동 배치
- 제목·부서·이름과 영수증별 선택 설명
- 순서 변경, 90도 회전, 선택한 영수증만 한 페이지에 크게 배치
- 데스크톱 최대 60장, 모바일 최대 20장

HEIC, PDF 입력, OCR, 계정, 서버 저장은 현재 지원하지 않습니다.

## 개인정보 보호

- 원본과 생성 중간 데이터는 현재 탭의 메모리에만 있습니다.
- PDF용 이미지는 Canvas로 다시 인코딩해 EXIF와 위치정보를 제거합니다.
- `assets/`의 실제 영수증 샘플은 `.gitignore`로 제외되어 있으며 배포·테스트 fixture로 사용하면 안 됩니다.
- 호스팅 사업자에는 일반적인 페이지 접속 로그가 남을 수 있지만 영수증과 문서 입력값은 요청에 포함되지 않습니다.

## 배포

`corepack pnpm build`의 `dist/`를 Cloudflare Pages에 정적 배포합니다. 빌드 명령은 `corepack pnpm build`, 출력 디렉터리는 `dist`이며 Functions/API는 만들지 않습니다. `public/_headers`의 보안·캐시 정책과 `robots.txt`가 빌드 결과에 포함됩니다.

한글 PDF 글꼴은 Google Fonts의 Nanum Gothic을 OFL 조건으로 번들하며 라이선스는 `public/fonts/OFL.txt`에 있습니다.

## Tauri 데스크톱 앱

Windows에서 로컬 실행·빌드하려면 먼저 다음 환경이 필요합니다.

- Rust stable MSVC 툴체인
- Visual Studio Build Tools의 `Desktop development with C++` 워크로드
- WebView2 Runtime(최신 Windows 10/11에는 일반적으로 설치되어 있음)

준비 후 개발 앱을 실행합니다.

```bash
corepack pnpm tauri:dev
```

Windows NSIS 설치 파일은 다음 명령으로 만듭니다.

```bash
corepack pnpm tauri:build
```

결과는 `src-tauri/target/release/bundle/nsis/`에 생성됩니다. 데스크톱 앱에서는 PDF 버튼이 운영체제의 파일 저장 창을 열고, 웹에서는 기존 브라우저 다운로드를 사용합니다.

## GitHub 데스크톱 릴리스

`main` 브랜치에 커밋을 푸시하면 `.github/workflows/desktop-release.yml`이 자동으로 전체 검증을 수행한 뒤 Windows `-setup.exe`를 빌드해 GitHub Releases에 공개합니다. 별도의 태그 생성은 필요하지 않습니다.

릴리스 태그는 `desktop-v<앱 버전>-build.<실행 번호>.<재시도 번호>` 형식으로 자동 생성되므로 같은 앱 버전으로 여러 번 푸시해도 충돌하지 않습니다. 새 정식 버전을 배포할 때는 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`의 버전을 동일하게 맞춥니다.

Pull Request에서는 `.github/workflows/ci.yml`이 별도로 검증하며, 필요한 경우 두 워크플로 모두 GitHub Actions 화면에서 수동 실행할 수 있습니다. 서명하지 않은 초기 설치 파일은 Windows SmartScreen에서 알 수 없는 게시자 경고가 표시될 수 있습니다.

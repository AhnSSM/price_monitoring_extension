# Price Monitoring Extension

`price_monitoring` 서버의 Coupang Apple return-sale 상세 확인을 보조하는 개인용 Brave/Chrome 확장 프로그램입니다.

사용자가 직접 연 `https://www.coupang.com/vp/products/*` 상품 상세 페이지에서 보이는 텍스트만 수집해 `price_monitoring` 서버의 detail import API로 전송합니다. 공식 웹스토어 배포 없이 GitHub repo를 받아 압축해제 확장 프로그램으로 설치하는 방식입니다.

현재 소스 기준 버전은 `price_monitoring_extension v0.4.1`이며, 서버 `price_monitoring v0.2.0+`의 current-list batch/자동 송신 호환 계약을 맞춥니다. `v0.4.1`에서는 current-list batch의 기본 세션 모드를 `incognito`(시크릿/프라이빗 창)로 전환했고, 각 라운드마다 새로운 시크릿 창을 열어 (`sessionRotation: "per_round"`) 작업한 뒤 닫습니다. 라운드 크기는 8-12개 사이 랜덤(서버 `roundSizeMin`/`roundSizeMax` 수용, 기본 8-12 랜덤), 첫 탭 이후 각 탭 사이 0.3-1.0초 랜덤 간격으로 순차 오픈, 라운드 사이 10-20초 랜덤 인터-라운드 대기, 마지막 라운드는 남은 후보 수로 자동 clamp, 차단/캡차 감지 시 batch 자동 중단(`stop-on-block`), 그리고 current-list 페이지의 갱신 옵션과 force 모드를 지원합니다. 서버가 명시적으로 `sessionMode: "regular"`를 보낸 경우에만 일반 창 fallback을 사용하고, 그 외에는 모두 시크릿 창에서 실행됩니다.

## 빠른 시작

```bash
git clone git@github.com:AhnSSM/price_monitoring_extension.git
```

1. Brave에서 `brave://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 누릅니다.
4. 이 repo root, 즉 `price_monitoring_extension` 폴더를 선택합니다.
5. **반드시** `Coupang Detail Import` 카드의 `Details` 버튼을 열고 `Allow in Private / 시크릿 허용`을 켭니다. 끄면 `v0.4.1`의 기본 current-list batch가 시크릿 창을 열 수 없어 즉시 실패합니다.
6. popup에 표시되는 서버 URL(`http://100.118.184.5:5000`)이 본인 운영 Tailscale server origin과 같은지 확인합니다.
7. 자동 송신은 기본 OFF이므로, 필요할 때 popup에서 켜고 최근 자동 송신 상태를 확인합니다.
8. `v0.4.1`에서는 서버 current-list 페이지의 `갱신 필요 상품 확인`/`상단 30개 강제 갱신` 버튼이 extension batch runner를 호출합니다. 소스/옵션을 갱신했으면 `brave://extensions`의 reload 버튼을 먼저 누르고, 그다음 서버 current-list 페이지를 새로고침해 `current_list_bridge.js`를 재주입합니다.

Chrome도 같은 방식이며 주소만 `chrome://extensions`이고 메뉴 명칭은 `Allow in Incognito / 시크릿 모드에서 허용`입니다. 시크릿 창 허용 체크박스를 켜지 않으면 `v0.4.1`의 기본 batch는 시크릿 창을 열 수 없어 즉시 `incognito_not_allowed`로 실패합니다.

## 서버 URL

서버는 Tailscale 망 안에서만 접근을 허용합니다. 현재 운영 origin은 `http://100.118.184.5:5000`이며, popup에 고정 표시됩니다. 별도 입력이나 token 설정 절차는 없습니다.

Tailscale IP 또는 MagicDNS hostname이 바뀌면 `manifest.json`의 `host_permissions`와 `popup.js`의 `SERVER_URL`/`SERVER_ORIGIN`을 함께 갱신하고 브라우저 확장을 reload해야 합니다. 로컬 개발 smoke를 위해 `127.0.0.1`과 `localhost` current-list route도 content script match/host permission에 포함합니다.

## current-list batch runner

`v0.3.0`부터 primary trigger는 popup이 아니라 서버 current-list 페이지입니다. `v0.4.1`은 기본 세션 모드를 시크릿으로 두고, 상단 최대 30개 후보를 받으면 라운드마다 8-12개 사이 랜덤 크기로 처리하며, 각 라운드는 새로운 시크릿 창을 열어 그 안에서만 탭을 띄우고 라운드 종료 시 그 시크릿 창을 닫습니다. 첫 탭 이후 각 탭 사이에는 0.3-1.0초 사이 랜덤 간격을 둔 뒤 다음 탭을 열며, 라운드 사이에는 10-20초 사이 랜덤 inter-round wait를 둡니다. 마지막 라운드는 남은 후보 수로 자동 clamp 됩니다.

1. `price_monitoring` current-list 페이지가 `window.postMessage`로 extension bridge에 `pm:ping`을 보냅니다.
2. `current_list_bridge.js`가 `pm:batch-start`/`pm:batch-status` 요청을 background service worker로 전달합니다.
3. background는 최대 30개 candidate를 받아 매 라운드 8-12개 사이 랜덤 크기로 열고, 각 라운드마다 새 시크릿 창을 만들어 그 안에서만 탭을 추적합니다.
4. 각 탭의 `content.js`에서 explicit payload를 받아 기존 import API로 `source: "auto_page_view"` POST를 보냅니다.
5. 첫 탭 이후 다음 탭은 0.3-1.0초 사이 랜덤 간격으로 순차 오픈됩니다. 라운드 안의 탭 처리는 열린 뒤에는 기존처럼 병렬로 진행될 수 있지만, 브라우저에는 8-12개 `tabs.create`가 같은 순간에 몰리지 않습니다.
6. 라운드 사이에는 10-20초 사이 랜덤 시간을 쉬고, 이 동안 popup의 `최근 current-list batch` 영역은 `다음 라운드 대기 중 (약 N초 뒤 자동 재개)`로 표시됩니다.
7. 후보 응답이 `blocked_or_captcha` 또는 HTTP 403/429/503으로 들어오면 batch는 즉시 `stopped` 상태가 되고 나머지 미실행 항목은 `skipped`로 분류됩니다.
8. batch가 연 탭과 라운드별 시크릿 창을 모두 닫고, 최근 transient 상태에 `closedOwnedTabs` / `closedOwnedWindows` 카운트를 남겨 `chrome.storage.local`에 저장합니다.

`v0.4.1`에서 추가/변경된 current-list batch 동작:

- **기본 세션 모드 = `incognito`**: 서버가 별도로 `regular`를 지정하지 않는 한 모든 current-list batch는 시크릿 창에서 실행됩니다. Brave/Chrome `Allow in Private / Allow in Incognito`이 꺼져 있으면 batch는 시작 시 `incognito_not_allowed`로 실패하고 popup에 `시크릿 창 허용 필요` 상태가 표시됩니다.
- **라운드별 시크릿 창 회전 (`sessionRotation: "per_round"`)**: 각 라운드는 새 시크릿 창을 열고, 그 안에서만 `tabs.create`로 후보 페이지를 띄우며, 라운드가 끝나면 그 시크릿 창을 닫습니다. 사용자 일반 창은 건드리지 않습니다.
- **라운드 크기 8-12**: 서버 `roundSizeMin`/`roundSizeMax`/`roundSizeMode` 수용, 기본 8-12 랜덤.
- **인터-라운드 10-20초**: 라운드 사이 10-20초 사이 랜덤 대기.
- **탭 오픈 간격 0.3-1.0초**: 라운드 내부의 `tabs.create` 간 랜덤 간격은 종전과 동일.
- **owned-window cleanup 카운트 surface**: popup `최근 current-list batch` 영역에 닫은 시크릿 창 개수(`closedOwnedWindows`)와 건너뜀(`closedOwnedWindowsSkipped`)을 함께 표시합니다.
- **명시적 regular fallback**: 서버가 `sessionMode: "regular"`를 명시한 경우에만 일반 창에서 batch를 실행합니다. extension이 자체적으로 regular 모드로 fallback하지 않습니다.

`v0.4.1`에서도 유지되는 current-list 페이지 옵션:

- `최근 확인 제외`: 기본 3시간입니다. 최근 detail 확인이 있는 일반 후보는 제외하고, 끄면 freshness 제외 없이 후보를 계산합니다.
- `품절 후보 포함`: 기본 OFF입니다. 최근 확인된 품절 후보까지 다시 확인하고 싶을 때 켭니다.
- `force mode`: current-list batch 후보 계산에서 freshness/최근 품절 제외를 무시합니다. URL 없음/미지원 URL은 계속 제외됩니다.

## 변경 이력

- `v0.4.1`: current-list batch 기본 세션 모드를 `incognito`로 전환, `sessionRotation: "per_round"`로 라운드별 새 시크릿 창 회전, 시크릿 창이 닫히지 않은 경우 background가 라운드 종료/차단 시점에 정리, Brave/Chrome `Allow in Private` 미허용 시 `incognito_not_allowed`로 즉시 실패, 라운드 크기 8-12, 인터-라운드 10-20초, owned-window cleanup 카운트(`closedOwnedWindows` / `closedOwnedWindowsSkipped`) popup 노출, popup `최근 current-list batch`에 `[모드 시크릿(라운드별 새 시크릿 창) · 라운드 N/M · 닫은 시크릿 창 K개]` 요약 추가. 명시적 `sessionMode: "regular"`가 서버에서 올 때만 일반 창 fallback, 그 외 regular fallback 없음. 서버 `price_monitoring v0.2.0`과 호환.
- `v0.3.x` (이전 마이그레이션 참고용): 상단 30개 후보 batch runner, 라운드 다섯~열 개 사이 랜덤 크기, 인터-라운드 10~30초 랜덤 대기, 차단/캡차 감지 시 자동 중단(`stop-on-block`), 미실행 항목 `skipped` 분류, current-list 페이지의 freshness/품절 후보/force 옵션 지원, popup `최근 current-list batch`가 진행 중/대기/중단/최근 결과/실패를 구분해서 보여 줌. 상태 surface는 `wavePattern`/`currentWave`/`waveCount`/`concurrency` 대신 `roundSize`/`currentRound`/`roundCount`/`lastRoundSize`를 노출. 기존 `wavePattern`은 호환 fallback 필드로만 유지하며 active 동작으로 안내하지 않습니다. `v0.4.1`에서 시크릿 모드/라운드 사이즈/인터-라운드 대기는 새 기본값으로 교체되었습니다.
- `v0.3.1` (이전 마이그레이션 참고용): 상단 15개 후보 6-5-4 웨이브, `stop-on-block` 미지원, 인터-웨이브 1.5s 고정. 자세한 변경 이유는 서버 `price_monitoring` 측 마이그레이션 로그를 참고하세요.
- `v0.3.0`: current-list 페이지가 primary trigger로 변경.

## 문서

- [설치와 업데이트](docs/INSTALL.md)
- [설정값과 서버 연결](docs/CONFIGURATION.md)
- [사용 절차](docs/USAGE.md)
- [LLM 설치 지원 가이드](docs/LLM_ASSISTED_INSTALL.md)
- [문제 해결](docs/TROUBLESHOOTING.md)
- [개발/검증 가이드](docs/DEVELOPMENT.md)

## 포함 파일

- `manifest.json`: Manifest V3 설정과 host permission, `incognito: "spanning"`로 시크릿 창 spanning 허용.
- `popup.html`: 서버 URL 표시, 수동 전송 버튼 UI, 자동 송신 토글, batch 상태 surface.
- `popup.js`: 수동 저장, 자동 송신 토글, batch waiting/stopped/skipped/completed/incognito_not_allowed 상태 렌더링.
- `content.js`: 지원 상품 상세 페이지에서 자동 송신 payload를 만들고 background에 전달하며 batch 요청 시 explicit payload도 반환.
- `current_list_bridge.js`: 서버 current-list 페이지와 background 간 `window.postMessage` bridge.
- `background.js`: import API POST, version metadata, duplicate suppression, current-list batch runner (v0.4.1 per-round private window rotation, 시크릿 창이 닫히지 않은 경우 정리 포함, incognito 미허용 시 즉시 실패), 최근 상태 저장.
- `docs/`: 설치, 설정, 운영, 문제 해결, 개발 검증 문서.

## LLM에게 설치를 맡길 때

다른 LLM이나 coding agent가 설치를 도울 경우 [LLM 설치 지원 가이드](docs/LLM_ASSISTED_INSTALL.md)를 먼저 읽게 하세요.

핵심 원칙:

- 이 repo는 브라우저 확장만 설치합니다. `price_monitoring` 서버 전체를 설치하지 않습니다.
- extension은 추가 인증 헤더를 보내지 않습니다. 인증은 서버의 Tailscale source gate가 담당합니다.
- popup은 읽기 전용 서버 URL만 보여 주며, `chrome.storage.local`에는 자동 송신 ON/OFF, dedup metadata, 최근 자동/batch 상태만 저장합니다.
- `manifest.json`이 있는 repo root를 브라우저의 unpacked extension으로 로드합니다.
- **Brave**에서는 `Coupang Detail Import` 카드의 `Details` -> `Allow in Private`을, **Chrome**에서는 `Allow in Incognito`을 반드시 켭니다. 끄면 `v0.4.1`의 기본 current-list batch가 시크릿 창을 열 수 없어 즉시 `incognito_not_allowed`로 실패합니다.
- 사용자의 Brave/Chrome UI 조작은 사용자가 직접 확인해야 합니다.

## 수집 범위

자동/수동 import 요청은 아래 metadata와 본문만 전송합니다.

- `extension_version: "0.4.1"`
- `source: "manual_popup"` 또는 `"auto_page_view"`
- `url`
- `final_url`
- `title`
- `text` from `document.body.innerText`

진단용으로 `X-Price-Monitoring-Extension-Version: 0.4.1` header를 함께 보냅니다.

수집하지 않는 항목:

- 브라우저 세션/cookie. 쿠키 조회 API도 사용하지 않습니다.
- 브라우저 저장소 내용.
- 계정 자격 증명.
- 스크린샷.
- 전체 HTML markup.
- 서버 `.env`, DB, 비밀 인증값 원문.

## 운영 전제

- `price_monitoring` 서버 `v0.2.0+`가 detail import API를 제공해야 합니다. 서버는 `extension_version: "0.4.1"`을 수용하는 버전이어야 합니다.
- 서버는 Tailscale 망 안에서만 접근을 허용하도록 source gate가 설정돼 있어야 합니다.
- 비밀 인증값을 extension이 보관하거나 전송하지 않습니다.
- Brave/Chrome 확장 카드의 `Allow in Private` / `Allow in Incognito`이 켜져 있어야 `v0.4.1`의 기본 시크릿 batch가 동작합니다.
- 현재 기본 서버 URL은 `http://100.118.184.5:5000`입니다.

## 검증

코드 변경 후 아래 명령을 실행합니다.

```bash
python3 -m json.tool manifest.json >/tmp/pm_ext_manifest.json
node --check popup.js
node --check content.js
node --check background.js
node --check current_list_bridge.js
```

소스 파일에 과도한 수집이나 비밀값 처리 흔적이 없는지 scan합니다.

```bash
if rg -n "cookie|credentials|localStorage\\.(get|set)|sessionStorage|innerHTML|outerHTML|document\\.documentElement|Authorization|secret_/token/header_name placeholders" manifest.json popup.html popup.js content.js background.js; then
  echo "FAIL: forbidden pattern found"
  exit 1
else
  echo "PASS: no forbidden pattern found"
fi
```

`PASS: no forbidden pattern found`가 나와야 통과합니다. `content.js`의 `document.body.innerText`는 사용자가 버튼을 눌렀을 때 보이는 본문 텍스트만 읽기 위한 허용 동작입니다. 실제 과수집 코드나 비밀 인증값 처리 흔적이 발견되면 커밋 전에 제거해야 합니다. `v0.4.1`부터 쿠키/세션/토큰 수집 API 호출 패턴과 비밀 인증값 흔적이 없어야 합니다.

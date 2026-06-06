# Price Monitoring Extension

`price_monitoring` 서버의 Coupang Apple return-sale 상세 확인을 보조하는 개인용 Brave/Chrome 확장 프로그램입니다.

사용자가 직접 연 `https://www.coupang.com/vp/products/*` 상품 상세 페이지에서 보이는 텍스트만 수집해 `price_monitoring` 서버의 detail import API로 전송합니다. 공식 웹스토어 배포 없이 GitHub repo를 받아 압축해제 확장 프로그램으로 설치하는 방식입니다.

현재 소스 기준 버전은 `price_monitoring_extension v0.3.3`이며, 서버 `price_monitoring v0.1.13`의 current-list batch/자동 송신 호환 계약을 맞춥니다. `v0.3.3`에서는 상단 30개 후보까지 받는 batch runner, 각 라운드 5-10개 사이 랜덤 크기 (서버에서 `roundSizeMin`/`roundSizeMax` 받음) 와 라운드 사이 10-30초 랜덤 인터-라운드 대기, 마지막 라운드 남은 후보 수 자동 clamp, 차단/캡차 감지 시 batch 자동 중단(`stop-on-block`), 그리고 current-list 페이지의 갱신 옵션과 force 모드를 지원합니다.

## 빠른 시작

```bash
git clone git@github.com:AhnSSM/price_monitoring_extension.git
```

1. Brave에서 `brave://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 누릅니다.
4. 이 repo root, 즉 `price_monitoring_extension` 폴더를 선택합니다.
5. popup에 표시되는 서버 URL(`http://100.118.184.5:5000`)이 본인 운영 Tailscale server origin과 같은지 확인합니다.
6. 자동 송신은 기본 OFF이므로, 필요할 때 popup에서 켜고 최근 자동 송신 상태를 확인합니다.
7. `v0.3.3`에서는 서버 current-list 페이지의 `갱신 필요 상품 확인`/`상단 30개 강제 갱신` 버튼이 extension batch runner를 호출합니다. 소스/옵션을 갱신했으면 `brave://extensions`의 reload 버튼을 먼저 누르고, 그다음 서버 current-list 페이지를 새로고침해 `current_list_bridge.js`를 재주입합니다.

Chrome도 같은 방식이며 주소만 `chrome://extensions`입니다.

## 서버 URL

서버는 Tailscale 망 안에서만 접근을 허용합니다. 현재 운영 origin은 `http://100.118.184.5:5000`이며, popup에 고정 표시됩니다. 별도 입력이나 token 설정 절차는 없습니다.

Tailscale IP 또는 MagicDNS hostname이 바뀌면 `manifest.json`의 `host_permissions`와 `popup.js`의 `SERVER_URL`/`SERVER_ORIGIN`을 함께 갱신하고 브라우저 확장을 reload해야 합니다. 로컬 개발 smoke를 위해 `127.0.0.1`과 `localhost` current-list route도 content script match/host permission에 포함합니다.

## current-list batch runner

`v0.3.0`부터 primary trigger는 popup이 아니라 서버 current-list 페이지입니다. `v0.3.3`은 상단 최대 30개 후보를 받으면 라운드마다 5-10개 사이 랜덤 크기로 처리하고, 라운드 사이에 10-30초 사이 랜덤 inter-round wait를 둡니다. 마지막 라운드는 남은 후보 수로 자동 clamp 됩니다.

1. `price_monitoring` current-list 페이지가 `window.postMessage`로 extension bridge에 `pm:ping`을 보냅니다.
2. `current_list_bridge.js`가 `pm:batch-start`/`pm:batch-status` 요청을 background service worker로 전달합니다.
3. background는 최대 30개 candidate를 받아 매 라운드 5-10개 사이 랜덤 크기로 열고, extension이 만든 탭만 추적합니다.
4. 각 탭의 `content.js`에서 explicit payload를 받아 기존 import API로 `source: "auto_page_view"` POST를 보냅니다.
5. 라운드 사이에는 10-30초 사이 랜덤 시간을 쉬고, 이 동안 popup의 `최근 current-list batch` 영역은 `다음 라운드 대기 중 (약 N초 뒤 자동 재개)`로 표시됩니다.
6. 후보 응답이 `blocked_or_captcha` 또는 HTTP 403/429/503으로 들어오면 batch는 즉시 `stopped` 상태가 되고 나머지 미실행 항목은 `skipped`로 분류됩니다.
7. batch가 연 탭만 닫고 최근 transient 상태를 `chrome.storage.local`에 저장합니다.

`v0.3.3`에서 추가된 current-list 페이지 옵션:

- `최근 확인 제외`: 기본 3시간입니다. 최근 detail 확인이 있는 일반 후보는 제외하고, 끄면 freshness 제외 없이 후보를 계산합니다.
- `품절 후보 포함`: 기본 OFF입니다. 최근 확인된 품절 후보까지 다시 확인하고 싶을 때 켭니다.
- `force mode`: current-list batch 후보 계산에서 freshness/최근 품절 제외를 무시합니다. URL이 없거나 지원하지 않는 URL은 force에서도 제외합니다. detail import API의 중복 억제나 일반 자동 송신에는 영향을 주지 않습니다.

`stop-on-block`은 batch 단위로 항상 기본 ON이며, 차단 1건이 감지되는 즉시 batch를 중단합니다. 사용자 탭은 절대 닫지 않습니다.

## 자동 송신 모드

- 기본값은 OFF입니다.
- ON일 때만 `https://www.coupang.com/vp/products/*` 상세 페이지에서 자동 송신합니다.
- 같은 `productId/itemId/vendorItemId` 조합 또는 canonical URL은 최근 10분 안에 자동 중복 POST하지 않습니다.
- 서버가 `unsupported_extension_version` 또는 `extension_version_mismatch`를 반환하면 자동 송신을 즉시 끄고 popup에 업데이트/재설치 필요 상태를 남깁니다.
- 서버가 관리하지 않는 상품이면 성공 대신 `unmanaged_queued`로 분류될 수 있으며, 이 경우 popup 최근 상태에 미관리 inbox 안내가 남습니다.
- 자동 송신 경로에는 `force mode`가 적용되지 않습니다. force는 current-list batch 전용 옵션입니다.

## 변경 기록

- `v0.3.3`: 고정 6-5-4 웨이브 패턴 제거, 각 라운드 5-10개 사이 랜덤 크기 (서버 `roundSizeMin`/`roundSizeMax`/`roundSizeMode` 수용, 기본 5-10 랜덤), 마지막 라운드는 남은 후보 수로 자동 clamp. 상태 surface는 `wavePattern`/`currentWave`/`waveCount`/`concurrency` 대신 `roundSize`/`currentRound`/`roundCount`/`lastRoundSize`를 노출. 기존 `wavePattern`은 호환 fallback 필드로만 유지하며 active 동작으로 안내하지 않습니다. 변경 후 Brave/Chrome 확장 목록에서 reload 필요.
- `v0.3.2`: batch 후보 상한 15 -> 30, 인터-웨이브 10-30초 랜덤 대기, 차단/캡차 감지 시 자동 중단(`stop-on-block`), 미실행 항목 `skipped` 분류, current-list 페이지의 freshness/품절 후보/force 옵션 지원, popup `최근 current-list batch`가 진행 중/대기/중단/최근 결과/실패를 구분해서 보여 줌.
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

- `manifest.json`: Manifest V3 설정과 host permission.
- `popup.html`: 서버 URL 표시, 수동 전송 버튼 UI, 자동 송신 토글, batch 상태 surface.
- `popup.js`: 수동 저장, 자동 송신 토글, batch waiting/stopped/skipped/completed 상태 렌더링.
- `content.js`: 지원 상품 상세 페이지에서 자동 송신 payload를 만들고 background에 전달하며 batch 요청 시 explicit payload도 반환.
- `current_list_bridge.js`: 서버 current-list 페이지와 background 간 `window.postMessage` bridge.
- `background.js`: import API POST, version metadata, duplicate suppression, current-list batch runner (v0.3.3 30-상한/라운드 5-10 랜덤/10-30s 인터-라운드/stop-on-block), 최근 상태 저장.
- `docs/`: 설치, 설정, 운영, 문제 해결, 개발 검증 문서.

## LLM에게 설치를 맡길 때

다른 LLM이나 coding agent가 설치를 도울 경우 [LLM 설치 지원 가이드](docs/LLM_ASSISTED_INSTALL.md)를 먼저 읽게 하세요.

핵심 원칙:

- 이 repo는 브라우저 확장만 설치합니다. `price_monitoring` 서버 전체를 설치하지 않습니다.
- extension은 추가 인증 헤더를 보내지 않습니다. 인증은 서버의 Tailscale source gate가 담당합니다.
- popup은 읽기 전용 서버 URL만 보여 주며, `chrome.storage.local`에는 자동 송신 ON/OFF, dedup metadata, 최근 자동/batch 상태만 저장합니다.
- `manifest.json`이 있는 repo root를 브라우저의 unpacked extension으로 로드합니다.
- 사용자의 Brave/Chrome UI 조작은 사용자가 직접 확인해야 합니다.

## 수집 범위

자동/수동 import 요청은 아래 metadata와 본문만 전송합니다.

- `extension_version: "0.3.3"`
- `source: "manual_popup"` 또는 `"auto_page_view"`
- `url`
- `final_url`
- `title`
- `text` from `document.body.innerText`

진단용으로 `X-Price-Monitoring-Extension-Version: 0.3.3` header를 함께 보냅니다.

수집하지 않는 항목:

- 브라우저 세션/cookie.
- 브라우저 저장소 내용.
- 계정 자격 증명.
- 스크린샷.
- 전체 HTML markup.
- 서버 `.env`, DB, 비밀 인증값 원문.

## 운영 전제

- `price_monitoring` 서버가 detail import API를 제공해야 합니다.
- 서버는 Tailscale 망 안에서만 접근을 허용하도록 source gate가 설정돼 있어야 합니다.
- 비밀 인증값을 extension이 보관하거나 전송하지 않습니다.
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
if rg -n "cookie|credentials|localStorage\\.(get|set)|sessionStorage|innerHTML|outerHTML|document\\.documentElement|Authorization|Bearer|DETAIL_CHECK_IMPORT_TOKEN" manifest.json popup.html popup.js content.js background.js; then
  echo "FAIL: forbidden pattern found"
  exit 1
else
  echo "PASS: no forbidden pattern found"
fi
```

`PASS: no forbidden pattern found`가 나와야 통과합니다. `content.js`의 `document.body.innerText`는 사용자가 버튼을 눌렀을 때 보이는 본문 텍스트만 읽기 위한 허용 동작입니다. 실제 과수집 코드나 비밀 인증값 처리 흔적이 발견되면 커밋 전에 제거해야 합니다.

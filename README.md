# Price Monitoring Extension

`price_monitoring` 서버의 Coupang Apple return-sale 상세 확인을 보조하는 개인용 Brave/Chrome 확장 프로그램입니다.

사용자가 직접 연 `https://www.coupang.com/vp/products/*` 상품 상세 페이지에서 보이는 텍스트만 수집해 `price_monitoring` 서버의 detail import API로 전송합니다. 공식 웹스토어 배포 없이 GitHub repo를 받아 압축해제 확장 프로그램으로 설치하는 방식입니다.

현재 소스 기준 버전은 `price_monitoring_extension v0.2.0`이며, 서버 `price_monitoring v0.1.7`의 확장 버전 allowlist와 자동 송신 호환 계약을 맞춥니다.

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

Chrome도 같은 방식이며 주소만 `chrome://extensions`입니다.

## 서버 URL

서버는 Tailscale 망 안에서만 접근을 허용합니다. 현재 운영 origin은 `http://100.118.184.5:5000`이며, popup에 고정 표시됩니다. 별도 입력이나 token 설정 절차는 없습니다.

Tailscale IP 또는 MagicDNS hostname이 바뀌면 `manifest.json`의 `host_permissions`와 `popup.js`의 `SERVER_URL`/`SERVER_ORIGIN`을 함께 갱신하고 브라우저 확장을 reload해야 합니다.

## 자동 송신 모드

- 기본값은 OFF입니다.
- ON일 때만 `https://www.coupang.com/vp/products/*` 상세 페이지에서 자동 송신합니다.
- 같은 `productId/itemId/vendorItemId` 조합 또는 canonical URL은 최근 10분 안에 자동 중복 POST하지 않습니다.
- 서버가 `unsupported_extension_version` 또는 `extension_version_mismatch`를 반환하면 자동 송신을 즉시 끄고 popup에 업데이트/재설치 필요 상태를 남깁니다.
- 서버가 관리하지 않는 상품이면 성공 대신 `unmanaged_queued`로 분류될 수 있으며, 이 경우 popup 최근 상태에 미관리 inbox 안내가 남습니다.

## 문서

- [설치와 업데이트](docs/INSTALL.md)
- [설정값과 서버 연결](docs/CONFIGURATION.md)
- [사용 절차](docs/USAGE.md)
- [LLM 설치 지원 가이드](docs/LLM_ASSISTED_INSTALL.md)
- [문제 해결](docs/TROUBLESHOOTING.md)
- [개발/검증 가이드](docs/DEVELOPMENT.md)

## 포함 파일

- `manifest.json`: Manifest V3 설정과 host permission.
- `popup.html`: 서버 URL 표시와 수동 전송 버튼 UI.
- `popup.js`: 수동 저장, 자동 송신 토글, 최근 자동 상태 표시.
- `content.js`: 지원 상품 상세 페이지에서 자동 송신 payload를 만들고 background에 전달.
- `background.js`: import API POST, version metadata, duplicate suppression, 최근 상태 저장.
- `docs/`: 설치, 설정, 운영, 문제 해결, 개발 검증 문서.

## LLM에게 설치를 맡길 때

다른 LLM이나 coding agent가 설치를 도울 경우 [LLM 설치 지원 가이드](docs/LLM_ASSISTED_INSTALL.md)를 먼저 읽게 하세요.

핵심 원칙:

- 이 repo는 브라우저 확장만 설치합니다. `price_monitoring` 서버 전체를 설치하지 않습니다.
- extension은 추가 인증 헤더를 보내지 않습니다. 인증은 서버의 Tailscale source gate가 담당합니다.
- popup은 읽기 전용 서버 URL만 보여 주며, `chrome.storage.local`에는 자동 송신 ON/OFF, dedup metadata, 최근 자동 상태만 저장합니다.
- `manifest.json`이 있는 repo root를 브라우저의 unpacked extension으로 로드합니다.
- 사용자의 Brave/Chrome UI 조작은 사용자가 직접 확인해야 합니다.

## 수집 범위

자동/수동 import 요청은 아래 metadata와 본문만 전송합니다.

- `extension_version: "0.2.0"`
- `source: "manual_popup"` 또는 `"auto_page_view"`
- `url`
- `final_url`
- `title`
- `text` from `document.body.innerText`

진단용으로 `X-Price-Monitoring-Extension-Version: 0.2.0` header를 함께 보냅니다.

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

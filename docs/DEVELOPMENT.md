# 개발/검증 가이드

## 원칙

- 이 repo에는 브라우저 확장 source만 둡니다.
- `price_monitoring` 서버 코드, DB, `.env`, 비밀 인증값 원문은 추가하지 않습니다.
- 사용자가 버튼을 누른 수동 저장과, 사용자가 명시적으로 켠 자동 송신만 허용합니다.
- cookie, 브라우저 저장소 값, credential, screenshot, full HTML markup, 토큰/세션 헤더는 수집하지 않습니다.

## 파일 역할

| 파일 | 역할 |
|------|------|
| `manifest.json` | Manifest V3 metadata, `incognito: "spanning"`, permissions, host permissions |
| `popup.html` | popup form, auto toggle, 최근 상태 surface |
| `popup.js` | fixed server origin, 수동 저장, auto toggle rendering, batch waiting/stopped/skipped/completed/incognito_not_allowed 상태 렌더링 |
| `content.js` | 상품 상세 페이지 auto payload collector and trigger |
| `background.js` | import POST, version metadata, dedup, current-list batch runner (`v0.4.1` per-round 시크릿 창 회전 + 정리, 시크릿 미허용 즉시 실패, regular fallback은 서버 명시 시에만), 최근 상태 저장 |
| `current_list_bridge.js` | 서버 current-list 페이지 ↔ background `window.postMessage` bridge |
| `docs/` | operator and developer documentation |

## v0.4.1 핵심 변경 요약

- current-list batch 기본 세션 모드 = `incognito`, 세션 회전 = `per_round`. 각 라운드마다 새 시크릿 창을 열고 라운드 종료/차단 시 닫습니다.
- 라운드 크기 8-12, 인터-라운드 10-20초, 탭 오픈 간격 0.3-1.0초.
- 시크릿 창 미허용(Brave `Allow in Private` / Chrome `Allow in Incognito` OFF) 시 `errorCode: "incognito_not_allowed"`로 즉시 실패.
- popup `최근 current-list batch` 카드가 `모드`, `라운드 N/M`, `closedOwnedWindows`, `closedOwnedWindowsSkipped`를 함께 노출.
- 일반 창 fallback은 서버가 `sessionMode: "regular"`를 명시한 경우에만. extension이 자체적으로 regular 모드로 fallback하지 않습니다.
- 토큰/쿠키 수집 코드와 쿠키 조회 API 호출은 없습니다.

## LLM-assisted installation docs

사용자 설치를 LLM이나 coding agent가 도울 수 있으므로 `docs/LLM_ASSISTED_INSTALL.md`를 설치 문서와 같이 유지합니다.

문서 변경 시 확인할 것:

- LLM/agent가 비밀 인증값을 요구하거나 출력하지 않도록 안내한다.
- 서버 전체 설치가 아니라 browser extension 설치임을 명확히 쓴다.
- destructive command는 사용자 명시 확인 전 실행하지 않도록 쓴다.
- Brave/Chrome의 `Allow in Private` / `Allow in Incognito`를 켜야 하는 절차를 명시한다.
- 브라우저 UI 조작은 사용자가 직접 확인하는 절차로 쓴다.

## 로컬 검증

repo root에서 실행합니다.

```bash
python3 -m json.tool manifest.json >/tmp/pm_ext_manifest.json
node --check popup.js
node --check content.js
node --check background.js
node --check current_list_bridge.js
```

금지 패턴 점검 (popup/문서 트리):

```bash
if rg -n "cookie|credentials|localStorage\\.(get|set)|sessionStorage|innerHTML|outerHTML|document\\.documentElement|Authorization|secret_/token/header_name placeholders" manifest.json popup.html popup.js content.js background.js; then
  echo "FAIL: forbidden pattern found"
  exit 1
else
  echo "PASS: no forbidden pattern found"
fi
```

stale 참조 점검 (popup/문서 트리):

```bash
if rg -n "0\\.3\\.5|이전 라운드|이전 인터-라운드|이전 import token|쿠키 조회 API|document\\.cookie" popup.js README.md docs; then
  exit 1
fi
```

이 scan들은 단순 문자열 점검입니다. `content.js`의 `document.body.innerText`는 버튼 클릭 시 보이는 본문 텍스트만 읽기 위한 허용 동작입니다. 실제 과수집 코드나 하드코딩 비밀값이 있으면 제거합니다.

## 새 서버 origin 추가

1. `manifest.json` `host_permissions`에 `http://host:port/*` 형식으로 추가합니다.
2. `popup.js`와 `background.js`의 `SERVER_URL`/`SERVER_ORIGIN`을 같은 origin으로 갱신합니다.
3. README 또는 `docs/CONFIGURATION.md`의 허용 origin 목록도 갱신합니다.
4. 브라우저 확장 목록에서 reload합니다.
5. popup에 표시된 origin과 실제 운영 origin이 같은지 확인한 뒤 전송을 확인합니다.

## 새 origin의 시크릿 동작 확인

1. 새 origin을 manifest host permissions에 추가한 뒤 확장 reload.
2. `brave://extensions` 또는 `chrome://extensions`의 `Coupang Detail Import` 카드에서 `Allow in Private` / `Allow in Incognito`가 켜져 있는지 확인.
3. current-list 페이지에서 `갱신 필요 상품 확인` 또는 `상단 30개 강제 갱신`을 눌러 popup의 `모드 시크릿(라운드별 새 시크릿 창)` 안내가 노출되는지 확인.
4. popup `최근 current-list batch`의 `closedOwnedWindows` 수치로 시크릿 창이 정리되는지 확인.

## 수동 smoke

1. `brave://extensions`에서 extension reload.
2. Coupang 상품 상세 페이지 열기.
3. popup에서 서버 origin 확인.
4. 자동 송신 기본 OFF인지 확인.
5. `현재 페이지 저장` 클릭.
6. popup success message 확인.
7. 자동 송신 ON 뒤 새 상품 상세 페이지를 열어 최근 자동 상태 확인.
8. `price_monitoring v0.2.0+` 서버 UI 또는 로그에서 import 결과 확인.
9. current-list 페이지에서 `갱신 필요 상품 확인`을 눌러 popup `최근 current-list batch` 카드에 `모드 시크릿(라운드별 새 시크릿 창) · 라운드 N/M · 닫은 시크릿 창 K개` 안내가 뜨는지 확인.

## 배포 전 checklist

- [ ] `manifest.json` parse PASS.
- [ ] `node --check popup.js` PASS.
- [ ] `node --check content.js` PASS.
- [ ] `node --check background.js` PASS.
- [ ] `node --check current_list_bridge.js` PASS.
- [ ] 비밀 인증값, `.env`, DB, cookie/세션/토큰 수집 코드 없음.
- [ ] README와 docs의 서버 origin 목록이 source와 일치.
- [ ] README/USAGE/CONFIGURATION/TROUBLESHOOTING가 v0.4.1 contract(8-12 라운드, 10-20 인터-라운드, 시크릿 회전, 시크릿 미허용 실패, regular fallback 조건)를 일관되게 설명.
- [ ] LLM-assisted install guide가 비밀값/destructive command 경계를 설명.
- [ ] 자동 test suite는 아직 없으며, 현재 기준은 정적 검증과 수동/자동 smoke임을 유지.
- [ ] Brave unpacked reload 후 popup manual smoke와 auto-mode smoke 확인.
- [ ] current-list 페이지에서 `갱신 필요 상품 확인`/`상단 30개 강제 갱신`으로 시크릿 batch smoke 확인.

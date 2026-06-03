# 개발/검증 가이드

## 원칙

- 이 repo에는 브라우저 확장 source만 둡니다.
- `price_monitoring` 서버 코드, DB, `.env`, 비밀 인증값 원문은 추가하지 않습니다.
- 사용자가 버튼을 누른 수동 저장과, 사용자가 명시적으로 켠 자동 송신만 허용합니다.
- cookie, 브라우저 저장소 값, credential, screenshot, full HTML markup은 수집하지 않습니다.

## 파일 역할

| 파일 | 역할 |
|------|------|
| `manifest.json` | Manifest V3 metadata, permissions, host permissions |
| `popup.html` | popup form, auto toggle, 최근 상태 surface |
| `popup.js` | fixed server origin, 수동 저장, auto toggle rendering |
| `content.js` | 상품 상세 페이지 auto payload collector and trigger |
| `background.js` | import POST, version metadata, dedup, last status persistence |
| `docs/` | operator and developer documentation |

## LLM-assisted installation docs

사용자 설치를 LLM이나 coding agent가 도울 수 있으므로 `docs/LLM_ASSISTED_INSTALL.md`를 설치 문서와 같이 유지합니다.

문서 변경 시 확인할 것:

- LLM/agent가 비밀 인증값을 요구하거나 출력하지 않도록 안내한다.
- 서버 전체 설치가 아니라 browser extension 설치임을 명확히 쓴다.
- destructive command는 사용자 명시 확인 전 실행하지 않도록 쓴다.
- 브라우저 UI 조작은 사용자가 직접 확인하는 절차로 쓴다.

## 로컬 검증

repo root에서 실행합니다.

```bash
python3 -m json.tool manifest.json >/tmp/pm_ext_manifest.json
node --check popup.js
node --check content.js
node --check background.js
```

금지 패턴 점검:

```bash
if rg -n "cookie|credentials|localStorage\\.(get|set)|sessionStorage|innerHTML|outerHTML|document\\.documentElement|Authorization|Bearer|DETAIL_CHECK_IMPORT_TOKEN" manifest.json popup.html popup.js content.js background.js; then
  echo "FAIL: forbidden pattern found"
  exit 1
else
  echo "PASS: no forbidden pattern found"
fi
```

이 scan은 단순 문자열 점검입니다. `PASS: no forbidden pattern found`가 나와야 통과합니다. `content.js`의 `document.body.innerText`는 버튼 클릭 시 보이는 본문 텍스트만 읽기 위한 허용 동작입니다. 실제 과수집 코드나 하드코딩 비밀값이 있으면 제거합니다.

## 새 서버 origin 추가

1. `manifest.json` `host_permissions`에 `http://host:port/*` 형식으로 추가합니다.
2. `popup.js`와 `background.js`의 `SERVER_URL`/`SERVER_ORIGIN`을 같은 origin으로 갱신합니다.
3. README 또는 `docs/CONFIGURATION.md`의 허용 origin 목록도 갱신합니다.
4. 브라우저 확장 목록에서 reload합니다.
5. popup에 표시된 origin과 실제 운영 origin이 같은지 확인한 뒤 전송을 확인합니다.

## 수동 smoke

1. `brave://extensions`에서 extension reload.
2. Coupang 상품 상세 페이지 열기.
3. popup에서 서버 origin 확인.
4. 자동 송신 기본 OFF인지 확인.
5. `현재 페이지 저장` 클릭.
6. popup success message 확인.
7. 자동 송신 ON 뒤 새 상품 상세 페이지를 열어 최근 자동 상태 확인.
8. `price_monitoring` 서버 UI 또는 로그에서 import 결과 확인.

## 배포 전 checklist

- [ ] `manifest.json` parse PASS.
- [ ] `node --check popup.js` PASS.
- [ ] `node --check content.js` PASS.
- [ ] `node --check background.js` PASS.
- [ ] 비밀 인증값, `.env`, DB, cookie 수집 코드 없음.
- [ ] README와 docs의 서버 origin 목록이 source와 일치.
- [ ] LLM-assisted install guide가 비밀값/destructive command 경계를 설명.
- [ ] 자동 test suite는 아직 없으며, 현재 기준은 정적 검증과 수동/자동 smoke임을 유지.
- [ ] Brave unpacked reload 후 popup manual smoke와 auto-mode smoke 확인.

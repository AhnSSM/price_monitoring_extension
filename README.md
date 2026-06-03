# Price Monitoring Extension

`price_monitoring` 서버의 Coupang Apple return-sale 상세 확인을 보조하는 개인용 Brave/Chrome 확장 프로그램입니다.

사용자가 직접 연 `https://www.coupang.com/` 상품 페이지에서 보이는 텍스트만 수집해 `price_monitoring` 서버의 detail import API로 전송합니다. 공식 웹스토어 배포 없이 GitHub repo를 받아 압축해제 확장 프로그램으로 설치하는 방식입니다.

## 빠른 시작

```bash
git clone git@github.com:AhnSSM/price_monitoring_extension.git
```

1. Brave에서 `brave://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 누릅니다.
4. 이 repo root, 즉 `price_monitoring_extension` 폴더를 선택합니다.
5. 확장 popup에서 서버 URL과 Bearer token을 저장합니다.

Chrome도 같은 방식이며 주소만 `chrome://extensions`입니다.

## 문서

- [설치와 업데이트](docs/INSTALL.md)
- [설정값과 서버 연결](docs/CONFIGURATION.md)
- [사용 절차](docs/USAGE.md)
- [LLM 설치 지원 가이드](docs/LLM_ASSISTED_INSTALL.md)
- [문제 해결](docs/TROUBLESHOOTING.md)
- [개발/검증 가이드](docs/DEVELOPMENT.md)

## 포함 파일

- `manifest.json`: Manifest V3 설정과 host permission.
- `popup.html`: 서버 URL, token, 수동 전송 버튼 UI.
- `popup.js`: 설정 저장, Coupang 탭 확인, page payload 수집, import API POST.
- `content.js`: 현재 페이지의 최소 텍스트 정보만 반환하는 content script.
- `docs/`: 설치, 설정, 운영, 문제 해결, 개발 검증 문서.

## LLM에게 설치를 맡길 때

다른 LLM이나 coding agent가 설치를 도울 경우 [LLM 설치 지원 가이드](docs/LLM_ASSISTED_INSTALL.md)를 먼저 읽게 하세요.

핵심 원칙:

- 이 repo는 브라우저 확장만 설치합니다. `price_monitoring` 서버 전체를 설치하지 않습니다.
- token 값을 묻거나 출력하거나 Git에 기록하지 않습니다.
- `manifest.json`이 있는 repo root를 브라우저의 unpacked extension으로 로드합니다.
- 사용자의 Brave/Chrome UI 조작은 사용자가 직접 확인해야 합니다.

## 수집 범위

서버로 전송하는 값은 아래 네 가지입니다.

- `url`
- `final_url`
- `title`
- `text` from `document.body.innerText`

수집하지 않는 항목:

- 브라우저 세션/cookie.
- localStorage/sessionStorage 값.
- 계정 자격 증명.
- 스크린샷.
- 전체 HTML markup.
- 서버 `.env`, DB, token 원문.

## 운영 전제

- `price_monitoring` 서버가 detail import API를 제공해야 합니다.
- popup에 입력하는 Bearer token은 서버의 `DETAIL_CHECK_IMPORT_TOKEN` 값과 같아야 합니다.
- token은 repo에 포함하지 않습니다. 사용자 브라우저의 `chrome.storage.local`에만 저장됩니다.
- 현재 기본 서버 URL은 `http://100.118.184.5:5000`입니다.

## 검증

코드 변경 후 아래 명령을 실행합니다.

```bash
python3 -m json.tool manifest.json >/tmp/pm_ext_manifest.json
node --check popup.js
node --check content.js
```

문서에는 설명을 위해 `cookie`, `localStorage` 같은 단어가 등장하므로 실제 검증에서는 source 파일만 대상으로 삼습니다.

```bash
if rg -n "cookie|localStorage|innerHTML|outerHTML|document\\.documentElement|DETAIL_CHECK_IMPORT_TOKEN=.*[A-Za-z0-9]" manifest.json popup.html popup.js content.js; then
  echo "FAIL: forbidden pattern found"
  exit 1
else
  echo "PASS: no forbidden pattern found"
fi
```

마지막 scan은 금지 패턴 점검용입니다. `PASS: no forbidden pattern found`가 나와야 통과합니다. 실제 token이나 cookie 수집 코드가 나오면 커밋 전에 제거해야 합니다.

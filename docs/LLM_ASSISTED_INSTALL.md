# LLM 설치 지원 가이드

이 문서는 다른 LLM, coding agent, 원격 지원자가 사용자의 Brave/Chrome에 `price_monitoring_extension` 설치를 도울 때 따라야 할 절차입니다.

목표는 브라우저 확장만 안전하게 설치하고, 서버 비밀값이나 개인 설정을 노출하지 않는 것입니다.

## 역할 구분

| 역할 | 해야 할 일 | 하지 말아야 할 일 |
|------|------------|-------------------|
| LLM/agent | repo clone/pull 안내, 파일 구조 확인, 검증 명령 실행, 브라우저 설치 절차 안내 | 비밀 인증값 요구/출력/저장, 서버 전체 설치, `.env` 수정, 무단 삭제 |
| 사용자 | Brave/Chrome UI에서 unpacked extension 로드, Coupang page에서 수동/자동 동작 확인 | 비밀 인증값을 채팅이나 로그에 붙여넣기 |

## 설치 전 확인

LLM/agent는 먼저 아래를 확인합니다.

```bash
test -d /home/kth/workspace && echo "workspace exists"
git --version
```

repo가 없으면 clone합니다.

```bash
cd /home/kth/workspace
git clone git@github.com:AhnSSM/price_monitoring_extension.git
```

SSH key가 없는 환경에서는 HTTPS fallback을 사용합니다.

```bash
cd /home/kth/workspace
git clone https://github.com/AhnSSM/price_monitoring_extension.git
```

repo가 이미 있으면 pull합니다.

```bash
git -C /home/kth/workspace/price_monitoring_extension pull
```

## Source 구조 확인

```bash
cd /home/kth/workspace/price_monitoring_extension
test -f manifest.json
test -f popup.html
test -f popup.js
test -f content.js
test -f background.js
test -d docs
```

`manifest.json`이 있는 디렉터리가 브라우저에서 선택해야 할 repo root입니다.

## 검증 명령

```bash
cd /home/kth/workspace/price_monitoring_extension
python3 -m json.tool manifest.json >/tmp/pm_ext_manifest.json
node --check popup.js
node --check content.js
node --check background.js
node tests/background_batch_wave.test.mjs
node tests/background_blocked_cleanup.test.mjs
if rg -n "chrome[.]cookies|document[.]cookie|Authorization|token" manifest.json popup.html popup.js content.js background.js; then
  echo "FAIL: forbidden pattern found"
  exit 1
else
  echo "PASS: no forbidden pattern found"
fi
```

마지막 scan은 금지 패턴 점검입니다. `PASS: no forbidden pattern found`가 나오면 정상입니다. `FAIL`이 나오면 설치를 중단하고 사용자에게 보고합니다. `content.js`의 `document.body.innerText`는 버튼 클릭 시 보이는 본문 텍스트만 읽기 위한 허용 동작입니다. 실제 비밀 인증값 처리, cookie 수집, broad DOM injection 코드가 나오면 커밋하거나 설치 안내를 계속하지 않습니다.

## Brave 설치 안내

LLM/agent는 사용자의 브라우저 UI를 임의로 조작하지 말고, 사용자가 아래를 직접 확인하게 안내합니다.

1. `brave://extensions` 열기.
2. `개발자 모드` 켜기.
3. `압축해제된 확장 프로그램 로드` 클릭.
4. `/home/kth/workspace/price_monitoring_extension` 선택.
5. `Coupang Detail Import` 카드가 보이는지 확인.
6. 카드 상세에서 Brave는 `Allow in Private`, Chrome은 `Allow in Incognito`를 켭니다. 이 설정이 꺼져 있으면 서버의 current-list 갱신 버튼은 regular 모드로 자동 fallback하지 않고 `incognito_not_allowed`로 중단합니다.

Chrome이면 `chrome://extensions`에서 같은 절차를 사용합니다.

## 설정 안내

popup은 서버 URL `http://100.118.184.5:5000`을 읽기 전용으로 보여 줍니다.

자동 송신 관련 운영 상태는 `chrome.storage.local`에만 저장합니다.

- `autoModeEnabled`: 기본 `false`
- `autoDedupMetadata`: 최근 dedup key/timestamp
- `lastAutoStatus`: 최근 자동 송신 결과

중요:

- LLM/agent는 비밀 인증값을 채팅에 붙여넣으라고 요구하지 않습니다.
- LLM/agent는 비밀 인증값을 echo, log, screenshot, commit에 남기지 않습니다.
- 이 확장은 별도 인증 입력 없이 서버의 Tailscale source gate만 전제로 동작합니다.
- current-list batch 기본값은 extension v0.4.1 기준입니다. 라운드마다 새 시크릿 창을 열고, 라운드 크기는 8-12개, 라운드 사이 대기는 10-20초, 탭 열기 간격은 0.3-1.0초입니다.

## 수동 동작 확인

사용자가 직접 수행합니다.

1. `https://www.coupang.com/vp/products/*` 상품 상세 페이지 열기.
2. `Coupang Detail Import` popup 열기.
3. 서버 URL 표시가 현재 운영 origin과 같은지 확인.
4. `현재 페이지 저장` 클릭.
5. success 또는 error 메시지 확인.
6. 서버 UI에서 import 결과 확인.

자동 송신 확인이 필요하면 popup에서 toggle을 ON으로 바꾸고, 새 상품 상세 페이지를 열어 최근 자동 상태를 확인합니다. 같은 상품은 최근 10분 동안 자동 중복 전송하지 않습니다.

## 문제 발생 시 LLM/agent가 확인할 것

```bash
git -C /home/kth/workspace/price_monitoring_extension status --short --branch
git -C /home/kth/workspace/price_monitoring_extension log --oneline -1
python3 -m json.tool /home/kth/workspace/price_monitoring_extension/manifest.json >/tmp/pm_ext_manifest.json
node --check /home/kth/workspace/price_monitoring_extension/popup.js
node --check /home/kth/workspace/price_monitoring_extension/content.js
node --check /home/kth/workspace/price_monitoring_extension/background.js
```

브라우저 popup 메시지별 해석은 [문제 해결](TROUBLESHOOTING.md)을 따릅니다.

## 금지 사항

LLM/agent는 아래 작업을 하지 않습니다.

- `price_monitoring` 서버 전체 설치를 시도.
- 비밀 인증값, `.env`, DB 파일을 repo에 복사.
- 사용자의 비밀 인증값을 출력하거나 저장.
- `npm install`, `pip install`, `docker compose up`, DB 초기화처럼 서버나 backend dependency를 설치.
- `git reset --hard`, `git clean`, `rm -rf` 같은 파괴적 명령 실행.
- 사용자의 브라우저 profile을 삭제하거나 초기화.
- 공식 웹스토어 배포를 시도.

## 성공 기준

- extension repo가 clone 또는 pull되어 있다.
- `manifest.json`, `popup.html`, `popup.js`, `content.js`가 repo root에 있다.
- 정적 검증이 통과한다.
- 사용자가 Brave/Chrome에서 unpacked extension을 로드했다.
- popup에 운영 서버 URL이 고정 표시된다.
- Coupang 상세 page에서 수동 전송 결과를 확인했다.

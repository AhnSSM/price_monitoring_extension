# Price Monitoring Extension

Brave 또는 Chrome에서 압축해제된 확장 프로그램으로 불러와, 현재 열려 있는 `https://www.coupang.com/` 상품 페이지의 보이는 텍스트를 `price_monitoring` 서버의 상세 확인 import API로 수동 전송하는 로컬 MVP입니다.

이 확장 프로그램은 공식 웹스토어 배포가 필요하지 않습니다. 운영자가 로컬에서 파일을 수정하고 `brave://extensions` 또는 `chrome://extensions`에서 다시 불러오면 됩니다.

## 설치용 GitHub 저장소

이 저장소는 `price_monitoring` 서버 전체가 아니라 브라우저 확장 프로그램만 담습니다.

```bash
git clone git@github.com:AhnSSM/price_monitoring_extension.git
```

이미 받은 뒤 업데이트할 때는:

```bash
cd price_monitoring_extension
git pull
```

## 포함 파일

- `manifest.json`: Manifest V3 설정
- `popup.html`: 서버 URL, 토큰, 수동 저장 버튼 UI
- `popup.js`: 설정 저장, Coupang 탭 확인, 수집 후 import API POST
- `content.js`: 현재 페이지의 최소 텍스트 정보만 반환하는 수집기

## 수집 범위

MVP는 아래 값만 서버로 전송합니다.

- `url`
- `final_url`
- `title`
- `text` (`document.body.innerText`)

수집하지 않는 항목:

- 브라우저 세션 정보
- 페이지 저장소 데이터
- 계정 자격 증명
- 스크린샷
- 전체 마크업

## 설치 방법

### Brave

1. `brave://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 클릭합니다.
4. 이 저장소 루트 디렉터리인 `price_monitoring_extension`를 선택합니다.

### Chrome

1. `chrome://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 클릭합니다.
4. 이 저장소 루트 디렉터리인 `price_monitoring_extension`를 선택합니다.

## 최초 설정

확장 프로그램 팝업에서 아래 두 값을 입력합니다.

- 서버 URL: 기본값은 `http://100.118.184.5:5000`
- Bearer 토큰: 서버에서 `DETAIL_CHECK_IMPORT_TOKEN`으로 설정한 값

입력한 값은 `chrome.storage.local`에 로컬 저장됩니다.

지원 서버 URL은 `manifest.json`의 `host_permissions`에 포함된 origin으로 제한됩니다.

- `http://100.118.184.5:5000`
- `http://127.0.0.1:5000`
- `http://127.0.0.1:5001`
- `http://localhost:5000`
- `http://localhost:5001`

다른 Tailscale IP, hostname, 또는 포트를 쓰려면 `manifest.json`의 `host_permissions`와 `popup.js`의 `ALLOWED_SERVER_ORIGINS`를 같이 추가한 뒤 확장 프로그램을 새로고침해야 합니다.

## 사용 방법

1. Brave 또는 Chrome에서 `https://www.coupang.com/` 상품 페이지를 엽니다.
2. 툴바의 `Coupang Detail Import` 확장 프로그램 아이콘을 클릭합니다.
3. 서버 URL과 토큰을 확인합니다.
4. `현재 페이지 저장`을 누릅니다.
5. 팝업 상태 문구에서 성공/실패를 확인합니다.
6. 서버 UI 또는 로그에서 import 결과를 검토합니다.

자동 제출은 지원하지 않습니다. 버튼을 누를 때만 한 번 전송합니다.

## 업데이트 방법

1. 이 디렉터리의 파일을 수정합니다.
2. `brave://extensions` 또는 `chrome://extensions`로 돌아갑니다.
3. 해당 확장 카드에서 `새로고침` 버튼을 누릅니다.
4. 팝업을 다시 열어 변경 사항을 확인합니다.

## 문제 확인

- `www.coupang.com 상품 페이지에서만 사용할 수 있습니다.`: 활성 탭이 Coupang 상품 페이지가 아닙니다.
- `Bearer 토큰을 입력하세요.`: 팝업에 토큰이 비어 있습니다.
- `manifest.json에 허용된 서버 URL만 사용할 수 있습니다.`: 입력한 서버 origin이 확장 권한 목록에 없습니다.
- `전송 실패: HTTP 403`: 서버 토큰이 없거나 잘못되었을 가능성이 큽니다.
- `보이는 본문 텍스트가 비어 있습니다.`: 페이지가 완전히 로드되지 않았거나 접근 차단 상태일 수 있습니다.
